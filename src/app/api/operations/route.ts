import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { operations } from "@/db/schema";
import { eq, desc, and, gte } from "drizzle-orm";

/**
 * 操作歷史 API — 供 Dashboard 事件圖譜頁面使用
 * GET /api/operations?days=7&app=notion
 * 回傳按工作階段分組的操作歷史
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const days = parseInt(url.searchParams.get("days") ?? "7");
  const appFilter = url.searchParams.get("app");

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // 查詢條件
  const conditions = [
    eq(operations.userId, session.user.id),
    gte(operations.createdAt, since),
  ];
  if (appFilter) {
    conditions.push(eq(operations.appName, appFilter));
  }

  // 查詢操作紀錄
  const rows = await db
    .select({
      id: operations.id,
      appName: operations.appName,
      action: operations.action,
      intent: operations.intent,
      success: operations.success,
      durationMs: operations.durationMs,
      parentOperationId: operations.parentOperationId,
      createdAt: operations.createdAt,
    })
    .from(operations)
    .where(and(...conditions))
    .orderBy(desc(operations.createdAt))
    .limit(500);

  // 動態分組：相鄰操作間隔 > 30 分鐘 = 新的工作階段
  const SESSION_GAP_MS = 30 * 60 * 1000;

  // 倒序改正序方便分組
  const sorted = [...rows].reverse();

  interface SessionGroup {
    startedAt: string;
    endedAt: string;
    operationCount: number;
    apps: string[];
    operations: Array<{
      id: string;
      appName: string;
      action: string;
      intent: string | null;
      success: boolean | null;
      durationMs: number | null;
      parentOperationId: string | null;
      createdAt: string;
    }>;
  }

  const sessions: SessionGroup[] = [];
  let currentOps: typeof sorted = [];

  for (let i = 0; i < sorted.length; i++) {
    if (i === 0) {
      currentOps.push(sorted[i]);
      continue;
    }

    const prevTime = sorted[i - 1].createdAt?.getTime() ?? 0;
    const currTime = sorted[i].createdAt?.getTime() ?? 0;

    if (currTime - prevTime > SESSION_GAP_MS) {
      sessions.push(buildSession(currentOps));
      currentOps = [sorted[i]];
    } else {
      currentOps.push(sorted[i]);
    }
  }
  if (currentOps.length > 0) {
    sessions.push(buildSession(currentOps));
  }

  return NextResponse.json({
    sessions: sessions.reverse(),
    totalOperations: rows.length,
    periodDays: days,
  });
}

/** 從一組操作建立工作階段摘要 */
function buildSession(ops: Array<{
  id: string;
  appName: string;
  action: string;
  intent: string | null;
  success: boolean | null;
  durationMs: number | null;
  parentOperationId: string | null;
  createdAt: Date | null;
}>) {
  const apps = [...new Set(ops.map((o) => o.appName))];
  return {
    startedAt: ops[0]?.createdAt?.toISOString() ?? "",
    endedAt: ops[ops.length - 1]?.createdAt?.toISOString() ?? "",
    operationCount: ops.length,
    apps,
    operations: ops.map((o) => ({
      id: o.id,
      appName: o.appName,
      action: o.action,
      intent: o.intent,
      success: o.success,
      durationMs: o.durationMs,
      parentOperationId: o.parentOperationId,
      createdAt: o.createdAt?.toISOString() ?? "",
    })),
  };
}
