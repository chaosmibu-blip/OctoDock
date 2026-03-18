import { db } from "@/db";
import { operations } from "@/db/schema";
import { and, eq, gte, desc, sql, ne } from "drizzle-orm";

// ============================================================
// E 組: AI 決策輔助進階
// E1: 操作鏈自動補全（一階馬可夫）
// E2: 失敗自動修復建議
// E4: 跨 App 上下文連結
// ============================================================

/** E1: 建議的最低機率閾值 */
const SUGGESTION_PROBABILITY_THRESHOLD = 0.6;
/** E1: 統計的歷史天數 */
const CHAIN_HISTORY_DAYS = 30;
/** E1: 後續操作的時間窗口（毫秒） */
const CHAIN_WINDOW_MS = 5 * 60 * 1000; // 5 分鐘
/** E4: 跨 App 關聯的最大回傳筆數 */
const MAX_CROSS_APP_RESULTS = 3;

/**
 * E1: 操作鏈自動補全
 * 從 operations 表統計「做完 A 之後 5 分鐘內最常接著做什麼」
 * 一階馬可夫鏈，機率超過閾值才建議
 */
export async function suggestNextAction(
  userId: string,
  appName: string,
  toolName: string,
): Promise<{ app: string; action: string; reason: string; probability: number } | null> {
  try {
    const historyStart = new Date(Date.now() - CHAIN_HISTORY_DAYS * 24 * 60 * 60 * 1000);

    // 查這個用戶做完 toolName 之後 5 分鐘內最常接什麼操作
    // 用 SQL window function 找後續操作
    const rows = await db.execute(sql`
      WITH ordered_ops AS (
        SELECT
          tool_name,
          app_name,
          created_at,
          LEAD(tool_name) OVER (PARTITION BY user_id ORDER BY created_at) AS next_tool,
          LEAD(app_name) OVER (PARTITION BY user_id ORDER BY created_at) AS next_app,
          LEAD(created_at) OVER (PARTITION BY user_id ORDER BY created_at) AS next_time
        FROM operations
        WHERE user_id = ${userId}
          AND success = true
          AND created_at >= ${historyStart}
      )
      SELECT
        next_app,
        next_tool,
        COUNT(*) AS cnt,
        COUNT(*)::float / SUM(COUNT(*)) OVER () AS probability
      FROM ordered_ops
      WHERE tool_name = ${toolName}
        AND app_name = ${appName}
        AND next_tool IS NOT NULL
        AND next_time - created_at <= interval '5 minutes'
      GROUP BY next_app, next_tool
      ORDER BY cnt DESC
      LIMIT 1
    `);

    const result = (rows as unknown as Array<{ next_app: string; next_tool: string; cnt: string; probability: string }>);
    if (!result || result.length === 0) return null;

    const top = result[0];
    const prob = parseFloat(top.probability);
    if (prob < SUGGESTION_PROBABILITY_THRESHOLD) return null;

    // 把 toolName 轉回 action name（去掉 app 前綴）
    const actionName = top.next_tool.replace(/^[^_]+_/, "");

    return {
      app: top.next_app,
      action: actionName,
      reason: `Past ${CHAIN_HISTORY_DAYS} days: ${Math.round(prob * 100)}% of the time after ${toolName}`,
      probability: Math.round(prob * 100) / 100,
    };
  } catch (err) {
    console.error("Action chain suggestion failed:", err);
    return null;
  }
}

/**
 * E2: 失敗自動修復建議
 * 從 operations 表找同一用戶、同一 app + action 最近一次成功的 params
 */
