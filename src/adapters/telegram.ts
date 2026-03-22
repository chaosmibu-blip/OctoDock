/**
 * Telegram Bot API Adapter
 *
 * 完整覆蓋 Telegram Bot API 常用端點（~50 個 action）
 * 認證方式：Bot Token，從 @BotFather 取得，零審核零費用。
 * 支援訊息、媒體、群組管理、投票、鍵盤按鈕、Bot 設定等。
 */
import { z } from "zod";
import type {
  AppAdapter,
  BotTokenConfig,
  ToolDefinition,
  ToolResult,
} from "./types";

// ── 認證設定 ─────────────────────────────────────────────
const authConfig: BotTokenConfig = {
  type: "bot_token",
  instructions: {
    zh: "1. 在 Telegram 搜尋 @BotFather\n2. 發送 /newbot 建立新 Bot\n3. 按照指示設定 Bot 名稱和 username\n4. BotFather 會回傳一個 Bot Token\n5. 複製 token 貼到下方\n\nOctoDock 會自動設定 Webhook。",
    en: "1. Search @BotFather on Telegram\n2. Send /newbot to create a new Bot\n3. Follow instructions to set name and username\n4. BotFather will send you a Bot Token\n5. Copy and paste the token below\n\nOctoDock will automatically set up the webhook.",
  },
  setupWebhook: true,
};

const TG_API = "https://api.telegram.org";

/** Bot API 請求超時時間（毫秒） */
const REQUEST_TIMEOUT_MS = 30_000;

// ── Telegram API fetch 封裝 ──────────────────────────────
async function tgFetch(
  method: string,
  token: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  /* AbortController 超時保護，避免請求無限掛起 */
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${TG_API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timer);
    if (err?.name === "AbortError") {
      throw new Error("Telegram Bot API 請求逾時 (TG_BOT_REQUEST_TIMEOUT)");
    }
    throw err;
  }
  clearTimeout(timer);

  if (!res.ok) {
    const error = await res.json().catch(() => ({ description: res.statusText }));
    throw new Error(
      JSON.stringify({ status: res.status, description: (error as { description: string }).description }),
    );
  }
  const data = (await res.json()) as { ok: boolean; result: unknown };
  return data.result;
}

// ── actionMap ──────────────────────────────────────────────
const actionMap: Record<string, string> = {
  // 訊息傳送（10）
  send_message: "tg_send_message",
  send_photo: "tg_send_photo",
  send_video: "tg_send_video",
  send_document: "tg_send_document",
  send_audio: "tg_send_audio",
  send_voice: "tg_send_voice",
  send_sticker: "tg_send_sticker",
  send_location: "tg_send_location",
  send_contact: "tg_send_contact",
  send_poll: "tg_send_poll",
  // 訊息管理（6）
  forward_message: "tg_forward_message",
  copy_message: "tg_copy_message",
  edit_message: "tg_edit_message",
  delete_message: "tg_delete_message",
  set_reaction: "tg_set_reaction",
  pin_message: "tg_pin_message",
  unpin_message: "tg_unpin_message",
  unpin_all: "tg_unpin_all",
  // 聊天管理（12）
  get_chat: "tg_get_chat",
  get_chat_member: "tg_get_chat_member",
  get_chat_member_count: "tg_get_chat_member_count",
  get_chat_admins: "tg_get_chat_admins",
  ban_member: "tg_ban_member",
  unban_member: "tg_unban_member",
  restrict_member: "tg_restrict_member",
  promote_member: "tg_promote_member",
  set_chat_title: "tg_set_chat_title",
  set_chat_description: "tg_set_chat_description",
  leave_chat: "tg_leave_chat",
  get_invite_link: "tg_get_invite_link",
  // 論壇主題（4）
  create_forum_topic: "tg_create_forum_topic",
  edit_forum_topic: "tg_edit_forum_topic",
  close_forum_topic: "tg_close_forum_topic",
  reopen_forum_topic: "tg_reopen_forum_topic",
  // Bot 設定（6）
  get_me: "tg_get_me",
  set_my_commands: "tg_set_my_commands",
  get_my_commands: "tg_get_my_commands",
  delete_my_commands: "tg_delete_my_commands",
  set_my_name: "tg_set_my_name",
  set_my_description: "tg_set_my_description",
  // Webhook + Updates（4）
  get_updates: "tg_get_updates",
  set_webhook: "tg_set_webhook",
  get_webhook: "tg_get_webhook",
  delete_webhook: "tg_delete_webhook",
  // 內容（2）
  get_file: "tg_get_file",
  get_user_photos: "tg_get_user_photos",
  // Inline 回覆（1）
  answer_callback: "tg_answer_callback",
};

