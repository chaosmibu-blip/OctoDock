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
  _toolName: string,
): Promise<void> {
  try {
    // 並行執行多種分析（含跨 App 模式偵測）
    await Promise.all([
      analyzeFrequentActions(userId, appName),
      analyzeFrequentParams(userId, appName),
      analyzeCrossAppPatterns(userId),
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

  // 統計常用的預設參數（folder/database/calendar 等）
  // 各 App 的 key → param 欄位映射
  const DEFAULT_PARAM_KEYS: Record<string, { paramField: string; memoryKey: string }[]> = {
    notion: [
      { paramField: "parent_id", memoryKey: `default_parent:${appName}` },
      { paramField: "database_id", memoryKey: `default_database:${appName}` },
    ],
    google_calendar: [
      { paramField: "calendar_id", memoryKey: `default_calendar:${appName}` },
    ],
  };

  const paramConfigs = DEFAULT_PARAM_KEYS[appName];
  if (paramConfigs) {
    for (const config of paramConfigs) {
      const valueCounts = new Map<string, number>();

      for (const op of recentOps) {
        const params = op.params as Record<string, unknown> | null;
        if (!params) continue;
        const val = params[config.paramField] as string | undefined;
        if (val) {
          valueCounts.set(val, (valueCounts.get(val) ?? 0) + 1);
        }
      }

      // 找出最常用的值
      let topValue = "";
      let topCount = 0;
      for (const [val, count] of valueCounts.entries()) {
        if (count > topCount) {
          topValue = val;
          topCount = count;
        }
      }

      if (topCount >= MIN_OPS_FOR_PATTERN) {
        await storeMemory(userId, config.memoryKey, topValue, "pattern", appName);
      }
    }
  }
}

/**
 * 分析跨 App 操作模式
 * 偵測「A app 操作後 5 分鐘內接 B app」的組合模式
 * 例如：notion.create_page 之後接 telegram.send_message
 */
async function analyzeCrossAppPatterns(userId: string): Promise<void> {
  const since = new Date();
  since.setDate(since.getDate() - ANALYSIS_WINDOW_DAYS);

  // 用 SQL window function 找跨 App 的前後操作序對
  const rows = await db.execute(sql`
    WITH ordered_ops AS (
      SELECT
        app_name,
        action,
        created_at,
        LEAD(app_name) OVER (ORDER BY created_at) AS next_app,
        LEAD(action) OVER (ORDER BY created_at) AS next_action,
        LEAD(created_at) OVER (ORDER BY created_at) AS next_time
      FROM operations
      WHERE user_id = ${userId}
        AND success = true
        AND created_at >= ${since}
    )
    SELECT
      app_name || '.' || action AS current_step,
      next_app || '.' || next_action AS next_step,
      COUNT(*) AS cnt
    FROM ordered_ops
    WHERE next_app IS NOT NULL
      AND app_name != next_app
      AND next_time - created_at <= interval '5 minutes'
    GROUP BY app_name, action, next_app, next_action
    HAVING COUNT(*) >= ${MIN_OPS_FOR_PATTERN}
    ORDER BY cnt DESC
    LIMIT 5
  `);

  const pairs = rows.rows as unknown as Array<{ current_step: string; next_step: string; cnt: string }>;
  if (!pairs || pairs.length === 0) return;

  // 將跨 App 模式存為 pattern 記憶（null appName 表示跨 App）
  const crossAppSummary = pairs
    .map((p) => `${p.current_step} → ${p.next_step} (${p.cnt}x)`)
    .join("\n");

  // appName 留空 = 跨 App 記憶
  await storeMemory(userId, "cross_app_patterns", crossAppSummary, "pattern");
}
