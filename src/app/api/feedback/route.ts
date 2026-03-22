import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { feedback } from "@/db/schema";

// POST /api/feedback — 儲存用戶反饋到 DB + FormSubmit 寄信
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { category, content, email, userName } = body as {
    category: string;
    content: string;
    email?: string;
    userName?: string;
  };

  if (!content?.trim()) {
    return NextResponse.json({ error: "Content required" }, { status: 400 });
  }

  /* 並行：存 DB + FormSubmit 寄信（email 地址從環境變數讀取，不暴露給前端） */
  const notifyEmail = process.env.FEEDBACK_EMAIL;
  await Promise.all([
    db.insert(feedback).values({
      userId: session.user.id,
      category: category || "other",
      content: content.trim(),
      email: email?.trim() || null,
    }),
    notifyEmail
      ? fetch(`https://formsubmit.co/ajax/${notifyEmail}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            _subject: `[OctoDock Feedback] ${category}`,
            category,
            content,
            email: email || session.user.email,
            user_name: userName || session.user.name,
          }),
        }).catch(() => {/* FormSubmit 失敗不影響主流程 */})
      : Promise.resolve(),
  ]);

  return NextResponse.json({ success: true });
}