// ── getSkill ──────────────────────────────────────────────
const ACTION_SKILLS: Record<string, string> = {
  send_message: `## telegram.send_message
Send a text message to a chat.
### Parameters
  chat_id: Chat ID (user, group, or channel)
  text: Message text
  parse_mode (optional): "Markdown", "MarkdownV2", or "HTML"
  reply_to (optional): Message ID to reply to
  reply_markup (optional): Inline keyboard or reply keyboard object
### Example
octodock_do(app:"telegram", action:"send_message", params:{chat_id:"123456789", text:"*Hello!*", parse_mode:"Markdown"})`,

  send_photo: `## telegram.send_photo
Send a photo to a chat.
### Parameters
  chat_id: Chat ID
  photo: Public URL or file_id
  caption (optional): Photo caption
### Example
octodock_do(app:"telegram", action:"send_photo", params:{chat_id:"123456789", photo:"https://example.com/img.jpg"})`,

  send_poll: `## telegram.send_poll
Send a poll to a chat.
### Parameters
  chat_id: Chat ID
  question: Poll question
  options: Array of answer options (2-10 strings)
  is_anonymous (optional): Anonymous poll (default true)
  type (optional): "regular" or "quiz"
  correct_option_id (optional): For quiz, index of correct answer
### Example
octodock_do(app:"telegram", action:"send_poll", params:{chat_id:"123456789", question:"午餐吃什麼？", options:["便當","麵","火鍋"]})`,

  edit_message: `## telegram.edit_message
Edit a sent message.
### Parameters
  chat_id: Chat ID
  message_id: Message ID
  text: New message text
  parse_mode (optional): "Markdown", "MarkdownV2", or "HTML"
### Example
octodock_do(app:"telegram", action:"edit_message", params:{chat_id:"123456789", message_id:42, text:"Updated text"})`,

  get_chat: `## telegram.get_chat
Get chat info (title, type, members, description).
### Parameters
  chat_id: Chat ID (user, group, or channel)
### Example
octodock_do(app:"telegram", action:"get_chat", params:{chat_id:"-1001234567890"})`,

  promote_member: `## telegram.promote_member
Promote a user to admin. Without permissions param, grants default admin rights.
### Parameters
  chat_id: Group/channel ID
  user_id: User ID to promote
  permissions (optional): {can_manage_chat, can_delete_messages, can_restrict_members, can_promote_members, can_change_info, can_invite_users, can_pin_messages, can_manage_topics}
### Example
octodock_do(app:"telegram", action:"promote_member", params:{chat_id:"-1001234567890", user_id:123456})`,

  restrict_member: `## telegram.restrict_member
Restrict a user's permissions in a group.
### Parameters
  chat_id: Group ID
  user_id: User ID
  permissions: {can_send_messages, can_send_media_messages, can_send_polls, can_send_other_messages, can_add_web_page_previews, can_change_info, can_invite_users, can_pin_messages}
### Example
octodock_do(app:"telegram", action:"restrict_member", params:{chat_id:"-100123", user_id:456, permissions:{can_send_messages:false}})`,

  set_my_commands: `## telegram.set_my_commands
Set bot command menu visible to users.
### Parameters
  commands: Array of {command, description}
### Example
octodock_do(app:"telegram", action:"set_my_commands", params:{commands:[{command:"help", description:"Show help"}, {command:"start", description:"Start bot"}]})`,

  forward_message: `## telegram.forward_message
Forward a message from one chat to another.
### Parameters
  chat_id: Target chat ID
  from_chat_id: Source chat ID
  message_id: Message ID to forward
### Example
octodock_do(app:"telegram", action:"forward_message", params:{chat_id:"123", from_chat_id:"456", message_id:42})`,

  create_forum_topic: `## telegram.create_forum_topic
Create a topic in a forum-enabled group.
### Parameters
  chat_id: Group chat ID
  name: Topic name
  icon_color (optional): Color of the topic icon
### Example
octodock_do(app:"telegram", action:"create_forum_topic", params:{chat_id:"-1001234567890", name:"Bug Reports"})`,
};

