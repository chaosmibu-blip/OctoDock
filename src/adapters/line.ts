/**
 * LINE Messaging API Adapter
 *
 * 完整覆蓋 LINE Messaging API ~49 個 action
 * 認證方式：API Key（Channel Access Token），從 LINE Developers Console 取得。
 * 支援文字、圖片、貼圖、Flex Message、Rich Menu、群組、受眾、洞察等。
 */
import { z } from "zod";
import type {
  AppAdapter,
  ApiKeyConfig,
  ToolDefinition,
  ToolResult,
} from "./types";

// ── 認證設定 ─────────────────────────────────────────────
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
const actionMap: Record<string, string> = {
  // 訊息傳送（7）
  send_message: "line_send_message",
  send_image: "line_send_image",
  send_sticker: "line_send_sticker",
  send_flex: "line_send_flex",
  multicast: "line_multicast",
  narrowcast: "line_narrowcast",
  broadcast: "line_broadcast",
  reply: "line_reply",
  // 訊息管理（2）
  mark_as_read: "line_mark_as_read",
  show_loading: "line_show_loading",
  // 內容取得（1）
  get_content_url: "line_get_content_url",
  // 用戶與群組（10）
  get_profile: "line_get_profile",
  get_followers_ids: "line_get_followers_ids",
  get_group_summary: "line_get_group_summary",
  get_group_member_count: "line_get_group_member_count",
  get_group_members: "line_get_group_members",
  get_group_member_profile: "line_get_group_member_profile",
  leave_group: "line_leave_group",
  get_room_members: "line_get_room_members",
  get_room_member_profile: "line_get_room_member_profile",
  leave_room: "line_leave_room",
  // Rich Menu（8）
  create_rich_menu: "line_create_rich_menu",
  list_rich_menus: "line_list_rich_menus",
  get_rich_menu: "line_get_rich_menu",
  delete_rich_menu: "line_delete_rich_menu",
  set_default_rich_menu: "line_set_default_rich_menu",
  get_default_rich_menu: "line_get_default_rich_menu",
  clear_default_rich_menu: "line_clear_default_rich_menu",
  link_rich_menu_to_user: "line_link_rich_menu_to_user",
  unlink_rich_menu_from_user: "line_unlink_rich_menu_from_user",
  get_user_rich_menu: "line_get_user_rich_menu",
  // 受眾管理（4）
  create_audience: "line_create_audience",
  get_audience: "line_get_audience",
  list_audiences: "line_list_audiences",
  delete_audience: "line_delete_audience",
  // 統計與配額（7）
  get_followers: "line_get_followers",
  get_quota: "line_get_quota",
  get_bot_info: "line_get_bot_info",
  get_demographics: "line_get_demographics",
  get_delivery_count: "line_get_delivery_count",
  get_message_event: "line_get_message_event",
  // 優惠券（3）
  create_coupon: "line_create_coupon",
  list_coupons: "line_list_coupons",
  get_coupon: "line_get_coupon",
  // 會員（2）
  get_membership_plans: "line_get_membership_plans",
  get_user_membership: "line_get_user_membership",
  // Webhook（3）
  set_webhook: "line_set_webhook",
  get_webhook: "line_get_webhook",
  test_webhook: "line_test_webhook",
};

