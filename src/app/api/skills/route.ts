import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { connectedApps } from "@/db/schema";
import { eq } from "drizzle-orm";
import { loadAdapters, getAllAdapters } from "@/mcp/registry";

/**
 * GET /api/skills
 * 回傳技能樹所需的完整資料：所有 App adapter 的 action 清單 + 用戶連接狀態
 * 未登入時仍回傳 App/action 清單，但 connected 全部為 false
 */
export async function GET() {
  /* 載入所有 adapter */
  await loadAdapters();
  const adapters = getAllAdapters();

  /* 查詢用戶已連接的 App（未登入則為空） */
  const session = await auth();
  let userApps: Array<{ appName: string; status: string | null; connectedAt: Date | null }> = [];
  if (session?.user?.id) {
    userApps = await db
      .select({
        appName: connectedApps.appName,
        status: connectedApps.status,
        connectedAt: connectedApps.connectedAt,
      })
      .from(connectedApps)
      .where(eq(connectedApps.userId, session.user.id));
  }

  /* 建立已連接 App 的快速查詢表 */
  const connectedMap = new Map(
    userApps
      .filter((a) => a.status === "active")
      .map((a) => [a.appName, a]),
  );

  /* 組合回傳資料 */
  const apps = adapters.map((adapter) => {
    const conn = connectedMap.get(adapter.name);

    /* 從 actionMap 取得所有 action，搭配 getSkill 取描述 */
    const actions = Object.keys(adapter.actionMap).map((actionName) => {
      /* 嘗試從 tools 找到對應的 description */
      const internalToolName = adapter.actionMap[actionName];
      const tool = adapter.tools.find((t) => t.name === internalToolName);
      return {
        name: actionName,
        description: tool?.description ?? "",
      };
    });

    return {
      name: adapter.name,
      displayName: adapter.displayName,
      authType: adapter.authType,
      connected: !!conn,
      connectedAt: conn?.connectedAt?.toISOString() ?? null,
      actions,
    };
  });

  return NextResponse.json({ apps });
}