function getSkill(action?: string): string | null {
  if (action && ACTION_SKILLS[action]) return ACTION_SKILLS[action];
  if (action) return null; // ACTION_SKILLS 沒有的 action → 回傳 null 讓 server.ts fallback 用 actionMap 自動查
  return `telegram actions (${Object.keys(actionMap).length}):
## Messaging
  send_message(chat_id, text, parse_mode?, reply_to?, reply_markup?) — send text
  send_photo(chat_id, photo, caption?) — send photo
  send_video(chat_id, video, caption?) — send video
  send_document(chat_id, document, caption?) — send file
  send_audio(chat_id, audio, caption?) — send audio
  send_voice(chat_id, voice) — send voice message
  send_sticker(chat_id, sticker) — send sticker
  send_location(chat_id, latitude, longitude) — send location
  send_contact(chat_id, phone_number, first_name) — send contact
  send_poll(chat_id, question, options) — send poll
## Message Management
  forward_message(chat_id, from_chat_id, message_id) — forward message
  copy_message(chat_id, from_chat_id, message_id) — copy without forward tag
  edit_message(chat_id, message_id, text) — edit sent message
  delete_message(chat_id, message_id) — delete message
  set_reaction(chat_id, message_id, emoji) — react to message
  pin_message(chat_id, message_id) — pin message
  unpin_message(chat_id, message_id) — unpin message
  unpin_all(chat_id) — unpin all messages
## Chat Management
  get_chat(chat_id) — get chat info
  get_chat_member(chat_id, user_id) — get member info
  get_chat_member_count(chat_id) — member count
  get_chat_admins(chat_id) — list admins
  ban_member(chat_id, user_id) — ban user
  unban_member(chat_id, user_id) — unban user
  restrict_member(chat_id, user_id, permissions) — restrict user
  promote_member(chat_id, user_id, permissions) — promote to admin
  set_chat_title(chat_id, title) — change chat title
  set_chat_description(chat_id, description) — change description
  leave_chat(chat_id) — bot leaves chat
  get_invite_link(chat_id) — get invite link
## Forum Topics
  create_forum_topic(chat_id, name) — create topic
  edit_forum_topic(chat_id, message_thread_id, name?) — edit topic
  close_forum_topic(chat_id, message_thread_id) — close topic
  reopen_forum_topic(chat_id, message_thread_id) — reopen topic
## Bot Settings
  get_me() — get bot info
  set_my_commands(commands) — set bot commands
  get_my_commands() — get bot commands
  delete_my_commands() — delete bot commands
  set_my_name(name) — set bot name
  set_my_description(description) — set bot description
## Webhook & Updates
  get_updates(limit?, offset?) — get recent messages
  set_webhook(url) — set webhook URL
  get_webhook() — get webhook info
  delete_webhook() — delete webhook
## Content
  get_file(file_id) — get file download URL
  get_user_photos(user_id) — get user profile photos
## Callback
  answer_callback(callback_query_id, text?) — answer inline button callback
Use octodock_help(app:"telegram", action:"ACTION") for details.`;
}

