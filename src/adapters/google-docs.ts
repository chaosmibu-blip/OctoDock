/**
 * Google Docs Adapter
 * 提供 Google Docs 文件的建立、讀取、插入文字、取代文字、追加文字、刪除文字、插入表格功能
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
  scopes: ["https://www.googleapis.com/auth/documents"],
  authMethod: "post",
  extraParams: { access_type: "offline", prompt: "consent" },
};

// ── API 基礎設定 ───────────────────────────────────────────
const DOCS_API = "https://docs.googleapis.com/v1/documents";

// ── 輔助函式：Google Docs API 請求封裝 ─────────────────────
async function docsFetch(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<unknown> {
  const url = path.startsWith("http") ? path : `${DOCS_API}${path}`;
  const res = await fetch(url, {
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
      `Google Docs API error: ${(error as { error: { message: string } }).error.message} (GDOCS_API_ERROR)`,
    );
  }
  return res.json();
}

// ── do+help 架構：動作對照表 ──────────────────────────────
const actionMap: Record<string, string> = {
  create: "gdocs_create",
  get: "gdocs_get",
  insert_text: "gdocs_insert_text",
  replace_text: "gdocs_replace_text",
  append_text: "gdocs_append_text",
  delete_text: "gdocs_delete_text",
  insert_table: "gdocs_insert_table",
};

// ── do+help 架構：技能描述（供 agent 理解可用操作）────────
const ACTION_SKILLS: Record<string, string> = {
  create: `## google_docs.create
Create a new Google Document with a given title.
### Parameters
  title: Document title
### Example
octodock_do(app:"google_docs", action:"create", params:{title:"Meeting Notes 2026-03-14"})`,

  get: `## google_docs.get
Get document content as plain text.
### Parameters
  documentId: Google Document ID (from URL or create result)
### Example
octodock_do(app:"google_docs", action:"get", params:{documentId:"1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"})`,

  insert_text: `## google_docs.insert_text
Insert text at a specific position (index) in the document.
### Parameters
  documentId: Google Document ID
  text: Text to insert
  index: Position index (1 = beginning of document)
### Example
octodock_do(app:"google_docs", action:"insert_text", params:{documentId:"1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms", text:"Hello World\\n", index:1})`,

  replace_text: `## google_docs.replace_text
Find and replace all occurrences of text in the document.
### Parameters
  documentId: Google Document ID
  findText: Text to find
  replaceText: Text to replace with
  matchCase: Whether to match case (default: true)
### Example
octodock_do(app:"google_docs", action:"replace_text", params:{documentId:"1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms", findText:"draft", replaceText:"final", matchCase:true})`,

  append_text: `## google_docs.append_text
Append text at the end of the document.
### Parameters
  documentId: Google Document ID
  text: Text to append
### Example
octodock_do(app:"google_docs", action:"append_text", params:{documentId:"1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms", text:"\\nAppended paragraph."})`,

  delete_text: `## google_docs.delete_text
Delete text in a range specified by start and end index.
### Parameters
  document_id: Google Document ID
  start_index: Start position index
  end_index: End position index
### Example
octodock_do(app:"google_docs", action:"delete_text", params:{document_id:"1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms", start_index:1, end_index:10})`,

  insert_table: `## google_docs.insert_table
Insert a table at a specific position in the document.
### Parameters
  document_id: Google Document ID
  rows: Number of rows
  columns: Number of columns
  index: Position index where to insert the table
### Example
octodock_do(app:"google_docs", action:"insert_table", params:{document_id:"1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms", rows:3, columns:4, index:1})`,
};

function getSkill(action?: string): string {
  if (action && ACTION_SKILLS[action]) return ACTION_SKILLS[action];
  if (action) return `Action "${action}" not found. Available: ${Object.keys(ACTION_SKILLS).join(", ")}`;
  return `google_docs actions (${Object.keys(actionMap).length}):
  create(title) — create new document
  get(documentId) — get document content as plain text
  insert_text(documentId, text, index) — insert text at position
  replace_text(documentId, findText, replaceText, matchCase) — find and replace text
  append_text(documentId, text) — append text at end of document
  delete_text(document_id, start_index, end_index) — delete text in range
  insert_table(document_id, rows, columns, index) — insert table at position
Use octodock_help(app:"google_docs", action:"ACTION") for detailed params + example.`;
}

// ── 輔助函式：從文件 body 提取純文字 ──────────────────────
/* eslint-disable @typescript-eslint/no-explicit-any */
function extractPlainText(body: any): string {
  if (!body || !body.content) return "";
  const parts: string[] = [];
  for (const element of body.content) {
    // 每個結構元素可能包含段落
    if (element.paragraph && element.paragraph.elements) {
      for (const el of element.paragraph.elements) {
        // 每個段落元素可能包含文字片段
        if (el.textRun && el.textRun.content) {
          parts.push(el.textRun.content);
        }
      }
    }
  }
  return parts.join("");
}

