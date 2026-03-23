import { db } from "@/db";
import { conversations, operations } from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { queryMemory } from "./memory-engine";

interface AutoReplyContext {
  userId: string;
  platform: "line" | "telegram";
  platformUserId: string;
  message: string;
  replyToken?: string; // LINE
  chatId?: string | number; // Telegram
  botCredentials: string; // decrypted token
  systemPrompt: string | null;
  llmProvider: string;
  llmApiKey: string; // decrypted
}

interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// Main entry: generate and send auto-reply
export async function handleAutoReply(ctx: AutoReplyContext): Promise<void> {
  // 1. Store incoming message in conversation history
  await db.insert(conversations).values({
    userId: ctx.userId,
    platform: ctx.platform,
    platformUserId: ctx.platformUserId,
    role: "user",
    content: ctx.message,
  });

  // 2. Load conversation history (last 20 messages)
  const history = await db
    .select({
      role: conversations.role,
      content: conversations.content,
    })
    .from(conversations)
    .where(
      and(
        eq(conversations.userId, ctx.userId),
        eq(conversations.platform, ctx.platform),
        eq(conversations.platformUserId, ctx.platformUserId),
      ),
    )
    .orderBy(desc(conversations.createdAt))
    .limit(20);

  // Reverse to chronological order
  history.reverse();

  // 3. Query user memory for relevant context
  const memories = await queryMemory(ctx.userId, ctx.message, undefined, undefined, 5);

  // 4. Build LLM messages
  const messages = buildMessages(ctx.systemPrompt, memories, history);

  // 5. Call LLM
  const reply = await callLLM(ctx.llmProvider, ctx.llmApiKey, messages);

  // 6. Store assistant reply in conversation history
  await db.insert(conversations).values({
    userId: ctx.userId,
    platform: ctx.platform,
    platformUserId: ctx.platformUserId,
    role: "assistant",
    content: reply,
  });

  // 7. Send reply via platform API
  await sendReply(ctx, reply);

  // 8. Log to operations (async, non-blocking)
  db.insert(operations)
    .values({
      userId: ctx.userId,
      appName: ctx.platform,
      toolName: `${ctx.platform}_auto_reply`,
      action: "auto_reply",
      params: {
        from: ctx.platformUserId,
        message: ctx.message.slice(0, 200),
      },
      result: { reply: reply.slice(0, 200) },
      success: true,
      durationMs: 0,
    })
    .catch((err) => console.error("Failed to log auto-reply:", err));
}

function buildMessages(
  systemPrompt: string | null,
  memories: Array<{ key: string; value: string }>,
  history: Array<{ role: string; content: string }>,
): LLMMessage[] {
  const messages: LLMMessage[] = [];

  // System prompt with memory context
  let system = systemPrompt ?? "You are a helpful assistant.";

  if (memories.length > 0) {
    const memoryContext = memories
      .map((m) => `- ${m.key}: ${m.value}`)
      .join("\n");
    system += `\n\n## User context (from memory)\n${memoryContext}`;
  }

  messages.push({ role: "system", content: system });

  // Conversation history
  for (const msg of history) {
    messages.push({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    });
  }

  return messages;
}

async function callLLM(
  provider: string,
  apiKey: string,
  messages: LLMMessage[],
): Promise<string> {
  if (provider === "openai" || provider === "gpt") {
    return callOpenAI(apiKey, messages);
  }
  // Default: Claude
  return callClaude(apiKey, messages);
}

async function callClaude(
  apiKey: string,
  messages: LLMMessage[],
): Promise<string> {
  // Extract system message
  const systemMsg = messages.find((m) => m.role === "system");
  const chatMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role, content: m.content }));

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: systemMsg?.content,
      messages: chatMessages,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error: ${err} (LLM_API_ERROR)`);
  }

  const data = (await res.json()) as {
    content: Array<{ type: string; text: string }>;
  };
  return data.content[0]?.text ?? "";
}

async function callOpenAI(
  apiKey: string,
  messages: LLMMessage[],
): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages,
      max_tokens: 1024,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API error: ${err} (LLM_API_ERROR)`);
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return data.choices[0]?.message?.content ?? "";
}

async function sendReply(
  ctx: AutoReplyContext,
  reply: string,
): Promise<void> {
  if (ctx.platform === "line") {
    await sendLINEReply(ctx.botCredentials, ctx.replyToken, ctx.platformUserId, reply);
  } else if (ctx.platform === "telegram") {
    await sendTelegramReply(ctx.botCredentials, ctx.chatId!, reply);
  }
}

async function sendLINEReply(
  token: string,
  replyToken: string | undefined,
  userId: string,
  message: string,
): Promise<void> {
  // Prefer reply token (free), fall back to push (costs quota)
  if (replyToken) {
    const res = await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        replyToken,
        messages: [{ type: "text", text: message }],
      }),
    });
    if (res.ok) return;
    // Reply token may be expired, fall back to push
  }

  // Push message as fallback
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: userId,
      messages: [{ type: "text", text: message }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`LINE reply failed: ${err} (LINE_REPLY_ERROR)`);
  }
}

async function sendTelegramReply(
  token: string,
  chatId: string | number,
  message: string,
): Promise<void> {
  const res = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
      }),
    },
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Telegram reply failed: ${err} (TELEGRAM_REPLY_ERROR)`);
  }
}
