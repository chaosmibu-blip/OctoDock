/**
 * Custom Adapter 個別操作
 * DELETE /api/custom-adapters/:id — 移除自訂 adapter
 * PATCH  /api/custom-adapters/:id — 開啟/關閉分享
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { customAdapters } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  await db
    .delete(customAdapters)
    .where(and(eq(customAdapters.id, id), eq(customAdapters.userId, session.user.id)));

  return NextResponse.json({ success: true });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();

  // 開啟分享：產生 shareCode
  if (body.action === "share") {
    const shareCode = nanoid(12);
    await db
      .update(customAdapters)
      .set({ shareCode, updatedAt: new Date() })
      .where(and(eq(customAdapters.id, id), eq(customAdapters.userId, session.user.id)));

    return NextResponse.json({ shareCode });
  }

  // 關閉分享
  if (body.action === "unshare") {
    await db
      .update(customAdapters)
      .set({ shareCode: null, updatedAt: new Date() })
      .where(and(eq(customAdapters.id, id), eq(customAdapters.userId, session.user.id)));

    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