// ── formatResponse ──────────────────────────────────────
/* eslint-disable @typescript-eslint/no-explicit-any */
function formatResponse(action: string, rawData: unknown): string {
  if (typeof rawData !== "object" || rawData === null) return String(rawData);
  const data = rawData as Record<string, unknown>;

  switch (action) {
    // 訊息傳送：回傳 message_id
    case "send_message":
    case "send_photo":
    case "send_video":
    case "send_document":
    case "send_audio":
    case "send_voice":
    case "send_sticker":
    case "send_location":
    case "send_contact":
    case "send_poll":
    case "forward_message":
    case "copy_message":
      // tgFetch() 已經 extract result，直接用 data.message_id
      return `Done. Message ID: ${data.message_id ?? "N/A"}`;

    // 訊息管理
    case "edit_message":
      return `Done. Message edited. ID: ${data.message_id ?? "N/A"}`;
    case "delete_message":
    case "pin_message":
    case "unpin_message":
    case "unpin_all":
    case "set_reaction":
      return "Done.";

    // 聊天資訊
    case "get_chat": {
      const type = data.type as string;
      const title = data.title as string || data.first_name as string || "?";
      return [`**${title}** (${type})`, `ID: ${data.id}`, data.description ? `> ${data.description}` : null, data.username ? `@${data.username}` : null, `Members: ${data.member_count ?? "?"}`, data.invite_link ? `Invite: ${data.invite_link}` : null].filter(Boolean).join("\n");
    }

    case "get_chat_member": {
      const user = data.user as Record<string, unknown> | undefined;
      const name = user?.first_name as string || "?";
      return `**${name}** — status: ${data.status}`;
    }

    case "get_chat_member_count":
      return `Member count: ${rawData}`;

    case "get_chat_admins": {
      // 加上 null/undefined guard，避免非 array 時 crash
      if (!rawData || !Array.isArray(rawData)) return "No admins.";
      if (rawData.length === 0) return "No admins.";
      return rawData.map((a: any) => `- **${a.user?.first_name || "?"}** (${a.status})${a.custom_title ? ` "${a.custom_title}"` : ""}`).join("\n");
    }

    case "get_invite_link":
      return `Invite link: ${rawData}`;

    // Bot 資訊
    case "get_me":
      return [`**${data.first_name}**`, `@${data.username}`, `ID: ${data.id}`, `Can join groups: ${data.can_join_groups}`, `Can read messages: ${data.can_read_all_group_messages}`].join("\n");

    case "get_my_commands": {
      if (!Array.isArray(rawData) || rawData.length === 0) return "No commands set.";
      return rawData.map((c: any) => `/${c.command} — ${c.description}`).join("\n");
    }

    // Updates
    case "get_updates": {
      if (!Array.isArray(rawData) || rawData.length === 0) return "No new messages.";
      return rawData.map((u: any) => {
        const msg = u.message || u.edited_message || u.channel_post;
        if (!msg) return `Update ${u.update_id}`;
        const from = msg.from?.first_name || msg.chat?.title || "?";
        const text = msg.text || msg.caption || "(media)";
        return `[${from}] ${text}`;
      }).join("\n");
    }

    // Webhook
    case "set_webhook":
    case "delete_webhook":
      return "Done. Webhook updated.";
    case "get_webhook":
      return [`URL: ${data.url || "none"}`, `Pending: ${data.pending_update_count ?? 0}`, data.last_error_message ? `Last error: ${data.last_error_message}` : null].filter(Boolean).join("\n");

    // 檔案
    case "get_file": {
      const filePath = data.file_path as string;
      return filePath ? `Download: ${TG_API}/file/bot<TOKEN>/${filePath}\nFile ID: ${data.file_id}\nSize: ${data.file_size ?? "?"} bytes` : JSON.stringify(data, null, 2);
    }

    case "get_user_photos": {
      const total = data.total_count as number;
      return `${total} profile photo(s)`;
    }

    // Forum
    case "create_forum_topic":
      return `Done. Topic "${data.name}" created. Thread ID: ${data.message_thread_id}`;

    // 管理操作
    case "ban_member":
    case "unban_member":
    case "restrict_member":
    case "promote_member":
    case "set_chat_title":
    case "set_chat_description":
    case "leave_chat":
    case "set_my_commands":
    case "delete_my_commands":
    case "set_my_name":
    case "set_my_description":
    case "edit_forum_topic":
    case "close_forum_topic":
    case "reopen_forum_topic":
    case "answer_callback":
      return "Done.";

    // 未列舉的 action 回傳簡潔的 key-value 格式，避免 raw JSON
    default: {
      const entries = Object.entries(data).filter(([_, v]) => v !== null && v !== undefined);
      if (entries.length === 0) return "Done.";
      return entries.slice(0, 10).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join("\n");
    }
  }
}

// ── 工具定義 ──────────────────────────────────────────────
// 通用的 chat_id schema（支援數字和字串）
const chatId = z.union([z.string(), z.number()]).describe("Chat ID (user, group, or channel)");

