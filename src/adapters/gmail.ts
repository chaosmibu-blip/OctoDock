/**
 * Gmail Adapter
 * 提供 Gmail 郵件搜尋、閱讀、發送、回覆、對話串、草稿全套、標籤管理、封存、垃圾桶、已讀/未讀、附件下載功能
 */
import { z } from "zod";
import type {
  AppAdapter,
  OAuthConfig,
  ToolDefinition,
  ToolResult,
  TokenSet,
} from "./types";

// ── OAuth 設定 ─────────────────────────────────────────────
const authConfig: OAuthConfig = {
  type: "oauth2",
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  scopes: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.modify",
  ],
  authMethod: "post",
  extraParams: { access_type: "offline", prompt: "consent" },
};

// ── API 基礎設定 ───────────────────────────────────────────
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

// ── 輔助函式：Gmail API 請求封裝 ──────────────────────────
async function gmailFetch(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<unknown> {
  const res = await fetch(`${GMAIL_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers as object),
    },
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error(
      `Gmail API error: ${(error as { error: { message: string } }).error.message} (GMAIL_API_ERROR)`,
    );
  }
  return res.json();
}

// ── 輔助函式：解碼 base64url 郵件內容 ────────────────────
function decodeBody(body: string): string {
  return Buffer.from(body, "base64url").toString("utf8");
}

// ── 輔助函式：RFC 2047 編碼（非 ASCII 字元的 Subject 需要） ──
// Gmail API 要求 Subject header 用 RFC 2047 編碼，否則中文等非 ASCII 字元會亂碼
function encodeRfc2047(text: string): string {
  // 純 ASCII 不需要編碼
  if (/^[\x20-\x7E]*$/.test(text)) return text;
  // Base64 編碼：=?charset?encoding?encoded_text?=
  return `=?UTF-8?B?${Buffer.from(text, "utf-8").toString("base64")}?=`;
}

// ── 輔助函式：建構 RFC 2822 格式郵件 ─────────────────────
function buildRawEmail(
  to: string,
  subject: string,
  body: string,
  headers?: Record<string, string>,
): string {
  const lines = [
    `To: ${to}`,
    `Subject: ${encodeRfc2047(subject)}`,
    "MIME-Version: 1.0",
    ...Object.entries(headers ?? {}).map(([k, v]) => `${k}: ${v}`),
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(body, "utf-8").toString("base64"),
  ];
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

// ── 輔助函式：從郵件結構中提取純文字內容 ──────────────────
// 優先取 text/plain，fallback 到 text/html（去除 HTML 標籤）
function extractText(payload: Record<string, unknown>): string {
  // 先嘗試找 text/plain
  const plain = extractByMimeType(payload, "text/plain");
  if (plain) return plain;
  // Fallback：取 text/html 並去除 HTML 標籤
  const html = extractByMimeType(payload, "text/html");
  if (html) return stripHtml(html);
  return "";
}

/** 按 MIME type 遞迴搜尋並解碼郵件內容 */
function extractByMimeType(payload: Record<string, unknown>, mimeType: string): string {
  if (
    (payload as { mimeType?: string }).mimeType === mimeType &&
    (payload as { body?: { data?: string } }).body?.data
  ) {
    return decodeBody((payload as { body: { data: string } }).body.data);
  }
  const parts = (payload as { parts?: Array<Record<string, unknown>> }).parts;
  if (parts) {
    for (const part of parts) {
      const text = extractByMimeType(part, mimeType);
      if (text) return text;
    }
  }
  return "";
}

/** 簡易 HTML → 純文字轉換（去標籤、保留結構） */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── 輔助函式：提取附件資訊（名稱、大小、ID）──────────────
// 讓 AI 知道郵件有附件，可接續呼叫 get_attachment 下載
function extractAttachments(payload: Record<string, unknown>): Array<{ filename: string; mimeType: string; size: number; attachmentId: string }> {
  const attachments: Array<{ filename: string; mimeType: string; size: number; attachmentId: string }> = [];
  const parts = (payload as { parts?: Array<Record<string, unknown>> }).parts;
  if (!parts) return attachments;
  for (const part of parts) {
    const filename = part.filename as string | undefined;
    const body = part.body as { attachmentId?: string; size?: number } | undefined;
    if (filename && body?.attachmentId) {
      attachments.push({
        filename,
        mimeType: (part.mimeType as string) ?? "application/octet-stream",
        size: body.size ?? 0,
        attachmentId: body.attachmentId,
      });
    }
    // 遞迴檢查巢狀 parts
    const nested = extractAttachments(part);
    attachments.push(...nested);
  }
  return attachments;
}

// ── 輔助函式：提取郵件標頭值 ──────────────────────────────
function getHeader(
  headers: Array<{ name: string; value: string }>,
  name: string,
): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

// ── do+help 架構：動作對照表 ──────────────────────────────
// 將自然語言動作名稱對應到 MCP 工具名稱
const actionMap: Record<string, string> = {
  search: "gmail_search",
  read: "gmail_read",
  send: "gmail_send",
  reply: "gmail_reply",
  draft: "gmail_draft",
  list_drafts: "gmail_list_drafts",
  get_draft: "gmail_get_draft",
  send_draft: "gmail_send_draft",
  delete_draft: "gmail_delete_draft",
  list_threads: "gmail_list_threads",
  get_thread: "gmail_get_thread",
  label_list: "gmail_label_list",
  trash: "gmail_trash",
  untrash: "gmail_untrash",
  archive: "gmail_archive",
  mark_read: "gmail_mark_read",
  mark_unread: "gmail_mark_unread",
  get_attachment: "gmail_get_attachment",
};

// ── do+help 架構：技能描述（供 agent 理解可用操作）────────
const ACTION_SKILLS: Record<string, string> = {
  search: `## gmail.search
Search emails using Gmail search syntax.
### Parameters
  query: Gmail search query (same syntax as Gmail search bar, e.g. "from:boss@company.com is:unread")
  max_results (optional): Max results (default 10, max 50)
### Example
octodock_do(app:"gmail", action:"search", params:{query:"is:unread from:client@company.com"})
octodock_do(app:"gmail", action:"search", params:{query:"subject:invoice after:2026/03/01", max_results:5})`,

  read: `## gmail.read
Read full email content by ID.
### Parameters
  message_id: Gmail message ID (get from search results)
### Example
octodock_do(app:"gmail", action:"read", params:{message_id:"18e5a3b2c4d6f789"})`,

  send: `## gmail.send
Send a new email.
### Parameters
  to: Recipient email address
  subject: Email subject
  body: Email body in plain text
### Example
octodock_do(app:"gmail", action:"send", params:{
  to:"colleague@company.com",
  subject:"Meeting Notes 3/15",
  body:"Hi,\\n\\nHere are the meeting notes...\\n\\nBest regards"
})`,

  reply: `## gmail.reply
Reply to an existing email thread.
### Parameters
  message_id: Original message ID to reply to
  body: Reply body in plain text
### Example
octodock_do(app:"gmail", action:"reply", params:{
  message_id:"18e5a3b2c4d6f789",
  body:"Thanks for the update. I'll review and get back to you."
})`,

  draft: `## gmail.draft
Create a draft email (can be reviewed and sent later from Gmail).
### Parameters
  to: Recipient email address
  subject: Email subject
  body: Email body in plain text
### Example
octodock_do(app:"gmail", action:"draft", params:{
  to:"partner@company.com",
  subject:"Proposal Draft",
  body:"Dear Partner,\\n\\nPlease find our proposal..."
})`,

  label_list: `## gmail.label_list
List all labels in user's Gmail account (system + custom labels).
### Parameters
  (none)
### Example
octodock_do(app:"gmail", action:"label_list", params:{})`,

  trash: `## gmail.trash
Move an email to trash.
### Parameters
  message_id: Gmail message ID
### Example
octodock_do(app:"gmail", action:"trash", params:{message_id:"18e5a3b2c4d6f789"})`,

  untrash: `## gmail.untrash
Remove an email from trash (restore it).
### Parameters
  message_id: Gmail message ID
### Example
octodock_do(app:"gmail", action:"untrash", params:{message_id:"18e5a3b2c4d6f789"})`,

  archive: `## gmail.archive
Archive an email (remove from Inbox but keep in All Mail).
### Parameters
  message_id: Gmail message ID
### Example
octodock_do(app:"gmail", action:"archive", params:{message_id:"18e5a3b2c4d6f789"})`,

  mark_read: `## gmail.mark_read
Mark an email as read.
### Parameters
  message_id: Gmail message ID
### Example
octodock_do(app:"gmail", action:"mark_read", params:{message_id:"18e5a3b2c4d6f789"})`,

  mark_unread: `## gmail.mark_unread
Mark an email as unread.
### Parameters
  message_id: Gmail message ID
### Example
octodock_do(app:"gmail", action:"mark_unread", params:{message_id:"18e5a3b2c4d6f789"})`,

  get_attachment: `## gmail.get_attachment
Download an email attachment by attachment ID. Returns base64-decoded content.
### Parameters
  message_id: Gmail message ID
  attachment_id: Attachment ID (found in message payload parts)
### Example
octodock_do(app:"gmail", action:"get_attachment", params:{message_id:"18e5a3b2c4d6f789", attachment_id:"ANGjdJ8..."})`,

  list_threads: `## gmail.list_threads
Search and list email threads (conversations). Each thread groups related emails together.
### Parameters
  query (optional): Gmail search query (default: all threads)
  max_results (optional): Max threads to return (default 10, max 50)
### Example
octodock_do(app:"gmail", action:"list_threads", params:{query:"from:client@company.com", max_results:5})`,

  get_thread: `## gmail.get_thread
Get all messages in an email thread (full conversation).
### Parameters
  thread_id: Gmail thread ID (from list_threads or search results)
### Example
octodock_do(app:"gmail", action:"get_thread", params:{thread_id:"18e5a3b2c4d6f789"})`,

  list_drafts: `## gmail.list_drafts
List all draft emails in user's Gmail.
### Parameters
  max_results (optional): Max drafts to return (default 10, max 50)
### Example
octodock_do(app:"gmail", action:"list_drafts", params:{max_results:5})`,

  get_draft: `## gmail.get_draft
Get full content of a specific draft email.
### Parameters
  draft_id: Gmail draft ID (from list_drafts)
### Example
octodock_do(app:"gmail", action:"get_draft", params:{draft_id:"r-123456789"})`,

  send_draft: `## gmail.send_draft
Send an existing draft email.
### Parameters
  draft_id: Gmail draft ID to send
### Example
octodock_do(app:"gmail", action:"send_draft", params:{draft_id:"r-123456789"})`,

  delete_draft: `## gmail.delete_draft
Permanently delete a draft email.
### Parameters
  draft_id: Gmail draft ID to delete
### Example
octodock_do(app:"gmail", action:"delete_draft", params:{draft_id:"r-123456789"})`,
};

function getSkill(action?: string): string | null {
  if (action && ACTION_SKILLS[action]) return ACTION_SKILLS[action];
  if (action) return null; // ACTION_SKILLS 沒有的 action → 回傳 null 讓 server.ts fallback 用 actionMap 自動查
  return `gmail actions:
  search(query, max_results?) — search emails (Gmail search syntax)
  read(message_id) — read full email content
  send(to, subject, body) — send new email
  reply(message_id, body) — reply to email thread
  list_threads(query?, max_results?) — list email threads (conversations)
  get_thread(thread_id) — get all messages in a thread
  draft(to, subject, body) — create draft email
  list_drafts(max_results?) — list all drafts
  get_draft(draft_id) — get draft content
  send_draft(draft_id) — send existing draft
  delete_draft(draft_id) — delete draft permanently
  label_list() — list all labels
  trash(message_id) — move email to trash
  untrash(message_id) — restore email from trash
  archive(message_id) — archive email (remove from Inbox)
  mark_read(message_id) — mark email as read
  mark_unread(message_id) — mark email as unread
  get_attachment(message_id, attachment_id) — download attachment
Use octodock_help(app:"gmail", action:"ACTION") for detailed params + example.`;
}

// ── do+help 架構：格式化回應（將原始資料轉為簡潔文字）────
/* eslint-disable @typescript-eslint/no-explicit-any */
function formatResponse(action: string, rawData: unknown): string {
  if (typeof rawData !== "object" || rawData === null) return String(rawData);
  const data = rawData as Record<string, unknown>;

  switch (action) {
    // 搜尋結果：精簡摘要列表
    // F1: rawData 可能是 { messages: [...], nextPageToken } 或直接是陣列
    case "search": {
      const messages = Array.isArray(rawData) ? rawData : (data.messages as any[]);
      if (!messages || messages.length === 0) return "No emails found.";
      let result = messages.map((e: any) =>
        `- **${e.subject}** from ${e.from} (${e.date})\n  ID: ${e.id} | ${e.snippet}`
      ).join("\n");
      if (data.nextPageToken) result += `\n\n_More results available. Use page_token: "${data.nextPageToken}" to see next page._`;
      return result;
    }
    // 閱讀結果：完整郵件格式（含附件列表）
    case "read": {
      const { subject, from, to, date, body, id, threadId, attachments } = data as any;
      let text = `From: ${from}\nTo: ${to}\nDate: ${date}\nSubject: ${subject}\nThread: ${threadId}\n\n${body}`;
      if (attachments && attachments.length > 0) {
        text += `\n\n--- Attachments (${attachments.length}) ---\n`;
        text += attachments.map((a: any) => `- ${a.filename} (${a.mimeType}, ${a.size} bytes)\n  Use get_attachment(message_id:"${id}", attachment_id:"${a.attachmentId}") to download`).join("\n");
      }
      return text;
    }
    // 發送/回覆/草稿：完成確認
    case "send":
    case "reply":
    case "draft": {
      const msg = data.message as Record<string, unknown> | undefined;
      const id = data.id || msg?.id;
      const threadId = data.threadId || msg?.threadId;
      return `Done. Message ID: ${id}${threadId ? `\nThread ID: ${threadId}` : ""}`;
    }
    // 標籤列表：列出所有標籤名稱
    case "label_list": {
      const labels = (data as any).labels;
      if (!Array.isArray(labels) || labels.length === 0) return "No labels found.";
      return labels.map((l: any) => `- ${l.name} (${l.type}, id: ${l.id})`).join("\n");
    }
    // 移至垃圾桶 / 從垃圾桶還原
    case "trash":
      return `Done. Message ${(data as any).id} moved to trash.`;
    case "untrash":
      return `Done. Message ${(data as any).id} restored from trash.`;
    // 封存郵件
    case "archive":
      return `Done. Message ${(data as any).id} archived.`;
    // 標記已讀 / 未讀
    case "mark_read":
      return `Done. Message ${(data as any).id} marked as read.`;
    case "mark_unread":
      return `Done. Message ${(data as any).id} marked as unread.`;
    // 下載附件
    case "get_attachment": {
      const size = (data as any).size;
      return `Attachment downloaded. Size: ${size ?? "unknown"} bytes. Data included in response.`;
    }
    // 對話串列表
    // F1: rawData 可能是 { threads: [...], nextPageToken } 或直接是陣列
    case "list_threads": {
      const threads = Array.isArray(rawData) ? rawData : (data.threads as any[]);
      if (!threads || threads.length === 0) return "No threads found.";
      let result = threads.map((t: any) =>
        `- **${t.subject}** from ${t.lastFrom} (${t.lastDate})\n  Thread ID: ${t.id} | ${t.messageCount} messages | ${t.snippet}`
      ).join("\n");
      if (data.nextPageToken) result += `\n\n_More results available. Use page_token: "${data.nextPageToken}" to see next page._`;
      return result;
    }
    // 對話串完整內容
    case "get_thread": {
      if (Array.isArray(rawData)) {
        return rawData.map((msg: any, i: number) =>
          `--- Message ${i + 1}/${rawData.length} ---\nFrom: ${msg.from}\nTo: ${msg.to}\nDate: ${msg.date}\nSubject: ${msg.subject}\n\n${msg.body}`
        ).join("\n\n");
      }
      return JSON.stringify(rawData, null, 2);
    }
    // 草稿列表
    case "list_drafts": {
      if (Array.isArray(rawData)) {
        if (rawData.length === 0) return "No drafts found.";
        return rawData.map((d: any) =>
          `- **${d.subject}** to ${d.to}\n  Draft ID: ${d.id} | ${d.snippet}`
        ).join("\n");
      }
      return JSON.stringify(rawData, null, 2);
    }
    // 草稿內容
    case "get_draft": {
      const { subject, from, to, date, body, id } = data as any;
      return `Draft ID: ${id}\nFrom: ${from}\nTo: ${to}\nDate: ${date}\nSubject: ${subject}\n\n${body}`;
    }
    // 發送草稿
    case "send_draft": {
      const msg = data.message as Record<string, unknown> | undefined;
      const id = data.id || msg?.id;
      return `Done. Draft sent. Message ID: ${id}`;
    }
    // 刪除草稿
    case "delete_draft":
      return `Done. Draft deleted.`;
    default:
      return JSON.stringify(rawData, null, 2);
  }
}

// ── MCP 工具定義 ──────────────────────────────────────────
const tools: ToolDefinition[] = [
  {
    name: "gmail_search",
    description:
      "Search emails in user's Gmail inbox. Uses Gmail search syntax (e.g., 'from:someone@example.com', 'subject:meeting', 'is:unread'). Returns a list of matching email summaries.",
    inputSchema: {
      query: z
        .string()
        .describe("Gmail search query (same syntax as Gmail search bar)"),
      max_results: z
        .number()
        .optional()
        .describe("Maximum number of results (default 10, max 50)"),
    },
  },
  {
    name: "gmail_read",
    description:
      "Read the full content of a specific email by its ID. Returns subject, from, to, date, and body text.",
    inputSchema: {
      message_id: z.string().describe("Gmail message ID"),
    },
  },
  {
    name: "gmail_send",
    description:
      "Send a new email from user's Gmail account. Supports plain text content.",
    inputSchema: {
      to: z.string().describe("Recipient email address"),
      subject: z.string().describe("Email subject line"),
      body: z.string().describe("Email body in plain text"),
    },
  },
  {
    name: "gmail_reply",
    description:
      "Reply to an existing email thread. Maintains the thread context and adds Re: prefix if needed.",
    inputSchema: {
      message_id: z.string().describe("Original message ID to reply to"),
      body: z.string().describe("Reply body in plain text"),
    },
  },
  {
    name: "gmail_draft",
    description:
      "Create a draft email in user's Gmail. The draft can be reviewed and sent later from Gmail.",
    inputSchema: {
      to: z.string().describe("Recipient email address"),
      subject: z.string().describe("Email subject line"),
      body: z.string().describe("Email body in plain text"),
    },
  },
  {
    name: "gmail_label_list",
    description:
      "List all labels in user's Gmail account, including system labels (INBOX, SENT, etc.) and custom labels.",
    inputSchema: {},
  },
  {
    name: "gmail_trash",
    description:
      "Move an email to trash. The email can be recovered within 30 days.",
    inputSchema: {
      message_id: z.string().describe("Gmail message ID to trash"),
    },
  },
  {
    name: "gmail_untrash",
    description:
      "Remove an email from trash and restore it to its previous location.",
    inputSchema: {
      message_id: z.string().describe("Gmail message ID to restore from trash"),
    },
  },
  {
    name: "gmail_archive",
    description:
      "Archive an email by removing it from the Inbox. The email remains accessible in All Mail.",
    inputSchema: {
      message_id: z.string().describe("Gmail message ID to archive"),
    },
  },
  {
    name: "gmail_mark_read",
    description:
      "Mark an email as read by removing the UNREAD label.",
    inputSchema: {
      message_id: z.string().describe("Gmail message ID to mark as read"),
    },
  },
  {
    name: "gmail_mark_unread",
    description:
      "Mark an email as unread by adding the UNREAD label.",
    inputSchema: {
      message_id: z.string().describe("Gmail message ID to mark as unread"),
    },
  },
  {
    name: "gmail_get_attachment",
    description:
      "Download an email attachment by its attachment ID. Returns the decoded attachment data.",
    inputSchema: {
      message_id: z.string().describe("Gmail message ID containing the attachment"),
      attachment_id: z.string().describe("Attachment ID (found in message payload parts)"),
    },
  },
  {
    name: "gmail_list_threads",
    description:
      "Search and list email threads (conversations). Each thread groups related emails. Returns thread ID, subject, last sender, date, message count, and snippet.",
    inputSchema: {
      query: z.string().optional().describe("Gmail search query (default: all threads)"),
      max_results: z.number().optional().describe("Maximum number of threads (default 10, max 50)"),
    },
  },
  {
    name: "gmail_get_thread",
    description:
      "Get all messages in an email thread (full conversation). Returns each message's sender, recipient, date, subject, and body text in chronological order.",
    inputSchema: {
      thread_id: z.string().describe("Gmail thread ID (from list_threads or search results)"),
    },
  },
  {
    name: "gmail_list_drafts",
    description:
      "List all draft emails in user's Gmail account. Returns draft ID, subject, recipient, and snippet.",
    inputSchema: {
      max_results: z.number().optional().describe("Maximum number of drafts (default 10, max 50)"),
    },
  },
  {
    name: "gmail_get_draft",
    description:
      "Get the full content of a specific draft email by its draft ID.",
    inputSchema: {
      draft_id: z.string().describe("Gmail draft ID (from list_drafts)"),
    },
  },
  {
    name: "gmail_send_draft",
    description:
      "Send an existing draft email. The draft is removed from drafts and sent immediately.",
    inputSchema: {
      draft_id: z.string().describe("Gmail draft ID to send"),
    },
  },
  {
    name: "gmail_delete_draft",
    description:
      "Permanently delete a draft email. This action cannot be undone.",
    inputSchema: {
      draft_id: z.string().describe("Gmail draft ID to delete"),
    },
  },
];

// ── 工具執行邏輯 ──────────────────────────────────────────
async function execute(
  toolName: string,
  params: Record<string, unknown>,
  token: string,
): Promise<ToolResult> {
  switch (toolName) {
    // 搜尋郵件：使用 Gmail 搜尋語法，並行取得摘要
    // F1: 支援 page_token 分頁
    case "gmail_search": {
      const maxResults = Math.min((params.max_results as number) ?? 10, 50);
      const pageToken = params.page_token ? `&pageToken=${encodeURIComponent(params.page_token as string)}` : "";
      const list = (await gmailFetch(
        `/messages?q=${encodeURIComponent(params.query as string)}&maxResults=${maxResults}${pageToken}`,
        token,
      )) as { messages?: Array<{ id: string }>; nextPageToken?: string };

      if (!list.messages?.length) {
        return { content: [{ type: "text", text: "No emails found." }] };
      }

      // 並行取得每封郵件的摘要資訊
      const summaries = await Promise.all(
        list.messages.map(async (msg) => {
          const full = (await gmailFetch(
            `/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
            token,
          )) as {
            id: string;
            snippet: string;
            payload: { headers: Array<{ name: string; value: string }> };
          };
          return {
            id: full.id,
            subject: getHeader(full.payload.headers, "Subject"),
            from: getHeader(full.payload.headers, "From"),
            date: getHeader(full.payload.headers, "Date"),
            snippet: full.snippet,
          };
        }),
      );

      // F1: 回傳帶 nextPageToken，讓 AI 可以翻頁
      const response: Record<string, unknown> = { messages: summaries };
      if (list.nextPageToken) response.nextPageToken = list.nextPageToken;
      return {
        content: [
          { type: "text", text: JSON.stringify(response, null, 2) },
        ],
      };
    }

    // 閱讀郵件：取得完整郵件內容（標頭 + 純文字本文）
    case "gmail_read": {
      const msg = (await gmailFetch(
        `/messages/${params.message_id}?format=full`,
        token,
      )) as {
        id: string;
        threadId: string;
        payload: {
          headers: Array<{ name: string; value: string }>;
        } & Record<string, unknown>;
      };

      const headers = msg.payload.headers;
      const body = extractText(msg.payload);

      // 提取附件資訊（讓 AI 知道有附件可下載）
      const attachments = extractAttachments(msg.payload);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                id: msg.id,
                threadId: msg.threadId,
                subject: getHeader(headers, "Subject"),
                from: getHeader(headers, "From"),
                to: getHeader(headers, "To"),
                date: getHeader(headers, "Date"),
                body,
                ...(attachments.length > 0 ? { attachments } : {}),
              },
              null,
              2,
            ),
          },
        ],
      };
    }

    // 發送郵件：建構 RFC 2822 格式並透過 API 發送
    case "gmail_send": {
      const raw = buildRawEmail(
        params.to as string,
        params.subject as string,
        params.body as string,
      );
      const result = await gmailFetch("/messages/send", token, {
        method: "POST",
        body: JSON.stringify({ raw }),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 回覆郵件：取得原始郵件的 thread 資訊，維持對話脈絡
    case "gmail_reply": {
      // 取得原始郵件的 thread 上下文
      const original = (await gmailFetch(
        `/messages/${params.message_id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Message-ID`,
        token,
      )) as {
        id: string;
        threadId: string;
        payload: { headers: Array<{ name: string; value: string }> };
      };

      const subject = getHeader(original.payload.headers, "Subject");
      const from = getHeader(original.payload.headers, "From");
      const messageId = getHeader(original.payload.headers, "Message-ID");

      const raw = buildRawEmail(
        from,
        subject.startsWith("Re:") ? subject : `Re: ${subject}`,
        params.body as string,
        {
          "In-Reply-To": messageId,
          References: messageId,
        },
      );

      const result = await gmailFetch("/messages/send", token, {
        method: "POST",
        body: JSON.stringify({ raw, threadId: original.threadId }),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 建立草稿：儲存為草稿，稍後可在 Gmail 中編輯發送
    case "gmail_draft": {
      const raw = buildRawEmail(
        params.to as string,
        params.subject as string,
        params.body as string,
      );
      const result = await gmailFetch("/drafts", token, {
        method: "POST",
        body: JSON.stringify({ message: { raw } }),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 列出所有標籤：取得系統標籤和自訂標籤
    case "gmail_label_list": {
      const result = await gmailFetch("/labels", token);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 移至垃圾桶：將郵件標記為垃圾（30 天後自動刪除）
    case "gmail_trash": {
      const result = await gmailFetch(
        `/messages/${params.message_id}/trash`,
        token,
        { method: "POST" },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 從垃圾桶還原：將郵件移出垃圾桶
    case "gmail_untrash": {
      const result = await gmailFetch(
        `/messages/${params.message_id}/untrash`,
        token,
        { method: "POST" },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 封存郵件：移除 INBOX 標籤，郵件仍在「所有郵件」中
    case "gmail_archive": {
      const result = await gmailFetch(
        `/messages/${params.message_id}/modify`,
        token,
        {
          method: "POST",
          body: JSON.stringify({ removeLabelIds: ["INBOX"] }),
        },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 標記已讀：移除 UNREAD 標籤
    case "gmail_mark_read": {
      const result = await gmailFetch(
        `/messages/${params.message_id}/modify`,
        token,
        {
          method: "POST",
          body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
        },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 標記未讀：加上 UNREAD 標籤
    case "gmail_mark_unread": {
      const result = await gmailFetch(
        `/messages/${params.message_id}/modify`,
        token,
        {
          method: "POST",
          body: JSON.stringify({ addLabelIds: ["UNREAD"] }),
        },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 對話串列表：搜尋並列出對話串
    // F1: 支援 page_token 分頁
    case "gmail_list_threads": {
      const maxResults = Math.min((params.max_results as number) ?? 10, 50);
      const query = (params.query as string) ?? "";
      const qParam = query ? `&q=${encodeURIComponent(query)}` : "";
      const pageToken = params.page_token ? `&pageToken=${encodeURIComponent(params.page_token as string)}` : "";
      const list = (await gmailFetch(
        `/threads?maxResults=${maxResults}${qParam}${pageToken}`,
        token,
      )) as { threads?: Array<{ id: string; snippet: string }>; nextPageToken?: string };

      if (!list.threads?.length) {
        return { content: [{ type: "text", text: "No threads found." }] };
      }

      // 並行取得每個 thread 的摘要（第一封信的 Subject + 最後一封的 From/Date + 訊息數）
      const summaries = await Promise.all(
        list.threads.map(async (t) => {
          const thread = (await gmailFetch(
            `/threads/${t.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
            token,
          )) as {
            id: string;
            snippet: string;
            messages: Array<{ payload: { headers: Array<{ name: string; value: string }> } }>;
          };
          const first = thread.messages[0];
          const last = thread.messages[thread.messages.length - 1];
          return {
            id: thread.id,
            subject: getHeader(first.payload.headers, "Subject"),
            lastFrom: getHeader(last.payload.headers, "From"),
            lastDate: getHeader(last.payload.headers, "Date"),
            messageCount: thread.messages.length,
            snippet: thread.snippet,
          };
        }),
      );

      // F1: 回傳帶 nextPageToken
      const threadResponse: Record<string, unknown> = { threads: summaries };
      if (list.nextPageToken) threadResponse.nextPageToken = list.nextPageToken;
      return {
        content: [{ type: "text", text: JSON.stringify(threadResponse, null, 2) }],
      };
    }

    // 對話串完整內容：取得 thread 中的所有訊息
    case "gmail_get_thread": {
      const thread = (await gmailFetch(
        `/threads/${params.thread_id}?format=full`,
        token,
      )) as {
        id: string;
        messages: Array<{
          id: string;
          payload: { headers: Array<{ name: string; value: string }> } & Record<string, unknown>;
        }>;
      };

      // 解析每封訊息的內容
      const messages = thread.messages.map((msg) => {
        const headers = msg.payload.headers;
        return {
          id: msg.id,
          subject: getHeader(headers, "Subject"),
          from: getHeader(headers, "From"),
          to: getHeader(headers, "To"),
          date: getHeader(headers, "Date"),
          body: extractText(msg.payload),
        };
      });

      return {
        content: [{ type: "text", text: JSON.stringify(messages, null, 2) }],
      };
    }

    // 草稿列表：列出所有草稿
    case "gmail_list_drafts": {
      const maxResults = Math.min((params.max_results as number) ?? 10, 50);
      const list = (await gmailFetch(
        `/drafts?maxResults=${maxResults}`,
        token,
      )) as { drafts?: Array<{ id: string; message: { id: string } }> };

      if (!list.drafts?.length) {
        return { content: [{ type: "text", text: "No drafts found." }] };
      }

      // 並行取得每個草稿的摘要
      const summaries = await Promise.all(
        list.drafts.map(async (d) => {
          const draft = (await gmailFetch(
            `/drafts/${d.id}`,
            token,
          )) as {
            id: string;
            message: {
              id: string;
              snippet: string;
              payload: { headers: Array<{ name: string; value: string }> };
            };
          };
          return {
            id: draft.id,
            subject: getHeader(draft.message.payload.headers, "Subject"),
            to: getHeader(draft.message.payload.headers, "To"),
            snippet: draft.message.snippet,
          };
        }),
      );

      return {
        content: [{ type: "text", text: JSON.stringify(summaries, null, 2) }],
      };
    }

    // 取得草稿內容
    case "gmail_get_draft": {
      const draft = (await gmailFetch(
        `/drafts/${params.draft_id}`,
        token,
      )) as {
        id: string;
        message: {
          id: string;
          payload: { headers: Array<{ name: string; value: string }> } & Record<string, unknown>;
        };
      };

      const headers = draft.message.payload.headers;
      const body = extractText(draft.message.payload);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            id: draft.id,
            subject: getHeader(headers, "Subject"),
            from: getHeader(headers, "From"),
            to: getHeader(headers, "To"),
            date: getHeader(headers, "Date"),
            body,
          }, null, 2),
        }],
      };
    }

    // 發送草稿：將草稿直接寄出
    case "gmail_send_draft": {
      const result = await gmailFetch("/drafts/send", token, {
        method: "POST",
        body: JSON.stringify({ id: params.draft_id }),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 刪除草稿：永久刪除（API 回傳 204 No Content）
    case "gmail_delete_draft": {
      const res = await fetch(`${GMAIL_API}/drafts/${params.draft_id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: { message: res.statusText } }));
        throw new Error(`Gmail API error: ${(error as { error: { message: string } }).error.message} (GMAIL_API_ERROR)`);
      }
      return {
        content: [{ type: "text", text: JSON.stringify({ deleted: true }) }],
      };
    }

    // 下載附件：取得附件資料並解碼 base64url
    case "gmail_get_attachment": {
      const result = (await gmailFetch(
        `/messages/${params.message_id}/attachments/${params.attachment_id}`,
        token,
      )) as { size: number; data: string };
      // 將 base64url 編碼的附件資料解碼
      const decoded = Buffer.from(result.data, "base64url").toString("base64");
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { size: result.size, data: decoded },
              null,
              2,
            ),
          },
        ],
      };
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
        isError: true,
      };
  }
}

// ── Token 刷新：使用 refresh_token 取得新的 access_token ─
async function refreshGmailToken(refreshToken: string): Promise<TokenSet> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    }).toString(),
  });

  if (!res.ok) {
    throw new Error(`Gmail token refresh failed (GMAIL_REFRESH_FAILED)`);
  }

  const data = await res.json();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? refreshToken, // Google may not return new refresh_token
    expires_in: data.expires_in,
  };
}

// ── 錯誤格式化：攔截常見 API 錯誤，回傳雙語提示 ────────
function formatError(action: string, errorMessage: string): string | null {
  const msg = errorMessage.toLowerCase();
  if (msg.includes("invalid_grant") || msg.includes("token")) return "「Gmail 授權已過期 (TOKEN_EXPIRED)」— 請到 Dashboard 重新連結 Gmail";
  if (msg.includes("invalid id") || msg.includes("not found") || msg.includes("404"))
    return "「找不到這封郵件 (NOT_FOUND)」— 請確認 message_id 是否正確。可用 octodock_do(app:\"gmail\", action:\"search\") 搜尋";
  if (msg.includes("rate") || msg.includes("quota") || msg.includes("429"))
    return "「Gmail API 請求過於頻繁 (RATE_LIMITED)」— 請稍後 30 秒再試";
  if (msg.includes("forbidden") || msg.includes("insufficient") || msg.includes("403"))
    return "「權限不足 (PERMISSION_DENIED)」— 請到 Dashboard 重新連結 Gmail 以取得所需權限";
  if (msg.includes("invalid") || msg.includes("400"))
    return `「參數格式錯誤 (INVALID_PARAMS)」— ${errorMessage}。Use octodock_help(app:"gmail", action:"${action}") 查看正確格式`;
  return null;
}

// ── Adapter 匯出 ─────────────────────────────────────────
export const gmailAdapter: AppAdapter = {
  name: "gmail",
  displayName: { zh: "Gmail", en: "Gmail" },
  icon: "gmail",
  authType: "oauth2",
  authConfig,
  actionMap,
  getSkill,
  formatResponse,
  formatError,
  tools,
  execute,
  refreshToken: refreshGmailToken,
};
