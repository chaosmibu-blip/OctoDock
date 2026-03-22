/**
 * Microsoft Excel Adapter
 * 提供 OneDrive 上 Excel 檔案的工作表管理、儲存格讀寫、表格操作、圖表建立、PDF 匯出等功能
 * 透過 Microsoft Graph API 操作 Excel Online
 */
import { z } from "zod";
import type {
  AppAdapter,
  OAuthConfig,
  ToolDefinition,
  ToolResult,
  TokenSet,
} from "./types";
import {
  graphFetch,
  listFiles,
  searchFiles,
  deleteFile,
  getFileInfo,
  convertFile,
  formatFileList,
  formatFileInfo,
  formatMicrosoftError,
  refreshMicrosoftToken,
  uploadSmallFile,
} from "./microsoft-common";

// ── OAuth 設定 ─────────────────────────────────────────────
const authConfig: OAuthConfig = {
  type: "oauth2",
  authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
  tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
  scopes: ["offline_access", "Files.ReadWrite", "User.Read"],
  authMethod: "post",
  extraParams: { prompt: "consent" },
};

// ── 最小合法 xlsx 檔案（base64 編碼）────────────────────────
// 這是一個只有一張空白工作表的合法 xlsx，用於 create_workbook
// 透過 Graph API 上傳後 Excel Online 可正常開啟
const MINIMAL_XLSX_BASE64 =
  "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" +
  "AAAMBAAAAAA=";

// ── do+help 架構：動作對照表 ──────────────────────────────
const actionMap: Record<string, string> = {
  list_files: "mexcel_list_files",
  create_workbook: "mexcel_create_workbook",
  list_worksheets: "mexcel_list_worksheets",
  create_worksheet: "mexcel_create_worksheet",
  read_range: "mexcel_read_range",
  write_range: "mexcel_write_range",
  append_rows: "mexcel_append_rows",
  list_tables: "mexcel_list_tables",
  create_table: "mexcel_create_table",
  add_chart: "mexcel_add_chart",
  calculate: "mexcel_calculate",
  export_pdf: "mexcel_export_pdf",
  search_files: "mexcel_search_files",
  get_file_info: "mexcel_get_file_info",
  delete_file: "mexcel_delete_file",
};

