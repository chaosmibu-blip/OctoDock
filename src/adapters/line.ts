/**
 * LINE Messaging API Adapter
 *
 * 透過 LINE Messaging API 讓 agent 能傳送訊息、廣播、查詢用戶資料與粉絲統計。
 * 認證方式：API Key（Channel Access Token），從 LINE Developers Console 取得。
 * 所有訊息皆為純文字格式。
 */
import { z } from "zod";
import type {
  AppAdapter,
  ApiKeyConfig,
  ToolDefinition,
  ToolResult,
} from "./types";

// --- 認證設定 ---
// LINE 使用 API Key 認證（Channel Access Token），不走 OAuth。
// 用戶需到 LINE Developers Console 產生 token 並貼入。
const authConfig: ApiKeyConfig = {
  type: "api_key",
  instructions: {
    zh: "1. 前往 LINE Developers Console (developers.line.biz)\n2. 建立或選擇 Messaging API Channel\n3. 在 Channel 設定頁面找到 Channel Access Token\n4. 點擊 Issue 產生 token\n5. 複製 token 貼到下方",
    en: "1. Go to LINE Developers Console (developers.line.biz)\n2. Create or select a Messaging API Channel\n3. Find Channel Access Token in Channel settings\n4. Click Issue to generate a token\n5. Copy and paste the token below",
  },
  validateEndpoint: "https://api.line.me/v2/bot/info",
};

const LINE_API = "https://api.line.me/v2";

// --- LINE API 共用 fetch 封裝 ---
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

// --- do+help 架構：actionMap ---
// 將簡短動作名稱對應到完整的 MCP 工具名稱，方便 agent 快速呼叫
const actionMap: Record<string, string> = {
  send_message: "line_send_message",
  broadcast: "line_broadcast",
  get_profile: "line_get_profile",
  get_followers: "line_get_followers",
  reply: "line_reply",
};

// --- do+help 架構：getSkill ---
// 回傳此 adapter 可用動作的摘要說明，供 agent 理解能力範圍
const ACTION_SKILLS: Record<string, string> = {
  send_message: `## line.send_message
Send a text message to a specific LINE user.
### Parameters
  user_id: LINE user ID of the recipient
  message: Text message to send
### Example
octodock_do(app:"line", action:"send_message", params:{
  user_id:"U1234567890abcdef",
  message:"明天的會議改到下午 3 點"
})`,

  broadcast: `## line.broadcast
Broadcast a message to ALL followers. Use with caution — counts toward monthly message quota.
### Parameters
  message: Text message to broadcast
### Example
octodock_do(app:"line", action:"broadcast", params:{message:"本週末活動取消，造成不便敬請見諒"})`,

  get_profile: `## line.get_profile
Get a LINE user's display name, picture, and status.
### Parameters
  user_id: LINE user ID
### Example
octodock_do(app:"line", action:"get_profile", params:{user_id:"U1234567890abcdef"})`,

  get_followers: `## line.get_followers
Get follower count and statistics.
### Parameters
  (none)
### Example
octodock_do(app:"line", action:"get_followers", params:{})`,

  reply: `## line.reply
Reply using a webhook reply token. Token is only valid for ~1 minute after receiving a message.
### Parameters
  reply_token: Reply token from webhook event
  message: Text message to reply with
### Example
octodock_do(app:"line", action:"reply", params:{
  reply_token:"nHuyWiB7yP5Zw52FIkcQob...",
  message:"收到您的訊息，我們會盡快回覆"
})`,
};

function getSkill(action?: string): string {
  if (action && ACTION_SKILLS[action]) return ACTION_SKILLS[action];
  if (action) return `Action "${action}" not found. Available: ${Object.keys(ACTION_SKILLS).join(", ")}`;
  return `line actions:
  send_message(user_id, message) — send text message to user
  broadcast(message) — broadcast to all followers (use with caution)
  get_profile(user_id) — get user display name and picture
  get_followers() — get follower count statistics
  reply(reply_token, message) — reply using webhook reply token (valid 1 min)
Use octodock_help(app:"line", action:"ACTION") for detailed params + example.`;
}

