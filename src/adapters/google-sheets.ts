/**
 * Google Sheets Adapter
 * 提供 Google Sheets 試算表的建立、讀取、寫入、追加、清除功能
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
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  authMethod: "post",
};

// ── API 基礎設定 ───────────────────────────────────────────
const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

// ── 輔助函式：Google Sheets API 請求封裝 ───────────────────
async function sheetsFetch(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<unknown> {
  const url = path.startsWith("http") ? path : `${SHEETS_API}${path}`;
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
      `Google Sheets API error: ${(error as { error: { message: string } }).error.message} (GSHEETS_API_ERROR)`,
    );
  }
  return res.json();
}

// ── do+help 架構：動作對照表 ──────────────────────────────
const actionMap: Record<string, string> = {
  create: "gsheets_create",
  get: "gsheets_get",
  read: "gsheets_read",
  write: "gsheets_write",
  append: "gsheets_append",
  clear: "gsheets_clear",
};

// ── do+help 架構：技能描述（供 agent 理解可用操作）────────
const ACTION_SKILLS: Record<string, string> = {
  create: `## google_sheets.create
Create a new spreadsheet.
### Parameters
  title: Spreadsheet title
### Example
octodock_do(app:"google_sheets", action:"create", params:{title:"Sales Report 2026"})`,

  get: `## google_sheets.get
Get spreadsheet metadata (sheet names, titles, sheet count).
### Parameters
  spreadsheetId: Spreadsheet ID (from URL or create result)
### Example
octodock_do(app:"google_sheets", action:"get", params:{spreadsheetId:"1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"})`,

  read: `## google_sheets.read
Read cell values from a range.
### Parameters
  spreadsheetId: Spreadsheet ID
  range: A1 notation range (e.g. "Sheet1!A1:D10", "Sheet1!A:A")
### Example
octodock_do(app:"google_sheets", action:"read", params:{spreadsheetId:"1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms", range:"Sheet1!A1:D10"})`,

  write: `## google_sheets.write
Write cell values to a range (overwrites existing data).
### Parameters
  spreadsheetId: Spreadsheet ID
  range: A1 notation range (e.g. "Sheet1!A1:C3")
  values: 2D array of values (rows × columns)
### Example
octodock_do(app:"google_sheets", action:"write", params:{
  spreadsheetId:"1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms",
  range:"Sheet1!A1:C2",
  values:[["Name","Age","City"],["Alice",30,"Taipei"]]
})`,

  append: `## google_sheets.append
Append rows after existing data in a range.
### Parameters
  spreadsheetId: Spreadsheet ID
  range: A1 notation range to append after (e.g. "Sheet1!A:C")
  values: 2D array of rows to append
### Example
octodock_do(app:"google_sheets", action:"append", params:{
  spreadsheetId:"1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms",
  range:"Sheet1!A:C",
  values:[["Bob",25,"Kaohsiung"],["Carol",28,"Taichung"]]
})`,

  clear: `## google_sheets.clear
Clear cell values in a range (keeps formatting).
### Parameters
  spreadsheetId: Spreadsheet ID
  range: A1 notation range to clear (e.g. "Sheet1!A1:D10")
### Example
octodock_do(app:"google_sheets", action:"clear", params:{spreadsheetId:"1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms", range:"Sheet1!A1:D10"})`,
};

function getSkill(action?: string): string {
  if (action && ACTION_SKILLS[action]) return ACTION_SKILLS[action];
  if (action) return `Action "${action}" not found. Available: ${Object.keys(ACTION_SKILLS).join(", ")}`;
  return `google_sheets actions (6):
  create(title) — create new spreadsheet
  get(spreadsheetId) — get spreadsheet metadata (sheet names)
  read(spreadsheetId, range) — read cell values (returns markdown table)
  write(spreadsheetId, range, values) — write cell values (2D array)
  append(spreadsheetId, range, values) — append rows after existing data
  clear(spreadsheetId, range) — clear cell values
Use octodock_help(app:"google_sheets", action:"ACTION") for detailed params + example.`;
}

// ── 格式化回應：將原始資料轉為 AI 友善格式 ─────────────────
/* eslint-disable @typescript-eslint/no-explicit-any */
function formatResponse(action: string, rawData: unknown): string {
  if (typeof rawData !== "object" || rawData === null) return String(rawData);
  const data = rawData as Record<string, unknown>;

  switch (action) {
    // 建立試算表：回傳連結
    case "create": {
      const id = data.spreadsheetId as string | undefined;
      const url = data.spreadsheetUrl as string | undefined;
      const title = (data.properties as any)?.title as string | undefined;
      return `Done. "${title ?? "Untitled"}" created.\nID: ${id}\nURL: ${url ?? `https://docs.google.com/spreadsheets/d/${id}`}`;
    }

    // 取得試算表資訊：列出所有工作表名稱
    case "get": {
      const title = (data.properties as any)?.title as string | undefined;
      const sheets = data.sheets as Array<{ properties: { title: string; sheetId: number; index: number } }> | undefined;
      const lines: string[] = [];
      lines.push(`**${title ?? "Untitled"}**`);
      lines.push(`ID: ${data.spreadsheetId}`);
      if (sheets && sheets.length > 0) {
        lines.push(`\nSheets (${sheets.length}):`);
        for (const s of sheets) {
          lines.push(`- ${s.properties.title} (id: ${s.properties.sheetId})`);
        }
      }
      return lines.join("\n");
    }

    // 讀取儲存格：轉為 Markdown 表格
    case "read": {
      const values = data.values as string[][] | undefined;
      if (!values || values.length === 0) return "No data in range.";

      // 第一列當表頭，其餘為資料列
      const header = values[0];
      const rows = values.slice(1);

      const headerLine = `| ${header.join(" | ")} |`;
      const separatorLine = `| ${header.map(() => "---").join(" | ")} |`;

      const dataLines = rows.map((row) => {
        // 補齊欄位數量以對齊表頭
        const paddedRow = header.map((_, i) => row[i] ?? "");
        return `| ${paddedRow.join(" | ")} |`;
      });

      return [headerLine, separatorLine, ...dataLines].join("\n");
    }

    // 寫入/追加/清除：簡潔確認
    case "write": {
      const updatedRange = data.updatedRange as string | undefined;
      const updatedCells = data.updatedCells as number | undefined;
      return `Done. Updated ${updatedCells ?? "?"} cells in ${updatedRange ?? "range"}.`;
    }

    case "append": {
      const tableRange = data.tableRange as string | undefined;
      const updates = data.updates as { updatedRows?: number; updatedRange?: string } | undefined;
      return `Done. Appended ${updates?.updatedRows ?? "?"} rows after ${tableRange ?? "range"}.`;
    }

    case "clear": {
      const clearedRange = data.clearedRange as string | undefined;
      return `Done. Cleared ${clearedRange ?? "range"}.`;
    }

    default:
      return JSON.stringify(rawData, null, 2);
  }
}