// ── do+help 架構：技能描述（供 agent 理解可用操作）────────
const ACTION_SKILLS: Record<string, string> = {
  list_files: `## microsoft_excel.list_files
List Excel (.xlsx) files on OneDrive.
### Parameters
  folder?: Folder path (optional, default: root)
  limit?: Max results (default: 20)
### Example
octodock_do(app:"microsoft_excel", action:"list_files")`,

  create_workbook: `## microsoft_excel.create_workbook
Create a new empty Excel workbook on OneDrive.
### Parameters
  name: Workbook file name (without .xlsx extension)
  folder?: Folder path (optional)
### Example
octodock_do(app:"microsoft_excel", action:"create_workbook", params:{name:"Sales Report"})`,

  list_worksheets: `## microsoft_excel.list_worksheets
List all worksheets in an Excel workbook.
### Parameters
  file_id: OneDrive file ID
### Example
octodock_do(app:"microsoft_excel", action:"list_worksheets", params:{file_id:"ABC123"})`,

  create_worksheet: `## microsoft_excel.create_worksheet
Add a new worksheet to an Excel workbook.
### Parameters
  file_id: OneDrive file ID
  name: Worksheet name
### Example
octodock_do(app:"microsoft_excel", action:"create_worksheet", params:{file_id:"ABC123", name:"Q2 Data"})`,

  read_range: `## microsoft_excel.read_range
Read cell values from a range in an Excel worksheet.
### Parameters
  file_id: OneDrive file ID
  sheet: Worksheet name (e.g. "Sheet1")
  range: Cell range in A1 notation (e.g. "A1:D10")
### Example
octodock_do(app:"microsoft_excel", action:"read_range", params:{file_id:"ABC123", sheet:"Sheet1", range:"A1:D10"})`,

  write_range: `## microsoft_excel.write_range
Write cell values to a range in an Excel worksheet.
### Parameters
  file_id: OneDrive file ID
  sheet: Worksheet name
  range: Cell range in A1 notation
  values: 2D array of values (rows × columns)
### Example
octodock_do(app:"microsoft_excel", action:"write_range", params:{
  file_id:"ABC123", sheet:"Sheet1", range:"A1:C2",
  values:[["Name","Age","City"],["Alice",30,"Taipei"]]
})`,

  append_rows: `## microsoft_excel.append_rows
Append rows to an Excel table.
### Parameters
  file_id: OneDrive file ID
  table: Table name or ID (use list_tables to find)
  values: 2D array of rows to append
### Example
octodock_do(app:"microsoft_excel", action:"append_rows", params:{
  file_id:"ABC123", table:"Table1",
  values:[["Bob",25,"Kaohsiung"],["Carol",28,"Taichung"]]
})`,

  list_tables: `## microsoft_excel.list_tables
List all tables in an Excel workbook.
### Parameters
  file_id: OneDrive file ID
### Example
octodock_do(app:"microsoft_excel", action:"list_tables", params:{file_id:"ABC123"})`,

  create_table: `## microsoft_excel.create_table
Create a new table in an Excel workbook.
### Parameters
  file_id: OneDrive file ID
  address: Range address for the table (e.g. "Sheet1!A1:C5")
  hasHeaders: Whether the first row is headers (default: true)
### Example
octodock_do(app:"microsoft_excel", action:"create_table", params:{file_id:"ABC123", address:"Sheet1!A1:C5", hasHeaders:true})`,

  add_chart: `## microsoft_excel.add_chart
Add a chart to an Excel worksheet.
### Parameters
  file_id: OneDrive file ID
  sheet: Worksheet name
  type: Chart type (e.g. "ColumnClustered", "Line", "Pie", "Bar", "Area")
  sourceData: Data range (e.g. "Sheet1!A1:B5")
  seriesBy: "Auto" | "Columns" | "Rows" (default: "Auto")
### Example
octodock_do(app:"microsoft_excel", action:"add_chart", params:{
  file_id:"ABC123", sheet:"Sheet1", type:"ColumnClustered", sourceData:"Sheet1!A1:B5", seriesBy:"Auto"
})`,

  calculate: `## microsoft_excel.calculate
Force recalculation of an Excel workbook.
### Parameters
  file_id: OneDrive file ID
  calculationType: "Recalculate" | "Full" | "FullRebuild"
### Example
octodock_do(app:"microsoft_excel", action:"calculate", params:{file_id:"ABC123", calculationType:"Recalculate"})`,

  export_pdf: `## microsoft_excel.export_pdf
Export an Excel workbook as PDF.
### Parameters
  file_id: OneDrive file ID
### Example
octodock_do(app:"microsoft_excel", action:"export_pdf", params:{file_id:"ABC123"})`,

  search_files: `## microsoft_excel.search_files
Search for Excel files on OneDrive by keyword.
### Parameters
  query: Search keyword
  limit?: Max results (default: 20)
### Example
octodock_do(app:"microsoft_excel", action:"search_files", params:{query:"sales report"})`,

  get_file_info: `## microsoft_excel.get_file_info
Get detailed info about an Excel file.
### Parameters
  file_id: OneDrive file ID
### Example
octodock_do(app:"microsoft_excel", action:"get_file_info", params:{file_id:"ABC123"})`,

  delete_file: `## microsoft_excel.delete_file
Delete an Excel file from OneDrive.
### Parameters
  file_id: OneDrive file ID
### Example
octodock_do(app:"microsoft_excel", action:"delete_file", params:{file_id:"ABC123"})`,
};

