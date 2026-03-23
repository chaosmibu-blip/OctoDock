/**
 * Microsoft Word Adapter
 * 提供 Word 文件的建立、讀取、列表、搜尋、匯出 PDF、刪除、檔案資訊功能
 * 使用 OneDrive Graph API 操作 .docx 檔案
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
  uploadSmallFile,
  listFiles,
  searchFiles,
  deleteFile,
  getFileInfo,
  downloadFile,
  convertFile,
  refreshMicrosoftToken,
  formatFileList,
  formatFileInfo,
  formatMicrosoftError,
} from "./microsoft-common";
import mammoth from "mammoth";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
} from "docx";

// ── OAuth 設定（與 Excel、PowerPoint 共用 Azure AD） ─────────
const authConfig: OAuthConfig = {
  type: "oauth2",
  authorizeUrl:
    "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
  tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
  scopes: ["offline_access", "Files.ReadWrite", "User.Read"],
  authMethod: "post",
  extraParams: { prompt: "consent" },
};

// ── do+help 架構：動作對照表 ─────────────────────────────────
const actionMap: Record<string, string> = {
  create_document: "msword_create_document",
  read_document: "msword_read_document",
  list_files: "msword_list_files",
  search_files: "msword_search_files",
  export_pdf: "msword_export_pdf",
  delete_file: "msword_delete_file",
  get_file_info: "msword_get_file_info",
};

// ── do+help 架構：技能描述（供 agent 理解可用操作）───────────
const ACTION_SKILLS: Record<string, string> = {
  create_document: `## microsoft_word.create_document
Create a new Word document (.docx) on OneDrive.
### Parameters
  title: Document title (becomes filename, .docx added automatically)
  content: Document body — plain text or simple Markdown (# heading, **bold**, *italic*, - bullet)
### Example
octodock_do(app:"microsoft_word", action:"create_document", params:{title:"Meeting Notes", content:"# Meeting Notes\\n\\n- Discuss Q2 goals\\n- Review budget"})`,

  read_document: `## microsoft_word.read_document
Read a Word document and return its text content.
### Parameters
  file_id: OneDrive file ID
### Example
octodock_do(app:"microsoft_word", action:"read_document", params:{file_id:"ABC123"})`,

  list_files: `## microsoft_word.list_files
List Word documents (.docx) on OneDrive.
### Parameters
  folder?: Folder path to list (optional, default: root)
### Example
octodock_do(app:"microsoft_word", action:"list_files", params:{})`,

  search_files: `## microsoft_word.search_files
Search Word documents by keyword.
### Parameters
  query: Search keyword
### Example
octodock_do(app:"microsoft_word", action:"search_files", params:{query:"meeting notes"})`,

  export_pdf: `## microsoft_word.export_pdf
Export a Word document as PDF.
### Parameters
  file_id: OneDrive file ID
### Example
octodock_do(app:"microsoft_word", action:"export_pdf", params:{file_id:"ABC123"})`,

  delete_file: `## microsoft_word.delete_file
Delete a Word document from OneDrive.
### Parameters
  file_id: OneDrive file ID
### Example
octodock_do(app:"microsoft_word", action:"delete_file", params:{file_id:"ABC123"})`,

  get_file_info: `## microsoft_word.get_file_info
Get metadata of a Word document (size, dates, URL, author).
### Parameters
  file_id: OneDrive file ID
### Example
octodock_do(app:"microsoft_word", action:"get_file_info", params:{file_id:"ABC123"})`,
};

// ── 工具定義（MCP 內部路由用） ──────────────────────────────
const tools: ToolDefinition[] = [
  {
    name: "msword_create_document",
    description: "Create a new Word document on OneDrive",
    inputSchema: {
      title: z.string().describe("Document title"),
      content: z.string().describe("Document body (plain text or simple Markdown)"),
    },
  },
  {
    name: "msword_read_document",
    description: "Read a Word document's text content",
    inputSchema: {
      file_id: z.string().describe("OneDrive file ID"),
    },
  },
  {
    name: "msword_list_files",
    description: "List Word documents on OneDrive",
    inputSchema: {
      folder: z.string().optional().describe("Folder path (optional)"),
    },
  },
  {
    name: "msword_search_files",
    description: "Search Word documents by keyword",
    inputSchema: {
      query: z.string().describe("Search keyword"),
    },
  },
  {
    name: "msword_export_pdf",
    description: "Export a Word document as PDF",
    inputSchema: {
      file_id: z.string().describe("OneDrive file ID"),
    },
  },
  {
    name: "msword_delete_file",
    description: "Delete a Word document from OneDrive",
    inputSchema: {
      file_id: z.string().describe("OneDrive file ID"),
    },
  },
  {
    name: "msword_get_file_info",
    description: "Get metadata of a Word document",
    inputSchema: {
      file_id: z.string().describe("OneDrive file ID"),
    },
  },
];

// ── 輔助函式：簡易 Markdown → docx Paragraph 轉換 ──────────
/** 將每行文字轉成 docx Paragraph，支援標題、粗體、斜體、項目符號 */
function markdownToParagraphs(content: string): Paragraph[] {
  return content.split("\n").map((line) => {
    // 標題：# / ## / ###
    if (line.startsWith("### ")) {
      return new Paragraph({
        text: line.slice(4),
        heading: HeadingLevel.HEADING_3,
      });
    }
    if (line.startsWith("## ")) {
      return new Paragraph({
        text: line.slice(3),
        heading: HeadingLevel.HEADING_2,
      });
    }
    if (line.startsWith("# ")) {
      return new Paragraph({
        text: line.slice(2),
        heading: HeadingLevel.HEADING_1,
      });
    }
    // 項目符號：- 或 *
    if (line.startsWith("- ") || line.startsWith("* ")) {
      return new Paragraph({
        text: line.slice(2),
        bullet: { level: 0 },
      });
    }
    // 空行
    if (line.trim() === "") {
      return new Paragraph({});
    }
    // 一般文字：解析粗體和斜體的 inline 格式
    const runs = parseInlineFormatting(line);
    return new Paragraph({ children: runs });
  });
}