// ── getSkill：回傳操作概覽 ──────────────────────────────
// 詳細的 ACTION_SKILLS 只為最常用的 action 提供
const ACTION_SKILLS: Record<string, string> = {
  send_message: `## line.send_message
Send a text message to a specific LINE user.
### Parameters
  user_id: LINE user ID
  message: Text message to send
### Example
octodock_do(app:"line", action:"send_message", params:{user_id:"U1234...", message:"明天的會議改到下午 3 點"})`,

  send_image: `## line.send_image
Send an image message.
### Parameters
  user_id: LINE user ID
  image_url: HTTPS URL (JPEG/PNG, max 10MB)
  preview_url (optional): Smaller preview image URL
### Example
octodock_do(app:"line", action:"send_image", params:{user_id:"U1234...", image_url:"https://example.com/photo.jpg"})`,

  send_flex: `## line.send_flex
Send a Flex Message (rich interactive card).
### Parameters
  user_id: LINE user ID
  alt_text: Notification text
  contents: Flex container object (type:"bubble" or "carousel")
### Example
octodock_do(app:"line", action:"send_flex", params:{user_id:"U1234...", alt_text:"Order", contents:{type:"bubble", body:{type:"box", layout:"vertical", contents:[{type:"text", text:"Confirmed!"}]}}})`,

  multicast: `## line.multicast
Send to multiple users (up to 500).
### Parameters
  user_ids: Array of LINE user IDs
  message: Text message
### Example
octodock_do(app:"line", action:"multicast", params:{user_ids:["U1234...", "U5678..."], message:"提醒"})`,

  narrowcast: `## line.narrowcast
Send targeted message to a specific audience.
### Parameters
  message: Text message
  audience_group_id (optional): Audience ID to target
  demographic (optional): Demographic filter object
### Example
octodock_do(app:"line", action:"narrowcast", params:{message:"VIP 專屬優惠", audience_group_id:12345})`,

  broadcast: `## line.broadcast
Broadcast to ALL followers. Counts toward monthly quota.
### Parameters
  message: Text message
### Example
octodock_do(app:"line", action:"broadcast", params:{message:"公告"})`,

  create_rich_menu: `## line.create_rich_menu
Create a rich menu (bottom panel with tap areas).
### Parameters
  size: {width: 2500, height: 1686 or 843}
  selected: Whether shown by default (boolean)
  name: Menu name (not shown to user)
  chat_bar_text: Text on the menu bar
  areas: Array of {bounds:{x,y,width,height}, action:{type,label,uri/text/...}}
### Example
octodock_do(app:"line", action:"create_rich_menu", params:{size:{width:2500,height:843}, selected:true, name:"main", chat_bar_text:"選單", areas:[{bounds:{x:0,y:0,width:1250,height:843}, action:{type:"message", text:"help"}}]})`,

  reply: `## line.reply
Reply to a user message using webhook reply token (must reply within 1 minute).
### Parameters
  reply_token: Reply token from webhook event
  message: Text message
### Example
octodock_do(app:"line", action:"reply", params:{reply_token:"nHuyW...", message:"收到！"})`,

  get_profile: `## line.get_profile
Get user's display name, picture, and status.
### Parameters
  user_id: LINE user ID
### Example
octodock_do(app:"line", action:"get_profile", params:{user_id:"U1234..."})`,

  get_group_summary: `## line.get_group_summary
Get group info (name, icon, member count).
### Parameters
  group_id: Group ID
### Example
octodock_do(app:"line", action:"get_group_summary", params:{group_id:"C1234..."})`,

  get_quota: `## line.get_quota
Get monthly message quota and current usage.
### Parameters
  (none)
### Example
octodock_do(app:"line", action:"get_quota", params:{})`,

  create_audience: `## line.create_audience
Create an audience group from user IDs for narrowcast.
### Parameters
  description: Audience name
  user_ids (optional): Array of user IDs to include
### Example
octodock_do(app:"line", action:"create_audience", params:{description:"VIP customers", user_ids:["U1234..."]})`,
};

function getSkill(action?: string): string {
  if (action && ACTION_SKILLS[action]) return ACTION_SKILLS[action];
  if (action) return null; // ACTION_SKILLS 沒有的 action → 回傳 null 讓 server.ts fallback 用 actionMap 自動查
  return `line actions (${Object.keys(actionMap).length}):
## Messaging
  send_message(user_id, message) — send text to user
  send_image(user_id, image_url) — send image
  send_sticker(user_id, package_id, sticker_id) — send sticker
  send_flex(user_id, alt_text, contents) — send Flex Message
  multicast(user_ids, message) — send to multiple users (max 500)
  narrowcast(message, audience_group_id?) — send to audience
  broadcast(message) — broadcast to all (use with caution)
  reply(reply_token, message) — reply (1 min TTL)
## Message Management
  mark_as_read(user_id) — mark messages as read
  show_loading(user_id) — show typing indicator
  get_content_url(message_id) — get content download URL
## Users & Groups
  get_profile(user_id) — user info
  get_followers_ids() — list follower IDs
  get_group_summary(group_id) — group info
  get_group_member_count(group_id) — member count
  get_group_members(group_id) — member IDs
  get_group_member_profile(group_id, user_id) — member profile in group
  leave_group(group_id) — bot leaves group
  get_room_members(room_id) — multi-person chat member IDs
  get_room_member_profile(room_id, user_id) — member profile in room
  leave_room(room_id) — bot leaves room
## Rich Menu
  create_rich_menu(size, selected, name, chat_bar_text, areas) — create
  list_rich_menus() — list all
  get_rich_menu(rich_menu_id) — get details
  delete_rich_menu(rich_menu_id) — delete
  set_default_rich_menu(rich_menu_id) — set default
  get_default_rich_menu() — get default ID
  clear_default_rich_menu() — clear default
  link_rich_menu_to_user(user_id, rich_menu_id) — link to user
  unlink_rich_menu_from_user(user_id) — unlink from user
  get_user_rich_menu(user_id) — get user's menu ID
## Audience
  create_audience(description, user_ids?) — create audience group
  get_audience(audience_group_id) — get audience info
  list_audiences() — list all audiences
  delete_audience(audience_group_id) — delete audience
## Statistics
  get_followers(date?) — follower count
  get_quota() — message quota + usage
  get_bot_info() — bot info
  get_demographics() — friend demographics
  get_delivery_count(date) — messages delivered on date
  get_message_event(request_id) — message event stats
## Coupons
  create_coupon(message) — create coupon
  list_coupons() — list coupons
  get_coupon(coupon_id) — get coupon details
## Membership
  get_membership_plans() — list plans
  get_user_membership(user_id) — user membership status
## Webhook
  set_webhook(url) — set webhook URL
  get_webhook() — get webhook info
  test_webhook() — test webhook
Use octodock_help(app:"line", action:"ACTION") for details.`;
}

