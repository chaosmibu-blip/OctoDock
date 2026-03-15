/**
 * LINE Messaging API Adapter
 *
 * 透過 LINE Messaging API 讓 agent 能傳送各種訊息、管理群組、查詢統計。
 * 認證方式：API Key（Channel Access Token），從 LINE Developers Console 取得。
 * 支援文字、圖片、貼圖、Flex Message 等多種訊息類型。
 */
import { z } from "zod";
import type {
  AppAdapter,
  ApiKeyConfig,
  ToolDefinition,
  ToolResult,
} from "./types";

// ── 認證設定 ─────────────────────────────────────────────
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
const LINE_DATA_API = "https://api-data.line.me/v2";

// ── LINE API 共用 fetch 封裝 ──────────────────────────────
async function lineFetch(
  path: string,
  token: string,
  options: RequestInit = {},
  baseUrl: string = LINE_API,
): Promise<unknown> {
  const res = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers as object),
    },
  });

  // LINE 的某些 API（如 push/broadcast）成功時回傳空 body
  if (res.status === 200 && res.headers.get("content-length") === "0") {
    return { _status: 200 };
  }

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(
      JSON.stringify({ status: res.status, message: (error as { message: string }).message }),
    );
  }

  // 處理空回應（push/broadcast 回傳 {}）
  const text = await res.text();
  if (!text || text === "{}") return { _status: res.status };
  return JSON.parse(text);
}

// ── do+help 架構：actionMap ──────────────────────────────
// 將簡短動作名稱對應到完整的 MCP 工具名稱
const actionMap: Record<string, string> = {
  // 訊息傳送
  send_message: "line_send_message",
  send_image: "line_send_image",
  send_sticker: "line_send_sticker",
  send_flex: "line_send_flex",
  multicast: "line_multicast",
  broadcast: "line_broadcast",
  reply: "line_reply",
  // 用戶與群組
  get_profile: "line_get_profile",
  get_group_summary: "line_get_group_summary",
  get_group_members: "line_get_group_members",
  leave_group: "line_leave_group",
  get_followers_ids: "line_get_followers_ids",
  // 統計與配額
  get_followers: "line_get_followers",
  get_quota: "line_get_quota",
  get_bot_info: "line_get_bot_info",
  get_demographics: "line_get_demographics",
  // Webhook 管理
  set_webhook: "line_set_webhook",
  get_webhook: "line_get_webhook",
};

