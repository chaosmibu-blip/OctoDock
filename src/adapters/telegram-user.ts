/**
 * Telegram Client API (MTProto) Adapter
 *
 * 透過 GramJS 讓用戶以自己的 Telegram 帳號操作。
 * 跟 telegram.ts（Bot API）不同，這裡用的是用戶帳號登入，
 * 能做到 Bot 做不到的事：讀完整聊天記錄、搜尋訊息、加入頻道等。
 *
 * 認證方式：手機號碼 + 驗證碼 + 可選 2FA → 產生 StringSession 存入 DB
 * 每次 execute() 用 StringSession 建 TelegramClient → 連線 → 執行 → 斷線
 */
import { z } from "zod";
import bigInt from "big-integer";
import type {
  AppAdapter,
  PhoneAuthConfig,
  ToolDefinition,
  ToolResult,
} from "./types";

// ── 認證設定 ─────────────────────────────────────────────
const authConfig: PhoneAuthConfig = {
  type: "phone_auth",
  instructions: {
    zh: "1. 輸入你的 Telegram 手機號碼（含國碼，如 +886912345678）\n2. Telegram 會發送驗證碼到你的 App\n3. 輸入驗證碼完成連接\n4. 如果有兩步驗證，再輸入密碼",
    en: "1. Enter your Telegram phone number (with country code, e.g. +886912345678)\n2. Telegram will send a code to your app\n3. Enter the code to connect\n4. If you have 2FA enabled, enter your password",
  },
};

// ── GramJS 動態載入（避免 top-level import 影響不用此 adapter 的環境） ──
async function getGramJS() {
  const { TelegramClient } = await import("telegram");
  const { StringSession } = await import("telegram/sessions");
  const { Api } = await import("telegram");
  return { TelegramClient, StringSession, Api };
}

/** 從環境變數取得 API 憑證 */
function getTgCredentials(): { apiId: number; apiHash: string } {
  const apiId = parseInt(process.env.TG_API_ID || "", 10);
  const apiHash = process.env.TG_API_HASH || "";
  if (!apiId || !apiHash) {
    throw new Error("TG_API_ID / TG_API_HASH 環境變數未設定 (TG_CREDENTIALS_MISSING)");
  }
  return { apiId, apiHash };
}

/** 建立 TelegramClient 並連線（token = StringSession 字串） */
async function createClient(sessionString: string) {
  const { TelegramClient, StringSession } = await getGramJS();
  const { apiId, apiHash } = getTgCredentials();
  const client = new TelegramClient(
    new StringSession(sessionString),
    apiId,
    apiHash,
    { connectionRetries: 3, retryDelay: 1000 },
  );
  await client.connect();
  return client;
}

// ── actionMap ──────────────────────────────────────────────
const actionMap: Record<string, string> = {
  // 對話（5）
  get_dialogs: "tgu_get_dialogs",
  get_history: "tgu_get_history",
  search_messages: "tgu_search_messages",
  send_message: "tgu_send_message",
  read_history: "tgu_read_history",
  // 聯絡人（3）
  get_contacts: "tgu_get_contacts",
  search_contacts: "tgu_search_contacts",
  resolve_username: "tgu_resolve_username",
  // 群組 / 頻道（5）
  join_channel: "tgu_join_channel",
  leave_channel: "tgu_leave_channel",
  get_participants: "tgu_get_participants",
  create_channel: "tgu_create_channel",
  get_channel_info: "tgu_get_channel_info",
  // 帳號（3）
  get_me: "tgu_get_me",
  update_profile: "tgu_update_profile",
  get_privacy: "tgu_get_privacy",
  // 檔案（2）
  download_media: "tgu_download_media",
  send_file: "tgu_send_file",
  // 工具（2）
  get_folders: "tgu_get_folders",
  forward_messages: "tgu_forward_messages",
};

