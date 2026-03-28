import { db } from "@/db";
import { operations, memory } from "@/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";

// ============================================================
// C2 + C3: Post-check Middleware
// C2: 操作後跟歷史基線比對，異常時發 warning
// C3: 偵測修正 pattern（create+delete、rapid replace）
//
// 設計原則：
// - warning 計算同步（要放進 response）
// - memory 寫入非同步（不阻塞主請求）
// - 新用戶保護：operations 資料不足 7 天不發 warning
// ============================================================

/** 基線異常倍數閾值：今日次數 > 日均 × 此倍數 AND 今日次數 > 10 時才發 warning（兩個條件都要滿足） */
const ANOMALY_MULTIPLIER = parseFloat(process.env.POST_CHECK_ANOMALY_MULTIPLIER ?? "3");

/** 修正 pattern 偵測的時間窗口（毫秒） */
const CONSOLIDATION_WINDOW_MS = 30 * 60 * 1000; // 30 分鐘
const RAPID_REPLACE_WINDOW_MS = 10 * 60 * 1000; // 10 分鐘

/** post-check 結果 */
export interface PostCheckResult {
  warnings: string[];
}

/**
 * 操作後檢查：歷史基線比對 + 修正 pattern 偵測
 * 失敗不影響主操作
 */
export async function runPostCheck(
  userId: string,
  appName: string,
  toolName: string,
  params: Record<string, unknown>,
): Promise<PostCheckResult | null> {
  try {
    const warnings: string[] = [];

    // 檢查用戶是否有足夠的歷史資料（至少 7 天）
    const oldestOp = await db
      .select({ createdAt: operations.createdAt })
      .from(operations)
      .where(eq(operations.userId, userId))
      .orderBy(operations.createdAt)
      .limit(1);

    if (oldestOp.length === 0) return null;
    const firstOpDate = oldestOp[0].createdAt;
    if (!firstOpDate) return null;
    const daysSinceFirst = (Date.now() - firstOpDate.getTime()) / (24 * 60 * 60 * 1000);
    if (daysSinceFirst < 7) return null; // 新用戶保護

    // ── C2: 今日操作次數 vs 30 天日均 ──
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [todayCount, thirtyDayCount] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)` })
        .from(operations)
        .where(
          and(
            eq(operations.userId, userId),
            eq(operations.appName, appName),
            eq(operations.toolName, toolName),
            gte(operations.createdAt, todayStart),
          ),
        ),
      db
        .select({ count: sql<number>`count(*)` })
        .from(operations)
        .where(
          and(
            eq(operations.userId, userId),
            eq(operations.appName, appName),
            eq(operations.toolName, toolName),
            gte(operations.createdAt, thirtyDaysAgo),
          ),
        ),
    ]);

    const todayN = Number(todayCount[0]?.count ?? 0);
    const totalN = Number(thirtyDayCount[0]?.count ?? 0);
    const dailyAvg = totalN / 30;

    // C2: 高頻操作 warning — 超過日均 N 倍且超過 10 次才發
    if (dailyAvg > 0 && todayN > dailyAvg * ANOMALY_MULTIPLIER && todayN > 10) {
      warnings.push(
        `Today: ${todayN} times for ${toolName} (avg ${dailyAvg.toFixed(1)}/day over 30 days)`,
      );
    }

    // C2: 重複操作 warning — 短時間內對同一目標重複操作
    const targetId = extractTargetId(params);
    if (targetId) {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
      const recentSameTarget = await db
        .select({ count: sql<number>`count(*)` })
        .from(operations)
        .where(
          and(
            eq(operations.userId, userId),
            eq(operations.toolName, toolName),
            gte(operations.createdAt, fiveMinAgo),
            sql`params->>'page_id' = ${targetId} OR params->>'database_id' = ${targetId} OR params->>'block_id' = ${targetId}`,
          ),
        );

      const recentCount = Number(recentSameTarget[0]?.count ?? 0);
      if (recentCount >= 2) {
        warnings.push(
          `Repeated operation: ${toolName} on the same target ${recentCount} times in 5 min`,
        );
      }
    }

    // ── C3: 修正 pattern 偵測（非同步寫入 memory）──
    detectCorrectionPatterns(userId, appName, toolName, params).catch((err) =>
      console.error("Correction pattern detection failed:", err),
    );

    return warnings.length > 0 ? { warnings } : null;
  } catch (err) {
    console.error("Post-check failed:", err);
    return null;
  }
}

/** 從 params 提取目標 ID */
function extractTargetId(params: Record<string, unknown>): string | null {
  return (
    (params.page_id as string) ??
    (params.database_id as string) ??
    (params.block_id as string) ??
    (params.messageId as string) ??
    null
  );
}

/**
 * C3: 偵測修正 pattern
 * - 同一 parent 下 30 分鐘內同時有 create 和 delete → consolidation_after_overcreation
 * - 同一 page 的 replace_content 10 分鐘內超過 2 次 → rapid_content_replacement
 */
async function detectCorrectionPatterns(
  userId: string,
  appName: string,
  toolName: string,
  params: Record<string, unknown>,
): Promise<void> {
  const windowStart = new Date(Date.now() - CONSOLIDATION_WINDOW_MS);

  // 偵測 create + delete 修正模式
  if (toolName.includes("delete") || toolName.includes("trash")) {
    const parentId = params.parent_id as string | undefined;
    if (parentId) {
      const recentCreates = await db
        .select({ count: sql<number>`count(*)` })
        .from(operations)
        .where(
          and(
            eq(operations.userId, userId),
            eq(operations.appName, appName),
            sql`tool_name LIKE '%create%'`,
            gte(operations.createdAt, windowStart),
            sql`params->>'parent_id' = ${parentId}`,
          ),
        );

      if (Number(recentCreates[0]?.count ?? 0) > 0) {
        await upsertPattern(userId, "consolidation_after_overcreation", {
          scope: { app: appName, toolName, parentId },
        });
      }
    }
  }

  // 偵測 rapid replace 模式
  if (toolName.includes("replace_content")) {
    const pageId = params.page_id as string | undefined;
    if (pageId) {
      const rapidWindow = new Date(Date.now() - RAPID_REPLACE_WINDOW_MS);
      const recentReplaces = await db
        .select({ count: sql<number>`count(*)` })
        .from(operations)
        .where(
          and(
            eq(operations.userId, userId),
            sql`tool_name LIKE '%replace_content%'`,
            gte(operations.createdAt, rapidWindow),
            sql`params->>'page_id' = ${pageId}`,
          ),
        );

      if (Number(recentReplaces[0]?.count ?? 0) >= 2) {
        await upsertPattern(userId, "rapid_content_replacement", {
          scope: { app: appName, toolName, pageId },
        });
      }
    }
  }
}

/** 寫入或更新 pattern 到 memory 表 */
async function upsertPattern(
  userId: string,
  patternName: string,
  data: { scope: Record<string, unknown> },
): Promise<void> {
  const existing = await db
    .select({ id: memory.id, value: memory.value })
    .from(memory)
    .where(
      and(
        eq(memory.userId, userId),
        eq(memory.category, "pattern"),
        eq(memory.key, patternName),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    // 更新累計次數
    try {
      const current = JSON.parse(existing[0].value);
      current.count = (current.count ?? 0) + 1;
      current.lastSeen = new Date().toISOString();
      current.scope = data.scope;
      await db
        .update(memory)
        .set({ value: JSON.stringify(current), updatedAt: new Date() })
        .where(eq(memory.id, existing[0].id));
    } catch {
      // parse 失敗就覆蓋
      await db
        .update(memory)
        .set({
          value: JSON.stringify({ ...data, count: 1, lastSeen: new Date().toISOString() }),
          updatedAt: new Date(),
        })
        .where(eq(memory.id, existing[0].id));
    }
  } else {
    // 新建
    await db.insert(memory).values({
      userId,
      category: "pattern",
      key: patternName,
      value: JSON.stringify({ ...data, count: 1, lastSeen: new Date().toISOString() }),
    });
  }
}