// ── 智慧錯誤引導 ──────────────────────────────────────────
function sheetsFormatError(action: string, errorMessage: string): string | null {
  const msg = errorMessage.toLowerCase();

  // 找不到試算表
  if (msg.includes("not found") || msg.includes("could not find")) {
    return `找不到指定的試算表。請確認：1) spreadsheetId 是否正確 2) 該試算表是否已與 Google 帳號共享 (GSHEETS_NOT_FOUND)`;
  }

  // 權限不足
  if (msg.includes("forbidden") || msg.includes("insufficient permission") || msg.includes("403")) {
    return `權限不足。請確認：1) Google Sheets 已授權給 OctoDock 2) 您對該試算表有編輯權限 (GSHEETS_FORBIDDEN)`;
  }

  // 無效的範圍
  if (msg.includes("unable to parse range") || msg.includes("invalid range")) {
    return `範圍格式錯誤。請使用 A1 表示法，例如 "Sheet1!A1:D10"。使用 get 查看可用的工作表名稱。 (GSHEETS_INVALID_RANGE)`;
  }

  // 超出範圍
  if (msg.includes("exceeds grid limits") || msg.includes("out of range")) {
    return `範圍超出工作表大小。請先用 read 確認現有資料範圍。 (GSHEETS_OUT_OF_RANGE)`;
  }

  // Token 過期
  if (msg.includes("invalid_grant") || msg.includes("token has been expired")) {
    return `Google 授權已過期，請重新連結 Google Sheets。 (GSHEETS_TOKEN_EXPIRED)`;
  }

  // Rate limit
  if (msg.includes("rate limit") || msg.includes("quota")) {
    return `Google Sheets API 配額已用盡。請稍後再試。 (GSHEETS_RATE_LIMIT)`;
  }

  return null;
}

