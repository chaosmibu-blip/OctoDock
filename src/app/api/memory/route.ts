import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { deleteMemory } from "@/services/memory-engine";

export async function DELETE(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { key, category } = body;

  if (!key || !category) {
    return NextResponse.json(
      { error: "key and category are required" },
      { status: 400 },
    );
  }

  await deleteMemory(session.user.id, key, category);
  return NextResponse.json({ success: true });
}