// ── formatResponse ──────────────────────────────────────
/* eslint-disable @typescript-eslint/no-explicit-any */
function formatResponse(action: string, rawData: unknown): string {
  if (typeof rawData !== "object" || rawData === null) return String(rawData);
  const data = rawData as Record<string, unknown>;

  switch (action) {
    case "get_profile":
    case "get_group_member_profile":
    case "get_room_member_profile":
      return [`**${data.displayName}**`, data.statusMessage ? `> ${data.statusMessage}` : null, `Picture: ${data.pictureUrl || "N/A"}`, `User ID: ${data.userId}`].filter(Boolean).join("\n");

    case "get_followers":
      return `Followers: ${data.followers ?? "N/A"}\nTargeted reaches: ${data.targetedReaches ?? "N/A"}\nBlocks: ${data.blocks ?? "N/A"}`;

    case "get_group_summary":
      return [`**${data.groupName}**`, `Members: ${data.memberCount ?? "?"}`, data.pictureUrl ? `Icon: ${data.pictureUrl}` : null, `Group ID: ${data.groupId}`].filter(Boolean).join("\n");

    case "get_group_members":
    case "get_room_members": {
      const ids = data.memberIds as string[] | undefined;
      if (!ids || ids.length === 0) return "No members found.";
      return `${ids.length} members:\n${ids.map((id) => `- ${id}`).join("\n")}${data.next ? "\n(more available)" : ""}`;
    }

    case "get_group_member_count":
      return `Member count: ${data.count ?? "N/A"}`;

    case "get_followers_ids": {
      const ids = data.userIds as string[] | undefined;
      if (!ids || ids.length === 0) return "No followers found.";
      return `${ids.length} followers:\n${ids.map((id) => `- ${id}`).join("\n")}${data.next ? "\n(more available)" : ""}`;
    }

    case "get_quota": {
      const quota = data.quota as Record<string, unknown> | undefined;
      const usage = data.usage as Record<string, unknown> | undefined;
      return `Monthly quota: ${quota?.value ?? "unlimited"}\nUsed this month: ${usage?.totalUsage ?? 0}`;
    }

    case "get_bot_info":
      return [`**${data.displayName}**`, `User ID: ${data.userId}`, `Basic ID: ${data.basicId ?? "N/A"}`, `Premium: ${data.premiumId ? "Yes" : "No"}`, `Chat mode: ${data.chatMode ?? "N/A"}`].join("\n");

    case "get_demographics": {
      if (data.available === false) return "Demographics not available (requires 20+ friends).";
      const sections: string[] = [];
      const genders = data.genders as Array<{ gender: string; percentage: number }> | undefined;
      if (genders) sections.push("Gender: " + genders.map((g) => `${g.gender} ${g.percentage}%`).join(", "));
      const ages = data.ages as Array<{ age: string; percentage: number }> | undefined;
      if (ages) sections.push("Age: " + ages.map((a) => `${a.age} ${a.percentage}%`).join(", "));
      const areas = data.areas as Array<{ area: string; percentage: number }> | undefined;
      if (areas) sections.push("Area: " + areas.slice(0, 5).map((a) => `${a.area} ${a.percentage}%`).join(", "));
      return sections.join("\n") || "No demographic data.";
    }

    case "get_delivery_count":
      return [`Broadcast: ${data.broadcast ?? 0}`, `Push: ${data.targeting ?? 0}`, `Auto-response: ${data.autoResponse ?? 0}`, `Welcome: ${data.welcome ?? 0}`].join("\n");

    case "get_webhook":
      return `URL: ${data.endpoint ?? "N/A"}\nActive: ${data.active ?? "N/A"}`;

    case "test_webhook": {
      return `Success: ${data.success ?? "N/A"}\nTimestamp: ${data.timestamp ?? "N/A"}\nStatus: ${data.statusCode ?? "N/A"}`;
    }

    case "list_rich_menus": {
      const menus = data.richmenus as Array<Record<string, unknown>> | undefined;
      if (!menus || menus.length === 0) return "No rich menus.";
      return menus.map((m) => `- **${m.name}** (${m.richMenuId}) ${m.selected ? "✅ default" : ""} bar: "${m.chatBarText}"`).join("\n");
    }

    case "get_rich_menu":
      return [`**${data.name}**`, `ID: ${data.richMenuId}`, `Size: ${(data.size as any)?.width}x${(data.size as any)?.height}`, `Selected: ${data.selected}`, `Bar text: ${data.chatBarText}`, `Areas: ${(data.areas as any[])?.length ?? 0}`].join("\n");

    case "create_rich_menu":
      return `Done. Rich menu ID: ${data.richMenuId}`;

    case "get_default_rich_menu":
      return `Default rich menu ID: ${data.richMenuId ?? "none"}`;

    case "get_user_rich_menu":
      return `User's rich menu ID: ${data.richMenuId ?? "none"}`;

    case "list_audiences": {
      const audiences = data.audienceGroups as Array<Record<string, unknown>> | undefined;
      if (!audiences || audiences.length === 0) return "No audiences.";
      return audiences.map((a) => `- **${a.description}** (id:${a.audienceGroupId}) ${a.audienceCount ?? "?"} users, status: ${a.status}`).join("\n");
    }

    case "get_audience":
      return [`**${data.description}**`, `ID: ${data.audienceGroupId}`, `Users: ${data.audienceCount ?? "?"}`, `Status: ${data.status}`, `Created: ${data.created}`].filter(Boolean).join("\n");

    case "create_audience":
      return `Done. Audience ID: ${data.audienceGroupId}`;

    case "list_coupons": {
      const coupons = data.coupons as Array<Record<string, unknown>> | undefined;
      if (!coupons || coupons.length === 0) return "No coupons.";
      return coupons.map((c) => `- **${c.couponId}** ${c.status}`).join("\n");
    }

    // 格式化 coupon 詳情，避免回傳 raw JSON（G1）
    case "get_coupon":
      return [`**Coupon ${data.couponId ?? "N/A"}**`, `Status: ${data.status ?? "N/A"}`, data.couponName ? `Name: ${data.couponName}` : null, data.description ? `> ${data.description}` : null, data.redemptionCount !== undefined ? `Redeemed: ${data.redemptionCount}` : null].filter(Boolean).join("\n");

    case "get_membership_plans": {
      const plans = data.membershipPlans as Array<Record<string, unknown>> | undefined;
      if (!plans || plans.length === 0) return "No membership plans.";
      return plans.map((p) => `- **${p.title}** (${p.membershipPlanId}) ${p.currency} ${p.price}`).join("\n");
    }

    case "get_user_membership": {
      const subs = data.subscriptions as Array<Record<string, unknown>> | undefined;
      if (!subs || subs.length === 0) return "No active memberships.";
      return subs.map((s) => `- Plan: ${s.membershipPlanId}, Since: ${s.startDate}`).join("\n");
    }

    // 寫入類動作
    case "send_message":
    case "send_image":
    case "send_sticker":
    case "send_flex":
    case "multicast":
    case "narrowcast":
    case "broadcast":
    case "reply":
    case "mark_as_read":
    case "show_loading":
    case "set_webhook":
    case "leave_group":
    case "leave_room":
    case "delete_rich_menu":
    case "set_default_rich_menu":
    case "clear_default_rich_menu":
    case "link_rich_menu_to_user":
    case "unlink_rich_menu_from_user":
    case "delete_audience":
    case "create_coupon":
      return "Done.";

    case "get_content_url":
      return `Download URL: ${LINE_DATA_API}/bot/message/${data._messageId}/content`;

    // 未列舉的 action 回傳簡潔的 key-value 格式，避免 raw JSON
    default: {
      const entries = Object.entries(data).filter(([_, v]) => v !== null && v !== undefined);
      if (entries.length === 0) return "Done.";
      return entries.slice(0, 10).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join("\n");
    }
  }
}