// ── getSkill ──────────────────────────────────────────────
const ACTION_SKILLS: Record<string, string> = {
  get_dialogs: `## telegram_user.get_dialogs
Get recent chat list (private chats, groups, channels).
### Parameters
  limit (optional): Max chats to return (default 20, max 100)
  folder_id (optional): Folder ID to filter
### Example
octodock_do(app:"telegram_user", action:"get_dialogs", params:{limit:10})`,

  get_history: `## telegram_user.get_history
Read chat message history.
### Parameters
  chat: Chat username, phone, or ID
  limit (optional): Max messages (default 20, max 100)
  offset_id (optional): Start from this message ID (for pagination)
  search (optional): Filter messages containing this text
### Example
octodock_do(app:"telegram_user", action:"get_history", params:{chat:"@username", limit:30})`,

  search_messages: `## telegram_user.search_messages
Search messages across all chats or in a specific chat.
### Parameters
  query: Search text
  chat (optional): Limit to specific chat (username/ID)
  limit (optional): Max results (default 20, max 100)
  filter (optional): "photo", "video", "document", "link", "voice"
### Example
octodock_do(app:"telegram_user", action:"search_messages", params:{query:"meeting notes", limit:10})`,

  send_message: `## telegram_user.send_message
Send a message as your user account.
### Parameters
  chat: Chat username, phone, or ID
  text: Message text (supports Markdown)
  reply_to (optional): Message ID to reply to
### Example
octodock_do(app:"telegram_user", action:"send_message", params:{chat:"@friend", text:"Hello!"})`,

  get_contacts: `## telegram_user.get_contacts
Get your contact list.
### Example
octodock_do(app:"telegram_user", action:"get_contacts")`,

  resolve_username: `## telegram_user.resolve_username
Resolve a @username to user/channel info.
### Parameters
  username: Username without @
### Example
octodock_do(app:"telegram_user", action:"resolve_username", params:{username:"durov"})`,

  join_channel: `## telegram_user.join_channel
Join a public channel or group.
### Parameters
  channel: Channel/group username or invite link
### Example
octodock_do(app:"telegram_user", action:"join_channel", params:{channel:"@channelname"})`,

  get_me: `## telegram_user.get_me
Get your own Telegram account info.
### Example
octodock_do(app:"telegram_user", action:"get_me")`,

  forward_messages: `## telegram_user.forward_messages
Forward messages from one chat to another.
### Parameters
  from_chat: Source chat (username/ID)
  to_chat: Target chat (username/ID)
  message_ids: Array of message IDs to forward
### Example
octodock_do(app:"telegram_user", action:"forward_messages", params:{from_chat:"@source", to_chat:"@target", message_ids:[123, 456]})`,

  get_participants: `## telegram_user.get_participants
Get member list of a group or channel.
### Parameters
  chat: Group/channel username or ID
  limit (optional): Max members (default 50, max 200)
  search (optional): Filter by name
### Example
octodock_do(app:"telegram_user", action:"get_participants", params:{chat:"@groupname", limit:20})`,
};

function getSkill(action?: string): string | null {
  /* 帶 action：回傳特定 action 的說明 */
  if (action && ACTION_SKILLS[action]) return ACTION_SKILLS[action];
  if (action) return null; // 找不到的 action → 回傳 null 讓 server.ts fallback

  /* 不帶 action：回傳 App 級別清單 */
  return `telegram_user actions (${Object.keys(actionMap).length}):
## Chats
  get_dialogs(limit?, folder_id?) — list recent chats
  get_history(chat, limit?, offset_id?, search?) — read chat messages
  search_messages(query, chat?, limit?, filter?) — search messages
  send_message(chat, text, reply_to?) — send message as user
  read_history(chat) — mark as read
## Contacts
  get_contacts() — list contacts
  search_contacts(query) — search contacts/users
  resolve_username(username) — resolve @username to info
## Groups & Channels
  join_channel(channel) — join channel/group
  leave_channel(channel) — leave channel/group
  get_participants(chat, limit?, search?) — list members
  create_channel(title, about?, megagroup?) — create channel/group
  get_channel_info(chat) — get channel/group info
## Account
  get_me() — get your account info
  update_profile(first_name?, last_name?, about?) — update profile
  get_privacy() — view privacy settings
## Files
  download_media(chat, message_id) — download media (up to 2GB)
  send_file(chat, file_url, caption?) — send file
## Tools
  get_folders() — list chat folders
  forward_messages(from_chat, to_chat, message_ids) — forward messages
Use octodock_help(app:"telegram_user", action:"ACTION") for details.`;
}