// ── do+help 架構：Skill 詳細說明 ──────────────────────────
const ACTION_SKILLS: Record<string, string> = {
  send_message: `## line.send_message
Send a text message to a specific LINE user.
### Parameters
  user_id: LINE user ID of the recipient
  message: Text message to send
### Example
octodock_do(app:"line", action:"send_message", params:{user_id:"U1234...", message:"明天的會議改到下午 3 點"})`,

  send_image: `## line.send_image
Send an image message to a specific LINE user.
### Parameters
  user_id: LINE user ID of the recipient
  image_url: URL of the image (must be HTTPS, JPEG or PNG)
  preview_url (optional): URL of the preview image (smaller version)
### Example
octodock_do(app:"line", action:"send_image", params:{user_id:"U1234...", image_url:"https://example.com/photo.jpg"})`,

  send_sticker: `## line.send_sticker
Send a LINE sticker to a specific user. See LINE sticker list for valid package/sticker IDs.
### Parameters
  user_id: LINE user ID of the recipient
  package_id: Sticker package ID (e.g. "446" for common stickers)
  sticker_id: Sticker ID within the package (e.g. "1988")
### Example
octodock_do(app:"line", action:"send_sticker", params:{user_id:"U1234...", package_id:"446", sticker_id:"1988"})`,

  send_flex: `## line.send_flex
Send a Flex Message (rich interactive card) to a LINE user. Flex Messages support custom layouts with buttons, images, and text.
### Parameters
  user_id: LINE user ID of the recipient
  alt_text: Alternative text shown in notifications
  contents: Flex Message container object (type: "bubble" or "carousel")
### Example
octodock_do(app:"line", action:"send_flex", params:{user_id:"U1234...", alt_text:"Order confirmation", contents:{type:"bubble", body:{type:"box", layout:"vertical", contents:[{type:"text", text:"Your order is confirmed!"}]}}})`,

  multicast: `## line.multicast
Send a message to multiple LINE users at once (up to 500 users per request).
### Parameters
  user_ids: Array of LINE user IDs
  message: Text message to send
### Example
octodock_do(app:"line", action:"multicast", params:{user_ids:["U1234...", "U5678..."], message:"團隊會議提醒"})`,

  broadcast: `## line.broadcast
Broadcast a message to ALL followers. Use with caution — counts toward monthly message quota.
### Parameters
  message: Text message to broadcast
### Example
octodock_do(app:"line", action:"broadcast", params:{message:"本週末活動取消"})`,

  reply: `## line.reply
Reply using a webhook reply token. Token is only valid for ~1 minute after receiving a message.
### Parameters
  reply_token: Reply token from webhook event
  message: Text message to reply with
### Example
octodock_do(app:"line", action:"reply", params:{reply_token:"nHuyWiB7yP5Zw52FIkcQob...", message:"收到"})`,

  get_profile: `## line.get_profile
Get a LINE user's display name, picture, and status.
### Parameters
  user_id: LINE user ID
### Example
octodock_do(app:"line", action:"get_profile", params:{user_id:"U1234..."})`,

  get_group_summary: `## line.get_group_summary
Get group chat information (name, icon, member count).
### Parameters
  group_id: LINE group ID
### Example
octodock_do(app:"line", action:"get_group_summary", params:{group_id:"C1234..."})`,

  get_group_members: `## line.get_group_members
Get list of user IDs in a group.
### Parameters
  group_id: LINE group ID
### Example
octodock_do(app:"line", action:"get_group_members", params:{group_id:"C1234..."})`,

  leave_group: `## line.leave_group
Make the bot leave a group chat.
### Parameters
  group_id: LINE group ID
### Example
octodock_do(app:"line", action:"leave_group", params:{group_id:"C1234..."})`,

  get_followers_ids: `## line.get_followers_ids
Get list of user IDs who have added the bot as a friend.
### Parameters
  (none)
### Example
octodock_do(app:"line", action:"get_followers_ids", params:{})`,

  get_followers: `## line.get_followers
Get follower count and statistics for a date.
### Parameters
  date (optional): Date in YYYYMMDD format (default: today)
### Example
octodock_do(app:"line", action:"get_followers", params:{})`,

  get_quota: `## line.get_quota
Get this month's message quota limit and usage.
### Parameters
  (none)
### Example
octodock_do(app:"line", action:"get_quota", params:{})`,

  get_bot_info: `## line.get_bot_info
Get bot information (display name, user ID, premium status).
### Parameters
  (none)
### Example
octodock_do(app:"line", action:"get_bot_info", params:{})`,

  get_demographics: `## line.get_demographics
Get friend demographics (age, gender, area distribution).
### Parameters
  (none)
### Example
octodock_do(app:"line", action:"get_demographics", params:{})`,

  set_webhook: `## line.set_webhook
Set the webhook URL for receiving messages.
### Parameters
  url: Webhook endpoint URL (must be HTTPS)
### Example
octodock_do(app:"line", action:"set_webhook", params:{url:"https://octo-dock.com/api/webhook/line"})`,

  get_webhook: `## line.get_webhook
Get current webhook endpoint information.
### Parameters
  (none)
### Example
octodock_do(app:"line", action:"get_webhook", params:{})`,
};