/** 解析行內的 **粗體** 和 *斜體* 標記，回傳 TextRun 陣列 */
function parseInlineFormatting(text: string): TextRun[] {
  const runs: TextRun[] = [];
  // 用正則拆分 **bold**、*italic* 和普通文字
  const regex = /(\*\*(.+?)\*\*|\*(.+?)\*|([^*]+))/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    if (match[2]) {
      // **粗體**
      runs.push(new TextRun({ text: match[2], bold: true }));
    } else if (match[3]) {
      // *斜體*
      runs.push(new TextRun({ text: match[3], italics: true }));
    } else if (match[4]) {
      // 普通文字
      runs.push(new TextRun(match[4]));
    }
  }
  // fallback：正則沒匹配到任何內容時直接輸出原文
  if (runs.length === 0) {
    runs.push(new TextRun(text));
  }
  return runs;
}

// ── 各 action 的實作函式 ────────────────────────────────────

/** 建立 Word 文件：解析 Markdown 內容 → 產生 .docx → 上傳到 OneDrive */
async function createDocument(
  token: string,
  title: string,
  content: string,
): Promise<ToolResult> {
  // 用 docx 套件產生 .docx Buffer
  const doc = new Document({
    sections: [{ children: markdownToParagraphs(content) }],
  });
  const buffer = await Packer.toBuffer(doc);

  // 上傳到 OneDrive 根目錄
  const fileName = title.endsWith(".docx") ? title : `${title}.docx`;
  const result = await uploadSmallFile(
    token,
    fileName,
    Buffer.from(buffer),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );

  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
  };
}

/** 讀取 Word 文件：下載 .docx → 用 mammoth 提取純文字 */
async function readDocument(
  token: string,
  fileId: string,
): Promise<ToolResult> {
  // 下載檔案二進位
  const buffer = await downloadFile(token, fileId);
  // 用 mammoth 提取純文字
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value;

  return {
    content: [{ type: "text", text: JSON.stringify({ text }) }],
  };
}

/** 列出 OneDrive 上的 .docx 檔案 */
async function listDocxFiles(
  token: string,
  folder?: string,
): Promise<ToolResult> {
  const files = await listFiles(token, "docx", 20, folder);
  return {
    content: [{ type: "text", text: JSON.stringify(files) }],
  };
}

/** 搜尋 OneDrive 上的 .docx 檔案 */
async function searchDocxFiles(
  token: string,
  query: string,
): Promise<ToolResult> {
  const files = await searchFiles(token, query, "docx");
  return {
    content: [{ type: "text", text: JSON.stringify(files) }],
  };
}

/** 將 Word 文件匯出為 PDF（透過 Graph API 轉換） */
async function exportPdf(
  token: string,
  fileId: string,
): Promise<ToolResult> {
  // 呼叫 Graph API 轉換為 PDF
  const pdfBuffer = await convertFile(token, fileId, "pdf");

  // 取得原始檔案資訊（用於回傳檔名）
  const fileInfo = (await getFileInfo(token, fileId)) as {
    name: string;
    webUrl?: string;
  };
  const pdfName = fileInfo.name.replace(/\.docx$/i, ".pdf");

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          exported: true,
          originalName: fileInfo.name,
          pdfName,
          pdfSizeKB: (pdfBuffer.length / 1024).toFixed(1),
        }),
      },
    ],
  };
}

/** 刪除 OneDrive 上的檔案 */
async function deleteDocxFile(
  token: string,
  fileId: string,
): Promise<ToolResult> {
  await deleteFile(token, fileId);
  return {
    content: [{ type: "text", text: JSON.stringify({ deleted: true }) }],
  };
}

