import { NextResponse } from "next/server";
import { tickScheduler } from "@/services/scheduler";
import { ensureAdapters } from "@/mcp/registry";

// ============================================================
// 排程引擎觸發 API
// 由外部 cron job 每分鐘呼叫一次：POST /api/scheduler
// 需要帶 Authorization header 防止外部濫用
//
// Replit 可以用 UptimeRobot 或 cron-job.org 來定時觸發
// ============================================================

/** POST /api/scheduler — 觸發排程引擎主循環 */
export async function POST(req: Request) {
  // 驗證呼叫者身份（用環境變數中的 secret）
  const authHeader = req.headers.get("authorization");
  const expectedSecret = process.env.SCHEDULER_SECRET;

  if (expectedSecret && authHeader !== `Bearer ${expectedSecret}`) {
    return NextResponse.json(
      { error: "Unauthorized (SCHEDULER_AUTH_FAILED)" },
      { status: 401 },
    );
  }

  // 確保 Adapter 已載入（並發安全的單例）
  await ensureAdapters();

  try {
    await tickScheduler();
    return NextResponse.json({ ok: true, timestamp: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Scheduler tick failed:", message);
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 },
    );
  }
}
