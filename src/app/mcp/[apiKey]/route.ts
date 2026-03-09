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

  try {
    return await transport.handleRequest(req);
  } finally {
    await transport.close();
    await server.close();
  }
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
