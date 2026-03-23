/**
 * Microsoft PowerPoint Adapter
 * 提供 PowerPoint 簡報建立（pptxgenjs）、讀取、列表、搜尋、匯出 PDF、刪除、檔案資訊功能
 * 使用 Microsoft Graph API 操作 OneDrive 上的 .pptx 檔案
 * 認證：Azure AD OAuth 2.0（共用 microsoft-common 的 token refresh）
 */
import { z } from "zod";
import type {
  AppAdapter,
  OAuthConfig,
  ToolDefinition,
  ToolResult,
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

// ── OAuth 設定（Azure AD，與 Excel/Word 共用） ───────────────
const authConfig: OAuthConfig = {
  type: "oauth2",
  authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
  tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
  scopes: ["offline_access", "Files.ReadWrite", "User.Read"],
  authMethod: "post",
  extraParams: { prompt: "consent" },
};

// ── actionMap：簡化 action 名稱 → 內部工具名稱 ─────────────
const actionMap: Record<string, string> = {
  create_presentation: "pptx_create_presentation",
  read_presentation: "pptx_read_presentation",
  list_files: "pptx_list_files",
  search_files: "pptx_search_files",
  export_pdf: "pptx_export_pdf",
  delete_file: "pptx_delete_file",
  get_file_info: "pptx_get_file_info",
};

// ── ACTION_SKILLS：每個 action 的詳細說明 ─────────────────
const ACTION_SKILLS: Record<string, string> = {
  create_presentation: `## create_presentation
Create a new PowerPoint presentation and upload to OneDrive.
- **title** (required): Presentation title (also used as filename)
- **slides** (required): Array of slide objects, each with:
  - **title** (required): Slide title text
  - **content** (optional): Body text for the slide
  - **bullets** (optional): Array of bullet point strings
  - **image_url** (optional): URL of image to embed (not yet supported, reserved)
Example: \`octodock_do(app:"microsoft_powerpoint", action:"create_presentation", params:{title:"Q1 Report", slides:[{title:"Overview", bullets:["Revenue up 20%","New markets entered"]}, {title:"Details", content:"Full quarterly breakdown..."}]})\``,

  read_presentation: `## read_presentation
Download and extract text content from a PowerPoint file on OneDrive.
- **file_id** (required): OneDrive file ID of the .pptx file
Example: \`octodock_do(app:"microsoft_powerpoint", action:"read_presentation", params:{file_id:"ABC123"})\``,

  list_files: `## list_files
List PowerPoint files (.pptx) in OneDrive.
- **folder** (optional): Folder path to search in
- **limit** (optional): Max results (default 20)
Example: \`octodock_do(app:"microsoft_powerpoint", action:"list_files")\``,

  search_files: `## search_files
Search for PowerPoint files (.pptx) in OneDrive by name or content.
- **query** (required): Search keyword
- **limit** (optional): Max results (default 20)
Example: \`octodock_do(app:"microsoft_powerpoint", action:"search_files", params:{query:"quarterly report"})\``,

  export_pdf: `## export_pdf
Convert a PowerPoint file to PDF via Microsoft Graph API.
- **file_id** (required): OneDrive file ID of the .pptx file
Example: \`octodock_do(app:"microsoft_powerpoint", action:"export_pdf", params:{file_id:"ABC123"})\``,

  delete_file: `## delete_file
Delete a PowerPoint file from OneDrive.
- **file_id** (required): OneDrive file ID to delete
Example: \`octodock_do(app:"microsoft_powerpoint", action:"delete_file", params:{file_id:"ABC123"})\``,

  get_file_info: `## get_file_info
Get metadata (name, size, dates, URL) for a PowerPoint file on OneDrive.
- **file_id** (required): OneDrive file ID
Example: \`octodock_do(app:"microsoft_powerpoint", action:"get_file_info", params:{file_id:"ABC123"})\``,
};

// ── getSkill：回傳操作說明 ────────────────────────────────
function getSkill(action?: string): string | null {
  // 有指定 action → 回傳該 action 的詳細說明
  if (action && ACTION_SKILLS[action]) return ACTION_SKILLS[action];
  // ACTION_SKILLS 沒有的 action → 回傳 null 讓 server.ts fallback 用 actionMap 自動查
  if (action) return null;

  // 沒指定 → 回傳 App 級別總覽
  return `# PowerPoint — Presentation management via OneDrive
Available actions:
- **create_presentation** — Create a new .pptx with slides and upload to OneDrive
- **read_presentation** — Download and extract text from a .pptx file
- **list_files** — List .pptx files in OneDrive
- **search_files** — Search .pptx files by keyword
- **export_pdf** — Convert .pptx to PDF
- **delete_file** — Delete a .pptx file
- **get_file_info** — Get file metadata (name, size, URL, dates)

Use octodock_help(app:"microsoft_powerpoint", action:"<name>") for detailed params.`;
}

// ── 輔助函式：用 pptxgenjs 建立簡報 ─────────────────────────
/** 根據 slides 陣列產生 .pptx Buffer */
async function createPptxBuffer(
  title: string,
  slides: Array<{ title: string; content?: string; bullets?: string[]; image_url?: string }>,
): Promise<Buffer> {
  // 動態 import 避免 top-level import 問題
  const PptxGenJS = (await import("pptxgenjs")).default;
  const pptx = new PptxGenJS();
  pptx.title = title;

  for (const slideData of slides) {
    const slide = pptx.addSlide();

    // 標題文字
    slide.addText(slideData.title, {
      x: 0.5,
      y: 0.3,
      w: 9,
      h: 1,
      fontSize: 28,
      bold: true,
      color: "363636",
    });

    // 內容：優先使用 bullets，其次 content
    if (slideData.bullets && slideData.bullets.length > 0) {
      const bulletItems = slideData.bullets.map((b) => ({
        text: b,
        options: { fontSize: 18, bullet: true, color: "666666" },
      }));
      slide.addText(bulletItems, { x: 0.5, y: 1.5, w: 9, h: 4 });
    } else if (slideData.content) {
      slide.addText(slideData.content, {
        x: 0.5,
        y: 1.5,
        w: 9,
        h: 4,
        fontSize: 18,
        color: "666666",
      });
    }
  }

  // 輸出為 Node.js Buffer
  const output = await pptx.write({ outputType: "nodebuffer" });
  return output as Buffer;
}

// ── 輔助函式：從 .pptx 中提取文字（best-effort） ─────────────
/** 嘗試用 jszip 解壓 .pptx 並從 slide XML 中提取 <a:t> 文字 */
async function extractTextFromPptx(buffer: Buffer): Promise<string[]> {
  try {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(buffer);
    const slides: string[] = [];

    // .pptx 的投影片 XML 在 ppt/slides/slide1.xml, slide2.xml, ...
    for (let i = 1; ; i++) {
      const slideFile = zip.file(`ppt/slides/slide${i}.xml`);
      if (!slideFile) break;
      const xml = await slideFile.async("string");
      // 從 <a:t> 標籤中提取文字
      const texts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
      slides.push(texts.join(" "));
    }

    return slides;
  } catch {
    // 解壓失敗時回傳空陣列，由呼叫端處理 fallback
    return [];
  }
}

// ── formatResponse：API 原始回傳 → AI 友善格式 ───────────
function formatResponse(action: string, rawData: unknown): string {
  const data = rawData as Record<string, unknown>;

  switch (action) {
    case "create_presentation": {
      // 建立簡報 → 回傳名稱和連結
      const name = data.name ?? "(未命名)";
      const webUrl = data.webUrl ?? "";
      const slideCount = data.slideCount ?? "?";
      return [
        `簡報已建立！`,
        `- 名稱: ${name}`,
        `- 投影片數: ${slideCount}`,
        webUrl ? `- URL: ${webUrl}` : "",
        `- ID: ${data.id ?? ""}`,
      ].filter(Boolean).join("\n");
    }

    case "read_presentation": {
      // 讀取簡報 → 回傳每張投影片的文字
      const slides = data.slides as string[] | undefined;
      const fileInfo = data.fileInfo as Record<string, unknown> | undefined;
      const lines: string[] = [];

      if (fileInfo) {
        lines.push(`# ${fileInfo.name ?? "PowerPoint"}`);
        if (fileInfo.webUrl) lines.push(`URL: ${fileInfo.webUrl}`);
        lines.push("");
      }

      if (slides && slides.length > 0) {
        slides.forEach((text, i) => {
          lines.push(`## Slide ${i + 1}`);
          lines.push(text || "(空白投影片)");
          lines.push("");
        });
      } else {
        lines.push("（無法提取文字內容，建議下載檔案直接檢視）");
      }

      return lines.join("\n");
    }

    case "list_files": {
      // 列表 → 用共用格式化函式
      const files = data as unknown;
      return formatFileList(files as unknown[], "PowerPoint");
    }

    case "search_files": {
      // 搜尋 → 用共用格式化函式
      const files = data as unknown;
      return formatFileList(files as unknown[], "PowerPoint");
    }

    case "get_file_info": {
      // 檔案資訊 → 用共用格式化函式
      return formatFileInfo(data);
    }

    case "export_pdf": {
      return `PDF 匯出完成！檔案已可下載。`;
    }

    case "delete_file": {
      return `檔案已刪除。`;
    }

    default:
      return JSON.stringify(data, null, 2);
  }
}

// ── formatError：智慧錯誤引導 ────────────────────────────
function formatError(action: string, errorMessage: string): string | null {
  // 先用 Microsoft 共用錯誤格式化
  const common = formatMicrosoftError(errorMessage);
  if (common) return common;

  // PowerPoint 專屬錯誤處理
  const msg = errorMessage.toLowerCase();
  if (msg.includes("pptxgenjs") || msg.includes("pptx generation")) {
    return "「簡報產生失敗 (PPTX_GENERATION_ERROR)」\n請檢查投影片資料格式是否正確。";
  }
  if (msg.includes("jszip") || msg.includes("zip") || msg.includes("corrupt")) {
    return "「檔案解壓失敗 (PPTX_PARSE_ERROR)」\n檔案可能已損壞或不是有效的 .pptx 格式。";
  }
  if (msg.includes("too large") || msg.includes("4mb") || msg.includes("request entity too large")) {
    return "「檔案過大 (FILE_TOO_LARGE)」\n目前僅支援 4MB 以下的簡報上傳，請減少投影片數量或圖片大小。";
  }

  return null;
}

// ── 工具定義 ──────────────────────────────────────────────
const tools: ToolDefinition[] = [
  {
    name: "pptx_create_presentation",
    description: "Create a new PowerPoint presentation with slides and upload to OneDrive.",
    inputSchema: {
      title: z.string().describe("Presentation title (also used as filename)"),
      slides: z.array(z.object({
        title: z.string().describe("Slide title text"),
        content: z.string().optional().describe("Body text for the slide"),
        bullets: z.array(z.string()).optional().describe("Bullet point strings"),
        image_url: z.string().optional().describe("Image URL to embed (reserved for future use)"),
      })).describe("Array of slide objects"),
    },
  },
  {
    name: "pptx_read_presentation",
    description: "Download a PowerPoint file from OneDrive and extract text content from each slide.",
    inputSchema: {
      file_id: z.string().describe("OneDrive file ID of the .pptx file"),
    },
  },
  {
    name: "pptx_list_files",
    description: "List PowerPoint files (.pptx) in the user's OneDrive.",
    inputSchema: {
      folder: z.string().optional().describe("Folder path to search in"),
      limit: z.number().optional().describe("Max results (default 20)"),
    },
  },
  {
    name: "pptx_search_files",
    description: "Search for PowerPoint files (.pptx) in OneDrive by keyword.",
    inputSchema: {
      query: z.string().describe("Search keyword"),
      limit: z.number().optional().describe("Max results (default 20)"),
    },
  },
  {
    name: "pptx_export_pdf",
    description: "Convert a PowerPoint file to PDF format via Microsoft Graph API.",
    inputSchema: {
      file_id: z.string().describe("OneDrive file ID of the .pptx file"),
    },
  },
  {
    name: "pptx_delete_file",
    description: "Delete a PowerPoint file from OneDrive.",
    inputSchema: {
      file_id: z.string().describe("OneDrive file ID to delete"),
    },
  },
  {
    name: "pptx_get_file_info",
    description: "Get metadata (name, size, dates, URL) for a PowerPoint file on OneDrive.",
    inputSchema: {
      file_id: z.string().describe("OneDrive file ID"),
    },
  },
];

// ── execute：實際 API 呼叫 ────────────────────────────────
async function execute(
  toolName: string,
  params: Record<string, unknown>,
  token: string,
): Promise<ToolResult> {
  switch (toolName) {
    // ── 建立簡報 ──
    case "pptx_create_presentation": {
      const title = String(params.title);
      const slides = params.slides as Array<{ title: string; content?: string; bullets?: string[]; image_url?: string }>;

      // 用 pptxgenjs 產生 .pptx Buffer
      const buffer = await createPptxBuffer(title, slides);

      // 上傳到 OneDrive
      const fileName = `${title}.pptx`;
      const result = await uploadSmallFile(
        token,
        fileName,
        buffer,
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      );

      // 把投影片數量附加到回傳結果
      const resultObj = result as Record<string, unknown>;
      resultObj.slideCount = slides.length;

      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }

    // ── 讀取簡報 ──
    case "pptx_read_presentation": {
      const fileId = String(params.file_id);

      // 取得檔案資訊
      const info = await getFileInfo(token, fileId) as Record<string, unknown>;

      // 下載 .pptx 二進位檔案
      const buffer = await downloadFile(token, fileId);

      // 嘗試從 .pptx 中提取文字
      const slides = await extractTextFromPptx(buffer);

      const result = { fileInfo: info, slides };
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }

    // ── 列出檔案 ──
    case "pptx_list_files": {
      const limit = params.limit ? Number(params.limit) : 20;
      const folder = params.folder ? String(params.folder) : undefined;
      const files = await listFiles(token, "pptx", limit, folder);
      return { content: [{ type: "text", text: JSON.stringify(files) }] };
    }

    // ── 搜尋檔案 ──
    case "pptx_search_files": {
      const query = String(params.query);
      const limit = params.limit ? Number(params.limit) : 20;
      const files = await searchFiles(token, query, "pptx", limit);
      return { content: [{ type: "text", text: JSON.stringify(files) }] };
    }

    // ── 匯出 PDF ──
    case "pptx_export_pdf": {
      const fileId = String(params.file_id);
      const pdfBuffer = await convertFile(token, fileId, "pdf");
      // 上傳 PDF 到 OneDrive（與原檔同目錄）
      const info = await getFileInfo(token, fileId) as { name: string };
      const pdfName = info.name.replace(/\.pptx$/i, ".pdf");
      const uploaded = await uploadSmallFile(
        token,
        pdfName,
        pdfBuffer,
        "application/pdf",
      );
      return { content: [{ type: "text", text: JSON.stringify(uploaded) }] };
    }

    // ── 刪除檔案 ──
    case "pptx_delete_file": {
      const fileId = String(params.file_id);
      await deleteFile(token, fileId);
      return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
    }

    // ── 取得檔案資訊 ──
    case "pptx_get_file_info": {
      const fileId = String(params.file_id);
      const info = await getFileInfo(token, fileId);
      return { content: [{ type: "text", text: JSON.stringify(info) }] };
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
        isError: true,
      };
  }
}

// ── 匯出 Adapter ─────────────────────────────────────────
export const microsoftPowerpointAdapter: AppAdapter = {
  name: "microsoft_powerpoint",
  displayName: { zh: "PowerPoint", en: "PowerPoint" },
  icon: "microsoft",
  authType: "oauth2",
  authConfig,
  actionMap,
  getSkill,
  formatResponse,
  formatError,
  tools,
  execute,
  refreshToken: (rt: string) => refreshMicrosoftToken(rt, "microsoft_powerpoint"),
};
