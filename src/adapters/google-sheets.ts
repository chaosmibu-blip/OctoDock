/**
 * Google Sheets Adapter
 * 提供 Google Sheets 試算表的建立、讀取、寫入、追加、清除、新增/刪除/重新命名工作表、批次更新功能
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
  extraParams: { access_type: "offline", prompt: "consent" },
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
      `Google Sheets API error (${res.status}): ${(error as { error: { message: string } }).error.message} (GSHEETS_API_ERROR)`,
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
  add_sheet: "gsheets_add_sheet",
  delete_sheet: "gsheets_delete_sheet",
  rename_sheet: "gsheets_rename_sheet",
  batch_update: "gsheets_batch_update",
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
  spreadsheet_id: Spreadsheet ID (from URL or create result)
### Example
octodock_do(app:"google_sheets", action:"get", params:{spreadsheet_id:"1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"})`,

  read: `## google_sheets.read
Read cell values from a range.
### Parameters
  spreadsheet_id: Spreadsheet ID
  range: A1 notation range (e.g. "Sheet1!A1:D10", "Sheet1!A:A")
### Example
octodock_do(app:"google_sheets", action:"read", params:{spreadsheet_id:"1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms", range:"Sheet1!A1:D10"})`,

  write: `## google_sheets.write
Write cell values to a range (overwrites existing data).
### Parameters
  spreadsheet_id: Spreadsheet ID
  range: A1 notation range (e.g. "Sheet1!A1:C3")
  values: 2D array of values (rows × columns)
### Example
octodock_do(app:"google_sheets", action:"write", params:{
  spreadsheet_id:"1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms",
  range:"Sheet1!A1:C2",
  values:[["Name","Age","City"],["Alice",30,"Taipei"]]
})`,

  append: `## google_sheets.append
Append rows after existing data in a range.
### Parameters
  spreadsheet_id: Spreadsheet ID
  range: A1 notation range to append after (e.g. "Sheet1!A:C")
  values: 2D array of rows to append
### Example
octodock_do(app:"google_sheets", action:"append", params:{
  spreadsheet_id:"1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms",
  range:"Sheet1!A:C",
  values:[["Bob",25,"Kaohsiung"],["Carol",28,"Taichung"]]
})`,

  clear: `## google_sheets.clear
Clear cell values in a range (keeps formatting).
### Parameters
  spreadsheet_id: Spreadsheet ID
  range: A1 notation range to clear (e.g. "Sheet1!A1:D10")
### Example
octodock_do(app:"google_sheets", action:"clear", params:{spreadsheet_id:"1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms", range:"Sheet1!A1:D10"})`,

  add_sheet: `## google_sheets.add_sheet
Add a new sheet (tab) to a spreadsheet.
### Parameters
  spreadsheet_id: Spreadsheet ID
  title: Name for the new sheet
### Example
octodock_do(app:"google_sheets", action:"add_sheet", params:{spreadsheet_id:"1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms", title:"Q2 Data"})`,

  delete_sheet: `## google_sheets.delete_sheet
Delete a sheet (tab) from a spreadsheet by its sheet ID (integer).
### Parameters
  spreadsheet_id: Spreadsheet ID
  sheet_id: Sheet ID (integer, use "get" to find sheet IDs)
### Example
octodock_do(app:"google_sheets", action:"delete_sheet", params:{spreadsheet_id:"1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms", sheet_id:123456789})`,

  rename_sheet: `## google_sheets.rename_sheet
Rename an existing sheet (tab) in a spreadsheet.
### Parameters
  spreadsheet_id: Spreadsheet ID
  sheet_id: Sheet ID (integer, use "get" to find sheet IDs)
  new_title: New name for the sheet
### Example
octodock_do(app:"google_sheets", action:"rename_sheet", params:{spreadsheet_id:"1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms", sheet_id:123456789, new_title:"Archived Data"})`,

  batch_update: `## google_sheets.batch_update
Send raw batchUpdate requests for advanced operations (formatting, merging, etc.).
### Parameters
  spreadsheet_id: Spreadsheet ID
  requests: Array of batchUpdate request objects (Google Sheets API format)
### Example
octodock_do(app:"google_sheets", action:"batch_update", params:{
  spreadsheet_id:"1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms",
  requests:[{repeatCell:{range:{sheetId:0,startRowIndex:0,endRowIndex:1,startColumnIndex:0,endColumnIndex:3},cell:{userEnteredFormat:{textFormat:{bold:true}}},fields:"userEnteredFormat(textFormat)"}}]
})`,
};

function getSkill(action?: string): string | null {
  if (action && ACTION_SKILLS[action]) return ACTION_SKILLS[action];
  if (action) return null; // ACTION_SKILLS 沒有的 action → 回傳 null 讓 server.ts fallback 用 actionMap 自動查
  return `google_sheets actions (${Object.keys(actionMap).length}):
  create(title) — create new spreadsheet
  get(spreadsheet_id) — get spreadsheet metadata (sheet names)
  read(spreadsheet_id, range) — read cell values (returns markdown table)
  write(spreadsheet_id, range, values) — write cell values (2D array)
  append(spreadsheet_id, range, values) — append rows after existing data
  clear(spreadsheet_id, range) — clear cell values
  add_sheet(spreadsheet_id, title) — add new sheet tab
  delete_sheet(spreadsheet_id, sheet_id) — delete sheet tab
  rename_sheet(spreadsheet_id, sheet_id, new_title) — rename sheet tab
  batch_update(spreadsheet_id, requests) — raw batchUpdate for advanced ops
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

    // 新增工作表
    case "add_sheet": {
      const replies = data.replies as Array<{ addSheet?: { properties?: { sheetId?: number; title?: string } } }> | undefined;
      const added = replies?.[0]?.addSheet?.properties;
      return `Done. Sheet "${added?.title ?? "Untitled"}" added (id: ${added?.sheetId ?? "?"}).`;
    }

    // 刪除工作表
    case "delete_sheet": {
      return "Done. Sheet deleted.";
    }

    // 重新命名工作表
    case "rename_sheet": {
      return "Done. Sheet renamed.";
    }

    // 批次更新
    case "batch_update": {
      const replies = data.replies as unknown[] | undefined;
      return `Done. Batch update completed (${replies?.length ?? 0} operations).`;
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
      spreadsheet_id: z.string().describe("Google Spreadsheet ID"),
    },
  },
  {
    name: "gsheets_read",
    description:
      "Read cell values from a specified range in a spreadsheet. Use A1 notation (e.g. 'Sheet1!A1:D10').",
    inputSchema: {
      spreadsheet_id: z.string().describe("Google Spreadsheet ID"),
      range: z.string().describe("A1 notation range (e.g. 'Sheet1!A1:D10')"),
    },
  },
  {
    name: "gsheets_write",
    description:
      "Write cell values to a specified range in a spreadsheet. Overwrites existing data in the range.",
    inputSchema: {
      spreadsheet_id: z.string().describe("Google Spreadsheet ID"),
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
      spreadsheet_id: z.string().describe("Google Spreadsheet ID"),
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
      spreadsheet_id: z.string().describe("Google Spreadsheet ID"),
      range: z.string().describe("A1 notation range to clear (e.g. 'Sheet1!A1:D10')"),
    },
  },
  // 新增工作表
  {
    name: "gsheets_add_sheet",
    description:
      "Add a new sheet (tab) to a Google Spreadsheet.",
    inputSchema: {
      spreadsheet_id: z.string().describe("Google Spreadsheet ID"),
      title: z.string().describe("Name for the new sheet"),
    },
  },
  // 刪除工作表
  {
    name: "gsheets_delete_sheet",
    description:
      "Delete a sheet (tab) from a Google Spreadsheet by its sheet ID.",
    inputSchema: {
      spreadsheet_id: z.string().describe("Google Spreadsheet ID"),
      sheet_id: z.number().describe("Sheet ID (integer, use 'get' to find sheet IDs)"),
    },
  },
  // 重新命名工作表
  {
    name: "gsheets_rename_sheet",
    description:
      "Rename an existing sheet (tab) in a Google Spreadsheet.",
    inputSchema: {
      spreadsheet_id: z.string().describe("Google Spreadsheet ID"),
      sheet_id: z.number().describe("Sheet ID (integer, use 'get' to find sheet IDs)"),
      new_title: z.string().describe("New name for the sheet"),
    },
  },
  // 批次更新（進階操作：格式化、合併儲存格等）
  {
    name: "gsheets_batch_update",
    description:
      "Send raw batchUpdate requests for advanced spreadsheet operations (formatting, merging cells, conditional formatting, etc.).",
    inputSchema: {
      spreadsheet_id: z.string().describe("Google Spreadsheet ID"),
      requests: z.array(z.record(z.string(), z.unknown())).describe("Array of batchUpdate request objects (Google Sheets API format)"),
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
      const spreadsheetId = (params.spreadsheet_id ?? params.spreadsheetId) as string;
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
      const spreadsheetId = (params.spreadsheet_id ?? params.spreadsheetId) as string;
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
      const spreadsheetId = (params.spreadsheet_id ?? params.spreadsheetId) as string;
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
      const spreadsheetId = (params.spreadsheet_id ?? params.spreadsheetId) as string;
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
      const spreadsheetId = (params.spreadsheet_id ?? params.spreadsheetId) as string;
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

    // 新增工作表
    case "gsheets_add_sheet": {
      const spreadsheetId = params.spreadsheet_id as string;
      const title = params.title as string;
      const result = await sheetsFetch(
        `/${spreadsheetId}:batchUpdate`,
        token,
        {
          method: "POST",
          body: JSON.stringify({
            requests: [{ addSheet: { properties: { title } } }],
          }),
        },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 刪除工作表
    case "gsheets_delete_sheet": {
      const spreadsheetId = params.spreadsheet_id as string;
      const sheetId = params.sheet_id as number;
      const result = await sheetsFetch(
        `/${spreadsheetId}:batchUpdate`,
        token,
        {
          method: "POST",
          body: JSON.stringify({
            requests: [{ deleteSheet: { sheetId } }],
          }),
        },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 重新命名工作表
    case "gsheets_rename_sheet": {
      const spreadsheetId = params.spreadsheet_id as string;
      const sheetId = params.sheet_id as number;
      const newTitle = params.new_title as string;
      const result = await sheetsFetch(
        `/${spreadsheetId}:batchUpdate`,
        token,
        {
          method: "POST",
          body: JSON.stringify({
            requests: [
              {
                updateSheetProperties: {
                  properties: { sheetId, title: newTitle },
                  fields: "title",
                },
              },
            ],
          }),
        },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 批次更新（進階操作）
    case "gsheets_batch_update": {
      const spreadsheetId = params.spreadsheet_id as string;
      const requests = params.requests as unknown[];
      const result = await sheetsFetch(
        `/${spreadsheetId}:batchUpdate`,
        token,
        {
          method: "POST",
          body: JSON.stringify({ requests }),
        },
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

// ── Token 刷新：使用共用的 Google OAuth token 刷新函式 ─
import { refreshGoogleToken } from "../lib/google-refresh";
const refreshSheetsToken = (token: string) =>
  refreshGoogleToken(token, "Google Sheets", "GSHEETS_REFRESH_FAILED");

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