// ── getSkill：回傳操作概覽 ──────────────────────────────
function getSkill(action?: string): string {
  if (action && ACTION_SKILLS[action]) return ACTION_SKILLS[action];
  if (action) return `Action "${action}" not found. Available: ${Object.keys(ACTION_SKILLS).join(", ")}`;
  return `line actions (18):
  send_message(user_id, message) — send text message to user
  send_image(user_id, image_url, preview_url?) — send image message
  send_sticker(user_id, package_id, sticker_id) — send LINE sticker
  send_flex(user_id, alt_text, contents) — send Flex Message (rich card)
  multicast(user_ids, message) — send to multiple users (up to 500)
  broadcast(message) — broadcast to all followers (use with caution)
  reply(reply_token, message) — reply using webhook token (valid 1 min)
  get_profile(user_id) — get user display name and picture
  get_group_summary(group_id) — get group info
  get_group_members(group_id) — get group member IDs
  leave_group(group_id) — bot leaves group
  get_followers_ids() — get list of follower user IDs
  get_followers(date?) — get follower count statistics
  get_quota() — get monthly message quota and usage
  get_bot_info() — get bot display name and info
  get_demographics() — get friend demographics (age, gender, area)
  set_webhook(url) — set webhook endpoint URL
  get_webhook() — get current webhook info
Use octodock_help(app:"line", action:"ACTION") for detailed params + example.`;
}

// ── formatResponse：將 LINE API 回傳轉為 AI 友善格式 ──────
/* eslint-disable @typescript-eslint/no-explicit-any */
function formatResponse(action: string, rawData: unknown): string {
  if (typeof rawData !== "object" || rawData === null) return String(rawData);
  const data = rawData as Record<string, unknown>;

  switch (action) {
    // 用戶資料
    case "get_profile": {
      return [
        `**${data.displayName}**`,
        data.statusMessage ? `> ${data.statusMessage}` : null,
        `Picture: ${data.pictureUrl || "N/A"}`,
        `User ID: ${data.userId}`,
      ].filter(Boolean).join("\n");
    }

    // 粉絲統計
    case "get_followers": {
      return `Followers: ${data.followers ?? "N/A"}\nTargeted reaches: ${data.targetedReaches ?? "N/A"}\nBlocks: ${data.blocks ?? "N/A"}`;
    }

    // 群組資訊
    case "get_group_summary": {
      return [
        `**${data.groupName}**`,
        `Members: ${data.memberCount ?? "?"}`,
        data.pictureUrl ? `Icon: ${data.pictureUrl}` : null,
        `Group ID: ${data.groupId}`,
      ].filter(Boolean).join("\n");
    }

    // 群組成員 ID 列表
    case "get_group_members": {
      const ids = data.memberIds as string[] | undefined;
      if (!ids || ids.length === 0) return "No members found.";
      return `${ids.length} members:\n${ids.map((id) => `- ${id}`).join("\n")}${data.next ? "\n(more available)" : ""}`;
    }

    // 粉絲 ID 列表
    case "get_followers_ids": {
      const ids = data.userIds as string[] | undefined;
      if (!ids || ids.length === 0) return "No followers found.";
      return `${ids.length} followers:\n${ids.map((id) => `- ${id}`).join("\n")}${data.next ? "\n(more available)" : ""}`;
    }

    // 訊息配額
    case "get_quota": {
      const quota = data.quota as Record<string, unknown> | undefined;
      const usage = data.usage as Record<string, unknown> | undefined;
      const limit = quota?.value ?? "unlimited";
      const used = usage?.totalUsage ?? 0;
      return `Monthly quota: ${limit}\nUsed this month: ${used}`;
    }

    // Bot 資訊
    case "get_bot_info": {
      return [
        `**${data.displayName}**`,
        `User ID: ${data.userId}`,
        `Basic ID: ${data.basicId ?? "N/A"}`,
        `Premium: ${data.premiumId ? "Yes" : "No"}`,
        `Chat mode: ${data.chatMode ?? "N/A"}`,
        `Mark as read: ${data.markAsReadMode ?? "N/A"}`,
      ].join("\n");
    }

    // 人口統計
    case "get_demographics": {
      if (data.available === false) return "Demographics data not available (requires 20+ friends).";
      const sections: string[] = [];
      // 性別
      const genders = data.genders as Array<{ gender: string; percentage: number }> | undefined;
      if (genders) sections.push("Gender: " + genders.map((g) => `${g.gender} ${g.percentage}%`).join(", "));
      // 年齡
      const ages = data.ages as Array<{ age: string; percentage: number }> | undefined;
      if (ages) sections.push("Age: " + ages.map((a) => `${a.age} ${a.percentage}%`).join(", "));
      // 地區
      const areas = data.areas as Array<{ area: string; percentage: number }> | undefined;
      if (areas) sections.push("Area: " + areas.slice(0, 5).map((a) => `${a.area} ${a.percentage}%`).join(", "));
      return sections.join("\n") || "No demographic data.";
    }

    // Webhook 資訊
    case "get_webhook": {
      return `URL: ${data.endpoint ?? "N/A"}\nActive: ${data.active ?? "N/A"}`;
    }

    // 傳送類動作：統一回覆已完成
    case "send_message":
    case "send_image":
    case "send_sticker":
    case "send_flex":
    case "multicast":
    case "broadcast":
    case "reply":
    case "set_webhook":
    case "leave_group":
      return "Done. Message sent.";

    default:
      return JSON.stringify(rawData, null, 2);
  }
}

