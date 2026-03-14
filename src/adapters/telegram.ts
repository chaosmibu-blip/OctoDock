import { z } from "zod";
import type {
  AppAdapter,
  BotTokenConfig,
  ToolDefinition,
  ToolResult,
} from "./types";

const authConfig: BotTokenConfig = {
  type: "bot_token",
  instructions: {
    zh: "1. 在 Telegram 搜尋 @BotFather\n2. 發送 /newbot 建立新 Bot\n3. 按照指示設定 Bot 名稱和 username\n4. BotFather 會回傳一個 Bot Token\n5. 複製 token 貼到下方\n\nAgentDock 會自動設定 Webhook。",
    en: "1. Search @BotFather on Telegram\n2. Send /newbot to create a new Bot\n3. Follow instructions to set name and username\n4. BotFather will send you a Bot Token\n5. Copy and paste the token below\n\nAgentDock will automatically set up the webhook.",
  },
  setupWebhook: true,
};

const TG_API = "https://api.telegram.org";

// ============================================================
// do + help 架構：actionMap / getSkill / formatResponse
// agentdock_do 透過 actionMap 找到工具名稱後，交給 execute() 執行
// ============================================================

/** 簡化 action 名稱 → 內部工具名稱對應表 */
const actionMap: Record<string, string> = {
  send_message: "telegram_send_message",
  send_photo: "telegram_send_photo",
  get_updates: "telegram_get_updates",
  set_webhook: "telegram_set_webhook",
};

/**
 * 回傳 Telegram Bot 可用操作的精簡說明
 * agentdock_help 會呼叫此方法，讓 AI 知道有哪些操作可用
 * 進入對話歷史後，同一個 chat 不需要再問
 */
function getSkill(): string {
  return `telegram actions:
  send_message(chat_id, text, parse_mode?) — send text message (supports Markdown)
  send_photo(chat_id, photo, caption?) — send photo from URL
  get_updates(limit?, offset?) — get recent incoming messages
  set_webhook(url) — configure webhook URL (HTTPS required)`;
}

/**
 * 將 Telegram API 回傳的 raw JSON 轉為 AI 友善的精簡格式
 * 減少 token 使用量，讓 AI 更容易理解結果
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
function formatResponse(action: string, rawData: unknown): string {
  if (typeof rawData !== "object" || rawData === null) return String(rawData);

  switch (action) {
    case "send_message":
    case "send_photo": {
      const msg = rawData as Record<string, unknown>;
      const msgId = msg.message_id;
      return `Done. Message ID: ${msgId}`;
    }
    case "get_updates": {
      if (!Array.isArray(rawData) || rawData.length === 0)
        return "No new messages.";
      return rawData
        .map((u: any) => {
          const msg = u.message;
          if (!msg) return `Update ${u.update_id}`;
          const from = msg.from?.first_name || "Unknown";
          const text = msg.text || "(non-text message)";
          return `[${from}] ${text}`;
        })
        .join("\n");
    }
    case "set_webhook":
      return "Done. Webhook configured.";
    default:
      return JSON.stringify(rawData, null, 2);
  }
}

async function tgFetch(
  method: string,
  token: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(`${TG_API}/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ description: res.statusText }));
    throw new Error(
      `Telegram API error: ${(error as { description: string }).description} (TELEGRAM_API_ERROR)`,
    );
  }
  const data = (await res.json()) as { ok: boolean; result: unknown };
  return data.result;
}

const tools: ToolDefinition[] = [
  {
    name: "telegram_send_message",
    description:
      "Send a text message to a Telegram chat. Supports Markdown formatting.",
    inputSchema: {
      chat_id: z
        .union([z.string(), z.number()])
        .describe("Telegram chat ID (user, group, or channel)"),
      text: z.string().describe("Message text (supports Markdown)"),
      parse_mode: z
        .enum(["Markdown", "MarkdownV2", "HTML"])
        .optional()
        .describe("Text formatting mode (default: Markdown)"),
    },
  },
  {
    name: "telegram_send_photo",
    description:
      "Send a photo to a Telegram chat. Provide a public URL to the image.",
    inputSchema: {
      chat_id: z
        .union([z.string(), z.number()])
        .describe("Telegram chat ID"),
      photo: z.string().describe("Public URL of the photo"),
      caption: z.string().optional().describe("Photo caption text"),
    },
  },
  {
    name: "telegram_get_updates",
    description:
      "Get recent incoming updates (messages) for the bot. Returns the latest messages received.",
    inputSchema: {
      limit: z
        .number()
        .optional()
        .describe("Number of updates to retrieve (default 10, max 100)"),
      offset: z
        .number()
        .optional()
        .describe("Offset for pagination"),
    },
  },
  {
    name: "telegram_set_webhook",
    description:
      "Set or update the webhook URL for the Telegram bot. AgentDock will receive incoming messages at this URL.",
    inputSchema: {
      url: z.string().describe("Webhook URL (must be HTTPS)"),
    },
  },
];

async function execute(
  toolName: string,
  params: Record<string, unknown>,
  token: string,
): Promise<ToolResult> {
  switch (toolName) {
    case "telegram_send_message": {
      const result = await tgFetch("sendMessage", token, {
        chat_id: params.chat_id,
        text: params.text,
        parse_mode: params.parse_mode ?? "Markdown",
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    case "telegram_send_photo": {
      const body: Record<string, unknown> = {
        chat_id: params.chat_id,
        photo: params.photo,
      };
      if (params.caption) body.caption = params.caption;

      const result = await tgFetch("sendPhoto", token, body);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    case "telegram_get_updates": {
      const result = await tgFetch("getUpdates", token, {
        limit: Math.min((params.limit as number) ?? 10, 100),
        offset: params.offset,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    case "telegram_set_webhook": {
      const result = await tgFetch("setWebhook", token, {
        url: params.url,
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
        isError: true,
      };
  }
}

export const telegramAdapter: AppAdapter = {
  name: "telegram",
  displayName: { zh: "Telegram", en: "Telegram" },
  icon: "telegram",
  authType: "bot_token",
  authConfig,
  tools,
  actionMap, // do + help 架構：簡化 action → 內部工具對應
  getSkill, // do + help 架構：回傳精簡操作說明
  formatResponse, // do + help 架構：raw JSON → AI 友善格式
  execute,
};