/** 回傳操作說明，找不到 action 時回傳 null 讓 server.ts fallback */
function getSkill(action?: string): string | null {
  if (action && ACTION_SKILLS[action]) return ACTION_SKILLS[action];
  if (action) return null;
  return `microsoft_excel actions (${Object.keys(actionMap).length}):
  list_files(folder?, limit?) — list Excel files on OneDrive
  create_workbook(name, folder?) — create new empty workbook
  list_worksheets(file_id) — list worksheets in a workbook
  create_worksheet(file_id, name) — add new worksheet
  read_range(file_id, sheet, range) — read cell values (returns text table)
  write_range(file_id, sheet, range, values) — write cell values (2D array)
  append_rows(file_id, table, values) — append rows to a table
  list_tables(file_id) — list tables in a workbook
  create_table(file_id, address, hasHeaders) — create a table
  add_chart(file_id, sheet, type, sourceData, seriesBy) — add chart
  calculate(file_id, calculationType) — force recalculation
  export_pdf(file_id) — export workbook as PDF
  search_files(query, limit?) — search Excel files
  get_file_info(file_id) — get file details
  delete_file(file_id) — delete file
Use octodock_help(app:"microsoft_excel", action:"ACTION") for detailed params + example.`;
}

// ── 格式化回應：將原始資料轉為 AI 友善格式 ─────────────────
function formatResponse(action: string, rawData: unknown): string {
  if (typeof rawData !== "object" || rawData === null) {
    return JSON.stringify(rawData, null, 2);
  }
  const data = rawData as Record<string, unknown>;

  switch (action) {
    // 列出檔案 / 搜尋檔案：用共用 helper
    case "list_files":
    case "search_files": {
      const files = Array.isArray(rawData) ? rawData : (data.value as unknown[]) ?? [];
      return formatFileList(files, "Excel");
    }

    // 取得檔案資訊：用共用 helper
    case "get_file_info": {
      return formatFileInfo(rawData);
    }

    // 建立活頁簿
    case "create_workbook": {
      const name = data.name as string | undefined;
      const id = data.id as string | undefined;
      const webUrl = data.webUrl as string | undefined;
      return `Done. Workbook "${name ?? "Untitled"}" created.\nID: ${id}\nURL: ${webUrl ?? "N/A"}`;
    }

    // 列出工作表
    case "list_worksheets": {
      const sheets = (data.value as Array<{ name: string; id: string; position: number; visibility: string }>) ?? [];
      if (sheets.length === 0) return "No worksheets found.";
      return `Worksheets (${sheets.length}):\n` +
        sheets.map((s, i) => `${i + 1}. ${s.name} (id: ${s.id}, position: ${s.position})`).join("\n");
    }

    // 建立工作表
    case "create_worksheet": {
      const name = data.name as string | undefined;
      const id = data.id as string | undefined;
      return `Done. Worksheet "${name ?? "Untitled"}" created (id: ${id ?? "?"}).`;
    }

    // 讀取儲存格：轉為對齊的文字表格
    case "read_range": {
      const values = data.values as unknown[][] | undefined;
      if (!values || values.length === 0) return "No data in range.";

      // 計算每一欄的最大寬度
      const colWidths: number[] = [];
      for (const row of values) {
        for (let c = 0; c < row.length; c++) {
          const cellStr = String(row[c] ?? "");
          colWidths[c] = Math.max(colWidths[c] ?? 0, cellStr.length);
        }
      }

      // 組裝對齊的文字表格
      const lines = values.map((row) => {
        return "| " + row.map((cell, c) => String(cell ?? "").padEnd(colWidths[c])).join(" | ") + " |";
      });

      // 在第一列（表頭）後面加上分隔線
      if (lines.length > 1) {
        const separator = "| " + colWidths.map((w) => "-".repeat(w)).join(" | ") + " |";
        lines.splice(1, 0, separator);
      }

      return lines.join("\n");
    }

    // 寫入儲存格
    case "write_range": {
      const address = (data.address ?? data.range) as string | undefined;
      const cellCount = data.cellCount as number | undefined;
      return `Done. Updated ${cellCount ?? "?"} cells in ${address ?? "range"}.`;
    }

    // 追加列
    case "append_rows": {
      const index = data.index as number | undefined;
      return `Done. Row appended (index: ${index ?? "?"}).`;
    }

    // 列出表格
    case "list_tables": {
      const tables = (data.value as Array<{ name: string; id: string; showHeaders: boolean; style: string; range?: { address?: string } }>) ?? [];
      if (tables.length === 0) return "No tables found.";
      return `Tables (${tables.length}):\n` +
        tables.map((t, i) => `${i + 1}. **${t.name}** (id: ${t.id}, range: ${t.range?.address ?? "?"})`).join("\n");
    }

    // 建立表格
    case "create_table": {
      const name = data.name as string | undefined;
      const id = data.id as string | undefined;
      return `Done. Table "${name ?? "Untitled"}" created (id: ${id ?? "?"}).`;
    }

    // 建立圖表
    case "add_chart": {
      const name = data.name as string | undefined;
      const id = data.id as string | undefined;
      return `Done. Chart "${name ?? "Chart"}" added (id: ${id ?? "?"}).`;
    }

    // 強制重新計算
    case "calculate": {
      return "Done. Workbook recalculated.";
    }

    // 匯出 PDF
    case "export_pdf": {
      const size = data.size as number | undefined;
      return `Done. PDF exported (${size ? `${(size / 1024).toFixed(1)}KB` : "?"}).`;
    }

    // 刪除檔案
    case "delete_file": {
      return "Done. File deleted.";
    }

    default:
      return JSON.stringify(rawData, null, 2);
  }
}