// ── formatResponse ──────────────────────────────────────
/* eslint-disable @typescript-eslint/no-explicit-any */
function formatResponse(action: string, rawData: unknown): string {
  if (rawData === null || rawData === undefined) return "Done.";
  if (typeof rawData === "string") return rawData;

  switch (action) {
    case "get_me": {
      const d = rawData as any;
      return [
        `**${d.firstName || ""}${d.lastName ? " " + d.lastName : ""}**`,
        d.username ? `@${d.username}` : null,
        `ID: ${d.id}`,
        d.phone ? `Phone: +${d.phone}` : null,
        d.about ? `Bio: ${d.about}` : null,
        `Premium: ${d.premium ? "Yes" : "No"}`,
      ].filter(Boolean).join("\n");
    }

    case "get_dialogs": {
      const dialogs = rawData as any[];
      if (!Array.isArray(dialogs) || dialogs.length === 0) return "No chats found.";
      return dialogs.map((d: any, i: number) => {
        const type = d.isChannel ? "Channel" : d.isGroup ? "Group" : "Private";
        const unread = d.unreadCount > 0 ? ` (${d.unreadCount} unread)` : "";
        return `${i + 1}. **${d.title || d.name || "?"}** [${type}]${unread}`;
      }).join("\n");
    }

    case "get_history": {
      const messages = rawData as any[];
      if (!Array.isArray(messages) || messages.length === 0) return "No messages.";
      return messages.map((m: any) => {
        const from = m.fromName || "?";
        const time = m.date ? new Date(m.date * 1000).toLocaleString() : "";
        const text = m.text || m.caption || "(media)";
        return `[${time}] **${from}**: ${text}`;
      }).join("\n");
    }

    case "search_messages": {
      const results = rawData as any[];
      if (!Array.isArray(results) || results.length === 0) return "No results.";
      return results.map((m: any, i: number) => {
        const chat = m.chatTitle || "?";
        const text = m.text || "(media)";
        return `${i + 1}. [${chat}] ${text}`;
      }).join("\n");
    }

    case "send_message":
      return `Done. Message sent.`;

    case "read_history":
      return "Done. Marked as read.";

    case "get_contacts": {
      const contacts = rawData as any[];
      if (!Array.isArray(contacts) || contacts.length === 0) return "No contacts.";
      return contacts.map((c: any) => {
        const name = `${c.firstName || ""}${c.lastName ? " " + c.lastName : ""}`.trim() || "?";
        return `- **${name}**${c.username ? ` (@${c.username})` : ""}${c.phone ? ` +${c.phone}` : ""}`;
      }).join("\n");
    }

    case "search_contacts": {
      const results = rawData as any[];
      if (!Array.isArray(results) || results.length === 0) return "No results.";
      return results.map((u: any) => {
        const name = `${u.firstName || ""}${u.lastName ? " " + u.lastName : ""}`.trim() || "?";
        return `- **${name}**${u.username ? ` (@${u.username})` : ""} — ID: ${u.id}`;
      }).join("\n");
    }

    case "resolve_username": {
      const d = rawData as any;
      return [
        `**${d.title || d.firstName || "?"}**`,
        d.username ? `@${d.username}` : null,
        `ID: ${d.id}`,
        `Type: ${d.type || "unknown"}`,
        d.about ? `About: ${d.about}` : null,
        d.participantsCount ? `Members: ${d.participantsCount}` : null,
      ].filter(Boolean).join("\n");
    }

    case "get_participants": {
      const members = rawData as any[];
      if (!Array.isArray(members) || members.length === 0) return "No members.";
      return members.map((m: any) => {
        const name = `${m.firstName || ""}${m.lastName ? " " + m.lastName : ""}`.trim() || "?";
        const role = m.isAdmin ? " (admin)" : m.isCreator ? " (creator)" : "";
        return `- **${name}**${m.username ? ` @${m.username}` : ""}${role}`;
      }).join("\n");
    }

    case "get_channel_info": {
      const d = rawData as any;
      return [
        `**${d.title || "?"}**`,
        d.username ? `@${d.username}` : null,
        `ID: ${d.id}`,
        `Type: ${d.type || "unknown"}`,
        d.about ? `> ${d.about}` : null,
        d.participantsCount ? `Members: ${d.participantsCount}` : null,
        d.date ? `Created: ${new Date(d.date * 1000).toLocaleDateString()}` : null,
      ].filter(Boolean).join("\n");
    }

    case "get_folders": {
      const folders = rawData as any[];
      if (!Array.isArray(folders) || folders.length === 0) return "No folders.";
      return folders.map((f: any) => `- **${f.title}** (ID: ${f.id})`).join("\n");
    }

    case "update_profile":
    case "join_channel":
    case "leave_channel":
    case "create_channel":
    case "forward_messages":
    case "send_file":
      return typeof rawData === "string" ? rawData : "Done.";

    case "download_media":
      return typeof rawData === "string" ? rawData : "Done. File downloaded.";

    case "get_privacy":
      return typeof rawData === "string" ? rawData : JSON.stringify(rawData, null, 2);

    default:
      return JSON.stringify(rawData, null, 2);
  }
}

