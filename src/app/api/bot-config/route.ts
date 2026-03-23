import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { botConfigs } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { encrypt } from "@/lib/crypto";

// GET /api/bot-config — List user's bot configs (without sensitive data)
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const configs = await db
    .select()
    .from(botConfigs)
    .where(eq(botConfigs.userId, session.user.id));

  const safe = configs.map((c) => ({
    id: c.id,
    platform: c.platform,
    platformBotId: c.platformBotId,
    systemPrompt: c.systemPrompt,
    llmProvider: c.llmProvider,
    hasLlmApiKey: !!c.llmApiKey,
    isActive: c.isActive,
    createdAt: c.createdAt,
  }));

  return NextResponse.json(safe);
}

// PUT /api/bot-config — Update bot config (persona, LLM settings)
export async function PUT(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { platform, systemPrompt, llmProvider, llmApiKey, isActive } = body as {
    platform: string;
    systemPrompt?: string;
    llmProvider?: string;
    llmApiKey?: string;
    isActive?: boolean;
  };

  if (!platform) {
    return NextResponse.json(
      { error: "「缺少 platform 參數 (MISSING_PLATFORM)」" },
      { status: 400 },
    );
  }

  // Find existing config
  const existing = await db
    .select()
    .from(botConfigs)
    .where(
      and(
        eq(botConfigs.userId, session.user.id),
        eq(botConfigs.platform, platform),
      ),
    )
    .limit(1);

  if (existing.length === 0) {
    return NextResponse.json(
      { error: "「找不到此平台的 Bot 設定 (BOT_CONFIG_NOT_FOUND)」" },
      { status: 404 },
    );
  }

  const updates: Record<string, unknown> = {};
  if (systemPrompt !== undefined) updates.systemPrompt = systemPrompt;
  if (llmProvider !== undefined) updates.llmProvider = llmProvider;
  if (llmApiKey !== undefined) updates.llmApiKey = llmApiKey ? encrypt(llmApiKey) : null;
  if (isActive !== undefined) updates.isActive = isActive;
  updates.updatedAt = new Date();

  await db
    .update(botConfigs)
    .set(updates)
    .where(eq(botConfigs.id, existing[0].id));

  return NextResponse.json({ success: true });
}
