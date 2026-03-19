import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { connectedApps, operations } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { loadAdapters, getAllAdapters } from "@/mcp/registry";
import { loadCombos, getCombosWithStatus } from "@/combos/registry";
import { discoverCombos } from "@/combos/auto-discover";
import { getActionZh } from "@/data/action-i18n";

/**
 * GET /api/skills
 * 回傳技能樹所需的完整資料：
 * - apps：所有 App adapter 的 action 清單 + 用戶連接狀態
 * - combos：已驗證的組合技 + 即時計算的 unlocked 狀態
 * 未登入時仍回傳完整清單，但 connected/unlocked 全部為 false
 */
export async function GET() {
  /* 載入所有 adapter 和組合技 */
  await loadAdapters();
  await loadCombos();
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

  // U17: 查詢每個 action 的使用次數（用於前端區分已解鎖/未解鎖）
  let usedActionsMap = new Map<string, Set<string>>(); // app → Set<action>
  if (session?.user?.id) {
    try {
      const usedActions = await db
        .select({
          appName: operations.appName,
          action: operations.action,
        })
        .from(operations)
        .where(
          and(
            eq(operations.userId, session.user.id),
            eq(operations.success, true),
          ),
        )
        .groupBy(operations.appName, operations.action);

      for (const row of usedActions) {
        if (!usedActionsMap.has(row.appName)) {
          usedActionsMap.set(row.appName, new Set());
        }
        usedActionsMap.get(row.appName)!.add(row.action);
      }
    } catch {
      // 查詢失敗不影響主流程
    }
  }

  /* 組合回傳資料 */
  const apps = adapters.map((adapter) => {
    const conn = connectedMap.get(adapter.name);

    /* 從 actionMap 取得所有 action，搭配 getSkill 取描述 */
    // U17: 加入 used 欄位，標示該 action 是否曾被使用過
    const appUsedActions = usedActionsMap.get(adapter.name) ?? new Set();
    const actions = Object.keys(adapter.actionMap).map((actionName) => {
      /* 嘗試從 tools 找到對應的 description */
      const internalToolName = adapter.actionMap[actionName];
      const tool = adapter.tools.find((t) => t.name === internalToolName);
      return {
        name: actionName,
        description: {
          zh: getActionZh(adapter.name, actionName),
          en: tool?.description ?? actionName,
        },
        used: appUsedActions.has(actionName), // U17: 已解鎖 = true
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

  /* 組合技：根據用戶已連接的 App 計算 unlocked 狀態 */
  const connectedAppNames = new Set(
    userApps.filter((a) => a.status === "active").map((a) => a.appName),
  );
  const combos = getCombosWithStatus(connectedAppNames);

  /* 第三層：自動發現的候選組合技（需要登入才有資料） */
  let discovered: Awaited<ReturnType<typeof discoverCombos>> = [];
  if (session?.user?.id) {
    try {
      discovered = await discoverCombos(session.user.id);
    } catch {
      /* 自動發現失敗不影響主回傳 */
    }
  }

  return NextResponse.json({ apps, combos, discovered });
}
