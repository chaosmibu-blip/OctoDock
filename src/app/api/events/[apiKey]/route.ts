import { authenticateByApiKey, authenticateByBearerToken } from "@/mcp/middleware/auth";
import { registerConnection, unregisterConnection } from "@/mcp/events/event-bus";
import type { OctoDockEvent } from "@/mcp/events/types";

// ============================================================
// SSE 事件推送 endpoint
// Channel Plugin 透過此 endpoint 接收即時事件
// 路由：GET /api/events/{apiKey}
//
// 流程：
// 1. 驗證 apiKey → 取得 userId
// 2. 建立 SSE 連線（ReadableStream）
// 3. 註冊到 event-bus
// 4. 每 30 秒發送 heartbeat（防止連線超時）
// 5. 連線斷開時自動清理
// ============================================================

/** heartbeat 間隔（毫秒） */
const HEARTBEAT_INTERVAL = 30_000;

/**
 * 處理 SSE 連線請求
 * Channel Plugin 透過 EventSource 連上此 endpoint
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ apiKey: string }> },
): Promise<Response> {
  const { apiKey } = await params;

  // 1. 驗證用戶身份（與 MCP 路由相同的認證邏輯）
  let user = null;
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    user = await authenticateByBearerToken(authHeader.slice(7));
  }
  if (!user) {
    user = await authenticateByApiKey(apiKey);
  }
  if (!user) {
    return new Response(JSON.stringify({ error: "Invalid API key (INVALID_AUTH)" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 2. 建立 SSE 串流
  const encoder = new TextEncoder();
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let connectionRef: ReturnType<typeof registerConnection> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      // 發送初始連線確認事件（不暴露內部 userId）
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ type: "connected", status: "ok" })}\n\n`),
      );

      // 3. 註冊到 event-bus
      connectionRef = registerConnection(
        user!.id,
        // send callback：將事件序列化為 SSE 格式
        (event: OctoDockEvent) => {
          try {
            const sseData = `data: ${JSON.stringify(event)}\n\n`;
            controller.enqueue(encoder.encode(sseData));
          } catch {
            // controller 已關閉 → 忽略
          }
        },
        // close callback
        () => {
          try {
            controller.close();
          } catch {
            // 已關閉 → 忽略
          }
        },
      );

      // 4. 定期 heartbeat，防止連線被中間設備（proxy/CDN）超時斷開
      heartbeatTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          // controller 已關閉 → 清理
          cleanup();
        }
      }, HEARTBEAT_INTERVAL);
    },
    cancel() {
      // 5. 連線斷開（客戶端關閉）→ 清理
      cleanup();
    },
  });

  /** 清理連線和計時器 */
  function cleanup() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (connectionRef) {
      unregisterConnection(connectionRef);
      connectionRef = null;
    }
  }

  // 監聽客戶端斷線（AbortSignal）
  req.signal.addEventListener("abort", cleanup);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "https://octo-dock.com",
    },
  });
}

/** CORS preflight */
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "https://octo-dock.com",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}