// ── MCP 工具定義 ──────────────────────────────────────────
const tools: ToolDefinition[] = [
  {
    name: "gsheets_create",
    description:
      "Create a new Google Spreadsheet with a given title. Returns the spreadsheet ID and URL.",
    inputSchema: {
      title: z.string().describe("Spreadsheet title"),
    },
  },
  {
    name: "gsheets_get",
    description:
      "Get spreadsheet metadata including sheet names, titles, and sheet count. Does not return cell data.",
    inputSchema: {
      spreadsheetId: z.string().describe("Google Spreadsheet ID"),
    },
  },
  {
    name: "gsheets_read",
    description:
      "Read cell values from a specified range in a spreadsheet. Use A1 notation (e.g. 'Sheet1!A1:D10').",
    inputSchema: {
      spreadsheetId: z.string().describe("Google Spreadsheet ID"),
      range: z.string().describe("A1 notation range (e.g. 'Sheet1!A1:D10')"),
    },
  },
  {
    name: "gsheets_write",
    description:
      "Write cell values to a specified range in a spreadsheet. Overwrites existing data in the range.",
    inputSchema: {
      spreadsheetId: z.string().describe("Google Spreadsheet ID"),
      range: z.string().describe("A1 notation range (e.g. 'Sheet1!A1:C3')"),
      values: z
        .array(z.array(z.unknown()))
        .describe("2D array of values (rows × columns)"),
    },
  },
  {
    name: "gsheets_append",
    description:
      "Append rows of data after the last row with data in a range. Does not overwrite existing data.",
    inputSchema: {
      spreadsheetId: z.string().describe("Google Spreadsheet ID"),
      range: z.string().describe("A1 notation range to append after (e.g. 'Sheet1!A:C')"),
      values: z
        .array(z.array(z.unknown()))
        .describe("2D array of rows to append"),
    },
  },
  {
    name: "gsheets_clear",
    description:
      "Clear all cell values in a specified range. Keeps cell formatting intact.",
    inputSchema: {
      spreadsheetId: z.string().describe("Google Spreadsheet ID"),
      range: z.string().describe("A1 notation range to clear (e.g. 'Sheet1!A1:D10')"),
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
    // 建立新試算表
    case "gsheets_create": {
      const result = await sheetsFetch("", token, {
        method: "POST",
        body: JSON.stringify({
          properties: { title: params.title as string },
        }),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 取得試算表資訊（工作表名稱、標題等）
    case "gsheets_get": {
      const spreadsheetId = params.spreadsheetId as string;
      const result = await sheetsFetch(
        `/${spreadsheetId}?fields=spreadsheetId,properties.title,sheets.properties`,
        token,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 讀取儲存格資料
    case "gsheets_read": {
      const spreadsheetId = params.spreadsheetId as string;
      const range = encodeURIComponent(params.range as string);
      const result = await sheetsFetch(
        `/${spreadsheetId}/values/${range}`,
        token,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 寫入儲存格資料（覆蓋）
    case "gsheets_write": {
      const spreadsheetId = params.spreadsheetId as string;
      const range = encodeURIComponent(params.range as string);
      const result = await sheetsFetch(
        `/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`,
        token,
        {
          method: "PUT",
          body: JSON.stringify({
            range: params.range as string,
            majorDimension: "ROWS",
            values: params.values,
          }),
        },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 追加列資料（在現有資料之後）
    case "gsheets_append": {
      const spreadsheetId = params.spreadsheetId as string;
      const range = encodeURIComponent(params.range as string);
      const result = await sheetsFetch(
        `/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED`,
        token,
        {
          method: "POST",
          body: JSON.stringify({
            range: params.range as string,
            majorDimension: "ROWS",
            values: params.values,
          }),
        },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 清除儲存格資料（保留格式）
    case "gsheets_clear": {
      const spreadsheetId = params.spreadsheetId as string;
      const range = encodeURIComponent(params.range as string);
      const result = await sheetsFetch(
        `/${spreadsheetId}/values/${range}:clear`,
        token,
        { method: "POST", body: JSON.stringify({}) },
      );
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
async function refreshSheetsToken(refreshToken: string): Promise<TokenSet> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env.GSHEETS_OAUTH_CLIENT_ID!,
      client_secret: process.env.GSHEETS_OAUTH_CLIENT_SECRET!,
    }).toString(),
  });

  if (!res.ok) {
    throw new Error(`Google Sheets token refresh failed (GSHEETS_REFRESH_FAILED)`);
  }

  const data = await res.json();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? refreshToken, // Google 不一定回傳新的 refresh_token
    expires_in: data.expires_in,
  };
}

// ── Adapter 匯出 ─────────────────────────────────────────
export const googleSheetsAdapter: AppAdapter = {
  name: "google_sheets",
  displayName: { zh: "Google 試算表", en: "Google Sheets" },
  icon: "google-sheets",
  authType: "oauth2",
  authConfig,
  actionMap,
  getSkill,
  formatResponse,
  formatError: sheetsFormatError,
  tools,
  execute,
  refreshToken: refreshSheetsToken,
};