// ── 工具定義 ──────────────────────────────────────────────
const tools: ToolDefinition[] = [
  // ── 訊息傳送 ──
  {
    name: "line_send_message",
    description: "Send a text message to a specific LINE user.",
    inputSchema: {
      user_id: z.string().describe("LINE user ID of the recipient"),
      message: z.string().describe("Text message to send"),
    },
  },
  {
    name: "line_send_image",
    description: "Send an image message to a LINE user. Image must be HTTPS URL (JPEG or PNG).",
    inputSchema: {
      user_id: z.string().describe("LINE user ID of the recipient"),
      image_url: z.string().describe("Image URL (HTTPS, JPEG or PNG, max 10MB)"),
      preview_url: z.string().optional().describe("Preview image URL (smaller version)"),
    },
  },
  {
    name: "line_send_sticker",
    description: "Send a LINE sticker to a user. See LINE sticker list for valid IDs.",
    inputSchema: {
      user_id: z.string().describe("LINE user ID of the recipient"),
      package_id: z.string().describe("Sticker package ID"),
      sticker_id: z.string().describe("Sticker ID within the package"),
    },
  },
  {
    name: "line_send_flex",
    description: "Send a Flex Message (rich interactive card) to a LINE user.",
    inputSchema: {
      user_id: z.string().describe("LINE user ID of the recipient"),
      alt_text: z.string().describe("Alternative text for notifications"),
      contents: z.record(z.string(), z.unknown()).describe("Flex Message container object"),
    },
  },
  {
    name: "line_multicast",
    description: "Send a message to multiple LINE users at once (up to 500 per request).",
    inputSchema: {
      user_ids: z.array(z.string()).describe("Array of LINE user IDs (max 500)"),
      message: z.string().describe("Text message to send"),
    },
  },
  {
    name: "line_broadcast",
    description: "Broadcast a message to ALL followers. Counts toward monthly quota.",
    inputSchema: {
      message: z.string().describe("Text message to broadcast"),
    },
  },
  {
    name: "line_reply",
    description: "Reply using a webhook reply token. Valid for 1 minute after message event.",
    inputSchema: {
      reply_token: z.string().describe("Reply token from a webhook event"),
      message: z.string().describe("Text message to reply with"),
    },
  },
  // ── 用戶與群組 ──
  {
    name: "line_get_profile",
    description: "Get a LINE user's display name, picture URL, and status message.",
    inputSchema: {
      user_id: z.string().describe("LINE user ID"),
    },
  },
  {
    name: "line_get_group_summary",
    description: "Get group chat information including name, icon, and member count.",
    inputSchema: {
      group_id: z.string().describe("LINE group ID"),
    },
  },
  {
    name: "line_get_group_members",
    description: "Get list of user IDs in a LINE group chat.",
    inputSchema: {
      group_id: z.string().describe("LINE group ID"),
    },
  },
  {
    name: "line_leave_group",
    description: "Make the bot leave a LINE group chat.",
    inputSchema: {
      group_id: z.string().describe("LINE group ID"),
    },
  },
  {
    name: "line_get_followers_ids",
    description: "Get list of user IDs who have added the bot as a friend.",
    inputSchema: {},
  },
  // ── 統計與配額 ──
  {
    name: "line_get_followers",
    description: "Get follower count and statistics.",
    inputSchema: {
      date: z.string().optional().describe("Date in YYYYMMDD format (default: today)"),
    },
  },
  {
    name: "line_get_quota",
    description: "Get monthly message sending limit and current usage.",
    inputSchema: {},
  },
  {
    name: "line_get_bot_info",
    description: "Get bot information including display name, user ID, and premium status.",
    inputSchema: {},
  },
  {
    name: "line_get_demographics",
    description: "Get friend demographics including age, gender, and area distribution.",
    inputSchema: {},
  },
  // ── Webhook 管理 ──
  {
    name: "line_set_webhook",
    description: "Set the webhook endpoint URL for receiving messages.",
    inputSchema: {
      url: z.string().describe("Webhook endpoint URL (must be HTTPS)"),
    },
  },
  {
    name: "line_get_webhook",
    description: "Get current webhook endpoint information.",
    inputSchema: {},
  },
];