const tools: ToolDefinition[] = [
  // ── 訊息傳送 ──
  { name: "tg_send_message", description: "Send text message. Supports Markdown/HTML.", inputSchema: { chat_id: chatId, text: z.string().describe("Message text"), parse_mode: z.enum(["Markdown", "MarkdownV2", "HTML"]).optional().describe("Format mode"), reply_to: z.number().optional().describe("Reply to message ID"), reply_markup: z.record(z.string(), z.unknown()).optional().describe("Inline keyboard or reply keyboard") } },
  { name: "tg_send_photo", description: "Send a photo.", inputSchema: { chat_id: chatId, photo: z.string().describe("URL or file_id"), caption: z.string().optional().describe("Caption") } },
  { name: "tg_send_video", description: "Send a video.", inputSchema: { chat_id: chatId, video: z.string().describe("URL or file_id"), caption: z.string().optional().describe("Caption") } },
  { name: "tg_send_document", description: "Send a file/document.", inputSchema: { chat_id: chatId, document: z.string().describe("URL or file_id"), caption: z.string().optional().describe("Caption") } },
  { name: "tg_send_audio", description: "Send an audio file.", inputSchema: { chat_id: chatId, audio: z.string().describe("URL or file_id"), caption: z.string().optional().describe("Caption") } },
  { name: "tg_send_voice", description: "Send a voice message (OGG/OPUS).", inputSchema: { chat_id: chatId, voice: z.string().describe("URL or file_id") } },
  { name: "tg_send_sticker", description: "Send a sticker.", inputSchema: { chat_id: chatId, sticker: z.string().describe("Sticker file_id or URL") } },
  { name: "tg_send_location", description: "Send a location pin.", inputSchema: { chat_id: chatId, latitude: z.number().describe("Latitude"), longitude: z.number().describe("Longitude") } },
  { name: "tg_send_contact", description: "Send a phone contact.", inputSchema: { chat_id: chatId, phone_number: z.string().describe("Phone number"), first_name: z.string().describe("Contact name"), last_name: z.string().optional().describe("Last name") } },
  { name: "tg_send_poll", description: "Send a poll.", inputSchema: { chat_id: chatId, question: z.string().describe("Poll question"), options: z.array(z.string()).describe("Answer options (2-10)"), is_anonymous: z.boolean().optional().describe("Anonymous (default true)"), type: z.enum(["regular", "quiz"]).optional().describe("Poll type"), correct_option_id: z.number().optional().describe("For quiz: correct answer index") } },
  // ── 訊息管理 ──
  { name: "tg_forward_message", description: "Forward a message.", inputSchema: { chat_id: chatId, from_chat_id: chatId, message_id: z.number().describe("Message ID to forward") } },
  { name: "tg_copy_message", description: "Copy message without forward tag.", inputSchema: { chat_id: chatId, from_chat_id: chatId, message_id: z.number().describe("Message ID to copy") } },
  { name: "tg_edit_message", description: "Edit a sent message.", inputSchema: { chat_id: chatId, message_id: z.number().describe("Message ID"), text: z.string().describe("New text"), parse_mode: z.enum(["Markdown", "MarkdownV2", "HTML"]).optional() } },
  { name: "tg_delete_message", description: "Delete a message.", inputSchema: { chat_id: chatId, message_id: z.number().describe("Message ID") } },
  { name: "tg_set_reaction", description: "Set reaction emoji on a message.", inputSchema: { chat_id: chatId, message_id: z.number().describe("Message ID"), emoji: z.string().describe("Emoji (e.g. '👍', '❤️')") } },
  { name: "tg_pin_message", description: "Pin a message in chat.", inputSchema: { chat_id: chatId, message_id: z.number().describe("Message ID") } },
  { name: "tg_unpin_message", description: "Unpin a message.", inputSchema: { chat_id: chatId, message_id: z.number().describe("Message ID") } },
  { name: "tg_unpin_all", description: "Unpin all messages in chat.", inputSchema: { chat_id: chatId } },
  // ── 聊天管理 ──
  { name: "tg_get_chat", description: "Get chat info (title, type, member count).", inputSchema: { chat_id: chatId } },
  { name: "tg_get_chat_member", description: "Get info about a member.", inputSchema: { chat_id: chatId, user_id: z.number().describe("User ID") } },
  { name: "tg_get_chat_member_count", description: "Get member count.", inputSchema: { chat_id: chatId } },
  { name: "tg_get_chat_admins", description: "List chat admins.", inputSchema: { chat_id: chatId } },
  { name: "tg_ban_member", description: "Ban a user from chat.", inputSchema: { chat_id: chatId, user_id: z.number().describe("User ID") } },
  { name: "tg_unban_member", description: "Unban a user.", inputSchema: { chat_id: chatId, user_id: z.number().describe("User ID") } },
  { name: "tg_restrict_member", description: "Restrict a user's permissions.", inputSchema: { chat_id: chatId, user_id: z.number().describe("User ID"), permissions: z.record(z.string(), z.boolean()).describe("Permission flags (can_send_messages, can_send_media_messages, etc.)") } },
  { name: "tg_promote_member", description: "Promote user to admin.", inputSchema: { chat_id: chatId, user_id: z.number().describe("User ID"), permissions: z.record(z.string(), z.boolean()).optional().describe("Admin permissions (can_manage_chat, can_delete_messages, etc.)") } },
  { name: "tg_set_chat_title", description: "Set chat title.", inputSchema: { chat_id: chatId, title: z.string().describe("New title") } },
  { name: "tg_set_chat_description", description: "Set chat description.", inputSchema: { chat_id: chatId, description: z.string().describe("New description") } },
  { name: "tg_leave_chat", description: "Bot leaves the chat.", inputSchema: { chat_id: chatId } },
  { name: "tg_get_invite_link", description: "Get chat invite link.", inputSchema: { chat_id: chatId } },
  // ── 論壇主題 ──
  { name: "tg_create_forum_topic", description: "Create a topic in a forum group.", inputSchema: { chat_id: chatId, name: z.string().describe("Topic name"), icon_color: z.number().optional().describe("Icon color") } },
  { name: "tg_edit_forum_topic", description: "Edit a forum topic.", inputSchema: { chat_id: chatId, message_thread_id: z.number().describe("Thread ID"), name: z.string().optional().describe("New name") } },
  { name: "tg_close_forum_topic", description: "Close a forum topic.", inputSchema: { chat_id: chatId, message_thread_id: z.number().describe("Thread ID") } },
  { name: "tg_reopen_forum_topic", description: "Reopen a forum topic.", inputSchema: { chat_id: chatId, message_thread_id: z.number().describe("Thread ID") } },
  // ── Bot 設定 ──
  { name: "tg_get_me", description: "Get bot info (name, username, capabilities).", inputSchema: {} },
  { name: "tg_set_my_commands", description: "Set bot command menu.", inputSchema: { commands: z.array(z.object({ command: z.string(), description: z.string() })).describe("Array of {command, description}") } },
  { name: "tg_get_my_commands", description: "Get bot commands.", inputSchema: {} },
  { name: "tg_delete_my_commands", description: "Delete all bot commands.", inputSchema: {} },
  { name: "tg_set_my_name", description: "Set bot display name.", inputSchema: { name: z.string().describe("New bot name") } },
  { name: "tg_set_my_description", description: "Set bot description.", inputSchema: { description: z.string().describe("New description") } },
  // ── Webhook + Updates ──
  { name: "tg_get_updates", description: "Get recent messages (long polling).", inputSchema: { limit: z.number().optional().describe("Max updates (default 10, max 100)"), offset: z.number().optional().describe("Offset for pagination") } },
  { name: "tg_set_webhook", description: "Set webhook URL.", inputSchema: { url: z.string().describe("HTTPS URL") } },
  { name: "tg_get_webhook", description: "Get webhook info.", inputSchema: {} },
  { name: "tg_delete_webhook", description: "Delete webhook.", inputSchema: {} },
  // ── 內容 ──
  { name: "tg_get_file", description: "Get file download path by file_id.", inputSchema: { file_id: z.string().describe("File ID") } },
  { name: "tg_get_user_photos", description: "Get user profile photos.", inputSchema: { user_id: z.number().describe("User ID") } },
  // ── Callback ──
  { name: "tg_answer_callback", description: "Answer an inline button callback query.", inputSchema: { callback_query_id: z.string().describe("Callback query ID"), text: z.string().optional().describe("Notification text"), show_alert: z.boolean().optional().describe("Show alert popup") } },
];

