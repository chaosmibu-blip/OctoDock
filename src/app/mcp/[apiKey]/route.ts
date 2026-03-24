import { NextRequest, NextResponse } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateByApiKey, authenticateByBearerToken } from "@/mcp/middleware/auth";
import { createServerForUser } from "@/mcp/server";
import { ensureAdapters } from "@/mcp/registry";
import { checkRateLimit } from "@/lib/rate-limit";

// ============================================================
// MCP HTTP 路由
// 這是 OctoDock 的核心入口：/mcp/{apiKey}
// AI agent（Claude/ChatGPT）透過這個 URL 連接 MCP server
// 每個用戶有一個唯一的 apiKey（ak_xxx），用來識別身份
//
// 架構：Stateless（無狀態）
// 每個 HTTP 請求獨立處理，不維護 session
// 回應格式：Server-Sent Events（SSE）
// ============================================================

/**
 * MCP 請求統一處理函式
 * 流程：驗證 API key → 速率限制 → 建立 MCP server → 處理請求 → 回傳 SSE
 */
async function handleMcpRequest(
  req: NextRequest,
  { params }: { params: Promise<{ apiKey: string }> },
): Promise<Response> {
  const { apiKey } = await params;

  // 1. 驗證用戶身份（支援 API key 和 Bearer token 兩種方式）
  // U24: 優先檢查 Authorization: Bearer header（OAuth Provider）
  let user = null;
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const bearerToken = authHeader.slice(7);
    user = await authenticateByBearerToken(bearerToken);
  }
  // Fallback: 從 URL path 中的 API key 驗證
  if (!user) {
    user = await authenticateByApiKey(apiKey);
  }
  if (!user) {
    return NextResponse.json(
      { error: "Invalid API key or Bearer token (INVALID_AUTH)" },
      { status: 401 },
    );
  }

  // 2. 速率限制檢查
  const rateCheck = checkRateLimit(user.id);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded (RATE_LIMIT_EXCEEDED)" },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rateCheck.resetAt - Date.now()) / 1000)) } },
    );
  }

  // 3. 確保 Adapter 已載入
  await ensureAdapters();

  // 4. 為此用戶建立 MCP server（只含 octodock_do + octodock_help）
  // A1: 傳入 request headers，供提取 agent 實例 ID
  const server = await createServerForUser(user, req.headers);

  // 5. 建立 Stateless transport（每個請求獨立，不維護 session）
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await server.connect(transport);

  // 5.1 推送 tools/list_changed notification
  // stateless 架構下無法維持長連線，改在每次 POST response 的 SSE stream 裡夾帶
  // 目的：通知 client（特別是 Claude App 版）重新拉 tools/list 取得最新 schema
  // 最壞情況：client 忽略（跟現在一樣）；最好情況：client 更新快取
  if (req.method === "POST") {
    try {
      server.sendToolListChanged();
    } catch {
      // notification 失敗不影響主請求
    }
  }

  // 6. 處理 MCP 請求
  const response = await transport.handleRequest(req);

  // 7. SSE 串流處理：包裝 ReadableStream 確保 cleanup 在串流結束後才執行
  //    不能在 finally 裡直接 close，否則 SSE body 會被截斷（空回應 bug）
  if (response.body) {
    const originalBody = response.body;
    const wrappedStream = new ReadableStream({
      async start(controller) {
        const reader = originalBody.getReader();
        try {
          // 逐塊轉發 SSE 資料
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        } finally {
          // 串流結束後才關閉 transport 和 server
          await transport.close();
          await server.close();
        }
      },
    });

    return new Response(wrappedStream, {
      status: response.status,
      headers: response.headers,
    });
  }

  // 非串流回應（例如錯誤回應）→ 可以立即 cleanup
  await transport.close();
  await server.close();
  return response;
}

// ============================================================
// Next.js App Router HTTP method handlers
// MCP 協議使用 POST，GET 和 DELETE 也開放供 MCP SDK 使用
// ============================================================

// U26e: CORS headers — 讓瀏覽器端認證能正常運作
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/** U26e: OPTIONS preflight handler（CORS 預檢請求） */
export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** 為 response 附加 CORS headers */
function withCors(response: Response): Response {
  const newHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    newHeaders.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}

/** 處理 MCP POST 請求（主要的工具呼叫入口） */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ apiKey: string }> },
) {
  return withCors(await handleMcpRequest(req, context));
}

/** 處理 MCP GET 請求（SSE 連線等） */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ apiKey: string }> },
) {
  return withCors(await handleMcpRequest(req, context));
}

/** 處理 MCP DELETE 請求（session 清理等） */
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ apiKey: string }> },
) {
  return withCors(await handleMcpRequest(req, context));
}