// ── formatError ──────────────────────────────────────────
function formatError(action: string, errorMessage: string): string | null {
  const msg = errorMessage.toLowerCase();
  if (msg.includes("session_expired") || msg.includes("auth_key_unregistered"))
    return "「Session 已過期 (TGU_SESSION_EXPIRED)」\n請在 Dashboard 重新連接 Telegram (User)。";
  if (msg.includes("flood_wait") || msg.includes("floodwait")) {
    const match = errorMessage.match(/(\d+)/);
    const secs = match ? match[1] : "?";
    return `「速率限制 (TGU_FLOOD_WAIT)」\n請等待 ${secs} 秒後再試。`;
  }
  if (msg.includes("peer_id_invalid") || msg.includes("username_not_occupied"))
    return "「找不到該用戶或頻道 (TGU_PEER_NOT_FOUND)」\n請確認 username 或 ID 是否正確。";
  if (msg.includes("chat_write_forbidden"))
    return "「無法在此聊天發送訊息 (TGU_WRITE_FORBIDDEN)」\n你可能沒有此群組/頻道的發言權限。";
  if (msg.includes("user_not_participant"))
    return "「你不是該群組/頻道的成員 (TGU_NOT_MEMBER)」\n需要先加入才能操作。";
  if (msg.includes("channels_too_much"))
    return "「已加入太多頻道/群組 (TGU_TOO_MANY_CHANNELS)」\nTelegram 限制最多加入 500 個。";
  if (msg.includes("tg_credentials_missing"))
    return "「TG_API_ID / TG_API_HASH 未設定 (TGU_CREDENTIALS_MISSING)」\n管理員需要在環境變數設定 Telegram API 憑證。";
  return null;
}

// ── 工具定義 ──────────────────────────────────────────────
/* chat 參數：支援 username（@xxx）、手機號碼、或 ID */
const chatParam = z.union([z.string(), z.number()]).describe("Chat: @username, phone number, or numeric ID");

