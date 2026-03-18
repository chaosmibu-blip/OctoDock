import { NextResponse } from "next/server";
import { getAllAdapters } from "@/mcp/registry";
import { getAllBreakerStates } from "@/mcp/middleware/circuit-breaker";

// ============================================================
// B5: 健康檢查 endpoint
// GET /api/health — 不需認證
// 回傳服務狀態 + 各 adapter 的 circuit breaker 狀態
// ============================================================

/** 啟動時間（用於計算 uptime） */
const startedAt = Date.now();

export async function GET() {
  const breakerStates = getAllBreakerStates();
  const allAdapters = getAllAdapters();

  // 組合各 adapter 狀態
  const adapters: Record<string, { status: string; circuitBreaker: string }> = {};
  for (const adapter of allAdapters) {
    const breaker = breakerStates[adapter.name];
    const cbState = breaker?.state ?? "closed";
    adapters[adapter.name] = {
      status: cbState === "OPEN" ? "degraded" : "up",
      circuitBreaker: cbState.toLowerCase(),
    };
  }

  // 判斷整體狀態
  const adapterValues = Object.values(adapters);
  const openCount = adapterValues.filter((a) => a.circuitBreaker === "open").length;
  let status: "healthy" | "degraded" | "unhealthy" = "healthy";
  if (openCount > 0 && openCount < adapterValues.length) status = "degraded";
  else if (openCount > 0 && openCount === adapterValues.length) status = "unhealthy";

  return NextResponse.json({
    status,
    version: process.env.NEXT_PUBLIC_GIT_SHA ?? "dev",
    uptime: Date.now() - startedAt,
    adapters,
  });
}
