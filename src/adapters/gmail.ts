/**
 * Gmail Adapter
 * 提供 Gmail 郵件搜尋、閱讀、發送、回覆、草稿、標籤管理、封存、垃圾桶、已讀/未讀、附件下載功能
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

// ── 輔助函式：建構 RFC 2822 格式郵件 ─────────────────────
function buildRawEmail(
  to: string,
  subject: string,
  body: string,
  headers?: Record<string, string>,
): string {
  const lines = [
    `To: ${to}`,
    `Subject: ${subject}`,
    ...Object.entries(headers ?? {}).map(([k, v]) => `${k}: ${v}`),
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
  ];
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

// ── 輔助函式：從郵件結構中提取純文字內容 ──────────────────
function extractText(payload: Record<string, unknown>): string {
  if (
    (payload as { mimeType?: string }).mimeType === "text/plain" &&
    (payload as { body?: { data?: string } }).body?.data
  ) {
    return decodeBody(
      (payload as { body: { data: string } }).body.data,
    );
  }
  const parts = (payload as { parts?: Array<Record<string, unknown>> }).parts;
  if (parts) {
    for (const part of parts) {
      const text = extractText(part);
      if (text) return text;
    }
  }
  return "";
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
};

function getSkill(action?: string): string {
  if (action && ACTION_SKILLS[action]) return ACTION_SKILLS[action];
  if (action) return `Action "${action}" not found. Available: ${Object.keys(ACTION_SKILLS).join(", ")}`;
  return `gmail actions:
  search(query, max_results?) — search emails (Gmail search syntax)
  read(message_id) — read full email content
  send(to, subject, body) — send new email
  reply(message_id, body) — reply to email thread
  draft(to, subject, body) — create draft email
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
    case "search": {
      if (Array.isArray(rawData)) {
        if (rawData.length === 0) return "No emails found.";
        return rawData.map((e: any) =>
          `- **${e.subject}** from ${e.from} (${e.date})\n  ID: ${e.id} | ${e.snippet}`
        ).join("\n");
      }
      return String(rawData);
    }
    // 閱讀結果：完整郵件格式
    case "read": {
      const { subject, from, to, date, body, id, threadId } = data as any;
      return `From: ${from}\nTo: ${to}\nDate: ${date}\nSubject: ${subject}\nThread: ${threadId}\n\n${body}`;
    }
    // 發送/回覆/草稿：完成確認
    case "send":
    case "reply":
    case "draft": {
      const msg = data.message as Record<string, unknown> | undefined;
      const id = data.id || msg?.id;
      return `Done. Message ID: ${id}`;
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
];

// ── 工具執行邏輯 ──────────────────────────────────────────
async function execute(
  toolName: string,
  params: Record<string, unknown>,
  token: string,
): Promise<ToolResult> {
  switch (toolName) {
    // 搜尋郵件：使用 Gmail 搜尋語法，並行取得摘要
    case "gmail_search": {
      const maxResults = Math.min((params.max_results as number) ?? 10, 50);
      const list = (await gmailFetch(
        `/messages?q=${encodeURIComponent(params.query as string)}&maxResults=${maxResults}`,
        token,
      )) as { messages?: Array<{ id: string }> };

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

      return {
        content: [
          { type: "text", text: JSON.stringify(summaries, null, 2) },
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
      client_id: process.env.GMAIL_OAUTH_CLIENT_ID!,
      client_secret: process.env.GMAIL_OAUTH_CLIENT_SECRET!,
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
  if (msg.includes("invalid_grant") || msg.includes("token")) return "Gmail token 已過期。請到 Dashboard 重新連結 Gmail。";
  if (msg.includes("not found")) return "找不到指定的郵件。請確認 message_id 是否正確。";
  if (msg.includes("rate") || msg.includes("quota")) return "Gmail API 速率限制。請稍後再試。";
  if (msg.includes("forbidden") || msg.includes("insufficient")) return "權限不足。請確認 Gmail OAuth 包含必要的 scope（readonly, send, compose, modify）。";
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
