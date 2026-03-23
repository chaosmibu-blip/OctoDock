import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUsageSummary } from "@/mcp/middleware/usage-limit";

// ============================================================
// GET /api/usage — 取得當前用戶的本月用量摘要
// Dashboard 用量條用這個 API 取得資料
// ============================================================

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await getUsageSummary(session.user.id);
    return NextResponse.json(summary);
  } catch (error) {
    console.error("Usage API error:", error);
    return NextResponse.json({ error: "Failed to fetch usage" }, { status: 500 });
  }
}
