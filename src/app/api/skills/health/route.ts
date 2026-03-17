import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { operations } from "@/db/schema";
import { eq, and, gte, sql, desc } from "drizzle-orm";

/**
 * GET /api/skills/health
 * 回傳用戶各 App 的健康狀態：成功率、平均回應時間、總呼叫數、最近錯誤
 * 以及各 action 的使用頻率排名
 * 統計範圍：最近 7 天
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  /* 每個 App 的統計摘要 */
  const appStats = await db
    .select({
      appName: operations.appName,
      totalCalls: sql<number>`count(*)::int`,
      successCalls: sql<number>`count(*) filter (where ${operations.success} = true)::int`,
      failedCalls: sql<number>`count(*) filter (where ${operations.success} = false)::int`,
      avgDurationMs: sql<number>`round(avg(${operations.durationMs}))::int`,
    })
    .from(operations)
    .where(
      and(
        eq(operations.userId, userId),
        gte(operations.createdAt, sevenDaysAgo),
      ),
    )
    .groupBy(operations.appName);

  /* 各 action 使用次數排名（前 20） */
  const topActions = await db
    .select({
      appName: operations.appName,
      action: operations.action,
      count: sql<number>`count(*)::int`,
    })
    .from(operations)
    .where(
      and(
        eq(operations.userId, userId),
        gte(operations.createdAt, sevenDaysAgo),
        eq(operations.success, true),
      ),
    )
    .groupBy(operations.appName, operations.action)
    .orderBy(desc(sql`count(*)`))
    .limit(20);

  /* 最近失敗的操作（前 5） */
  const recentErrors = await db
    .select({
      appName: operations.appName,
      action: operations.action,
      result: operations.result,
      createdAt: operations.createdAt,
    })
    .from(operations)
    .where(
      and(
        eq(operations.userId, userId),
        eq(operations.success, false),
        gte(operations.createdAt, sevenDaysAgo),
      ),
    )
    .orderBy(desc(operations.createdAt))
    .limit(5);

  /* 計算每個 App 的健康燈號 */
  const health = appStats.map((stat) => {
    const successRate = stat.totalCalls > 0 ? stat.successCalls / stat.totalCalls : 1;
    let status: 'green' | 'yellow' | 'red';
    if (successRate >= 0.95) status = 'green';
    else if (successRate >= 0.8) status = 'yellow';
    else status = 'red';

    return {
      appName: stat.appName,
      status,
      successRate: Math.round(successRate * 100),
      totalCalls: stat.totalCalls,
      failedCalls: stat.failedCalls,
      avgDurationMs: stat.avgDurationMs ?? 0,
    };
  });

  return NextResponse.json({
    health,
    topActions: topActions.map((a) => ({
      appName: a.appName,
      action: a.action,
      count: a.count,
    })),
    recentErrors: recentErrors.map((e) => ({
      appName: e.appName,
      action: e.action,
      error: typeof e.result === 'object' && e.result !== null
        ? (e.result as Record<string, unknown>).error ?? JSON.stringify(e.result)
        : String(e.result ?? ''),
      time: e.createdAt?.toISOString() ?? '',
    })),
  });
}