// ── 工具執行邏輯 ──────────────────────────────────────────
async function execute(
  toolName: string,
  params: Record<string, unknown>,
  token: string,
): Promise<ToolResult> {
  const json = (result: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] });
  const call = (method: string, body?: Record<string, unknown>) => tgFetch(method, token, body);

  switch (toolName) {
    // ── 訊息傳送 ──
    case "tg_send_message": {
      const body: Record<string, unknown> = { chat_id: params.chat_id, text: params.text, parse_mode: params.parse_mode ?? "Markdown" };
      if (params.reply_to) body.reply_parameters = { message_id: params.reply_to };
      if (params.reply_markup) body.reply_markup = params.reply_markup;
      return json(await call("sendMessage", body));
    }
    case "tg_send_photo": { const b: Record<string, unknown> = { chat_id: params.chat_id, photo: params.photo }; if (params.caption) b.caption = params.caption; return json(await call("sendPhoto", b)); }
    case "tg_send_video": { const b: Record<string, unknown> = { chat_id: params.chat_id, video: params.video }; if (params.caption) b.caption = params.caption; return json(await call("sendVideo", b)); }
    case "tg_send_document": { const b: Record<string, unknown> = { chat_id: params.chat_id, document: params.document }; if (params.caption) b.caption = params.caption; return json(await call("sendDocument", b)); }
    case "tg_send_audio": { const b: Record<string, unknown> = { chat_id: params.chat_id, audio: params.audio }; if (params.caption) b.caption = params.caption; return json(await call("sendAudio", b)); }
    case "tg_send_voice": return json(await call("sendVoice", { chat_id: params.chat_id, voice: params.voice }));
    case "tg_send_sticker": return json(await call("sendSticker", { chat_id: params.chat_id, sticker: params.sticker }));
    case "tg_send_location": return json(await call("sendLocation", { chat_id: params.chat_id, latitude: params.latitude, longitude: params.longitude }));
    case "tg_send_contact": { const b: Record<string, unknown> = { chat_id: params.chat_id, phone_number: params.phone_number, first_name: params.first_name }; if (params.last_name) b.last_name = params.last_name; return json(await call("sendContact", b)); }
    case "tg_send_poll": {
      const b: Record<string, unknown> = { chat_id: params.chat_id, question: params.question, options: (params.options as string[]).map(o => ({ text: o })) };
      if (params.is_anonymous !== undefined) b.is_anonymous = params.is_anonymous;
      if (params.type) b.type = params.type;
      if (params.correct_option_id !== undefined) b.correct_option_id = params.correct_option_id;
      return json(await call("sendPoll", b));
    }

    // ── 訊息管理 ──
    case "tg_forward_message": return json(await call("forwardMessage", { chat_id: params.chat_id, from_chat_id: params.from_chat_id, message_id: params.message_id }));
    case "tg_copy_message": return json(await call("copyMessage", { chat_id: params.chat_id, from_chat_id: params.from_chat_id, message_id: params.message_id }));
    case "tg_edit_message": { const b: Record<string, unknown> = { chat_id: params.chat_id, message_id: params.message_id, text: params.text }; if (params.parse_mode) b.parse_mode = params.parse_mode; return json(await call("editMessageText", b)); }
    case "tg_delete_message": return json(await call("deleteMessage", { chat_id: params.chat_id, message_id: params.message_id }));
    case "tg_set_reaction": return json(await call("setMessageReaction", { chat_id: params.chat_id, message_id: params.message_id, reaction: [{ type: "emoji", emoji: params.emoji }] }));
    case "tg_pin_message": return json(await call("pinChatMessage", { chat_id: params.chat_id, message_id: params.message_id }));
    case "tg_unpin_message": return json(await call("unpinChatMessage", { chat_id: params.chat_id, message_id: params.message_id }));
    case "tg_unpin_all": return json(await call("unpinAllChatMessages", { chat_id: params.chat_id }));

    // ── 聊天管理 ──
    case "tg_get_chat": return json(await call("getChat", { chat_id: params.chat_id }));
    case "tg_get_chat_member": return json(await call("getChatMember", { chat_id: params.chat_id, user_id: params.user_id }));
    case "tg_get_chat_member_count": return json(await call("getChatMemberCount", { chat_id: params.chat_id }));
    case "tg_get_chat_admins": return json(await call("getChatAdministrators", { chat_id: params.chat_id }));
    case "tg_ban_member": return json(await call("banChatMember", { chat_id: params.chat_id, user_id: params.user_id }));
    case "tg_unban_member": return json(await call("unbanChatMember", { chat_id: params.chat_id, user_id: params.user_id, only_if_banned: true }));
    case "tg_restrict_member": return json(await call("restrictChatMember", { chat_id: params.chat_id, user_id: params.user_id, permissions: params.permissions }));
    // 當 permissions 未提供時，給予預設管理員權限（避免靜默降權）
    case "tg_promote_member": {
      const defaultPerms = { can_manage_chat: true, can_delete_messages: true, can_manage_video_chats: true, can_restrict_members: true, can_promote_members: false, can_change_info: true, can_invite_users: true, can_pin_messages: true, can_manage_topics: true };
      const perms = params.permissions && typeof params.permissions === "object" && Object.keys(params.permissions as object).length > 0
        ? params.permissions as object
        : defaultPerms;
      const b: Record<string, unknown> = { chat_id: params.chat_id, user_id: params.user_id, ...perms };
      return json(await call("promoteChatMember", b));
    }
    case "tg_set_chat_title": return json(await call("setChatTitle", { chat_id: params.chat_id, title: params.title }));
    case "tg_set_chat_description": return json(await call("setChatDescription", { chat_id: params.chat_id, description: params.description }));
    case "tg_leave_chat": return json(await call("leaveChat", { chat_id: params.chat_id }));
    case "tg_get_invite_link": return json(await call("exportChatInviteLink", { chat_id: params.chat_id }));

    // ── 論壇主題 ──
    case "tg_create_forum_topic": { const b: Record<string, unknown> = { chat_id: params.chat_id, name: params.name }; if (params.icon_color) b.icon_color = params.icon_color; return json(await call("createForumTopic", b)); }
    case "tg_edit_forum_topic": { const b: Record<string, unknown> = { chat_id: params.chat_id, message_thread_id: params.message_thread_id }; if (params.name) b.name = params.name; return json(await call("editForumTopic", b)); }
    case "tg_close_forum_topic": return json(await call("closeForumTopic", { chat_id: params.chat_id, message_thread_id: params.message_thread_id }));
    case "tg_reopen_forum_topic": return json(await call("reopenForumTopic", { chat_id: params.chat_id, message_thread_id: params.message_thread_id }));

    // ── Bot 設定 ──
    case "tg_get_me": return json(await call("getMe"));
    case "tg_set_my_commands": return json(await call("setMyCommands", { commands: params.commands }));
    case "tg_get_my_commands": return json(await call("getMyCommands"));
    case "tg_delete_my_commands": return json(await call("deleteMyCommands"));
    case "tg_set_my_name": return json(await call("setMyName", { name: params.name }));
    case "tg_set_my_description": return json(await call("setMyDescription", { description: params.description }));

    // ── Webhook + Updates ──
    case "tg_get_updates": return json(await call("getUpdates", { limit: Math.min((params.limit as number) ?? 10, 100), offset: params.offset }));
    case "tg_set_webhook": return json(await call("setWebhook", { url: params.url }));
    case "tg_get_webhook": return json(await call("getWebhookInfo"));
    case "tg_delete_webhook": return json(await call("deleteWebhook"));

    // ── 內容 ──
    case "tg_get_file": return json(await call("getFile", { file_id: params.file_id }));
    case "tg_get_user_photos": return json(await call("getUserProfilePhotos", { user_id: params.user_id }));

    // ── Callback ──
    case "tg_answer_callback": { const b: Record<string, unknown> = { callback_query_id: params.callback_query_id }; if (params.text) b.text = params.text; if (params.show_alert) b.show_alert = params.show_alert; return json(await call("answerCallbackQuery", b)); }

    default:
      return { content: [{ type: "text", text: `Unknown tool: ${toolName}` }], isError: true };
  }
}