// ── 工具定義 ──────────────────────────────────────────────
const tools: ToolDefinition[] = [
  // ── 訊息傳送 ──
  { name: "line_send_message", description: "Send a text message to a LINE user.", inputSchema: { user_id: z.string().describe("LINE user ID"), message: z.string().describe("Text message") } },
  { name: "line_send_image", description: "Send an image message to a LINE user.", inputSchema: { user_id: z.string().describe("LINE user ID"), image_url: z.string().describe("Image URL (HTTPS, JPEG/PNG)"), preview_url: z.string().optional().describe("Preview image URL") } },
  { name: "line_send_sticker", description: "Send a LINE sticker.", inputSchema: { user_id: z.string().describe("LINE user ID"), package_id: z.string().describe("Sticker package ID"), sticker_id: z.string().describe("Sticker ID") } },
  { name: "line_send_flex", description: "Send a Flex Message (rich card).", inputSchema: { user_id: z.string().describe("LINE user ID"), alt_text: z.string().describe("Notification text"), contents: z.record(z.string(), z.unknown()).describe("Flex container object") } },
  { name: "line_multicast", description: "Send message to multiple users (max 500).", inputSchema: { user_ids: z.array(z.string()).describe("Array of user IDs"), message: z.string().describe("Text message") } },
  { name: "line_narrowcast", description: "Send targeted message to audience.", inputSchema: { message: z.string().describe("Text message"), audience_group_id: z.number().optional().describe("Audience group ID"), demographic: z.record(z.string(), z.unknown()).optional().describe("Demographic filter") } },
  { name: "line_broadcast", description: "Broadcast to ALL followers. Counts toward quota.", inputSchema: { message: z.string().describe("Text message") } },
  { name: "line_reply", description: "Reply using webhook token (1 min TTL).", inputSchema: { reply_token: z.string().describe("Reply token"), message: z.string().describe("Text message") } },
  // ── 訊息管理 ──
  { name: "line_mark_as_read", description: "Mark messages from a user as read.", inputSchema: { user_id: z.string().describe("LINE user ID") } },
  { name: "line_show_loading", description: "Show typing indicator to a user (20 sec).", inputSchema: { user_id: z.string().describe("LINE user ID") } },
  { name: "line_get_content_url", description: "Get download URL for message content (image/video/audio).", inputSchema: { message_id: z.string().describe("Message ID from webhook event") } },
  // ── 用戶與群組 ──
  { name: "line_get_profile", description: "Get user display name, picture, status.", inputSchema: { user_id: z.string().describe("LINE user ID") } },
  { name: "line_get_followers_ids", description: "Get list of follower user IDs.", inputSchema: {} },
  { name: "line_get_group_summary", description: "Get group info (name, icon, count).", inputSchema: { group_id: z.string().describe("Group ID") } },
  { name: "line_get_group_member_count", description: "Get group member count.", inputSchema: { group_id: z.string().describe("Group ID") } },
  { name: "line_get_group_members", description: "Get group member user IDs.", inputSchema: { group_id: z.string().describe("Group ID") } },
  { name: "line_get_group_member_profile", description: "Get user profile within a group.", inputSchema: { group_id: z.string().describe("Group ID"), user_id: z.string().describe("User ID") } },
  { name: "line_leave_group", description: "Bot leaves a group.", inputSchema: { group_id: z.string().describe("Group ID") } },
  { name: "line_get_room_members", description: "Get multi-person chat member IDs.", inputSchema: { room_id: z.string().describe("Room ID") } },
  { name: "line_get_room_member_profile", description: "Get user profile within a room.", inputSchema: { room_id: z.string().describe("Room ID"), user_id: z.string().describe("User ID") } },
  { name: "line_leave_room", description: "Bot leaves a multi-person chat.", inputSchema: { room_id: z.string().describe("Room ID") } },
  // ── Rich Menu ──
  { name: "line_create_rich_menu", description: "Create a rich menu (bottom panel).", inputSchema: { size: z.object({ width: z.number(), height: z.number() }).describe("Menu size {width:2500, height:1686 or 843}"), selected: z.boolean().describe("Show by default"), name: z.string().describe("Menu name"), chat_bar_text: z.string().describe("Bar text"), areas: z.array(z.record(z.string(), z.unknown())).describe("Tap areas") } },
  { name: "line_list_rich_menus", description: "List all rich menus.", inputSchema: {} },
  { name: "line_get_rich_menu", description: "Get rich menu details.", inputSchema: { rich_menu_id: z.string().describe("Rich menu ID") } },
  { name: "line_delete_rich_menu", description: "Delete a rich menu.", inputSchema: { rich_menu_id: z.string().describe("Rich menu ID") } },
  { name: "line_set_default_rich_menu", description: "Set default rich menu for all users.", inputSchema: { rich_menu_id: z.string().describe("Rich menu ID") } },
  { name: "line_get_default_rich_menu", description: "Get default rich menu ID.", inputSchema: {} },
  { name: "line_clear_default_rich_menu", description: "Clear default rich menu.", inputSchema: {} },
  { name: "line_link_rich_menu_to_user", description: "Link rich menu to specific user.", inputSchema: { user_id: z.string().describe("User ID"), rich_menu_id: z.string().describe("Rich menu ID") } },
  { name: "line_unlink_rich_menu_from_user", description: "Unlink rich menu from user.", inputSchema: { user_id: z.string().describe("User ID") } },
  { name: "line_get_user_rich_menu", description: "Get rich menu linked to user.", inputSchema: { user_id: z.string().describe("User ID") } },
  // ── 受眾管理 ──
  { name: "line_create_audience", description: "Create audience group from user IDs.", inputSchema: { description: z.string().describe("Audience name"), user_ids: z.array(z.string()).optional().describe("User IDs to include") } },
  { name: "line_get_audience", description: "Get audience info.", inputSchema: { audience_group_id: z.number().describe("Audience group ID") } },
  { name: "line_list_audiences", description: "List all audiences.", inputSchema: {} },
  { name: "line_delete_audience", description: "Delete audience.", inputSchema: { audience_group_id: z.number().describe("Audience group ID") } },
  // ── 統計與配額 ──
  { name: "line_get_followers", description: "Get follower count stats.", inputSchema: { date: z.string().optional().describe("Date YYYYMMDD") } },
  { name: "line_get_quota", description: "Get message quota and usage.", inputSchema: {} },
  { name: "line_get_bot_info", description: "Get bot info.", inputSchema: {} },
  { name: "line_get_demographics", description: "Get friend demographics.", inputSchema: {} },
  { name: "line_get_delivery_count", description: "Get messages delivered on a date.", inputSchema: { date: z.string().describe("Date YYYYMMDD") } },
  { name: "line_get_message_event", description: "Get message event statistics.", inputSchema: { request_id: z.string().describe("Request ID from send operation") } },
  // ── 優惠券 ──
  { name: "line_create_coupon", description: "Create a LINE coupon.", inputSchema: { message: z.record(z.string(), z.unknown()).describe("Coupon message object") } },
  { name: "line_list_coupons", description: "List all coupons.", inputSchema: {} },
  { name: "line_get_coupon", description: "Get coupon details.", inputSchema: { coupon_id: z.string().describe("Coupon ID") } },
  // ── 會員 ──
  { name: "line_get_membership_plans", description: "List membership plans.", inputSchema: {} },
  { name: "line_get_user_membership", description: "Get user membership status.", inputSchema: { user_id: z.string().describe("User ID") } },
  // ── Webhook ──
  { name: "line_set_webhook", description: "Set webhook URL.", inputSchema: { url: z.string().describe("HTTPS URL") } },
  { name: "line_get_webhook", description: "Get webhook info.", inputSchema: {} },
  { name: "line_test_webhook", description: "Test webhook endpoint.", inputSchema: {} },
];

