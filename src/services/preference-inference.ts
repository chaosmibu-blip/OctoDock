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

  // 4. Cross-app patterns — detect when apps are used together
  const coOccurrences = await db
    .select({
      appName: operations.appName,
      taskId: operations.taskId,
    })
    .from(operations)
    .where(
      and(
        eq(operations.userId, userId),
        sql`${operations.taskId} IS NOT NULL`,
      ),
    );

  const taskApps = new Map<string, Set<string>>();
  for (const op of coOccurrences) {
    if (!op.taskId) continue;
    if (!taskApps.has(op.taskId)) taskApps.set(op.taskId, new Set());
    taskApps.get(op.taskId)!.add(op.appName);
  }

  const pairCounts = new Map<string, number>();
  for (const apps of taskApps.values()) {
    if (apps.size < 2) continue;
    const sorted = [...apps].sort();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const pair = `${sorted[i]}+${sorted[j]}`;
        pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
      }
    }
  }

  for (const [pair, count] of pairCounts) {
    if (count >= 2) {
      await storeMemory(
        userId,
        `cross_app_pattern_${pair}`,
        `User often uses ${pair.replace("+", " and ")} together in the same task (${count} times)`,
        "pattern",
      );
      memoriesStored++;
    }
  }

  return memoriesStored;
}
