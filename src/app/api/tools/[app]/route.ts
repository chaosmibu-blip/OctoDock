import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getAdapter, loadAdapters } from "@/mcp/registry";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ app: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { app: appName } = await params;

  // Ensure adapters are loaded
  await loadAdapters();

  const adapter = getAdapter(appName);
  if (!adapter) {
    return NextResponse.json({ error: "App not found" }, { status: 404 });
  }

  const tools = adapter.tools.map((t) => ({
    name: t.name,
    description: t.description,
  }));

  return NextResponse.json({ appName, toolCount: tools.length, tools });
}