// ── 工具執行邏輯 ──────────────────────────────────────────
async function execute(
  toolName: string,
  params: Record<string, unknown>,
  token: string,
): Promise<ToolResult> {
  const json = (result: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] });
  const post = (path: string, body: unknown) => lineFetch(path, token, { method: "POST", body: JSON.stringify(body) });
  const get = (path: string) => lineFetch(path, token);
  const put = (path: string, body: unknown) => lineFetch(path, token, { method: "PUT", body: JSON.stringify(body) });
  const del = (path: string) => lineFetch(path, token, { method: "DELETE" });

  switch (toolName) {
    // ── 訊息傳送 ──
    case "line_send_message": return json(await post("/bot/message/push", { to: params.user_id, messages: [{ type: "text", text: params.message }] }));
    case "line_send_image": return json(await post("/bot/message/push", { to: params.user_id, messages: [{ type: "image", originalContentUrl: params.image_url, previewImageUrl: params.preview_url || params.image_url }] }));
    case "line_send_sticker": return json(await post("/bot/message/push", { to: params.user_id, messages: [{ type: "sticker", packageId: params.package_id, stickerId: params.sticker_id }] }));
    case "line_send_flex": return json(await post("/bot/message/push", { to: params.user_id, messages: [{ type: "flex", altText: params.alt_text, contents: params.contents }] }));
    case "line_multicast": return json(await post("/bot/message/multicast", { to: params.user_ids, messages: [{ type: "text", text: params.message }] }));
    case "line_narrowcast": {
      const body: Record<string, unknown> = { messages: [{ type: "text", text: params.message }] };
      if (params.audience_group_id) body.recipient = { type: "audience", audienceGroupId: params.audience_group_id };
      if (params.demographic) body.demographic = params.demographic;
      return json(await post("/bot/message/narrowcast", body));
    }
    case "line_broadcast": return json(await post("/bot/message/broadcast", { messages: [{ type: "text", text: params.message }] }));
    case "line_reply": return json(await post("/bot/message/reply", { replyToken: params.reply_token, messages: [{ type: "text", text: params.message }] }));

    // ── 訊息管理 ──
    case "line_mark_as_read": return json(await post("/bot/message/markAsRead", { chat: { userId: params.user_id } }));
    case "line_show_loading": return json(await post("/bot/message/showLoadingAnimation", { chatId: params.user_id }));
    case "line_get_content_url": return json({ _messageId: params.message_id, url: `${LINE_DATA_API}/bot/message/${params.message_id}/content` });

    // ── 用戶與群組 ──
    case "line_get_profile": return json(await get(`/bot/profile/${params.user_id}`));
    // F1: 支援 start cursor 分頁
    case "line_get_followers_ids": {
      const startParam = params.start ? `?start=${encodeURIComponent(params.start as string)}` : "";
      return json(await get(`/bot/followers/ids${startParam}`));
    }
    case "line_get_group_summary": return json(await get(`/bot/group/${params.group_id}/summary`));
    case "line_get_group_member_count": return json(await get(`/bot/group/${params.group_id}/members/count`));
    // F1: 支援 start cursor 分頁
    case "line_get_group_members": {
      const startParam = params.start ? `?start=${encodeURIComponent(params.start as string)}` : "";
      return json(await get(`/bot/group/${params.group_id}/members/ids${startParam}`));
    }
    case "line_get_group_member_profile": return json(await get(`/bot/group/${params.group_id}/members/${params.user_id}`));
    case "line_leave_group": return json(await post(`/bot/group/${params.group_id}/leave`, {}));
    // F1: 支援 start cursor 分頁
    case "line_get_room_members": {
      const startParam = params.start ? `?start=${encodeURIComponent(params.start as string)}` : "";
      return json(await get(`/bot/room/${params.room_id}/members/ids${startParam}`));
    }
    case "line_get_room_member_profile": return json(await get(`/bot/room/${params.room_id}/members/${params.user_id}`));
    case "line_leave_room": return json(await post(`/bot/room/${params.room_id}/leave`, {}));

    // ── Rich Menu ──
    case "line_create_rich_menu": return json(await post("/bot/richmenu", { size: params.size, selected: params.selected, name: params.name, chatBarText: params.chat_bar_text, areas: params.areas }));
    case "line_list_rich_menus": return json(await get("/bot/richmenu/list"));
    case "line_get_rich_menu": return json(await get(`/bot/richmenu/${params.rich_menu_id}`));
    case "line_delete_rich_menu": return json(await del(`/bot/richmenu/${params.rich_menu_id}`));
    case "line_set_default_rich_menu": return json(await post(`/bot/user/all/richmenu/${params.rich_menu_id}`, {}));
    case "line_get_default_rich_menu": return json(await get("/bot/user/all/richmenu"));
    case "line_clear_default_rich_menu": return json(await del("/bot/user/all/richmenu"));
    case "line_link_rich_menu_to_user": return json(await post(`/bot/user/${params.user_id}/richmenu/${params.rich_menu_id}`, {}));
    case "line_unlink_rich_menu_from_user": return json(await del(`/bot/user/${params.user_id}/richmenu`));
    case "line_get_user_rich_menu": return json(await get(`/bot/user/${params.user_id}/richmenu`));

    // ── 受眾管理 ──
    case "line_create_audience": {
      const body: Record<string, unknown> = { description: params.description, isIfaAudience: false };
      if (params.user_ids) body.audiences = (params.user_ids as string[]).map((id) => ({ id }));
      return json(await post("/bot/audienceGroup/upload", body));
    }
    case "line_get_audience": return json(await get(`/bot/audienceGroup/${params.audience_group_id}`));
    // F1: 支援 page 參數分頁（不再硬編碼 page=1）
    case "line_list_audiences": {
      const page = (params.page as number) ?? 1;
      const size = Math.min((params.size as number) ?? 40, 40);
      return json(await get(`/bot/audienceGroup/list?page=${page}&size=${size}`));
    }
    case "line_delete_audience": return json(await del(`/bot/audienceGroup/${params.audience_group_id}`));

    // ── 統計與配額 ──
    case "line_get_followers": {
      const date = (params.date as string) || new Date().toISOString().slice(0, 10).replace(/-/g, "");
      return json(await get(`/bot/insight/followers?date=${date}`));
    }
    case "line_get_quota": {
      const [quota, usage] = await Promise.all([get("/bot/message/quota"), get("/bot/message/quota/consumption")]);
      return json({ quota, usage });
    }
    case "line_get_bot_info": return json(await get("/bot/info"));
    case "line_get_demographics": return json(await get("/bot/insight/demographic"));
    case "line_get_delivery_count": return json(await get(`/bot/insight/message/delivery?date=${params.date}`));
    case "line_get_message_event": return json(await get(`/bot/insight/message/event?requestId=${params.request_id}`));

    // ── 優惠券 ──
    case "line_create_coupon": return json(await post("/bot/coupon", params.message));
    case "line_list_coupons": return json(await get("/bot/coupon/list"));
    case "line_get_coupon": return json(await get(`/bot/coupon/${params.coupon_id}`));

    // ── 會員 ──
    case "line_get_membership_plans": return json(await get("/bot/membership/list"));
    case "line_get_user_membership": return json(await get(`/bot/user/${params.user_id}/membership`));

    // ── Webhook ──
    case "line_set_webhook": return json(await put("/bot/channel/webhook/endpoint", { endpoint: params.url }));
    case "line_get_webhook": return json(await get("/bot/channel/webhook/endpoint"));
    case "line_test_webhook": return json(await post("/bot/channel/webhook/test", {}));

    default:
      return { content: [{ type: "text", text: `Unknown tool: ${toolName}` }], isError: true };
  }
}

