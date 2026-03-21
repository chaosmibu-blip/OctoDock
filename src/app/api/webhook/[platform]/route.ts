import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { botConfigs, operations } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";
import { handleAutoReply } from "@/services/auto-reply";
import { emitEvent } from "@/mcp/events/event-bus";

interface WebhookEvent {
  platform: string;
  botId: string;
  userId: string;
  message: string;
  replyToken?: string; // LINE only
  chatId?: string | number; // Telegram only
  raw: unknown;
}

function parseLINEWebhook(body: Record<string, unknown>): WebhookEvent[] {
  const events = (body.events as Array<Record<string, unknown>>) ?? [];
  return events
    .filter((e) => e.type === "message")
    .map((e) => ({
      platform: "line",
      botId: (body.destination as string) ?? "",
      userId: ((e.source as Record<string, string>)?.userId) ?? "",
      message: ((e.message as Record<string, string>)?.text) ?? "",
      replyToken: e.replyToken as string,
      raw: e,
    }));
}

function parseTelegramWebhook(body: Record<string, unknown>): WebhookEvent[] {
  const message = body.message as Record<string, unknown> | undefined;
  if (!message?.text) return [];

  const from = message.from as Record<string, unknown> | undefined;
  const chat = message.chat as Record<string, unknown> | undefined;

  return [
    {
      platform: "telegram",
      botId: "",
      userId: String(from?.id ?? ""),
      message: message.text as string,
      chatId: chat?.id as number,
      raw: body,
    },
  ];
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ platform: string }> },
) {
  const { platform } = await params;
  const body = await req.json();

  let events: WebhookEvent[];
  try {
    if (platform === "line") {
      events = parseLINEWebhook(body);
    } else if (platform === "telegram") {
      events = parseTelegramWebhook(body);
    } else {
      return NextResponse.json({ error: "Unknown platform" }, { status: 404 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid webhook payload" }, { status: 400 });
  }

  // Process each event asynchronously
  for (const event of events) {
    processWebhookEvent(event).catch((err) =>
      console.error(`Webhook processing error (${platform}):`, err),
    );
  }

  // Always return 200 quickly to acknowledge receipt
  return NextResponse.json({ ok: true });
}

async function processWebhookEvent(event: WebhookEvent): Promise<void> {
  // Find bot config for this platform
  const configs = await db
    .select()
    .from(botConfigs)
    .where(
      and(
        eq(botConfigs.platform, event.platform),
        eq(botConfigs.isActive, true),
      ),
    );

  if (configs.length === 0) {
    console.log(`No active bot config for ${event.platform}`);
    return;
  }

  // Log the incoming message as an operation + 推送事件到 Channel Plugin
  for (const config of configs) {
    // 推送事件到 event-bus（Channel Plugin 會透過 SSE 收到）
    emitEvent(
      config.userId,
      event.platform,
      "message",
      `New ${event.platform} message from ${event.userId}: ${event.message.slice(0, 100)}`,
      {
        source: event.platform,
        sender: event.userId,
        chat_id: event.chatId,
        has_reply_token: !!event.replyToken,
      },
      event.raw,
    );

    db.insert(operations)
      .values({
        userId: config.userId,
        appName: event.platform,
        toolName: `${event.platform}_webhook_receive`,
        action: "webhook_receive",
        params: {
          from: event.userId,
          message: event.message.slice(0, 200), // Don't store full content (spec section 14)
        },
        success: true,
        durationMs: 0,
      })
      .catch((err) => console.error("Failed to log webhook event:", err));

    // Phase 4: Auto-reply if bot has LLM API key configured
    if (config.llmApiKey && config.isActive) {
      try {
        const botCredentials = decrypt(config.credentials);
        const llmApiKey = decrypt(config.llmApiKey);

        await handleAutoReply({
          userId: config.userId,
          platform: event.platform as "line" | "telegram",
          platformUserId: event.userId,
          message: event.message,
          replyToken: event.replyToken,
          chatId: event.chatId,
          botCredentials,
          systemPrompt: config.systemPrompt,
          llmProvider: config.llmProvider ?? "claude",
          llmApiKey,
        });
      } catch (err) {
        console.error(`Auto-reply error (${event.platform}):`, err);
      }
    }
  }
}