// ── 智慧錯誤引導 ──────────────────────────────────────────
function excelFormatError(_action: string, errorMessage: string): string | null {
  /* 先嘗試 Microsoft 共用錯誤格式化 */
  const common = formatMicrosoftError(errorMessage);
  if (common) return common;

  /* Excel 特定錯誤 */
  const msg = errorMessage.toLowerCase();
  if (msg.includes("invalidreference") || msg.includes("badrequest")) {
    return "「儲存格範圍無效 (EXCEL_INVALID_RANGE)」\n請確認 sheet 名稱和 range 格式是否正確（例如 A1:D10）。";
  }
  if (msg.includes("generalexception") && msg.includes("worksheet")) {
    return "「工作表操作失敗 (EXCEL_WORKSHEET_ERROR)」\n請確認工作表名稱是否存在。用 list_worksheets 查看可用的工作表。";
  }
  if (msg.includes("itemalreadyexists")) {
    return "「同名工作表已存在 (EXCEL_SHEET_EXISTS)」\n請使用不同的名稱。";
  }
  if (msg.includes("editmodesupported") || msg.includes("session")) {
    return "「Excel 檔案正被其他人編輯 (EXCEL_SESSION_CONFLICT)」\n請稍後再試，或請其他人先關閉檔案。";
  }

  return null;
}