// ── 智慧錯誤引導 ──────────────────────────────────────────
function formatError(action: string, errorMessage: string): string | null {
  const msg = errorMessage.toLowerCase();
  if (msg.includes("unauthorized") || msg.includes("401"))
    return "「Bot Token 無效 (TG_AUTH_ERROR)」\n請確認 token 是否正確（從 @BotFather 取得）。";
  if (msg.includes("chat not found") || msg.includes("400"))
    return "「找不到 chat (TG_CHAT_NOT_FOUND)」\n請確認 chat_id 且 Bot 已加入該群組/頻道。";
  if (msg.includes("blocked"))
    return "「用戶已封鎖 Bot (TG_USER_BLOCKED)」\n無法發送訊息。";
  if (msg.includes("too many") || msg.includes("429"))
    return "「速率限制 (TG_RATE_LIMITED)」\n同一聊天 1 msg/sec，群發 30 msg/sec。請稍後再試。";
  if (msg.includes("message is not modified"))
    return "「訊息未變更 (TG_NOT_MODIFIED)」\n新內容和舊內容相同。";
  if (msg.includes("message to delete not found"))
    return "「找不到訊息 (TG_MSG_NOT_FOUND)」\n訊息可能已被刪除，或超過 48 小時無法刪除。";
  if (msg.includes("not enough rights"))
    return "「權限不足 (TG_NO_PERMISSION)」\nBot 需要管理員權限才能執行此操作。";
  return null;
}

// ── Adapter 匯出 ──────────────────────────────────────────
export const telegramAdapter: AppAdapter = {
  name: "telegram",
  displayName: { zh: "Telegram", en: "Telegram" },
  icon: "telegram",
  authType: "bot_token",
  authConfig,
  tools,
  actionMap,
  getSkill,
  formatResponse,
  formatError,
  execute,
};