const tools: ToolDefinition[] = [
  // 對話
  { name: "tgu_get_dialogs", description: "List recent chats (private, groups, channels).", inputSchema: { limit: z.number().optional().describe("Max chats (default 20, max 100)"), folder_id: z.number().optional().describe("Folder ID to filter") } },
  { name: "tgu_get_history", description: "Read chat message history.", inputSchema: { chat: chatParam, limit: z.number().optional().describe("Max messages (default 20, max 100)"), offset_id: z.number().optional().describe("Start from message ID"), search: z.string().optional().describe("Filter text") } },
  { name: "tgu_search_messages", description: "Search messages across chats.", inputSchema: { query: z.string().describe("Search text"), chat: chatParam.optional().describe("Limit to chat"), limit: z.number().optional().describe("Max results (default 20)"), filter: z.enum(["photo", "video", "document", "link", "voice"]).optional().describe("Media type filter") } },
  { name: "tgu_send_message", description: "Send message as your user account.", inputSchema: { chat: chatParam, text: z.string().describe("Message text"), reply_to: z.number().optional().describe("Reply to message ID") } },
  { name: "tgu_read_history", description: "Mark chat as read.", inputSchema: { chat: chatParam } },
  // 聯絡人
  { name: "tgu_get_contacts", description: "Get your contact list.", inputSchema: {} },
  { name: "tgu_search_contacts", description: "Search contacts and global users.", inputSchema: { query: z.string().describe("Search query"), limit: z.number().optional().describe("Max results (default 20)") } },
  { name: "tgu_resolve_username", description: "Resolve @username to user/channel info.", inputSchema: { username: z.string().describe("Username without @") } },
  // 群組 / 頻道
  { name: "tgu_join_channel", description: "Join a public channel or group.", inputSchema: { channel: z.string().describe("Channel username or invite link") } },
  { name: "tgu_leave_channel", description: "Leave a channel or group.", inputSchema: { channel: chatParam } },
  { name: "tgu_get_participants", description: "Get group/channel member list.", inputSchema: { chat: chatParam, limit: z.number().optional().describe("Max members (default 50, max 200)"), search: z.string().optional().describe("Filter by name") } },
  { name: "tgu_create_channel", description: "Create a new channel or group.", inputSchema: { title: z.string().describe("Channel/group title"), about: z.string().optional().describe("Description"), megagroup: z.boolean().optional().describe("true = group, false = channel (default false)") } },
  { name: "tgu_get_channel_info", description: "Get channel/group detailed info.", inputSchema: { chat: chatParam } },
  // 帳號
  { name: "tgu_get_me", description: "Get your Telegram account info.", inputSchema: {} },
  { name: "tgu_update_profile", description: "Update your profile.", inputSchema: { first_name: z.string().optional().describe("First name"), last_name: z.string().optional().describe("Last name"), about: z.string().optional().describe("Bio") } },
  { name: "tgu_get_privacy", description: "View privacy settings.", inputSchema: {} },
  // 檔案
  { name: "tgu_download_media", description: "Download media from a message (up to 2GB).", inputSchema: { chat: chatParam, message_id: z.number().describe("Message ID containing media") } },
  { name: "tgu_send_file", description: "Send a file to a chat.", inputSchema: { chat: chatParam, file_url: z.string().describe("Public URL of file to send"), caption: z.string().optional().describe("File caption") } },
  // 工具
  { name: "tgu_get_folders", description: "List chat folders.", inputSchema: {} },
  { name: "tgu_forward_messages", description: "Forward messages between chats.", inputSchema: { from_chat: chatParam, to_chat: chatParam, message_ids: z.array(z.number()).describe("Message IDs to forward") } },
];