// --- do+help 架構：formatResponse ---
// 將 LINE API 的原始回應轉為人類可讀格式，讓 agent 回覆更友善
/* eslint-disable @typescript-eslint/no-explicit-any */
function formatResponse(action: string, rawData: unknown): string {
  if (typeof rawData !== "object" || rawData === null) return String(rawData);
  const data = rawData as Record<string, unknown>;

  switch (action) {
    // 用戶資料：顯示名稱、頭像、狀態訊息
    case "get_profile": {
      return `Name: ${data.displayName}\nPicture: ${data.pictureUrl || "N/A"}\nStatus: ${data.statusMessage || "N/A"}\nUser ID: ${data.userId}`;
    }
    // 粉絲統計：追蹤數、可觸及數、封鎖數
    case "get_followers": {
      return `Followers: ${data.followers || "N/A"}\nTargeted reaches: ${data.targetedReaches || "N/A"}\nBlocks: ${data.blocks || "N/A"}`;
    }
    // 傳送類動作：統一回覆已完成
    case "send_message":
    case "broadcast":
    case "reply":
      return "Done. Message sent.";
    default:
      return JSON.stringify(rawData, null, 2);
  }
}

// --- 工具定義 ---
const tools: ToolDefinition[] = [
  // 傳送訊息給指定用戶（需要 user_id）
  {
    name: "line_send_message",
    description:
      "Send a message to a specific LINE user by their user ID. Supports text messages.",
    inputSchema: {
      user_id: z.string().describe("LINE user ID of the recipient"),
      message: z.string().describe("Text message to send"),
    },
  },
  // 廣播訊息給所有好友（請謹慎使用）
  {
    name: "line_broadcast",
    description:
      "Broadcast a message to all users who have added the bot as a friend. Use with caution.",
    inputSchema: {
      message: z.string().describe("Text message to broadcast"),
    },
  },
  // 查詢用戶個人資料（顯示名稱、頭像、狀態訊息）
  {
    name: "line_get_profile",
    description:
      "Get the profile of a LINE user including display name, picture URL, and status message.",
    inputSchema: {
      user_id: z.string().describe("LINE user ID"),
    },
  },
  // 取得 bot 的粉絲數與相關統計
  {
    name: "line_get_followers",
    description:
      "Get the number of followers (friends) of the bot and recent follower count changes.",
    inputSchema: {},
  },
  // 使用 reply token 回覆訊息（token 有效期 1 分鐘）
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

// --- 工具執行邏輯 ---
async function execute(
  toolName: string,
  params: Record<string, unknown>,
  token: string,
): Promise<ToolResult> {
  switch (toolName) {
    // 推送訊息：使用 push API 傳送文字訊息給指定用戶
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

    // 廣播訊息：傳送給所有加入好友的用戶
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

    // 查詢用戶資料：透過 user_id 取得 displayName、pictureUrl 等
    case "line_get_profile": {
      const result = await lineFetch(`/bot/profile/${params.user_id}`, token);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 粉絲統計：查詢今日的追蹤者數據
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

    // 回覆訊息：使用 webhook 提供的 reply token（有效期 1 分鐘）
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

// --- 錯誤格式化：攔截常見 API 錯誤，回傳雙語提示 ---
function formatError(action: string, errorMessage: string): string | null {
  const msg = errorMessage.toLowerCase();
  if (msg.includes("invalid token") || msg.includes("authentication")) return "LINE Channel Access Token 無效或已過期。請到 LINE Developers Console 重新產生 token。";
  if (msg.includes("not found")) return "找不到指定的用戶。請確認 user_id 是否正確。";
  if (msg.includes("rate")) return "LINE API 速率限制。請稍後再試。";
  if (action === "reply" && msg.includes("invalid")) return "Reply token 已過期（有效期僅 1 分鐘）。無法回覆過期的訊息。";
  if (action === "broadcast") return `廣播失敗：${errorMessage}。請確認免費方案的每月訊息額度是否已用完。`;
  return null;
}

export const lineAdapter: AppAdapter = {
  name: "line",
  displayName: { zh: "LINE", en: "LINE" },
  icon: "line",
  authType: "api_key",
  authConfig,
  tools,
  execute,
  actionMap,
  getSkill,
  formatResponse,
  formatError,
};
