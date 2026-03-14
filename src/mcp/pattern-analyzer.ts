import { db } from "@/db";
import { operations } from "@/db/schema";
import { eq, and, desc, sql, gte } from "drizzle-orm";
import { storeMemory } from "@/services/memory-engine";

// ============================================================
// 行為模式分析器（Pattern Analyzer）
// 從操作記錄中自動提煉用戶的行為模式，存入記憶層
// 這是 OctoDock「越用越懂你」的核心機制之一
//
// 分析時機：每次成功操作後（非同步，不阻塞主請求）
// 分析內容：
//   1. 常用操作（某個 action 用了 N 次以上）
//   2. 常用參數（某個 folder/database 反覆出現）
//   3. 操作組合（搜尋後經常接著建立頁面）
// ============================================================

/** 觸發分析的最低操作次數（避免資料太少時產生雜訊） */
const MIN_OPS_FOR_PATTERN = 3;

/** 分析的時間範圍（最近 30 天） */
const ANALYSIS_WINDOW_DAYS = 30;

/**
 * 分析用戶的操作模式並存入記憶
 * 在每次成功操作後非同步呼叫，不阻塞主請求
 *
 * @param userId 用戶 ID
 * @param appName 剛執行的 App 名稱
 * @param toolName 剛執行的工具名稱
 */
export async function analyzePatterns(
  userId: string,
  appName: string,
  toolName: string,
): Promise<void> {
  try {
    // 並行執行多種分析
    await Promise.all([
      analyzeFrequentActions(userId, appName),
      analyzeFrequentParams(userId, appName),
    ]);
  } catch (err) {
    // 分析失敗不影響主流程
    console.error("Pattern analysis failed:", err);
  }
}

/**
 * 分析常用操作
 * 找出用戶在某個 App 中最常執行的 action
 * 例如：用戶在 Notion 最常用 search 和 create_page
 */
async function analyzeFrequentActions(
  userId: string,
  appName: string,
): Promise<void> {
  const since = new Date();
  since.setDate(since.getDate() - ANALYSIS_WINDOW_DAYS);

  // 統計每個 action 的執行次數
  const actionCounts = await db
    .select({
      action: operations.action,
      count: sql<number>`count(*)::int`,
    })
    .from(operations)
    .where(
      and(
        eq(operations.userId, userId),
        eq(operations.appName, appName),
        eq(operations.success, true),
        gte(operations.createdAt, since),
      ),
    )
    .groupBy(operations.action)
    .orderBy(desc(sql`count(*)`))
    .limit(5);

  // 只記錄使用次數達到門檻的操作
  const frequentActions = actionCounts.filter((a) => a.count >= MIN_OPS_FOR_PATTERN);
  if (frequentActions.length === 0) return;

  // 將常用操作存為 pattern 類型的記憶
  const actionSummary = frequentActions
    .map((a) => `${a.action}(${a.count} times)`)
    .join(", ");

  await storeMemory(
    userId,
    `frequent_actions:${appName}`,
    actionSummary,
    "pattern",
    appName,
  );
}

/**
 * 分析常用參數
 * 找出用戶在操作中反覆使用的參數值
 * 例如：建立頁面時總是放在同一個 parent_id 下
 */
async function analyzeFrequentParams(
  userId: string,
  appName: string,
): Promise<void> {
  const since = new Date();
  since.setDate(since.getDate() - ANALYSIS_WINDOW_DAYS);

  // 取得最近成功操作的參數
  const recentOps = await db
    .select({
      action: operations.action,
      params: operations.params,
    })
    .from(operations)
    .where(
      and(
        eq(operations.userId, userId),
        eq(operations.appName, appName),
        eq(operations.success, true),
        gte(operations.createdAt, since),
      ),
    )
    .orderBy(desc(operations.createdAt))
    .limit(50);

  // 統計 parent_id 使用頻率（Notion 特有）
  if (appName === "notion") {
    const parentCounts = new Map<string, number>();

    for (const op of recentOps) {
      const params = op.params as Record<string, unknown> | null;
      if (!params) continue;
      const parentId = params.parent_id as string | undefined;
      if (parentId) {
        parentCounts.set(parentId, (parentCounts.get(parentId) ?? 0) + 1);
      }
    }

    // 找出最常用的 parent（預設資料夾）
    for (const [parentId, count] of parentCounts.entries()) {
      if (count >= MIN_OPS_FOR_PATTERN) {
        await storeMemory(
          userId,
          `default_parent:${appName}`,
          parentId,
          "pattern",
          appName,
        );
        break; // 只記錄最常用的一個
      }
    }
  }
}