// ── 格式化回應：將原始資料轉為 AI 友善格式 ─────────────────
function formatResponse(action: string, rawData: unknown): string {
  if (typeof rawData !== "object" || rawData === null) return String(rawData);
  const data = rawData as Record<string, unknown>;

  switch (action) {
    // 建立文件：回傳標題、ID、連結
    case "create": {
      const id = data.documentId as string | undefined;
      const title = data.title as string | undefined;
      return `Done. Title: ${title ?? "Untitled"}, ID: ${id}, URL: https://docs.google.com/document/d/${id}/edit`;
    }

    // 取得文件內容：提取純文字
    case "get": {
      const title = data.title as string | undefined;
      const body = data.body as any;
      const text = extractPlainText(body);
      if (!text.trim()) return `**${title ?? "Untitled"}**\n\n(empty document)`;
      return `**${title ?? "Untitled"}**\n\n${text}`;
    }

    // 插入文字 / 取代文字 / 追加文字 / 刪除文字 / 插入表格：簡潔確認
    case "insert_text":
    case "replace_text":
    case "append_text":
    case "delete_text":
    case "insert_table":
      return "Done.";

    default:
      return JSON.stringify(rawData, null, 2);
  }
}

// ── 智慧錯誤引導 ──────────────────────────────────────────
function docsFormatError(action: string, errorMessage: string): string | null {
  const msg = errorMessage.toLowerCase();

  // 找不到文件
  if (msg.includes("not found") || msg.includes("could not find")) {
    return `找不到指定的文件。請確認：1) documentId 是否正確 2) 該文件是否已與 Google 帳號共享 (GDOCS_NOT_FOUND)`;
  }

  // 權限不足
  if (msg.includes("forbidden") || msg.includes("insufficient permission") || msg.includes("403")) {
    return `權限不足。請確認：1) Google Docs 已授權給 OctoDock 2) 您對該文件有編輯權限 (GDOCS_FORBIDDEN)`;
  }

  // 無效請求（例如 index 超出範圍）
  if (msg.includes("invalid") || msg.includes("bad request") || msg.includes("400")) {
    return `請求格式錯誤。請確認參數是否正確，例如 index 是否在文件範圍內。 (GDOCS_INVALID_REQUEST)`;
  }

  // Token 過期
  if (msg.includes("invalid_grant") || msg.includes("token has been expired")) {
    return `Google 授權已過期，請重新連結 Google Docs。 (GDOCS_TOKEN_EXPIRED)`;
  }

  // Rate limit
  if (msg.includes("rate limit") || msg.includes("quota")) {
    return `Google Docs API 配額已用盡。請稍後再試。 (GDOCS_RATE_LIMIT)`;
  }

  return null;
}

// ── MCP 工具定義 ──────────────────────────────────────────
const tools: ToolDefinition[] = [
  {
    name: "gdocs_create",
    description:
      "Create a new Google Document with a given title. Returns the document ID and URL.",
    inputSchema: {
      title: z.string().describe("Document title"),
    },
  },
  {
    name: "gdocs_get",
    description:
      "Get document content as plain text. Extracts all text from the document body.",
    inputSchema: {
      documentId: z.string().describe("Google Document ID"),
    },
  },
  {
    name: "gdocs_insert_text",
    description:
      "Insert text at a specific position in the document. Use index 1 for the beginning.",
    inputSchema: {
      documentId: z.string().describe("Google Document ID"),
      text: z.string().describe("Text to insert"),
      index: z.number().describe("Position index (1 = beginning of document)"),
    },
  },
  {
    name: "gdocs_replace_text",
    description:
      "Find and replace all occurrences of text in the document.",
    inputSchema: {
      documentId: z.string().describe("Google Document ID"),
      findText: z.string().describe("Text to find"),
      replaceText: z.string().describe("Text to replace with"),
      matchCase: z.boolean().optional().default(true).describe("Whether to match case (default: true)"),
    },
  },
  {
    name: "gdocs_append_text",
    description:
      "Append text at the end of the document.",
    inputSchema: {
      documentId: z.string().describe("Google Document ID"),
      text: z.string().describe("Text to append"),
    },
  },
  // 刪除文字
  {
    name: "gdocs_delete_text",
    description:
      "Delete text in a specified range (by start and end index) from the document.",
    inputSchema: {
      document_id: z.string().describe("Google Document ID"),
      start_index: z.number().describe("Start position index"),
      end_index: z.number().describe("End position index"),
    },
  },
  // 插入表格
  {
    name: "gdocs_insert_table",
    description:
      "Insert a table with specified rows and columns at a given position in the document.",
    inputSchema: {
      document_id: z.string().describe("Google Document ID"),
      rows: z.number().describe("Number of rows"),
      columns: z.number().describe("Number of columns"),
      index: z.number().describe("Position index where to insert the table"),
    },
  },
];