export async function getRecoveryHint(
  userId: string,
  appName: string,
  toolName: string,
): Promise<{ lastSuccessfulParams: Record<string, unknown>; note: string } | null> {
  try {
    const lastSuccess = await db
      .select({ params: operations.params, createdAt: operations.createdAt })
      .from(operations)
      .where(
        and(
          eq(operations.userId, userId),
          eq(operations.appName, appName),
          eq(operations.toolName, toolName),
          eq(operations.success, true),
        ),
      )
      .orderBy(desc(operations.createdAt))
      .limit(1);

    if (lastSuccess.length === 0) return null;

    const params = lastSuccess[0].params as Record<string, unknown> | null;
    if (!params) return null;

    return {
      lastSuccessfulParams: params,
      note: `Last successful ${toolName} at ${lastSuccess[0].createdAt?.toISOString() ?? "unknown"}`,
    };
  } catch (err) {
    console.error("Recovery hint query failed:", err);
    return null;
  }
}

/**
 * E3: Action 推薦引擎
 * 統計用戶最常用的前 3 個 action + 最常用的參數
 */
export async function getLikelyNextActions(
  userId: string,
): Promise<Array<{ app: string; action: string; reason: string; suggestedParams?: Record<string, unknown> }>> {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const topActions = await db
      .select({
        appName: operations.appName,
        toolName: operations.toolName,
        count: sql<number>`count(*)`,
      })
      .from(operations)
      .where(
        and(
          eq(operations.userId, userId),
          eq(operations.success, true),
          gte(operations.createdAt, thirtyDaysAgo),
        ),
      )
      .groupBy(operations.appName, operations.toolName)
      .orderBy(desc(sql`count(*)`))
      .limit(3);

    const results: Array<{ app: string; action: string; reason: string; suggestedParams?: Record<string, unknown> }> = [];

    for (const row of topActions) {
      // 找最近一次成功的 params 當建議
      const lastParams = await db
        .select({ params: operations.params })
        .from(operations)
        .where(
          and(
            eq(operations.userId, userId),
            eq(operations.appName, row.appName),
            eq(operations.toolName, row.toolName),
            eq(operations.success, true),
          ),
        )
        .orderBy(desc(operations.createdAt))
        .limit(1);

      const actionName = row.toolName.replace(/^[^_]+_/, "");
      results.push({
        app: row.appName,
        action: actionName,
        reason: `Used ${row.count} times in the past 30 days`,
        suggestedParams: (lastParams[0]?.params as Record<string, unknown>) ?? undefined,
      });
    }

    return results;
  } catch (err) {
    console.error("Likely actions query failed:", err);
    return [];
  }
}

/**
 * E4: 跨 App 上下文連結
 * 用操作的標題/主題做文字匹配，找跨 App 關聯
 */
export async function findCrossAppContext(
  userId: string,
  currentApp: string,
  keyword: string,
): Promise<Array<{ app: string; action: string; title: string; date: string }>> {
  if (!keyword || keyword.length < 2) return [];

  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // SQL LIKE 搜尋 params 和 result jsonb 裡的關鍵字
    const related = await db
      .select({
        appName: operations.appName,
        toolName: operations.toolName,
        params: operations.params,
        result: operations.result,
        createdAt: operations.createdAt,
      })
      .from(operations)
      .where(
        and(
          eq(operations.userId, userId),
          eq(operations.success, true),
          ne(operations.appName, currentApp), // 排除當前 App
          gte(operations.createdAt, thirtyDaysAgo),
          sql`(params::text LIKE ${"%" + keyword + "%"} OR result::text LIKE ${"%" + keyword + "%"})`,
        ),
      )
      .orderBy(desc(operations.createdAt))
      .limit(MAX_CROSS_APP_RESULTS);

    return related.map((row) => {
      const params = row.params as Record<string, unknown> | null;
      const result = row.result as Record<string, unknown> | null;
      const title =
        (params?.title as string) ??
        (params?.subject as string) ??
        (result?.title as string) ??
        row.toolName;

      return {
        app: row.appName,
        action: row.toolName.replace(/^[^_]+_/, ""),
        title,
        date: row.createdAt?.toISOString()?.slice(0, 10) ?? "",
      };
    });
  } catch (err) {
    console.error("Cross-app context query failed:", err);
    return [];
  }
}
