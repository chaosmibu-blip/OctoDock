import { db } from "@/db";
import { operations } from "@/db/schema";
import { eq, desc, sql, and, gte } from "drizzle-orm";
import { storeMemory } from "./memory-engine";

// Auto-preference inference: analyze operations to discover user patterns
// Runs periodically or after a batch of operations



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

  // 4. Cross-app patterns — 已移除（原本依賴 task_id 欄位，但該欄位從未寫入過資料）
  // 未來若需要跨 App 關聯分析，可改用時間視窗分組（同一 session 內的操作）

  return memoriesStored;
}