// ── MCP 工具定義 ──────────────────────────────────────────
const tools: ToolDefinition[] = [
  {
    name: "mexcel_list_files",
    description: "List Excel (.xlsx) files on OneDrive.",
    inputSchema: {
      folder: z.string().optional().describe("Folder path (optional)"),
      limit: z.number().optional().describe("Max results (default: 20)"),
    },
  },
  {
    name: "mexcel_create_workbook",
    description: "Create a new empty Excel workbook on OneDrive.",
    inputSchema: {
      name: z.string().describe("Workbook file name (without .xlsx extension)"),
      folder: z.string().optional().describe("Folder path (optional)"),
    },
  },
  {
    name: "mexcel_list_worksheets",
    description: "List all worksheets in an Excel workbook.",
    inputSchema: {
      file_id: z.string().describe("OneDrive file ID"),
    },
  },
  {
    name: "mexcel_create_worksheet",
    description: "Add a new worksheet to an Excel workbook.",
    inputSchema: {
      file_id: z.string().describe("OneDrive file ID"),
      name: z.string().describe("Worksheet name"),
    },
  },
  {
    name: "mexcel_read_range",
    description: "Read cell values from a range in an Excel worksheet.",
    inputSchema: {
      file_id: z.string().describe("OneDrive file ID"),
      sheet: z.string().describe("Worksheet name (e.g. 'Sheet1')"),
      range: z.string().describe("Cell range in A1 notation (e.g. 'A1:D10')"),
    },
  },
  {
    name: "mexcel_write_range",
    description: "Write cell values to a range in an Excel worksheet. Overwrites existing data.",
    inputSchema: {
      file_id: z.string().describe("OneDrive file ID"),
      sheet: z.string().describe("Worksheet name"),
      range: z.string().describe("Cell range in A1 notation"),
      values: z.array(z.array(z.unknown())).describe("2D array of values (rows × columns)"),
    },
  },
  {
    name: "mexcel_append_rows",
    description: "Append rows to an Excel table.",
    inputSchema: {
      file_id: z.string().describe("OneDrive file ID"),
      table: z.string().describe("Table name or ID"),
      values: z.array(z.array(z.unknown())).describe("2D array of rows to append"),
    },
  },
  {
    name: "mexcel_list_tables",
    description: "List all tables in an Excel workbook.",
    inputSchema: {
      file_id: z.string().describe("OneDrive file ID"),
    },
  },
  {
    name: "mexcel_create_table",
    description: "Create a new table in an Excel workbook from a cell range.",
    inputSchema: {
      file_id: z.string().describe("OneDrive file ID"),
      address: z.string().describe("Range address for the table (e.g. 'Sheet1!A1:C5')"),
      hasHeaders: z.boolean().optional().describe("Whether the first row is headers (default: true)"),
    },
  },
  {
    name: "mexcel_add_chart",
    description: "Add a chart to an Excel worksheet.",
    inputSchema: {
      file_id: z.string().describe("OneDrive file ID"),
      sheet: z.string().describe("Worksheet name"),
      type: z.string().describe("Chart type (e.g. 'ColumnClustered', 'Line', 'Pie', 'Bar', 'Area')"),
      sourceData: z.string().describe("Data range (e.g. 'Sheet1!A1:B5')"),
      seriesBy: z.string().optional().describe("'Auto' | 'Columns' | 'Rows' (default: 'Auto')"),
    },
  },
  {
    name: "mexcel_calculate",
    description: "Force recalculation of an Excel workbook.",
    inputSchema: {
      file_id: z.string().describe("OneDrive file ID"),
      calculationType: z.string().describe("'Recalculate' | 'Full' | 'FullRebuild'"),
    },
  },
  {
    name: "mexcel_export_pdf",
    description: "Export an Excel workbook as PDF.",
    inputSchema: {
      file_id: z.string().describe("OneDrive file ID"),
    },
  },
  {
    name: "mexcel_search_files",
    description: "Search for Excel files on OneDrive by keyword.",
    inputSchema: {
      query: z.string().describe("Search keyword"),
      limit: z.number().optional().describe("Max results (default: 20)"),
    },
  },
  {
    name: "mexcel_get_file_info",
    description: "Get detailed info about an Excel file on OneDrive.",
    inputSchema: {
      file_id: z.string().describe("OneDrive file ID"),
    },
  },
  {
    name: "mexcel_delete_file",
    description: "Delete an Excel file from OneDrive.",
    inputSchema: {
      file_id: z.string().describe("OneDrive file ID"),
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
    // 列出 OneDrive 上的 Excel 檔案
    case "mexcel_list_files": {
      const folder = params.folder as string | undefined;
      const limit = (params.limit as number) ?? 20;
      const files = await listFiles(token, "xlsx", limit, folder);
      return {
        content: [{ type: "text", text: JSON.stringify(files, null, 2) }],
      };
    }

    // 建立空白活頁簿（上傳最小合法 xlsx）
    case "mexcel_create_workbook": {
      const name = params.name as string;
      const folder = params.folder as string | undefined;
      const xlsxBuffer = Buffer.from(MINIMAL_XLSX_BASE64, "base64");
      const result = await uploadSmallFile(
        token,
        `${name}.xlsx`,
        xlsxBuffer,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        folder,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 列出活頁簿中的所有工作表
    case "mexcel_list_worksheets": {
      const fileId = params.file_id as string;
      const result = await graphFetch(`/me/drive/items/${fileId}/workbook/worksheets`, token);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 新增工作表
    case "mexcel_create_worksheet": {
      const fileId = params.file_id as string;
      const name = params.name as string;
      const result = await graphFetch(
        `/me/drive/items/${fileId}/workbook/worksheets`,
        token,
        { method: "POST", body: { name } },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 讀取儲存格範圍
    case "mexcel_read_range": {
      const fileId = params.file_id as string;
      const sheet = encodeURIComponent(params.sheet as string);
      const range = encodeURIComponent(params.range as string);
      const result = await graphFetch(
        `/me/drive/items/${fileId}/workbook/worksheets/${sheet}/range(address='${range}')`,
        token,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 寫入儲存格範圍
    case "mexcel_write_range": {
      const fileId = params.file_id as string;
      const sheet = encodeURIComponent(params.sheet as string);
      const range = encodeURIComponent(params.range as string);
      const values = params.values as unknown[][];
      const result = await graphFetch(
        `/me/drive/items/${fileId}/workbook/worksheets/${sheet}/range(address='${range}')`,
        token,
        { method: "PATCH", body: { values } },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 追加列到表格
    case "mexcel_append_rows": {
      const fileId = params.file_id as string;
      const table = encodeURIComponent(params.table as string);
      const values = params.values as unknown[][];
      const result = await graphFetch(
        `/me/drive/items/${fileId}/workbook/tables/${table}/rows`,
        token,
        { method: "POST", body: { values } },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 列出活頁簿中的所有表格
    case "mexcel_list_tables": {
      const fileId = params.file_id as string;
      const result = await graphFetch(`/me/drive/items/${fileId}/workbook/tables`, token);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 建立表格
    case "mexcel_create_table": {
      const fileId = params.file_id as string;
      const address = params.address as string;
      const hasHeaders = (params.hasHeaders as boolean) ?? true;
      const result = await graphFetch(
        `/me/drive/items/${fileId}/workbook/tables/add`,
        token,
        { method: "POST", body: { address, hasHeaders } },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 建立圖表
    case "mexcel_add_chart": {
      const fileId = params.file_id as string;
      const sheet = encodeURIComponent(params.sheet as string);
      const type = params.type as string;
      const sourceData = params.sourceData as string;
      const seriesBy = (params.seriesBy as string) ?? "Auto";
      const result = await graphFetch(
        `/me/drive/items/${fileId}/workbook/worksheets/${sheet}/charts/add`,
        token,
        { method: "POST", body: { type, sourceData, seriesBy } },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 強制重新計算
    case "mexcel_calculate": {
      const fileId = params.file_id as string;
      const calculationType = params.calculationType as string;
      const result = await graphFetch(
        `/me/drive/items/${fileId}/workbook/application/calculate`,
        token,
        { method: "POST", body: { calculationType } },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result ?? { ok: true }, null, 2) }],
      };
    }

    // 匯出為 PDF
    case "mexcel_export_pdf": {
      const fileId = params.file_id as string;
      const pdfBuffer = await convertFile(token, fileId, "pdf");
      /* 回傳 base64 編碼的 PDF 和大小資訊 */
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            format: "pdf",
            size: pdfBuffer.length,
            base64: pdfBuffer.toString("base64"),
          }, null, 2),
        }],
      };
    }

    // 搜尋 Excel 檔案
    case "mexcel_search_files": {
      const query = params.query as string;
      const limit = (params.limit as number) ?? 20;
      const files = await searchFiles(token, query, "xlsx", limit);
      return {
        content: [{ type: "text", text: JSON.stringify(files, null, 2) }],
      };
    }

    // 取得檔案資訊
    case "mexcel_get_file_info": {
      const fileId = params.file_id as string;
      const info = await getFileInfo(token, fileId);
      return {
        content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
      };
    }

    // 刪除檔案
    case "mexcel_delete_file": {
      const fileId = params.file_id as string;
      await deleteFile(token, fileId);
      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true }, null, 2) }],
      };
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
        isError: true,
      };
  }
}

// ── Token 刷新：使用 microsoft-common 共用函式 ────────────
async function refreshExcelToken(rt: string): Promise<TokenSet> {
  return refreshMicrosoftToken(rt, "microsoft_excel");
}

// ── Adapter 匯出 ─────────────────────────────────────────
export const microsoftExcelAdapter: AppAdapter = {
  name: "microsoft_excel",
  displayName: { zh: "Excel", en: "Excel" },
  icon: "microsoft",
  authType: "oauth2",
  authConfig,
  actionMap,
  getSkill,
  formatResponse,
  formatError: excelFormatError,
  tools,
  execute,
  refreshToken: refreshExcelToken,
};