// ── 工具執行邏輯 ──────────────────────────────────────────
async function execute(
  toolName: string,
  params: Record<string, unknown>,
  token: string,
): Promise<ToolResult> {
  switch (toolName) {
    // ── 推送文字訊息 ──
    case "line_send_message": {
      const result = await lineFetch("/bot/message/push", token, {
        method: "POST",
        body: JSON.stringify({
          to: params.user_id,
          messages: [{ type: "text", text: params.message }],
        }),
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    // ── 推送圖片訊息 ──
    case "line_send_image": {
      const result = await lineFetch("/bot/message/push", token, {
        method: "POST",
        body: JSON.stringify({
          to: params.user_id,
          messages: [{
            type: "image",
            originalContentUrl: params.image_url,
            previewImageUrl: params.preview_url || params.image_url,
          }],
        }),
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    // ── 推送貼圖 ──
    case "line_send_sticker": {
      const result = await lineFetch("/bot/message/push", token, {
        method: "POST",
        body: JSON.stringify({
          to: params.user_id,
          messages: [{
            type: "sticker",
            packageId: params.package_id,
            stickerId: params.sticker_id,
          }],
        }),
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    // ── 推送 Flex Message（富卡片） ──
    case "line_send_flex": {
      const result = await lineFetch("/bot/message/push", token, {
        method: "POST",
        body: JSON.stringify({
          to: params.user_id,
          messages: [{
            type: "flex",
            altText: params.alt_text,
            contents: params.contents,
          }],
        }),
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    // ── 群發訊息（多人） ──
    case "line_multicast": {
      const result = await lineFetch("/bot/message/multicast", token, {
        method: "POST",
        body: JSON.stringify({
          to: params.user_ids,
          messages: [{ type: "text", text: params.message }],
        }),
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    // ── 廣播訊息（所有好友） ──
    case "line_broadcast": {
      const result = await lineFetch("/bot/message/broadcast", token, {
        method: "POST",
        body: JSON.stringify({
          messages: [{ type: "text", text: params.message }],
        }),
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    // ── 回覆訊息（需 reply token） ──
    case "line_reply": {
      const result = await lineFetch("/bot/message/reply", token, {
        method: "POST",
        body: JSON.stringify({
          replyToken: params.reply_token,
          messages: [{ type: "text", text: params.message }],
        }),
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    // ── 取得用戶資料 ──
    case "line_get_profile": {
      const result = await lineFetch(`/bot/profile/${params.user_id}`, token);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    // ── 取得群組資訊 ──
    case "line_get_group_summary": {
      const result = await lineFetch(`/bot/group/${params.group_id}/summary`, token);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    // ── 取得群組成員 ID ──
    case "line_get_group_members": {
      const result = await lineFetch(`/bot/group/${params.group_id}/members/ids`, token);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    // ── Bot 離開群組 ──
    case "line_leave_group": {
      const result = await lineFetch(`/bot/group/${params.group_id}/leave`, token, {
        method: "POST",
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    // ── 取得粉絲 ID 列表 ──
    case "line_get_followers_ids": {
      const result = await lineFetch("/bot/followers/ids", token);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    // ── 粉絲統計 ──
    case "line_get_followers": {
      const date = (params.date as string) || new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const result = await lineFetch(`/bot/insight/followers?date=${date}`, token);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    // ── 訊息配額（同時取 limit 和 usage） ──
    case "line_get_quota": {
      const [quota, usage] = await Promise.all([
        lineFetch("/bot/message/quota", token),
        lineFetch("/bot/message/quota/consumption", token),
      ]);
      return { content: [{ type: "text", text: JSON.stringify({ quota, usage }, null, 2) }] };
    }

    // ── Bot 資訊 ──
    case "line_get_bot_info": {
      const result = await lineFetch("/bot/info", token);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    // ── 好友人口統計 ──
    case "line_get_demographics": {
      const result = await lineFetch("/bot/insight/demographic", token);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    // ── 設定 Webhook ──
    case "line_set_webhook": {
      const result = await lineFetch("/bot/channel/webhook/endpoint", token, {
        method: "PUT",
        body: JSON.stringify({ endpoint: params.url }),
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    // ── 取得 Webhook 資訊 ──
    case "line_get_webhook": {
      const result = await lineFetch("/bot/channel/webhook/endpoint", token);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
        isError: true,
      };
  }
}

// ── 智慧錯誤引導 ──────────────────────────────────────────
function formatError(action: string, errorMessage: string): string | null {
  const msg = errorMessage.toLowerCase();

  // Token 無效
  if (msg.includes("invalid token") || msg.includes("authentication") || msg.includes("401")) {
    return "「LINE token 無效 (LINE_AUTH_ERROR)」\nChannel Access Token 無效或已過期。請到 LINE Developers Console 重新產生 token。";
  }

  // 找不到用戶
  if (msg.includes("not found") || msg.includes("404")) {
    if (action.includes("group")) {
      return "「找不到群組 (LINE_GROUP_NOT_FOUND)」\n請確認 group_id 是否正確，且 Bot 仍在群組中。";
    }
    return "「找不到用戶 (LINE_USER_NOT_FOUND)」\n請確認 user_id 是否正確，且對方已加 Bot 為好友。";
  }

  // 速率限制
  if (msg.includes("rate") || msg.includes("429")) {
    return "「LINE API 速率限制 (LINE_RATE_LIMITED)」\n請稍後再試。Push API 限制每秒 100,000 則。";
  }

  // Reply token 過期
  if (action === "reply" && msg.includes("invalid")) {
    return "「Reply token 已過期 (LINE_REPLY_EXPIRED)」\n有效期僅 1 分鐘。請改用 send_message。";
  }

  // 配額超限
  if (msg.includes("limit") || msg.includes("quota")) {
    return "「訊息配額已用完 (LINE_QUOTA_EXCEEDED)」\n免費方案每月有訊息數量限制。用 get_quota 查看剩餘額度。";
  }

  return null;
}

// ── Adapter 匯出 ──────────────────────────────────────────
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
