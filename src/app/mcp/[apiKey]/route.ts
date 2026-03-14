import { NextRequest, NextResponse } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticateByApiKey } from "@/mcp/middleware/auth";
import { createServerForUser } from "@/mcp/server";
import { loadAdapters } from "@/mcp/registry";
import { checkRateLimit } from "@/lib/rate-limit";

let adaptersLoaded = false;

async function ensureAdaptersLoaded() {
  if (!adaptersLoaded) {
    await loadAdapters();
    adaptersLoaded = true;
  }
}

async function handleMcpRequest(
  req: NextRequest,
  { params }: { params: Promise<{ apiKey: string }> },
): Promise<Response> {
  const { apiKey } = await params;

  // Authenticate user by API key
  const user = await authenticateByApiKey(apiKey);
  if (!user) {
    return NextResponse.json(
      { error: "Invalid API key (INVALID_API_KEY)" },
      { status: 401 },
    );
  }

  // Rate limiting
  const rateCheck = checkRateLimit(user.id);
  if (!rateCheck.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded (RATE_LIMIT_EXCEEDED)" },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rateCheck.resetAt - Date.now()) / 1000)) } },
    );
  }

  await ensureAdaptersLoaded();

  // Create per-user MCP server
  const server = await createServerForUser(user);

  // Stateless transport — each request is independent
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await server.connect(transport);

  const response = await transport.handleRequest(req);

  // For SSE streams, we must not close transport until the stream is fully sent.
  // Wrap the body so cleanup happens after the stream ends.
  if (response.body) {
    const originalBody = response.body;
    const wrappedStream = new ReadableStream({
      async start(controller) {
        const reader = originalBody.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
          controller.close();
        } catch (err) {
          controller.error(err);
        } finally {
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

  // Non-streaming response — safe to close immediately
  await transport.close();
  await server.close();
  return response;
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ apiKey: string }> },
) {
  return handleMcpRequest(req, context);
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ apiKey: string }> },
) {
  return handleMcpRequest(req, context);
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ apiKey: string }> },
) {
  return handleMcpRequest(req, context);
}
