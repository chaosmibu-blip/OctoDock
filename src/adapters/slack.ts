/**
 * Slack Adapter
 *
 * 覆蓋 Slack Web API 核心端點：頻道、訊息、使用者、反應、釘選
 * 認證方式：OAuth 2.0（Bot Token）
 * Bot token 不過期，但用戶可撤銷
 */
import { z } from "zod";
import type {
  AppAdapter,
  OAuthConfig,
  ToolDefinition,
  ToolResult,
} from "./types";

// ── OAuth 設定 ─────────────────────────────────────────────
const authConfig: OAuthConfig = {
  type: "oauth2",
  authorizeUrl: "https://slack.com/oauth/v2/authorize",
  tokenUrl: "https://slack.com/api/oauth.v2.access",
  scopes: [
    "channels:read",
    "channels:history",
    "groups:read",
    "groups:history",
    "im:read",
    "im:history",
    "chat:write",
    "users:read",
    "reactions:read",
    "reactions:write",
    "pins:read",
    "pins:write",
    "channels:manage",
    "bookmarks:read",
    "bookmarks:write",
  ],
  authMethod: "post",
};

// ── API 基礎設定 ───────────────────────────────────────────
const SLACK_API = "https://slack.com/api";

// ── Slack API fetch 封裝 ──────────────────────────────────
async function slackFetch(
  method: string,
  token: string,
  params?: Record<string, unknown>,
  httpMethod: "GET" | "POST" = "GET",
): Promise<unknown> {
  let res: Response;

  if (httpMethod === "POST") {
    // POST 用 JSON body
    res = await fetch(`${SLACK_API}/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(params ?? {}),
    });
  } else {
    // GET 用 query string
    const qs = params
      ? "?" + new URLSearchParams(
          Object.entries(params)
            .filter(([, v]) => v != null)
            .map(([k, v]) => [k, String(v)]),
        ).toString()
      : "";
    res = await fetch(`${SLACK_API}/${method}${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  if (!res.ok) {
    throw new Error(`Slack API HTTP error: ${res.status} ${res.statusText} (SLACK_API_ERROR)`);
  }

  const data = (await res.json()) as { ok: boolean; error?: string; [key: string]: unknown };
  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error ?? "unknown"} (SLACK_API_ERROR)`);
  }
  return data;
}

// ── actionMap ──────────────────────────────────────────────
const actionMap: Record<string, string> = {
  // 頻道
  list_channels: "slack_list_channels",
  create_channel: "slack_create_channel",
  archive_channel: "slack_archive_channel",
  set_topic: "slack_set_topic",
  set_purpose: "slack_set_purpose",
  invite_to_channel: "slack_invite_to_channel",
  kick_from_channel: "slack_kick_from_channel",
  // 訊息
  get_messages: "slack_get_messages",
  get_replies: "slack_get_replies",
  send_message: "slack_send_message",
  update_message: "slack_update_message",
  delete_message: "slack_delete_message",
  // 使用者
  list_users: "slack_list_users",
  get_user: "slack_get_user",
  // 反應
  add_reaction: "slack_add_reaction",
  get_reactions: "slack_get_reactions",
  // 釘選
  pin: "slack_pin",
  unpin: "slack_unpin",
  list_pins: "slack_list_pins",
  // 書籤
  add_bookmark: "slack_add_bookmark",
  list_bookmarks: "slack_list_bookmarks",
};

// ── Skill 說明 ─────────────────────────────────────────────

/** 各 action 的詳細參數說明 + 範例 */
const ACTION_SKILLS: Record<string, string> = {
  list_channels: `## slack.list_channels
List all channels (public, private, DMs).
### Parameters
  types (optional): "public_channel,private_channel,im,mpim" (default: "public_channel")
  limit (optional): max results (default: 100)
  cursor (optional): pagination cursor
### Example
  octodock_do(app:"slack", action:"list_channels", params:{types:"public_channel,private_channel"})`,

  send_message: `## slack.send_message
Send a message to a channel or DM.
### Parameters
  channel: channel ID (C0123456)
  text: message text (supports Slack markdown)
  thread_ts (optional): reply to a thread
### Example
  octodock_do(app:"slack", action:"send_message", params:{channel:"C0123456", text:"Hello team!"})`,

  get_messages: `## slack.get_messages
Get message history of a channel.
### Parameters
  channel: channel ID
  limit (optional): max messages (default: 20, max: 100)
  cursor (optional): pagination cursor
  oldest (optional): oldest message timestamp
  latest (optional): latest message timestamp
### Example
  octodock_do(app:"slack", action:"get_messages", params:{channel:"C0123456", limit:10})`,

  get_replies: `## slack.get_replies
Get replies in a message thread.
### Parameters
  channel: channel ID
  ts: parent message timestamp
  limit (optional): max replies (default: 20)
  cursor (optional): pagination cursor
### Example
  octodock_do(app:"slack", action:"get_replies", params:{channel:"C0123456", ts:"1234567890.123456"})`,
};

/** 回傳 Skill 說明 */
function getSkill(action?: string): string | null {
  if (action && ACTION_SKILLS[action]) return ACTION_SKILLS[action];
  if (action) return null; // 回傳 null 讓 server.ts fallback 用 actionMap 查 inputSchema
  return `slack (${Object.keys(actionMap).length} actions):
Channels: list_channels, create_channel, archive_channel, set_topic, set_purpose, invite_to_channel, kick_from_channel
Messages: get_messages, get_replies, send_message, update_message, delete_message
Users: list_users, get_user
Reactions: add_reaction, get_reactions
Pins: pin, unpin, list_pins
Bookmarks: add_bookmark, list_bookmarks

Use octodock_help(app:"slack", action:"ACTION") for detailed params + example.`;
}

// ── formatResponse ────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */
/** 將 Slack API raw JSON 轉成 AI 友善格式 */
function formatResponse(action: string, rawData: unknown): string {
  if (typeof rawData !== "object" || rawData === null) return String(rawData);
  const data = rawData as Record<string, unknown>;

  switch (action) {
    // 頻道列表
    case "list_channels": {
      const channels = (data.channels ?? []) as any[];
      if (channels.length === 0) return "No channels found.";
      let result = channels.map((c: any) =>
        `- **#${c.name}** (${c.id}) — ${c.purpose?.value || c.topic?.value || "no description"} [${c.num_members ?? "?"} members]`,
      ).join("\n");
      const cursor = (data.response_metadata as any)?.next_cursor;
      if (cursor) result += `\n\n_More channels available. Use cursor: "${cursor}" to see next page._`;
      return result;
    }

    // 訊息歷史
    case "get_messages":
    case "get_replies": {
      const messages = (data.messages ?? []) as any[];
      if (messages.length === 0) return "No messages found.";
      // 倒序（最舊在上）
      const sorted = [...messages].reverse();
      let result = sorted.map((m: any) => {
        const time = m.ts ? new Date(parseFloat(m.ts) * 1000).toISOString().slice(0, 16) : "";
        const user = m.user ?? m.bot_id ?? "unknown";
        return `[${time}] <${user}> ${m.text ?? ""}`;
      }).join("\n");
      if (data.has_more) result += "\n\n_More messages available. Use cursor parameter to see next page._";
      return result;
    }

    // 使用者列表
    case "list_users": {
      const members = (data.members ?? []) as any[];
      if (members.length === 0) return "No users found.";
      let result = members
        .filter((u: any) => !u.deleted && !u.is_bot)
        .map((u: any) =>
          `- **${u.real_name ?? u.name}** (@${u.name}) — ${u.profile?.title || ""} [ID: ${u.id}]`,
        ).join("\n");
      const cursor = (data.response_metadata as any)?.next_cursor;
      if (cursor) result += `\n\n_More users available. Use cursor: "${cursor}" to see next page._`;
      return result;
    }

    // 使用者資訊
    case "get_user": {
      const u = data.user as any;
      if (!u) return JSON.stringify(data, null, 2);
      return `**${u.real_name ?? u.name}** (@${u.name})
ID: ${u.id}
Title: ${u.profile?.title ?? "N/A"}
Email: ${u.profile?.email ?? "N/A"}
Status: ${u.profile?.status_text ?? "N/A"} ${u.profile?.status_emoji ?? ""}
Timezone: ${u.tz ?? "N/A"}`;
    }

    // 釘選列表
    case "list_pins": {
      const items = (data.items ?? []) as any[];
      if (items.length === 0) return "No pinned items.";
      return items.map((p: any) => {
        const msg = p.message;
        if (!msg) return `- [${p.type}] ${JSON.stringify(p)}`;
        return `- "${(msg.text ?? "").substring(0, 80)}" by <${msg.user ?? "?"}> at ${msg.ts}`;
      }).join("\n");
    }

    // 書籤列表
    case "list_bookmarks": {
      const bookmarks = (data.bookmarks ?? []) as any[];
      if (bookmarks.length === 0) return "No bookmarks.";
      return bookmarks.map((b: any) =>
        `- **${b.title}** — ${b.link ?? "no link"} (${b.type})`,
      ).join("\n");
    }

    // 反應
    case "get_reactions": {
      const msg = data.message as any;
      if (!msg?.reactions) return "No reactions on this message.";
      return (msg.reactions as any[]).map((r: any) =>
        `:${r.name}: (${r.count}) — ${(r.users ?? []).join(", ")}`,
      ).join("\n");
    }

    // 寫入操作的回傳
    case "send_message": {
      const msg = data.message as any;
      return `Done. Message sent to <#${data.channel}>. ts: ${msg?.ts ?? "?"}`;
    }
    case "update_message":
      return `Done. Message updated. ts: ${data.ts}`;
    case "delete_message":
      return `Done. Message deleted. ts: ${data.ts}`;
    case "create_channel": {
      const ch = data.channel as any;
      return `Done. Channel #${ch?.name} created. ID: ${ch?.id}`;
    }
    case "archive_channel":
      return "Done. Channel archived.";
    case "set_topic":
      return `Done. Topic set to: "${(data as any).topic ?? ""}"`;
    case "set_purpose":
      return `Done. Purpose set to: "${(data as any).purpose ?? ""}"`;
    case "invite_to_channel":
      return "Done. User(s) invited to channel.";
    case "kick_from_channel":
      return "Done. User removed from channel.";
    case "add_reaction":
      return "Done. Reaction added.";
    case "pin":
      return "Done. Message pinned.";
    case "unpin":
      return "Done. Message unpinned.";
    case "add_bookmark":
      return `Done. Bookmark "${(data.bookmark as any)?.title ?? ""}" added.`;

    default:
      return JSON.stringify(rawData, null, 2);
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── formatError ───────────────────────────────────────────
/** 攔截常見 Slack API 錯誤，回傳有用提示 */
function formatError(action: string, errorMessage: string): string | null {
  const msg = errorMessage.toLowerCase();
  if (msg.includes("not_authed") || msg.includes("invalid_auth")) return "Slack token 無效或已撤銷。請到 Dashboard 重新連結 Slack。";
  if (msg.includes("channel_not_found")) return "找不到指定的頻道。請用 list_channels 確認頻道 ID。";
  if (msg.includes("not_in_channel")) return "Bot 不在這個頻道裡。請先把 Bot 加入頻道，或用 invite_to_channel。";
  if (msg.includes("is_archived")) return "這個頻道已封存，無法執行操作。";
  if (msg.includes("too_many_attachments")) return "附件太多。Slack 限制每則訊息的附件數量。";
  if (msg.includes("msg_too_long")) return "訊息太長。Slack 限制 40,000 字元。";
  if (msg.includes("no_text")) return "訊息內容不能為空。請提供 text 參數。";
  if (msg.includes("ratelimited") || msg.includes("rate_limit")) return "Slack API 速率限制。請稍後再試。";
  if (msg.includes("missing_scope")) return "Bot 缺少必要的 OAuth scope。請到 Dashboard 重新連結 Slack 並確認權限。";
  return null;
}

// ── 工具定義 ──────────────────────────────────────────────
const tools: ToolDefinition[] = [
  // ── 頻道 ──
  {
    name: "slack_list_channels",
    description: "List Slack channels (public, private, DMs, group DMs).",
    inputSchema: {
      types: z.string().optional().describe("Channel types: public_channel, private_channel, im, mpim (comma-separated)"),
      limit: z.number().optional().describe("Max results (default: 100)"),
      cursor: z.string().optional().describe("Pagination cursor"),
    },
  },
  {
    name: "slack_create_channel",
    description: "Create a new Slack channel.",
    inputSchema: {
      name: z.string().describe("Channel name (lowercase, no spaces, max 80 chars)"),
      is_private: z.boolean().optional().describe("Create as private channel (default: false)"),
    },
  },
  {
    name: "slack_archive_channel",
    description: "Archive a Slack channel.",
    inputSchema: { channel: z.string().describe("Channel ID") },
  },
  {
    name: "slack_set_topic",
    description: "Set channel topic.",
    inputSchema: {
      channel: z.string().describe("Channel ID"),
      topic: z.string().describe("New topic text"),
    },
  },
  {
    name: "slack_set_purpose",
    description: "Set channel purpose/description.",
    inputSchema: {
      channel: z.string().describe("Channel ID"),
      purpose: z.string().describe("New purpose text"),
    },
  },
  {
    name: "slack_invite_to_channel",
    description: "Invite user(s) to a channel.",
    inputSchema: {
      channel: z.string().describe("Channel ID"),
      users: z.string().describe("User ID(s), comma-separated"),
    },
  },
  {
    name: "slack_kick_from_channel",
    description: "Remove a user from a channel.",
    inputSchema: {
      channel: z.string().describe("Channel ID"),
      user: z.string().describe("User ID"),
    },
  },
  // ── 訊息 ──
  {
    name: "slack_get_messages",
    description: "Get message history of a Slack channel.",
    inputSchema: {
      channel: z.string().describe("Channel ID"),
      limit: z.number().optional().describe("Max messages (default: 20, max: 100)"),
      cursor: z.string().optional().describe("Pagination cursor"),
      oldest: z.string().optional().describe("Oldest message timestamp to include"),
      latest: z.string().optional().describe("Latest message timestamp to include"),
    },
  },
  {
    name: "slack_get_replies",
    description: "Get replies in a message thread.",
    inputSchema: {
      channel: z.string().describe("Channel ID"),
      ts: z.string().describe("Parent message timestamp"),
      limit: z.number().optional().describe("Max replies (default: 20)"),
      cursor: z.string().optional().describe("Pagination cursor"),
    },
  },
  {
    name: "slack_send_message",
    description: "Send a message to a Slack channel or DM. Supports Slack markdown and threads.",
    inputSchema: {
      channel: z.string().describe("Channel ID (C0123456) or user ID for DM"),
      text: z.string().describe("Message text (supports Slack markdown: *bold*, _italic_, ~strike~, `code`)"),
      thread_ts: z.string().optional().describe("Reply to a thread (parent message timestamp)"),
    },
  },
  {
    name: "slack_update_message",
    description: "Update an existing message.",
    inputSchema: {
      channel: z.string().describe("Channel ID"),
      ts: z.string().describe("Message timestamp to update"),
      text: z.string().describe("New message text"),
    },
  },
  {
    name: "slack_delete_message",
    description: "Delete a message.",
    inputSchema: {
      channel: z.string().describe("Channel ID"),
      ts: z.string().describe("Message timestamp to delete"),
    },
  },
  // ── 使用者 ──
  {
    name: "slack_list_users",
    description: "List all users in the Slack workspace.",
    inputSchema: {
      limit: z.number().optional().describe("Max results (default: 100)"),
      cursor: z.string().optional().describe("Pagination cursor"),
    },
  },
  {
    name: "slack_get_user",
    description: "Get detailed info about a specific user.",
    inputSchema: {
      user: z.string().describe("User ID (U0123456)"),
    },
  },
  // ── 反應 ──
  {
    name: "slack_add_reaction",
    description: "Add an emoji reaction to a message.",
    inputSchema: {
      channel: z.string().describe("Channel ID"),
      timestamp: z.string().describe("Message timestamp"),
      name: z.string().describe("Emoji name without colons (e.g. 'thumbsup', 'heart')"),
    },
  },
  {
    name: "slack_get_reactions",
    description: "Get all reactions on a message.",
    inputSchema: {
      channel: z.string().describe("Channel ID"),
      timestamp: z.string().describe("Message timestamp"),
    },
  },
  // ── 釘選 ──
  {
    name: "slack_pin",
    description: "Pin a message to a channel.",
    inputSchema: {
      channel: z.string().describe("Channel ID"),
      timestamp: z.string().describe("Message timestamp"),
    },
  },
  {
    name: "slack_unpin",
    description: "Unpin a message from a channel.",
    inputSchema: {
      channel: z.string().describe("Channel ID"),
      timestamp: z.string().describe("Message timestamp"),
    },
  },
  {
    name: "slack_list_pins",
    description: "List all pinned items in a channel.",
    inputSchema: {
      channel: z.string().describe("Channel ID"),
    },
  },
  // ── 書籤 ──
  {
    name: "slack_add_bookmark",
    description: "Add a bookmark to a channel.",
    inputSchema: {
      channel_id: z.string().describe("Channel ID"),
      title: z.string().describe("Bookmark title"),
      type: z.string().optional().describe("Bookmark type (default: 'link')"),
      link: z.string().optional().describe("Bookmark URL"),
    },
  },
  {
    name: "slack_list_bookmarks",
    description: "List bookmarks in a channel.",
    inputSchema: {
      channel_id: z.string().describe("Channel ID"),
    },
  },
];

// ── 工具執行邏輯 ──────────────────────────────────────────
async function execute(
  toolName: string,
  params: Record<string, unknown>,
  token: string,
): Promise<ToolResult> {
  /** 簡化回傳格式 */
  const json = (data: unknown): ToolResult => ({
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  });

  switch (toolName) {
    // ── 頻道 ──
    case "slack_list_channels": {
      const result = await slackFetch("conversations.list", token, {
        types: params.types ?? "public_channel",
        limit: Math.min((params.limit as number) ?? 100, 200),
        cursor: params.cursor,
        exclude_archived: true,
      });
      return json(result);
    }
    case "slack_create_channel":
      return json(await slackFetch("conversations.create", token, {
        name: params.name,
        is_private: params.is_private ?? false,
      }, "POST"));
    case "slack_archive_channel":
      return json(await slackFetch("conversations.archive", token, { channel: params.channel }, "POST"));
    case "slack_set_topic":
      return json(await slackFetch("conversations.setTopic", token, {
        channel: params.channel,
        topic: params.topic,
      }, "POST"));
    case "slack_set_purpose":
      return json(await slackFetch("conversations.setPurpose", token, {
        channel: params.channel,
        purpose: params.purpose,
      }, "POST"));
    case "slack_invite_to_channel":
      return json(await slackFetch("conversations.invite", token, {
        channel: params.channel,
        users: params.users,
      }, "POST"));
    case "slack_kick_from_channel":
      return json(await slackFetch("conversations.kick", token, {
        channel: params.channel,
        user: params.user,
      }, "POST"));

    // ── 訊息 ──
    case "slack_get_messages": {
      const limit = Math.min((params.limit as number) ?? 20, 100);
      const result = await slackFetch("conversations.history", token, {
        channel: params.channel,
        limit,
        cursor: params.cursor,
        oldest: params.oldest,
        latest: params.latest,
      });
      return json(result);
    }
    case "slack_get_replies": {
      const limit = Math.min((params.limit as number) ?? 20, 100);
      const result = await slackFetch("conversations.replies", token, {
        channel: params.channel,
        ts: params.ts,
        limit,
        cursor: params.cursor,
      });
      return json(result);
    }
    case "slack_send_message":
      return json(await slackFetch("chat.postMessage", token, {
        channel: params.channel,
        text: params.text,
        thread_ts: params.thread_ts,
      }, "POST"));
    case "slack_update_message":
      return json(await slackFetch("chat.update", token, {
        channel: params.channel,
        ts: params.ts,
        text: params.text,
      }, "POST"));
    case "slack_delete_message":
      return json(await slackFetch("chat.delete", token, {
        channel: params.channel,
        ts: params.ts,
      }, "POST"));

    // ── 使用者 ──
    case "slack_list_users": {
      const result = await slackFetch("users.list", token, {
        limit: Math.min((params.limit as number) ?? 100, 200),
        cursor: params.cursor,
      });
      return json(result);
    }
    case "slack_get_user":
      return json(await slackFetch("users.info", token, { user: params.user }));

    // ── 反應 ──
    case "slack_add_reaction":
      return json(await slackFetch("reactions.add", token, {
        channel: params.channel,
        timestamp: params.timestamp,
        name: params.name,
      }, "POST"));
    case "slack_get_reactions":
      return json(await slackFetch("reactions.get", token, {
        channel: params.channel,
        timestamp: params.timestamp,
        full: true,
      }));

    // ── 釘選 ──
    case "slack_pin":
      return json(await slackFetch("pins.add", token, {
        channel: params.channel,
        timestamp: params.timestamp,
      }, "POST"));
    case "slack_unpin":
      return json(await slackFetch("pins.remove", token, {
        channel: params.channel,
        timestamp: params.timestamp,
      }, "POST"));
    case "slack_list_pins":
      return json(await slackFetch("pins.list", token, { channel: params.channel }));

    // ── 書籤 ──
    case "slack_add_bookmark":
      return json(await slackFetch("bookmarks.add", token, {
        channel_id: params.channel_id,
        title: params.title,
        type: params.type ?? "link",
        link: params.link,
      }, "POST"));
    case "slack_list_bookmarks":
      return json(await slackFetch("bookmarks.list", token, { channel_id: params.channel_id }));

    default:
      return {
        content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
        isError: true,
      };
  }
}

// ── Adapter 匯出 ─────────────────────────────────────────
// 注意：Slack Bot Token 不過期，不需要 refreshToken
export const slackAdapter: AppAdapter = {
  name: "slack",
  displayName: { zh: "Slack", en: "Slack" },
  icon: "slack",
  authType: "oauth2",
  authConfig,
  actionMap,
  getSkill,
  formatResponse,
  formatError,
  tools,
  execute,
};