// ── 工具執行邏輯 ──────────────────────────────────────────
/* eslint-disable @typescript-eslint/no-explicit-any */
async function execute(
  toolName: string,
  params: Record<string, unknown>,
  token: string, // token = StringSession 字串
): Promise<ToolResult> {
  const json = (result: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] });

  /* 建立 GramJS client（每次呼叫建新的，避免 long-lived connection 問題） */
  const client = await createClient(token);

  try {
    const { Api } = await getGramJS();

    switch (toolName) {
      // ── 對話 ──
      case "tgu_get_dialogs": {
        const limit = Math.min((params.limit as number) ?? 20, 100);
        const dialogs = await client.getDialogs({ limit, folder: params.folder_id as number | undefined });
        const result = dialogs.map(d => ({
          id: d.id?.toString(),
          title: d.title || d.name || "?",
          isChannel: d.isChannel,
          isGroup: d.isGroup,
          isUser: d.isUser,
          unreadCount: d.unreadCount,
          lastMessage: d.message?.text?.slice(0, 100) || null,
        }));
        return json(result);
      }

      case "tgu_get_history": {
        const limit = Math.min((params.limit as number) ?? 20, 100);
        const messages = await client.getMessages(params.chat as any, {
          limit,
          offsetId: params.offset_id as number | undefined,
          search: params.search as string | undefined,
        });
        const result = messages.map(m => ({
          id: m.id,
          date: m.date,
          fromName: m.sender && "firstName" in m.sender
            ? (m.sender as any).firstName
            : (m.sender as any)?.title || "?",
          text: m.text || null,
          caption: (m as any).caption || null,
          hasMedia: !!m.media,
          replyTo: m.replyTo ? (m.replyTo as any).replyToMsgId : null,
        }));
        return json(result);
      }

      case "tgu_search_messages": {
        const limit = Math.min((params.limit as number) ?? 20, 100);
        /* 建立 media filter（如果有） */
        const filterMap: Record<string, any> = {
          photo: new Api.InputMessagesFilterPhotos(),
          video: new Api.InputMessagesFilterVideo(),
          document: new Api.InputMessagesFilterDocument(),
          link: new Api.InputMessagesFilterUrl(),
          voice: new Api.InputMessagesFilterVoice(),
        };
        const filter = params.filter ? filterMap[params.filter as string] : undefined;
        const entity = params.chat || undefined;
        const messages = await client.getMessages(entity as any, {
          limit,
          search: params.query as string,
          filter,
        });
        const result = messages.map(m => ({
          id: m.id,
          chatTitle: m.chat && "title" in m.chat ? (m.chat as any).title : "Private",
          chatId: m.chatId?.toString(),
          text: m.text || null,
          date: m.date,
          fromName: m.sender && "firstName" in m.sender
            ? (m.sender as any).firstName
            : (m.sender as any)?.title || "?",
        }));
        return json(result);
      }

      case "tgu_send_message": {
        const result = await client.sendMessage(params.chat as any, {
          message: params.text as string,
          replyTo: params.reply_to as number | undefined,
        });
        return json({ id: result.id, date: result.date });
      }

      case "tgu_read_history": {
        await client.markAsRead(params.chat as any);
        return json("read");
      }

      // ── 聯絡人 ──
      case "tgu_get_contacts": {
        const result = await client.invoke(new Api.contacts.GetContacts({ hash: bigInt(0) }));
        if ("users" in result) {
          const contacts = (result.users as any[]).map(u => ({
            id: u.id?.toString(),
            firstName: u.firstName,
            lastName: u.lastName,
            username: u.username,
            phone: u.phone,
          }));
          return json(contacts);
        }
        return json([]);
      }

      case "tgu_search_contacts": {
        const limit = Math.min((params.limit as number) ?? 20, 100);
        const result = await client.invoke(new Api.contacts.Search({
          q: params.query as string,
          limit,
        }));
        const users = (result.users as any[]).map(u => ({
          id: u.id?.toString(),
          firstName: u.firstName,
          lastName: u.lastName,
          username: u.username,
        }));
        return json(users);
      }

      case "tgu_resolve_username": {
        const result = await client.invoke(new Api.contacts.ResolveUsername({
          username: (params.username as string).replace(/^@/, ""),
        }));
        const peer = result.peer;
        /* 從 users 或 chats 中找到對應的實體 */
        let entity: any = null;
        if ("userId" in peer) {
          entity = (result.users as any[]).find(u => u.id?.eq?.(peer.userId) || u.id === peer.userId);
          if (entity) {
            return json({
              type: "user",
              id: entity.id?.toString(),
              firstName: entity.firstName,
              lastName: entity.lastName,
              username: entity.username,
              phone: entity.phone,
              about: entity.about,
            });
          }
        }
        if ("channelId" in peer || "chatId" in peer) {
          const chatId = "channelId" in peer ? peer.channelId : (peer as any).chatId;
          entity = (result.chats as any[]).find(c => c.id?.eq?.(chatId) || c.id === chatId);
          if (entity) {
            return json({
              type: entity.megagroup ? "group" : "channel",
              id: entity.id?.toString(),
              title: entity.title,
              username: entity.username,
              about: entity.about,
              participantsCount: entity.participantsCount,
              date: entity.date,
            });
          }
        }
        return json({ type: "unknown", peer: JSON.stringify(peer) });
      }

      // ── 群組 / 頻道 ──
      case "tgu_join_channel": {
        const channel = params.channel as string;
        /* 判斷是 invite link 還是 username */
        if (channel.includes("joinchat/") || channel.includes("+")) {
          const hash = channel.split("/").pop()?.replace("+", "") || channel.replace("+", "");
          await client.invoke(new Api.messages.ImportChatInvite({ hash }));
        } else {
          const entity = await client.getEntity(channel);
          await client.invoke(new Api.channels.JoinChannel({ channel: entity as any }));
        }
        return json("Joined.");
      }

      case "tgu_leave_channel": {
        const entity = await client.getEntity(params.channel as any);
        await client.invoke(new Api.channels.LeaveChannel({ channel: entity as any }));
        return json("Left.");
      }

      case "tgu_get_participants": {
        const limit = Math.min((params.limit as number) ?? 50, 200);
        const entity = await client.getEntity(params.chat as any);
        const search = params.search as string | undefined;
        const result = await client.invoke(new Api.channels.GetParticipants({
          channel: entity as any,
          filter: search
            ? new Api.ChannelParticipantsSearch({ q: search })
            : new Api.ChannelParticipantsRecent(),
          offset: 0,
          limit,
          hash: bigInt(0),
        }));
        const r = result as any;
        const members = (r.users || []).map((u: any) => ({
          id: u.id?.toString(),
          firstName: u.firstName,
          lastName: u.lastName,
          username: u.username,
          isAdmin: (r.participants || []).some(
            (p: any) => (p.userId?.eq?.(u.id) || p.userId === u.id) && (p.className === "ChannelParticipantAdmin" || p.className === "ChannelParticipantCreator")
          ),
          isCreator: (r.participants || []).some(
            (p: any) => (p.userId?.eq?.(u.id) || p.userId === u.id) && p.className === "ChannelParticipantCreator"
          ),
        }));
        return json(members);
      }

      case "tgu_create_channel": {
        const result = await client.invoke(new Api.channels.CreateChannel({
          title: params.title as string,
          about: (params.about as string) || "",
          megagroup: (params.megagroup as boolean) ?? false,
        }));
        const chat = (result as any).chats?.[0];
        return json({
          id: chat?.id?.toString(),
          title: chat?.title,
          type: chat?.megagroup ? "group" : "channel",
        });
      }

      case "tgu_get_channel_info": {
        const entity = await client.getEntity(params.chat as any);
        const fullChat = await client.invoke(new Api.channels.GetFullChannel({ channel: entity as any }));
        const chat = (fullChat.chats as any[])[0];
        const full = fullChat.fullChat as any;
        return json({
          id: chat?.id?.toString(),
          title: chat?.title,
          username: chat?.username,
          type: chat?.megagroup ? "group" : "channel",
          about: full?.about,
          participantsCount: full?.participantsCount,
          date: chat?.date,
          linkedChatId: full?.linkedChatId?.toString(),
        });
      }

      // ── 帳號 ──
      case "tgu_get_me": {
        const me = await client.getMe();
        return json({
          id: (me as any).id?.toString(),
          firstName: (me as any).firstName,
          lastName: (me as any).lastName,
          username: (me as any).username,
          phone: (me as any).phone,
          about: (me as any).about,
          premium: (me as any).premium,
        });
      }

      case "tgu_update_profile": {
        await client.invoke(new Api.account.UpdateProfile({
          firstName: params.first_name as string | undefined,
          lastName: params.last_name as string | undefined,
          about: params.about as string | undefined,
        }));
        return json("Profile updated.");
      }

      case "tgu_get_privacy": {
        /* 取得主要隱私設定 */
        const keys = [
          { key: new Api.InputPrivacyKeyPhoneNumber(), label: "Phone number" },
          { key: new Api.InputPrivacyKeyStatusTimestamp(), label: "Last seen" },
          { key: new Api.InputPrivacyKeyProfilePhoto(), label: "Profile photo" },
        ];
        const results: Record<string, string> = {};
        for (const { key, label } of keys) {
          try {
            const r = await client.invoke(new Api.account.GetPrivacy({ key }));
            const rule = (r.rules as any[])[0]?.className || "unknown";
            results[label] = rule.replace("PrivacyValueAllow", "Allow ").replace("PrivacyValueDisallow", "Disallow ");
          } catch {
            results[label] = "unknown";
          }
        }
        return json(results);
      }

      // ── 檔案 ──
      case "tgu_download_media": {
        const messages = await client.getMessages(params.chat as any, { ids: [params.message_id as number] });
        const msg = messages[0];
        if (!msg?.media) {
          return { content: [{ type: "text", text: "No media in this message." }], isError: true };
        }
        /* 回傳 base64 太大，改回傳檔案資訊 + 提示用 get_file */
        const mediaInfo = {
          hasMedia: true,
          mediaType: (msg.media as any).className,
          messageId: msg.id,
          note: "Media download available. Due to size limits, use Telegram app to download large files.",
        };
        return json(mediaInfo);
      }

      case "tgu_send_file": {
        await client.sendFile(params.chat as any, {
          file: params.file_url as string,
          caption: params.caption as string | undefined,
        });
        return json("File sent.");
      }

      // ── 工具 ──
      case "tgu_get_folders": {
        const result = await client.invoke(new Api.messages.GetDialogFilters());
        /* GetDialogFilters 回傳的可能是 object 或 array，取 filters 欄位 */
        const filters = Array.isArray(result) ? result : (result as any).filters || [];
        const folders = filters
          .filter((f: any) => f.className !== "DialogFilterDefault")
          .map((f: any) => ({ id: f.id, title: f.title }));
        return json(folders);
      }

      case "tgu_forward_messages": {
        const fromEntity = await client.getEntity(params.from_chat as any);
        await client.forwardMessages(params.to_chat as any, {
          messages: params.message_ids as number[],
          fromPeer: fromEntity,
        });
        return json("Messages forwarded.");
      }

      default:
        return { content: [{ type: "text", text: `Unknown tool: ${toolName}` }], isError: true };
    }
  } finally {
    /* 確保斷線，避免 resource leak */
    try { await client.disconnect(); } catch { /* ignore */ }
  }
}

// ── Adapter 匯出 ──────────────────────────────────────────
export const telegramUserAdapter: AppAdapter = {
  name: "telegram_user",
  displayName: { zh: "Telegram (帳號)", en: "Telegram (User)" },
  icon: "telegram",
  authType: "phone_auth",
  authConfig,
  tools,
  actionMap,
  getSkill,
  formatResponse,
  formatError,
  execute,
};
