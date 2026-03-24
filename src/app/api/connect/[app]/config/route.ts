/**
 * Per-Action 權限設定 API
 * GET  — 取得 App 的 action 清單 + 目前停用的 action
 * PATCH — 更新停用的 action 清單
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { connectedApps } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getAdapter, ensureAdapters } from "@/mcp/registry";

/** GET /api/connect/:app/config — 取得 action 清單 + 停用狀態 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ app: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { app: appName } = await params;

  // 查已連結的 App
  const [existing] = await db
    .select()
    .from(connectedApps)
    .where(and(
      eq(connectedApps.userId, session.user.id),
      eq(connectedApps.appName, appName),
      eq(connectedApps.status, "active"),
    ))
    .limit(1);
  if (!existing) {
    return NextResponse.json({ error: "App not connected" }, { status: 404 });
  }

  // 從 adapter 取 action 清單 + 描述
  await ensureAdapters();
  const adapter = getAdapter(appName);
  const actions = adapter
    ? Object.entries(adapter.actionMap || {}).map(([name, toolName]) => {
        const toolDef = adapter.tools.find((t) => t.name === toolName);
        return { name, toolName, description: toolDef?.description ?? "" };
      })
    : [];

  const config = (existing.config as Record<string, unknown>) ?? {};
  const disabledActions = (config.disabledActions as string[]) ?? [];

  return NextResponse.json({ appName, actions, disabledActions });
}

/** PATCH /api/connect/:app/config — 更新停用的 action 清單 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ app: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { app: appName } = await params;
  const body = await req.json();
  const { disabledActions } = body as { disabledActions: string[] };

  // 驗證格式
  if (!Array.isArray(disabledActions)) {
    return NextResponse.json({ error: "disabledActions must be an array" }, { status: 400 });
  }

  // 查已連結的 App
  const [existing] = await db
    .select()
    .from(connectedApps)
    .where(and(
      eq(connectedApps.userId, session.user.id),
      eq(connectedApps.appName, appName),
      eq(connectedApps.status, "active"),
    ))
    .limit(1);
  if (!existing) {
    return NextResponse.json({ error: "App not connected" }, { status: 404 });
  }

  // 驗證 action 名稱存在於 actionMap
  await ensureAdapters();
  const adapter = getAdapter(appName);
  if (adapter) {
    const validActions = Object.keys(adapter.actionMap || {});
    const invalid = disabledActions.filter((a) => !validActions.includes(a));
    if (invalid.length > 0) {
      return NextResponse.json({ error: `Unknown actions: ${invalid.join(", ")}` }, { status: 400 });
    }
  }

  // 合併到現有 config（保留其他設定欄位）
  const currentConfig = (existing.config as Record<string, unknown>) ?? {};
  const newConfig = { ...currentConfig, disabledActions };

  await db
    .update(connectedApps)
    .set({ config: newConfig, updatedAt: new Date() })
    .where(and(
      eq(connectedApps.userId, session.user.id),
      eq(connectedApps.appName, appName),
    ));

  return NextResponse.json({ success: true, disabledActions });
}
