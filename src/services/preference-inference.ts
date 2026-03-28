import { db } from "@/db";
import { operations } from "@/db/schema";
import { eq, desc, sql, and, gte } from "drizzle-orm";
import { storeMemory } from "./memory-engine";

// ============================================================
// 偏好推斷服務
// 分析 operations 表的歷史數據，自動發現用戶的使用模式
// 由 memory-maintenance.ts 在每次操作後非同步觸發（每用戶每小時最多一次）
// ============================================================

/**
 * 從操作歷史推斷用戶偏好，存入 memory
 * 三種分析：1. 常用工具（≥3 次的標記為 frequent）2. App 使用排名 3. 近 7 天活動摘要
 * @returns 本次儲存的記憶數量
 */
export async function inferPreferences(userId: string): Promise<number> {
  let memoriesStored = 0;

  // 1. Tool usage frequency — discover which tools are used most
  const toolFreqs = await db
    .select({
      toolName: operations.toolName,
      appName: operations.appName,
      count: sql<number>`count(*)::int`,
    })
    .from(operations)
    .where(
      and(
        eq(operations.userId, userId),
        eq(operations.success, true),
      ),
    )
    .groupBy(operations.toolName, operations.appName)
    .orderBy(desc(sql`count(*)`))
    .limit(10);

  for (const freq of toolFreqs) {
    if (freq.count >= 3) {
      await storeMemory(
        userId,
        `frequent_tool_${freq.toolName}`,
        `User frequently uses ${freq.toolName} (${freq.count} times)`,
        "pattern",
        freq.appName,
      );
      memoriesStored++;
    }
  }

  // 2. App usage patterns — which apps are used most
  const appFreqs = await db
    .select({
      appName: operations.appName,
      count: sql<number>`count(*)::int`,
    })
    .from(operations)
    .where(
      and(
        eq(operations.userId, userId),
        eq(operations.success, true),
      ),
    )
    .groupBy(operations.appName)
    .orderBy(desc(sql`count(*)`));

  if (appFreqs.length > 0) {
    const appList = appFreqs
      .map((a) => `${a.appName}(${a.count})`)
      .join(", ");
    await storeMemory(
      userId,
      "app_usage_ranking",
      `App usage frequency: ${appList}`,
      "pattern",
    );
    memoriesStored++;
  }

  // 3. Recent activity patterns — what has the user been doing lately
  const recentOps = await db
    .select({
      appName: operations.appName,
      toolName: operations.toolName,
      count: sql<number>`count(*)::int`,
    })
    .from(operations)
    .where(
      and(
        eq(operations.userId, userId),
        eq(operations.success, true),
        gte(operations.createdAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
      ),
    )
    .groupBy(operations.appName, operations.toolName)
    .orderBy(desc(sql`count(*)`))
    .limit(5);

  if (recentOps.length > 0) {
    const summary = recentOps
      .map((o) => `${o.toolName}(${o.count})`)
      .join(", ");
    await storeMemory(
      userId,
      "recent_activity_7d",
      `Recent 7-day activity: ${summary}`,
      "context",
    );
    memoriesStored++;
  }



  return memoriesStored;
}