// ── 輔助函式：取得文件末尾的 index ────────────────────────
async function getDocumentEndIndex(
  documentId: string,
  token: string,
): Promise<number> {
  // 取得文件以獲取 body.content 的最後位置
  const doc = (await docsFetch(`/${documentId}`, token)) as Record<string, any>;
  const body = doc.body;
  if (!body || !body.content || body.content.length === 0) return 1;
  // 文件最後一個結構元素的 endIndex - 1 就是可插入的位置
  const lastElement = body.content[body.content.length - 1];
  return (lastElement.endIndex as number) - 1;
}

// ── 工具執行邏輯 ──────────────────────────────────────────
async function execute(
  toolName: string,
  params: Record<string, unknown>,
  token: string,
): Promise<ToolResult> {
  switch (toolName) {
    // 建立新文件
    case "gdocs_create": {
      const result = await docsFetch("", token, {
        method: "POST",
        body: JSON.stringify({
          title: params.title as string,
        }),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 取得文件內容
    case "gdocs_get": {
      const documentId = params.documentId as string;
      const result = await docsFetch(`/${documentId}`, token);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 在指定位置插入文字
    case "gdocs_insert_text": {
      const documentId = params.documentId as string;
      const text = params.text as string;
      const index = params.index as number;
      const result = await docsFetch(`/${documentId}:batchUpdate`, token, {
        method: "POST",
        body: JSON.stringify({
          requests: [
            {
              insertText: {
                text,
                location: { index },
              },
            },
          ],
        }),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 全文尋找與取代
    case "gdocs_replace_text": {
      const documentId = params.documentId as string;
      const findText = params.findText as string;
      const replaceText = params.replaceText as string;
      const matchCase = (params.matchCase as boolean) ?? true;
      const result = await docsFetch(`/${documentId}:batchUpdate`, token, {
        method: "POST",
        body: JSON.stringify({
          requests: [
            {
              replaceAllText: {
                containsText: {
                  text: findText,
                  matchCase,
                },
                replaceText,
              },
            },
          ],
        }),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 在文件末尾追加文字
    case "gdocs_append_text": {
      const documentId = params.documentId as string;
      const text = params.text as string;
      // 先取得文件末尾的 index
      const endIndex = await getDocumentEndIndex(documentId, token);
      const result = await docsFetch(`/${documentId}:batchUpdate`, token, {
        method: "POST",
        body: JSON.stringify({
          requests: [
            {
              insertText: {
                text,
                location: { index: endIndex },
              },
            },
          ],
        }),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 刪除指定範圍的文字
    case "gdocs_delete_text": {
      const documentId = params.document_id as string;
      const startIndex = params.start_index as number;
      const endIndex = params.end_index as number;
      const result = await docsFetch(`/${documentId}:batchUpdate`, token, {
        method: "POST",
        body: JSON.stringify({
          requests: [
            {
              deleteContentRange: {
                range: { startIndex, endIndex },
              },
            },
          ],
        }),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 插入表格
    case "gdocs_insert_table": {
      const documentId = params.document_id as string;
      const rows = params.rows as number;
      const columns = params.columns as number;
      const index = params.index as number;
      const result = await docsFetch(`/${documentId}:batchUpdate`, token, {
        method: "POST",
        body: JSON.stringify({
          requests: [
            {
              insertTable: {
                rows,
                columns,
                location: { index },
              },
            },
          ],
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

// ── Token 刷新：使用 refresh_token 取得新的 access_token ─
async function refreshDocsToken(refreshToken: string): Promise<TokenSet> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env.GDOCS_OAUTH_CLIENT_ID!,
      client_secret: process.env.GDOCS_OAUTH_CLIENT_SECRET!,
    }).toString(),
  });

  if (!res.ok) {
    throw new Error(`Google Docs token refresh failed (GDOCS_REFRESH_FAILED)`);
  }

  const data = await res.json();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? refreshToken, // Google 不一定回傳新的 refresh_token
    expires_in: data.expires_in,
  };
}

// ── Adapter 匯出 ─────────────────────────────────────────
export const googleDocsAdapter: AppAdapter = {
  name: "google_docs",
  displayName: { zh: "Google 文件", en: "Google Docs" },
  icon: "google-docs",
  authType: "oauth2",
  authConfig,
  actionMap,
  getSkill,
  formatResponse,
  formatError: docsFormatError,
  tools,
  execute,
  refreshToken: refreshDocsToken,
};