// ── 智慧錯誤引導 ──────────────────────────────────────────
function formatError(action: string, errorMessage: string): string | null {
  const msg = errorMessage.toLowerCase();
  if (msg.includes("401") || msg.includes("invalid token") || msg.includes("authentication"))
    return "「LINE token 無效 (LINE_AUTH_ERROR)」\nChannel Access Token 無效或已過期。請到 LINE Developers Console 重新產生 token。";
  if (msg.includes("404") || msg.includes("not found")) {
    if (action.includes("group")) return "「找不到群組 (LINE_GROUP_NOT_FOUND)」\n請確認 group_id 是否正確，以及 Bot 是否已加入該群組。";
    if (action.includes("room")) return "「找不到聊天室 (LINE_ROOM_NOT_FOUND)」\n請確認 room_id 且 Bot 仍在聊天室中。";
    if (action.includes("rich_menu")) return "「找不到 Rich Menu (LINE_MENU_NOT_FOUND)」\n請用 list_rich_menus 確認 ID。";
    return "「找不到用戶 (LINE_USER_NOT_FOUND)」\n請確認 user_id 且對方已加 Bot 為好友。";
  }
  if (msg.includes("429") || msg.includes("rate")) return "「速率限制 (LINE_RATE_LIMITED)」\n請稍後再試。";
  if (action === "reply" && msg.includes("invalid")) return "「Reply token 過期 (LINE_REPLY_EXPIRED)」\n有效期 1 分鐘。請改用 send_message。";
  if (msg.includes("limit") || msg.includes("quota")) return "「配額已滿 (LINE_QUOTA_EXCEEDED)」\n用 get_quota 查看剩餘額度。";
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
