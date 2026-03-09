import { z } from "zod";
import type {
  AppAdapter,
  OAuthConfig,
  ToolDefinition,
  ToolResult,
  TokenSet,
} from "./types";

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

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

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

// Decode base64url email body
function decodeBody(body: string): string {
  return Buffer.from(body, "base64url").toString("utf8");
}

// Build RFC 2822 email message
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

// Extract plain text from message parts
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

// Extract header value
function getHeader(
  headers: Array<{ name: string; value: string }>,
  name: string,
): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

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
];

async function execute(
  toolName: string,
  params: Record<string, unknown>,
  token: string,
): Promise<ToolResult> {
  switch (toolName) {
    case "gmail_search": {
      const maxResults = Math.min((params.max_results as number) ?? 10, 50);
      const list = (await gmailFetch(
        `/messages?q=${encodeURIComponent(params.query as string)}&maxResults=${maxResults}`,
        token,
      )) as { messages?: Array<{ id: string }> };

      if (!list.messages?.length) {
        return { content: [{ type: "text", text: "No emails found." }] };
      }

      // Fetch summaries in parallel
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

    case "gmail_reply": {
      // Get original message for thread context
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

    default:
      return {
        content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
        isError: true,
      };
  }
}

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

export const gmailAdapter: AppAdapter = {
  name: "gmail",
  displayName: { zh: "Gmail", en: "Gmail" },
  icon: "gmail",
  authType: "oauth2",
  authConfig,
  tools,
  execute,
  refreshToken: refreshGmailToken,
};
