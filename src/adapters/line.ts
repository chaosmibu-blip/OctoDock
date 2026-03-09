import { z } from "zod";
import type {
  AppAdapter,
  ApiKeyConfig,
  ToolDefinition,
  ToolResult,
} from "./types";

const authConfig: ApiKeyConfig = {
  type: "api_key",
  instructions: {
    zh: "1. 前往 LINE Developers Console (developers.line.biz)\n2. 建立或選擇 Messaging API Channel\n3. 在 Channel 設定頁面找到 Channel Access Token\n4. 點擊 Issue 產生 token\n5. 複製 token 貼到下方",
    en: "1. Go to LINE Developers Console (developers.line.biz)\n2. Create or select a Messaging API Channel\n3. Find Channel Access Token in Channel settings\n4. Click Issue to generate a token\n5. Copy and paste the token below",
  },
  validateEndpoint: "https://api.line.me/v2/bot/info",
};

const LINE_API = "https://api.line.me/v2";

async function lineFetch(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<unknown> {
  const res = await fetch(`${LINE_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers as object),
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(
      `LINE API error: ${(error as { message: string }).message} (LINE_API_ERROR)`,
    );
  }
  return res.json();
}

const tools: ToolDefinition[] = [
  {
    name: "line_send_message",
    description:
      "Send a message to a specific LINE user by their user ID. Supports text messages.",
    inputSchema: {
      user_id: z.string().describe("LINE user ID of the recipient"),
      message: z.string().describe("Text message to send"),
    },
  },
  {
    name: "line_broadcast",
    description:
      "Broadcast a message to all users who have added the bot as a friend. Use with caution.",
    inputSchema: {
      message: z.string().describe("Text message to broadcast"),
    },
  },
  {
    name: "line_get_profile",
    description:
      "Get the profile of a LINE user including display name, picture URL, and status message.",
    inputSchema: {
      user_id: z.string().describe("LINE user ID"),
    },
  },
  {
    name: "line_get_followers",
    description:
      "Get the number of followers (friends) of the bot and recent follower count changes.",
    inputSchema: {},
  },
  {
    name: "line_reply",
    description:
      "Reply to a message using a reply token. Reply tokens are valid for 1 minute after the message event.",
    inputSchema: {
      reply_token: z.string().describe("Reply token from a webhook event"),
      message: z.string().describe("Text message to reply with"),
    },
  },
];

async function execute(
  toolName: string,
  params: Record<string, unknown>,
  token: string,
): Promise<ToolResult> {
  switch (toolName) {
    case "line_send_message": {
      const result = await lineFetch("/bot/message/push", token, {
        method: "POST",
        body: JSON.stringify({
          to: params.user_id,
          messages: [{ type: "text", text: params.message }],
        }),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    case "line_broadcast": {
      const result = await lineFetch("/bot/message/broadcast", token, {
        method: "POST",
        body: JSON.stringify({
          messages: [{ type: "text", text: params.message }],
        }),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    case "line_get_profile": {
      const result = await lineFetch(`/bot/profile/${params.user_id}`, token);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    case "line_get_followers": {
      // Get bot info for follower statistics
      const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const result = await lineFetch(
        `/bot/insight/followers?date=${today}`,
        token,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    case "line_reply": {
      const result = await lineFetch("/bot/message/reply", token, {
        method: "POST",
        body: JSON.stringify({
          replyToken: params.reply_token,
          messages: [{ type: "text", text: params.message }],
        }),
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

export const lineAdapter: AppAdapter = {
  name: "line",
  displayName: { zh: "LINE", en: "LINE" },
  icon: "line",
  authType: "api_key",
  authConfig,
  tools,
  execute,
};
