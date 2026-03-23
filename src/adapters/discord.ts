/**
 * Discord Bot API Adapter
 *
 * 完整覆蓋 Discord Bot API 常用端點（~50 個 action）
 * 認證方式：Bot Token，從 Discord Developer Portal 取得，零審核。
 * 支援訊息、頻道、伺服器、成員管理、角色、討論串、Webhook 等。
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
    zh: "1. 前往 Discord Developer Portal (discord.com/developers)\n2. 建立 Application → 點左側 Bot\n3. 點 Reset Token 產生 Bot Token\n4. 複製 token 貼到下方\n5. 到 OAuth2 → URL Generator，勾選 bot scope + 需要的權限\n6. 用產生的 URL 把 Bot 加入伺服器",
    en: "1. Go to Discord Developer Portal (discord.com/developers)\n2. Create Application → Click Bot in sidebar\n3. Click Reset Token to generate Bot Token\n4. Copy and paste the token below\n5. Go to OAuth2 → URL Generator, select bot scope + permissions\n6. Use the generated URL to add Bot to your server",
  },
  setupWebhook: false,
};

const DISCORD_API = "https://discord.com/api/v10";

// ── Discord API fetch 封裝 ──────────────────────────────
async function discordFetch(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<unknown> {
  const res = await fetch(`${DISCORD_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      ...(options.headers as object),
    },
  });

  // 204 No Content（成功但無回傳，如 delete、add reaction）
  if (res.status === 204) return { _status: 204 };

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(
      JSON.stringify({ status: res.status, message: (error as { message: string }).message }),
    );
  }

  return res.json();
}

// ── actionMap ──────────────────────────────────────────────
const actionMap: Record<string, string> = {
  // 訊息（10）
  send_message: "discord_send_message",
  get_messages: "discord_get_messages",
  get_message: "discord_get_message",
  edit_message: "discord_edit_message",
  delete_message: "discord_delete_message",
  bulk_delete: "discord_bulk_delete",
  add_reaction: "discord_add_reaction",
  pin_message: "discord_pin_message",
  unpin_message: "discord_unpin_message",
  get_pinned: "discord_get_pinned",
  // 頻道（6）
  get_channel: "discord_get_channel",
  edit_channel: "discord_edit_channel",
  delete_channel: "discord_delete_channel",
  create_channel: "discord_create_channel",
  get_invites: "discord_get_invites",
  trigger_typing: "discord_trigger_typing",
  // 討論串（6）
  start_thread: "discord_start_thread",
  start_thread_no_message: "discord_start_thread_no_message",
  join_thread: "discord_join_thread",
  leave_thread: "discord_leave_thread",
  list_thread_members: "discord_list_thread_members",
  list_active_threads: "discord_list_active_threads",
  // 伺服器（5）
  get_guild: "discord_get_guild",
  get_guild_channels: "discord_get_guild_channels",
  get_guild_preview: "discord_get_guild_preview",
  modify_guild: "discord_modify_guild",
  get_audit_log: "discord_get_audit_log",
  // 成員（8）
  get_member: "discord_get_member",
  list_members: "discord_list_members",
  search_members: "discord_search_members",
  modify_member: "discord_modify_member",
  add_role: "discord_add_role",
  remove_role: "discord_remove_role",
  kick_member: "discord_kick_member",
  ban_member: "discord_ban_member",
  unban_member: "discord_unban_member",
  get_bans: "discord_get_bans",
  // 角色（4）
  get_roles: "discord_get_roles",
  create_role: "discord_create_role",
  modify_role: "discord_modify_role",
  delete_role: "discord_delete_role",
  // Webhook（4）
  create_webhook: "discord_create_webhook",
  get_webhooks: "discord_get_webhooks",
  execute_webhook: "discord_execute_webhook",
  delete_webhook: "discord_delete_webhook",
  // Webhook 修改（1）
  modify_webhook: "discord_modify_webhook",
  // 討論串修改（1）
  edit_thread: "discord_edit_thread",
  // 其他（3）
  get_user: "discord_get_user",
  create_dm: "discord_create_dm",
  get_bot_info: "discord_get_bot_info",
};

// ── getSkill ──────────────────────────────────────────────
const ACTION_SKILLS: Record<string, string> = {
  send_message: `## discord.send_message
Send a message to a Discord channel.
### Parameters
  channel_id: Channel ID
  content: Message text (supports Markdown)
  embeds (optional): Array of embed objects for rich content
### Example
octodock_do(app:"discord", action:"send_message", params:{channel_id:"123456789", content:"Hello **world**!"})`,

  start_thread: `## discord.start_thread
Start a thread from an existing message.
### Parameters
  channel_id: Channel ID
  message_id: Message ID to start thread from
  name: Thread name
  auto_archive_duration (optional): Minutes before auto-archive (60, 1440, 4320, 10080)
### Example
octodock_do(app:"discord", action:"start_thread", params:{channel_id:"123", message_id:"456", name:"Discussion"})`,

  create_channel: `## discord.create_channel
Create a new channel in a server.
### Parameters
  guild_id: Server ID
  name: Channel name
  type (optional): 0=text, 2=voice, 4=category, 5=announcement, 13=stage, 15=forum
  parent_id (optional): Category ID
  topic (optional): Channel topic
### Example
octodock_do(app:"discord", action:"create_channel", params:{guild_id:"123", name:"general", type:0})`,

  get_messages: `## discord.get_messages
Get recent messages from a channel.
### Parameters
  channel_id: Channel ID
  limit (optional): Number of messages (1-100, default 50)
### Example
octodock_do(app:"discord", action:"get_messages", params:{channel_id:"123456789", limit:20})`,

  edit_message: `## discord.edit_message
Edit a message sent by the bot.
### Parameters
  channel_id: Channel ID
  message_id: Message ID
  content (optional): New text
  embeds (optional): New embed objects
### Example
octodock_do(app:"discord", action:"edit_message", params:{channel_id:"123", message_id:"456", content:"Updated!"})`,

  bulk_delete: `## discord.bulk_delete
Bulk delete messages (must be <14 days old).
### Parameters
  channel_id: Channel ID
  message_ids: Array of message IDs (2-100)
### Example
octodock_do(app:"discord", action:"bulk_delete", params:{channel_id:"123", message_ids:["456","789"]})`,

  get_member: `## discord.get_member
Get info about a server member.
### Parameters
  guild_id: Server ID
  user_id: User ID
### Example
octodock_do(app:"discord", action:"get_member", params:{guild_id:"123", user_id:"456"})`,

  create_role: `## discord.create_role
Create a new role in a server.
### Parameters
  guild_id: Server ID
  name: Role name
  color (optional): Color as integer (e.g. 0xFF0000 for red)
  permissions (optional): Permission bitfield string
  mentionable (optional): Whether role can be mentioned
### Example
octodock_do(app:"discord", action:"create_role", params:{guild_id:"123", name:"Moderator", color:3447003, mentionable:true})`,

  modify_member: `## discord.modify_member
Edit a server member's nickname, mute, or deafen status.
### Parameters
  guild_id: Server ID
  user_id: User ID
  nick (optional): Nickname
  mute (optional): Server mute
  deaf (optional): Server deafen
### Example
octodock_do(app:"discord", action:"modify_member", params:{guild_id:"123", user_id:"456", nick:"New Name"})`,

  execute_webhook: `## discord.execute_webhook
Send a message through a webhook (no bot required).
### Parameters
  webhook_id: Webhook ID
  webhook_token: Webhook token
  content: Message text
  username (optional): Override webhook username
  embeds (optional): Array of embed objects
### Example
octodock_do(app:"discord", action:"execute_webhook", params:{webhook_id:"123", webhook_token:"abc", content:"Automated alert!"})`,
};

function getSkill(action?: string): string | null {
  if (action && ACTION_SKILLS[action]) return ACTION_SKILLS[action];
  if (action) return null; // ACTION_SKILLS 沒有的 action → 回傳 null 讓 server.ts fallback 用 actionMap 自動查
  return `discord actions (${Object.keys(actionMap).length}):
## Messages
  send_message(channel_id, content, embeds?) — send message (Markdown)
  get_messages(channel_id, limit?) — get recent messages
  get_message(channel_id, message_id) — get single message
  edit_message(channel_id, message_id, content) — edit message
  delete_message(channel_id, message_id) — delete message
  bulk_delete(channel_id, message_ids) — bulk delete (2-100 messages, <14 days)
  add_reaction(channel_id, message_id, emoji) — add reaction
  pin_message(channel_id, message_id) — pin message
  unpin_message(channel_id, message_id) — unpin message
  get_pinned(channel_id) — get pinned messages
## Channels
  get_channel(channel_id) — channel info
  edit_channel(channel_id, name?, topic?) — edit channel
  delete_channel(channel_id) — delete channel
  create_channel(guild_id, name, type?) — create channel
  get_invites(channel_id) — list invites
  trigger_typing(channel_id) — show typing indicator
## Threads
  start_thread(channel_id, message_id, name) — thread from message
  start_thread_no_message(channel_id, name, type?) — standalone thread
  edit_thread(channel_id, name?, archived?, auto_archive_duration?) — edit thread
  join_thread(channel_id) — join thread
  leave_thread(channel_id) — leave thread
  list_thread_members(channel_id) — list members
  list_active_threads(guild_id) — list active threads
## Server
  get_guild(guild_id) — server info
  get_guild_channels(guild_id) — list channels
  get_guild_preview(guild_id) — server preview
  modify_guild(guild_id, name?, description?) — edit server
  get_audit_log(guild_id) — audit log
## Members
  get_member(guild_id, user_id) — member info
  list_members(guild_id, limit?) — list members
  search_members(guild_id, query) — search by name
  modify_member(guild_id, user_id, nick?) — edit member
  add_role(guild_id, user_id, role_id) — add role
  remove_role(guild_id, user_id, role_id) — remove role
  kick_member(guild_id, user_id) — kick
  ban_member(guild_id, user_id) — ban
  unban_member(guild_id, user_id) — unban
  get_bans(guild_id) — list bans
## Roles
  get_roles(guild_id) — list roles
  create_role(guild_id, name, color?, permissions?) — create role
  modify_role(guild_id, role_id, name?, color?) — edit role
  delete_role(guild_id, role_id) — delete role
## Webhooks
  create_webhook(channel_id, name) — create webhook
  get_webhooks(channel_id) — list webhooks
  execute_webhook(webhook_id, webhook_token, content) — send via webhook
  modify_webhook(webhook_id, name?, channel_id?) — edit webhook
  delete_webhook(webhook_id) — delete webhook
## Other
  get_user(user_id) — user info
  create_dm(user_id) — open DM channel
  get_bot_info() — bot user info
Use octodock_help(app:"discord", action:"ACTION") for details.`;
}

// ── formatResponse ──────────────────────────────────────
/* eslint-disable @typescript-eslint/no-explicit-any */
function formatResponse(action: string, rawData: unknown): string {
  if (typeof rawData !== "object" || rawData === null) return String(rawData);
  const data = rawData as Record<string, unknown>;

  switch (action) {
    // 訊息
    case "send_message":
    case "edit_message":
      return `Done. Message ID: ${data.id}\nChannel: ${data.channel_id}`;

    case "get_message": {
      const author = data.author as Record<string, unknown> | undefined;
      return [`**${author?.username ?? "?"}**: ${data.content}`, data.embeds && (data.embeds as any[]).length > 0 ? `(${(data.embeds as any[]).length} embed(s))` : null, `ID: ${data.id} | ${data.timestamp}`].filter(Boolean).join("\n");
    }

    case "get_messages": {
      if (!Array.isArray(rawData) || rawData.length === 0) return "No messages.";
      return rawData.map((m: any) => `[${m.author?.username ?? "?"}] ${m.content || "(embed/attachment)"}${m.id ? ` (${m.id})` : ""}`).join("\n");
    }

    case "get_pinned": {
      if (!Array.isArray(rawData) || rawData.length === 0) return "No pinned messages.";
      return rawData.map((m: any) => `- [${m.author?.username ?? "?"}] ${m.content?.substring(0, 80) || "(embed)"} (${m.id})`).join("\n");
    }

    // 頻道
    case "get_channel":
      return [`**#${data.name}**`, `Type: ${channelType(data.type as number)}`, data.topic ? `Topic: ${data.topic}` : null, `ID: ${data.id}`, data.parent_id ? `Category: ${data.parent_id}` : null].filter(Boolean).join("\n");

    case "create_channel":
      return `Done. Channel **#${data.name}** created. ID: ${data.id}`;

    // 討論串
    case "start_thread":
    case "start_thread_no_message":
      return `Done. Thread **${data.name}** created. ID: ${data.id}`;

    case "list_thread_members": {
      if (!Array.isArray(rawData) || rawData.length === 0) return "No thread members.";
      return `${rawData.length} member(s):\n${rawData.map((m: any) => `- User: ${m.user_id}`).join("\n")}`;
    }

    case "list_active_threads": {
      const threads = data.threads as any[] | undefined;
      if (!threads || threads.length === 0) return "No active threads.";
      return threads.map((t: any) => `- **${t.name}** (${t.id}) ${t.message_count ?? 0} messages`).join("\n");
    }

    // 伺服器
    case "get_guild":
    case "get_guild_preview":
      return [`**${data.name}**`, data.description ? `> ${data.description}` : null, `Members: ${data.approximate_member_count ?? data.member_count ?? "?"}`, `ID: ${data.id}`, data.icon ? `Icon: https://cdn.discordapp.com/icons/${data.id}/${data.icon}.png` : null].filter(Boolean).join("\n");

    case "get_guild_channels": {
      if (!Array.isArray(rawData) || rawData.length === 0) return "No channels.";
      return rawData.map((c: any) => `- ${channelType(c.type)} **#${c.name}** (${c.id})${c.topic ? ` — ${c.topic}` : ""}`).join("\n");
    }

    case "get_audit_log": {
      const entries = data.audit_log_entries as any[] | undefined;
      if (!entries || entries.length === 0) return "No audit log entries.";
      return entries.slice(0, 20).map((e: any) => `- [${e.action_type}] by ${e.user_id} target:${e.target_id ?? "N/A"}`).join("\n");
    }

    // 成員
    case "get_member": {
      const user = data.user as Record<string, unknown> | undefined;
      const roles = data.roles as string[] | undefined;
      return [`**${user?.username ?? "?"}**${data.nick ? ` (${data.nick})` : ""}`, `Joined: ${data.joined_at}`, roles && roles.length > 0 ? `Roles: ${roles.length}` : "No roles"].filter(Boolean).join("\n");
    }

    case "list_members": {
      if (!Array.isArray(rawData) || rawData.length === 0) return "No members.";
      return rawData.map((m: any) => `- **${m.user?.username ?? "?"}**${m.nick ? ` (${m.nick})` : ""}`).join("\n");
    }

    case "search_members": {
      if (!Array.isArray(rawData) || rawData.length === 0) return "No members found.";
      return rawData.map((m: any) => `- **${m.user?.username ?? "?"}** (${m.user?.id})`).join("\n");
    }

    // 角色
    case "get_roles": {
      if (!Array.isArray(rawData) || rawData.length === 0) return "No roles.";
      return rawData.map((r: any) => `- **${r.name}** (${r.id}) color:#${r.color?.toString(16).padStart(6, "0") ?? "000000"} ${r.mentionable ? "📢" : ""}`).join("\n");
    }

    case "create_role":
    case "modify_role":
      return `Done. Role **${data.name}** (${data.id})`;

    // Webhook
    // 注意：不回傳 webhook token，避免敏感資訊洩漏到對話紀錄
    case "create_webhook":
      return `Done. Webhook **${data.name}** created.\nID: ${data.id}`;

    case "get_webhooks": {
      if (!Array.isArray(rawData) || rawData.length === 0) return "No webhooks.";
      return rawData.map((w: any) => `- **${w.name}** (${w.id}) channel:${w.channel_id}`).join("\n");
    }

    // 用戶
    case "get_user":
    case "get_bot_info":
      return [`**${data.username}**${data.discriminator && data.discriminator !== "0" ? `#${data.discriminator}` : ""}`, `ID: ${data.id}`, data.bot ? "🤖 Bot" : "👤 User", data.avatar ? `Avatar: https://cdn.discordapp.com/avatars/${data.id}/${data.avatar}.png` : null].filter(Boolean).join("\n");

    case "create_dm":
      return `Done. DM channel ID: ${data.id}`;

    case "get_bans": {
      if (!Array.isArray(rawData) || rawData.length === 0) return "No bans.";
      return rawData.map((b: any) => `- **${b.user?.username ?? "?"}** (${b.user?.id}) ${b.reason ? `— ${b.reason}` : ""}`).join("\n");
    }

    case "get_invites": {
      if (!Array.isArray(rawData) || rawData.length === 0) return "No invites.";
      return rawData.map((i: any) => `- discord.gg/${i.code} by ${i.inviter?.username ?? "?"} (uses: ${i.uses ?? 0})`).join("\n");
    }

    // 操作類
    case "delete_message":
    case "bulk_delete":
    case "add_reaction":
    case "pin_message":
    case "unpin_message":
    case "delete_channel":
    case "trigger_typing":
    case "join_thread":
    case "leave_thread":
    case "modify_member":
    case "add_role":
    case "remove_role":
    case "kick_member":
    case "ban_member":
    case "unban_member":
    case "delete_role":
    case "execute_webhook":
    case "modify_webhook":
    case "delete_webhook":
    case "edit_thread":
    case "edit_channel":
    case "modify_guild":
      return "Done.";

    // 未列舉的 action 回傳簡潔的 key-value 格式，避免 raw JSON
    default: {
      const entries = Object.entries(data).filter(([, v]) => v !== null && v !== undefined);
      if (entries.length === 0) return "Done.";
      return entries.slice(0, 10).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join("\n");
    }
  }
}

/** 頻道類型對應表 */
function channelType(type: number): string {
  const types: Record<number, string> = { 0: "💬text", 2: "🔊voice", 4: "📁category", 5: "📢announcement", 10: "📰news-thread", 11: "🧵public-thread", 12: "🔒private-thread", 13: "🎤stage", 15: "📋forum" };
  return types[type] ?? `type:${type}`;
}

// ── 工具定義 ──────────────────────────────────────────────
const snowflake = z.string().describe("Discord snowflake ID");

const tools: ToolDefinition[] = [
  // ── 訊息 ──
  { name: "discord_send_message", description: "Send a message to a channel. Supports Markdown and embeds.", inputSchema: { channel_id: snowflake, content: z.string().optional().describe("Message text"), embeds: z.array(z.record(z.string(), z.unknown())).optional().describe("Array of embed objects") } },
  { name: "discord_get_messages", description: "Get recent messages from a channel.", inputSchema: { channel_id: snowflake, limit: z.number().optional().describe("Number of messages (1-100, default 50)") } },
  { name: "discord_get_message", description: "Get a single message.", inputSchema: { channel_id: snowflake, message_id: snowflake } },
  { name: "discord_edit_message", description: "Edit a message sent by the bot.", inputSchema: { channel_id: snowflake, message_id: snowflake, content: z.string().optional().describe("New text"), embeds: z.array(z.record(z.string(), z.unknown())).optional().describe("New embeds") } },
  { name: "discord_delete_message", description: "Delete a message.", inputSchema: { channel_id: snowflake, message_id: snowflake } },
  { name: "discord_bulk_delete", description: "Bulk delete messages (2-100, must be <14 days old).", inputSchema: { channel_id: snowflake, message_ids: z.array(z.string()).describe("Array of message IDs") } },
  { name: "discord_add_reaction", description: "Add a reaction emoji to a message.", inputSchema: { channel_id: snowflake, message_id: snowflake, emoji: z.string().describe("Emoji (e.g. '👍' or 'custom:123')") } },
  { name: "discord_pin_message", description: "Pin a message.", inputSchema: { channel_id: snowflake, message_id: snowflake } },
  { name: "discord_unpin_message", description: "Unpin a message.", inputSchema: { channel_id: snowflake, message_id: snowflake } },
  { name: "discord_get_pinned", description: "Get pinned messages.", inputSchema: { channel_id: snowflake } },
  // ── 頻道 ──
  { name: "discord_get_channel", description: "Get channel info.", inputSchema: { channel_id: snowflake } },
  { name: "discord_edit_channel", description: "Edit channel settings.", inputSchema: { channel_id: snowflake, name: z.string().optional().describe("New name"), topic: z.string().optional().describe("New topic"), nsfw: z.boolean().optional() } },
  { name: "discord_delete_channel", description: "Delete a channel.", inputSchema: { channel_id: snowflake } },
  { name: "discord_create_channel", description: "Create a channel in a server.", inputSchema: { guild_id: snowflake, name: z.string().describe("Channel name"), type: z.number().optional().describe("0=text, 2=voice, 4=category, 5=announcement, 15=forum"), parent_id: z.string().optional().describe("Category ID"), topic: z.string().optional() } },
  { name: "discord_get_invites", description: "List channel invites.", inputSchema: { channel_id: snowflake } },
  { name: "discord_trigger_typing", description: "Show typing indicator.", inputSchema: { channel_id: snowflake } },
  // ── 討論串 ──
  { name: "discord_start_thread", description: "Start thread from a message.", inputSchema: { channel_id: snowflake, message_id: snowflake, name: z.string().describe("Thread name"), auto_archive_duration: z.number().optional().describe("Minutes: 60, 1440, 4320, 10080") } },
  { name: "discord_start_thread_no_message", description: "Start a standalone thread.", inputSchema: { channel_id: snowflake, name: z.string().describe("Thread name"), type: z.number().optional().describe("11=public, 12=private"), auto_archive_duration: z.number().optional() } },
  { name: "discord_join_thread", description: "Bot joins a thread.", inputSchema: { channel_id: snowflake } },
  { name: "discord_leave_thread", description: "Bot leaves a thread.", inputSchema: { channel_id: snowflake } },
  { name: "discord_list_thread_members", description: "List thread members.", inputSchema: { channel_id: snowflake } },
  { name: "discord_list_active_threads", description: "List active threads in a server.", inputSchema: { guild_id: snowflake } },
  // ── 伺服器 ──
  { name: "discord_get_guild", description: "Get server info.", inputSchema: { guild_id: snowflake } },
  { name: "discord_get_guild_channels", description: "List all channels.", inputSchema: { guild_id: snowflake } },
  { name: "discord_get_guild_preview", description: "Get server preview.", inputSchema: { guild_id: snowflake } },
  { name: "discord_modify_guild", description: "Edit server settings.", inputSchema: { guild_id: snowflake, name: z.string().optional(), description: z.string().optional() } },
  { name: "discord_get_audit_log", description: "Get server audit log.", inputSchema: { guild_id: snowflake, limit: z.number().optional().describe("Entries (1-100, default 50)") } },
  // ── 成員 ──
  { name: "discord_get_member", description: "Get member info.", inputSchema: { guild_id: snowflake, user_id: snowflake } },
  { name: "discord_list_members", description: "List server members.", inputSchema: { guild_id: snowflake, limit: z.number().optional().describe("Max members (1-1000, default 100)") } },
  { name: "discord_search_members", description: "Search members by name.", inputSchema: { guild_id: snowflake, query: z.string().describe("Search query"), limit: z.number().optional().describe("Max results (1-1000)") } },
  { name: "discord_modify_member", description: "Edit member (nick, roles, mute, deaf).", inputSchema: { guild_id: snowflake, user_id: snowflake, nick: z.string().optional().describe("Nickname"), mute: z.boolean().optional(), deaf: z.boolean().optional() } },
  { name: "discord_add_role", description: "Add role to member.", inputSchema: { guild_id: snowflake, user_id: snowflake, role_id: snowflake } },
  { name: "discord_remove_role", description: "Remove role from member.", inputSchema: { guild_id: snowflake, user_id: snowflake, role_id: snowflake } },
  { name: "discord_kick_member", description: "Kick member from server.", inputSchema: { guild_id: snowflake, user_id: snowflake } },
  { name: "discord_ban_member", description: "Ban member.", inputSchema: { guild_id: snowflake, user_id: snowflake, delete_message_seconds: z.number().optional().describe("Delete recent messages (seconds, max 604800)") } },
  { name: "discord_unban_member", description: "Unban member.", inputSchema: { guild_id: snowflake, user_id: snowflake } },
  { name: "discord_get_bans", description: "List banned users.", inputSchema: { guild_id: snowflake } },
  // ── 角色 ──
  { name: "discord_get_roles", description: "List server roles.", inputSchema: { guild_id: snowflake } },
  { name: "discord_create_role", description: "Create a role.", inputSchema: { guild_id: snowflake, name: z.string().describe("Role name"), color: z.number().optional().describe("Color (integer)"), permissions: z.string().optional().describe("Permission bitfield"), mentionable: z.boolean().optional() } },
  { name: "discord_modify_role", description: "Edit a role.", inputSchema: { guild_id: snowflake, role_id: snowflake, name: z.string().optional(), color: z.number().optional(), permissions: z.string().optional() } },
  { name: "discord_delete_role", description: "Delete a role.", inputSchema: { guild_id: snowflake, role_id: snowflake } },
  // ── Webhook ──
  { name: "discord_create_webhook", description: "Create a webhook for a channel.", inputSchema: { channel_id: snowflake, name: z.string().describe("Webhook name") } },
  { name: "discord_get_webhooks", description: "List channel webhooks.", inputSchema: { channel_id: snowflake } },
  { name: "discord_execute_webhook", description: "Send message via webhook.", inputSchema: { webhook_id: snowflake, webhook_token: z.string().describe("Webhook token"), content: z.string().optional().describe("Message text"), username: z.string().optional().describe("Override username"), embeds: z.array(z.record(z.string(), z.unknown())).optional() } },
  { name: "discord_modify_webhook", description: "Edit a webhook (name, channel).", inputSchema: { webhook_id: snowflake, name: z.string().optional().describe("New name"), channel_id: z.string().optional().describe("Move to channel") } },
  { name: "discord_delete_webhook", description: "Delete a webhook.", inputSchema: { webhook_id: snowflake } },
  // ── 討論串修改 ──
  { name: "discord_edit_thread", description: "Edit thread settings.", inputSchema: { channel_id: snowflake, name: z.string().optional().describe("New name"), archived: z.boolean().optional().describe("Archive/unarchive"), auto_archive_duration: z.number().optional().describe("Minutes: 60, 1440, 4320, 10080") } },
  // ── 其他 ──
  { name: "discord_get_user", description: "Get user info.", inputSchema: { user_id: snowflake } },
  { name: "discord_create_dm", description: "Open a DM channel with a user.", inputSchema: { user_id: snowflake } },
  { name: "discord_get_bot_info", description: "Get bot's own user info.", inputSchema: {} },
];

// ── 工具執行邏輯 ──────────────────────────────────────────
async function execute(
  toolName: string,
  params: Record<string, unknown>,
  token: string,
): Promise<ToolResult> {
  const json = (result: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] });
  const get = (path: string) => discordFetch(path, token);
  const post = (path: string, body?: unknown) => discordFetch(path, token, { method: "POST", body: body ? JSON.stringify(body) : undefined });
  const patch = (path: string, body: unknown) => discordFetch(path, token, { method: "PATCH", body: JSON.stringify(body) });
  const del = (path: string) => discordFetch(path, token, { method: "DELETE" });
  const put = (path: string, body?: unknown) => discordFetch(path, token, { method: "PUT", body: body ? JSON.stringify(body) : undefined });

  switch (toolName) {
    // ── 訊息 ──
    case "discord_send_message": { const b: Record<string, unknown> = {}; if (params.content) b.content = params.content; if (params.embeds) b.embeds = params.embeds; return json(await post(`/channels/${params.channel_id}/messages`, b)); }
    // F1: 支援 before/after 分頁
    case "discord_get_messages": {
      let url = `/channels/${params.channel_id}/messages?limit=${params.limit ?? 50}`;
      if (params.before) url += `&before=${params.before}`;
      if (params.after) url += `&after=${params.after}`;
      return json(await get(url));
    }
    case "discord_get_message": return json(await get(`/channels/${params.channel_id}/messages/${params.message_id}`));
    case "discord_edit_message": { const b: Record<string, unknown> = {}; if (params.content !== undefined) b.content = params.content; if (params.embeds) b.embeds = params.embeds; return json(await patch(`/channels/${params.channel_id}/messages/${params.message_id}`, b)); }
    case "discord_delete_message": return json(await del(`/channels/${params.channel_id}/messages/${params.message_id}`));
    case "discord_bulk_delete": return json(await post(`/channels/${params.channel_id}/messages/bulk-delete`, { messages: params.message_ids }));
    case "discord_add_reaction": return json(await put(`/channels/${params.channel_id}/messages/${params.message_id}/reactions/${encodeURIComponent(params.emoji as string)}/@me`));
    case "discord_pin_message": return json(await put(`/channels/${params.channel_id}/pins/${params.message_id}`));
    case "discord_unpin_message": return json(await del(`/channels/${params.channel_id}/pins/${params.message_id}`));
    case "discord_get_pinned": return json(await get(`/channels/${params.channel_id}/pins`));

    // ── 頻道 ──
    case "discord_get_channel": return json(await get(`/channels/${params.channel_id}`));
    case "discord_edit_channel": { const b: Record<string, unknown> = {}; if (params.name) b.name = params.name; if (params.topic !== undefined) b.topic = params.topic; if (params.nsfw !== undefined) b.nsfw = params.nsfw; return json(await patch(`/channels/${params.channel_id}`, b)); }
    case "discord_delete_channel": return json(await del(`/channels/${params.channel_id}`));
    case "discord_create_channel": { const b: Record<string, unknown> = { name: params.name }; if (params.type !== undefined) b.type = params.type; if (params.parent_id) b.parent_id = params.parent_id; if (params.topic) b.topic = params.topic; return json(await post(`/guilds/${params.guild_id}/channels`, b)); }
    case "discord_get_invites": return json(await get(`/channels/${params.channel_id}/invites`));
    case "discord_trigger_typing": return json(await post(`/channels/${params.channel_id}/typing`));

    // ── 討論串 ──
    case "discord_start_thread": { const b: Record<string, unknown> = { name: params.name }; if (params.auto_archive_duration) b.auto_archive_duration = params.auto_archive_duration; return json(await post(`/channels/${params.channel_id}/messages/${params.message_id}/threads`, b)); }
    case "discord_start_thread_no_message": { const b: Record<string, unknown> = { name: params.name, type: params.type ?? 11 }; if (params.auto_archive_duration) b.auto_archive_duration = params.auto_archive_duration; return json(await post(`/channels/${params.channel_id}/threads`, b)); }
    case "discord_join_thread": return json(await put(`/channels/${params.channel_id}/thread-members/@me`));
    case "discord_leave_thread": return json(await del(`/channels/${params.channel_id}/thread-members/@me`));
    case "discord_list_thread_members": return json(await get(`/channels/${params.channel_id}/thread-members`));
    case "discord_list_active_threads": return json(await get(`/guilds/${params.guild_id}/threads/active`));

    // ── 伺服器 ──
    case "discord_get_guild": return json(await get(`/guilds/${params.guild_id}?with_counts=true`));
    case "discord_get_guild_channels": return json(await get(`/guilds/${params.guild_id}/channels`));
    case "discord_get_guild_preview": return json(await get(`/guilds/${params.guild_id}/preview`));
    case "discord_modify_guild": { const b: Record<string, unknown> = {}; if (params.name) b.name = params.name; if (params.description !== undefined) b.description = params.description; return json(await patch(`/guilds/${params.guild_id}`, b)); }
    case "discord_get_audit_log": return json(await get(`/guilds/${params.guild_id}/audit-logs?limit=${params.limit ?? 50}`));

    // ── 成員 ──
    case "discord_get_member": return json(await get(`/guilds/${params.guild_id}/members/${params.user_id}`));
    // F1: 支援 after 分頁（Discord 用 user ID 做 cursor）
    case "discord_list_members": {
      let url = `/guilds/${params.guild_id}/members?limit=${params.limit ?? 100}`;
      if (params.after) url += `&after=${params.after}`;
      return json(await get(url));
    }
    case "discord_search_members": return json(await get(`/guilds/${params.guild_id}/members/search?query=${encodeURIComponent(params.query as string)}&limit=${params.limit ?? 100}`));
    case "discord_modify_member": { const b: Record<string, unknown> = {}; if (params.nick !== undefined) b.nick = params.nick; if (params.mute !== undefined) b.mute = params.mute; if (params.deaf !== undefined) b.deaf = params.deaf; return json(await patch(`/guilds/${params.guild_id}/members/${params.user_id}`, b)); }
    case "discord_add_role": return json(await put(`/guilds/${params.guild_id}/members/${params.user_id}/roles/${params.role_id}`));
    case "discord_remove_role": return json(await del(`/guilds/${params.guild_id}/members/${params.user_id}/roles/${params.role_id}`));
    case "discord_kick_member": return json(await del(`/guilds/${params.guild_id}/members/${params.user_id}`));
    case "discord_ban_member": { const b: Record<string, unknown> = {}; if (params.delete_message_seconds) b.delete_message_seconds = params.delete_message_seconds; return json(await put(`/guilds/${params.guild_id}/bans/${params.user_id}`, b)); }
    case "discord_unban_member": return json(await del(`/guilds/${params.guild_id}/bans/${params.user_id}`));
    case "discord_get_bans": return json(await get(`/guilds/${params.guild_id}/bans`));

    // ── 角色 ──
    case "discord_get_roles": return json(await get(`/guilds/${params.guild_id}/roles`));
    case "discord_create_role": { const b: Record<string, unknown> = { name: params.name }; if (params.color) b.color = params.color; if (params.permissions) b.permissions = params.permissions; if (params.mentionable !== undefined) b.mentionable = params.mentionable; return json(await post(`/guilds/${params.guild_id}/roles`, b)); }
    case "discord_modify_role": { const b: Record<string, unknown> = {}; if (params.name) b.name = params.name; if (params.color !== undefined) b.color = params.color; if (params.permissions) b.permissions = params.permissions; return json(await patch(`/guilds/${params.guild_id}/roles/${params.role_id}`, b)); }
    case "discord_delete_role": return json(await del(`/guilds/${params.guild_id}/roles/${params.role_id}`));

    // ── Webhook ──
    case "discord_create_webhook": return json(await post(`/channels/${params.channel_id}/webhooks`, { name: params.name }));
    case "discord_get_webhooks": return json(await get(`/channels/${params.channel_id}/webhooks`));
    case "discord_execute_webhook": {
      const b: Record<string, unknown> = {};
      if (params.content) b.content = params.content;
      if (params.username) b.username = params.username;
      if (params.embeds) b.embeds = params.embeds;
      // Webhook 執行不需要 Bot token，用 webhook token
      const res = await fetch(`${DISCORD_API}/webhooks/${params.webhook_id}/${params.webhook_token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(b),
      });
      if (!res.ok) { const err = await res.json().catch(() => ({ message: res.statusText })); throw new Error(JSON.stringify({ status: res.status, message: (err as any).message })); }
      if (res.status === 204) return json({ _status: 204 });
      return json(await res.json());
    }
    case "discord_modify_webhook": { const b: Record<string, unknown> = {}; if (params.name) b.name = params.name; if (params.channel_id) b.channel_id = params.channel_id; return json(await patch(`/webhooks/${params.webhook_id}`, b)); }
    case "discord_delete_webhook": return json(await del(`/webhooks/${params.webhook_id}`));

    // ── 討論串修改 ──
    case "discord_edit_thread": { const b: Record<string, unknown> = {}; if (params.name) b.name = params.name; if (params.archived !== undefined) b.archived = params.archived; if (params.auto_archive_duration) b.auto_archive_duration = params.auto_archive_duration; return json(await patch(`/channels/${params.channel_id}`, b)); }

    // ── 其他 ──
    case "discord_get_user": return json(await get(`/users/${params.user_id}`));
    case "discord_create_dm": return json(await post("/users/@me/channels", { recipient_id: params.user_id }));
    case "discord_get_bot_info": return json(await get("/users/@me"));

    default:
      return { content: [{ type: "text", text: `Unknown tool: ${toolName}` }], isError: true };
  }
}

// ── 智慧錯誤引導 ──────────────────────────────────────────
function formatError(action: string, errorMessage: string): string | null {
  const msg = errorMessage.toLowerCase();
  if (msg.includes("401") || msg.includes("unauthorized"))
    return "「Bot Token 無效 (DISCORD_AUTH_ERROR)」\n請確認 token 是否正確（從 Discord Developer Portal 取得）。";
  if (msg.includes("403") || msg.includes("missing permissions") || msg.includes("missing access"))
    return "「權限不足 (DISCORD_FORBIDDEN)」\nBot 缺少所需權限。請到伺服器設定確認 Bot 角色有足夠權限。";
  if (msg.includes("404") || msg.includes("unknown"))
    return "「找不到資源 (DISCORD_NOT_FOUND)」\n請確認 channel_id / guild_id / user_id 是否正確。";
  if (msg.includes("429") || msg.includes("rate"))
    return "「速率限制 (DISCORD_RATE_LIMITED)」\n全域上限 50 req/sec。請稍後再試。";
  if (msg.includes("50035") || msg.includes("invalid form"))
    return "「參數格式錯誤 (DISCORD_VALIDATION)」\n請用 octodock_help 確認參數格式。";
  if (msg.includes("bulk delete"))
    return "「批量刪除限制 (DISCORD_BULK_DELETE)」\n只能刪除 14 天內的訊息，數量 2-100。";
  return null;
}

// ── Adapter 匯出 ──────────────────────────────────────────
export const discordAdapter: AppAdapter = {
  name: "discord",
  displayName: { zh: "Discord", en: "Discord" },
  icon: "discord",
  authType: "bot_token",
  authConfig,
  tools,
  actionMap,
  getSkill,
  formatResponse,
  formatError,
  execute,
};
