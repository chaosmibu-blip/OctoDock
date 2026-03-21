import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { schedules } from "@/db/schema";
import { eq, and } from "drizzle-orm";

// ============================================================
// 排程管理 API
// GET: 列出用戶的所有排程
// PATCH: 啟停排程
// DELETE: 刪除排程
// ============================================================

/** GET /api/schedules — 列出用戶的所有排程 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db
    .select()
    .from(schedules)
    .where(eq(schedules.userId, session.user.id));

  return NextResponse.json({ ok: true, schedules: rows });
}

/** PATCH /api/schedules — 啟停排程 */
export async function PATCH(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { id, isActive } = body as { id: string; isActive: boolean };

  if (!id || typeof isActive !== "boolean") {
    return NextResponse.json({ error: "Missing id or isActive" }, { status: 400 });
  }

  // 確保只能改自己的排程
  const result = await db
    .update(schedules)
    .set({ isActive, updatedAt: new Date() })
    .where(and(eq(schedules.id, id), eq(schedules.userId, session.user.id)));

  return NextResponse.json({ ok: true, result });
}

/** DELETE /api/schedules — 刪除排程 */
export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { id } = body as { id: string };

  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  // 確保只能刪自己的排程
  await db
    .delete(schedules)
    .where(and(eq(schedules.id, id), eq(schedules.userId, session.user.id)));

  return NextResponse.json({ ok: true });
}
