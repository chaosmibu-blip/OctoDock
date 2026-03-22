import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { feedback } from "@/db/schema";

// POST /api/feedback — 儲存用戶反饋到 DB
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { category, content, email } = body as {
      category: string;
      content: string;
      email?: string;
    };

    if (!content?.trim()) {
      return NextResponse.json({ error: "Content required" }, { status: 400 });
    }

    await db.insert(feedback).values({
      userId: session.user.id,
      category: category || "other",
      content: content.trim(),
      email: email?.trim() || null,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    // 儲存用戶反饋失敗
    console.error("[FEEDBACK]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