/** 取得檔案中繼資料 */
async function getDocxFileInfo(
  token: string,
  fileId: string,
): Promise<ToolResult> {
  const info = await getFileInfo(token, fileId);
  return {
    content: [{ type: "text", text: JSON.stringify(info) }],
  };
}

// ── formatResponse：將 raw data 轉成 AI 友善格式 ───────────
/** 根據 action 類型將 API 回傳轉成易讀文字 */
function formatResponse(action: string, rawData: unknown): string {
  const data = rawData as Record<string, unknown>;
  switch (action) {
    case "create_document": {
      // 建立文件：回傳名稱和連結
      const name = data.name || "untitled";
      const webUrl = data.webUrl || "";
      return `Done. Document created: ${name}\nURL: ${webUrl}`;
    }
    case "read_document": {
      // 讀取文件：直接回傳提取的文字
      return (data.text as string) || "(empty document)";
    }
    case "list_files": {
      // 列表：用共用格式化工具
      return formatFileList(rawData as unknown[], "Word");
    }
    case "search_files": {
      // 搜尋：用共用格式化工具
      return formatFileList(rawData as unknown[], "Word");
    }
    case "export_pdf": {
      // 匯出 PDF：回傳確認訊息
      const pdfName = data.pdfName || "document.pdf";
      const pdfSize = data.pdfSizeKB || "?";
      return `Done. PDF exported: ${pdfName} (${pdfSize}KB)`;
    }
    case "delete_file": {
      return "Done. File deleted.";
    }
    case "get_file_info": {
      // 檔案資訊：用共用格式化工具
      return formatFileInfo(rawData);
    }
    default:
      return JSON.stringify(rawData, null, 2);
  }
}

// ── formatError：智慧錯誤引導 ──────────────────────────────
/** 攔截常見 Microsoft API 錯誤，回傳有用提示 */
function formatError(action: string, errorMessage: string): string | null {
  // 先用共用的 Microsoft 錯誤格式化
  const common = formatMicrosoftError(errorMessage);
  if (common) return common;

  // Word 特定的錯誤
  const msg = errorMessage.toLowerCase();
  if (msg.includes("mammoth") || msg.includes("corrupt")) {
    return "「文件格式無法解析 (WORD_CORRUPT_FILE)」\n檔案可能損壞或不是有效的 .docx 格式。";
  }
  if (msg.includes("too large") || msg.includes("maxrequestsize")) {
    return "「檔案過大 (WORD_FILE_TOO_LARGE)」\n目前僅支援 4MB 以內的檔案上傳。";
  }

  return null;
}

// ── getSkill：回傳操作說明 ──────────────────────────────────
/** 回傳指定 action 的操作說明；找不到回傳 null（讓 server.ts fallback） */
function getSkill(action?: string): string | null {
  // 不帶 action：回傳 App 級別清單
  if (!action) {
    return `## Microsoft Word
Manage Word documents on OneDrive.
### Actions
- create_document — Create a new .docx document
- read_document — Read document text content
- list_files — List Word documents
- search_files — Search Word documents
- export_pdf — Export document as PDF
- delete_file — Delete a document
- get_file_info — Get document metadata`;
  }
  // 帶 action：回傳特定 action 的完整說明，找不到回傳 null
  return ACTION_SKILLS[action] ?? null;
}

// ── execute：實際 API 呼叫路由 ──────────────────────────────
/** 根據工具名稱路由到對應的實作函式 */
async function execute(
  toolName: string,
  params: Record<string, unknown>,
  token: string,
): Promise<ToolResult> {
  switch (toolName) {
    case "msword_create_document":
      return createDocument(
        token,
        params.title as string,
        params.content as string,
      );
    case "msword_read_document":
      return readDocument(token, params.file_id as string);
    case "msword_list_files":
      return listDocxFiles(token, params.folder as string | undefined);
    case "msword_search_files":
      return searchDocxFiles(token, params.query as string);
    case "msword_export_pdf":
      return exportPdf(token, params.file_id as string);
    case "msword_delete_file":
      return deleteDocxFile(token, params.file_id as string);
    case "msword_get_file_info":
      return getDocxFileInfo(token, params.file_id as string);
    default:
      return {
        content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
        isError: true,
      };
  }
}

// ── Adapter 匯出 ───────────────────────────────────────────
export const microsoftWordAdapter: AppAdapter = {
  name: "microsoft_word",
  displayName: { zh: "Word", en: "Word" },
  icon: "microsoft",

  authType: "oauth2",
  authConfig,

  tools,
  actionMap,
  getSkill,
  formatResponse,
  formatError,
  execute,

  /** OAuth token 刷新（共用 Microsoft token refresh） */
  async refreshToken(rt: string): Promise<TokenSet> {
    return refreshMicrosoftToken(rt, "microsoft_word");
  },
};
