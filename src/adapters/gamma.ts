import { z } from "zod";
import type { AppAdapter, ToolDefinition, ToolResult, ApiKeyConfig } from "./types";

// ============================================================
// Gamma Adapter
// AI 原生簡報生成工具
// API 文件：https://developers.gamma.app
// 認證方式：API Key（X-API-KEY header）
// ============================================================

/** Gamma API base URL */
const BASE_URL = "https://public-api.gamma.app/v1.0";

/** 生成狀態 polling 間隔（毫秒） */
const POLL_INTERVAL_MS = 5000;

/** 最大 polling 次數（5 秒 × 60 = 5 分鐘上限） */
const MAX_POLL_ATTEMPTS = 60;

// ============================================================
// 認證設定：API Key
// ============================================================

const authConfig: ApiKeyConfig = {
  type: "api_key",
  instructions: {
    zh: "1. 前往 Gamma 帳號設定 > API Keys\n2. 建立新的 API Key\n3. 複製 API Key 貼到這裡\n\n注意：需要 Pro（$18/月）以上方案才能使用 API",
    en: "1. Go to Gamma Account Settings > API Keys\n2. Create a new API Key\n3. Copy and paste the API Key here\n\nNote: Requires Pro ($18/mo) or higher plan for API access",
  },
  validateEndpoint: `${BASE_URL}/themes`,
};

// ============================================================
// API 請求工具函式
// ============================================================

/**
 * Gamma API 請求封裝
 * 所有請求都帶 X-API-KEY header
 */
async function gammaFetch(
  endpoint: string,
  token: string,
  options: RequestInit = {},
): Promise<unknown> {
  const url = `${BASE_URL}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      "X-API-KEY": token,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  // 204 No Content
  if (res.status === 204) return { _status: 204 };

  const body = await res.json();

  if (!res.ok) {
    throw new Error(JSON.stringify({
      status: res.status,
      message: body?.message || body?.error || res.statusText,
    }));
  }

  return body;
}

/**
 * 非同步生成 polling
 * Gamma 的生成是非同步的，需要 polling 直到完成或失敗
 */
async function pollGeneration(
  generationId: string,
  token: string,
): Promise<unknown> {
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    const result = await gammaFetch(`/generations/${generationId}`, token) as Record<string, unknown>;
    const status = result.status as string;

    if (status === "completed") return result;
    if (status === "failed") {
      throw new Error(JSON.stringify({
        status: 500,
        message: result.error || "Generation failed",
      }));
    }

    // 等待下一次 polling
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(JSON.stringify({
    status: 408,
    message: `Generation timed out after ${MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS / 1000} seconds`,
  }));
}

// ============================================================
// Action Map：簡化名稱 → 內部工具名稱
// ============================================================

const actionMap: Record<string, string> = {
  // 生成
  generate: "gamma_generate",
  generate_from_template: "gamma_generate_from_template",
  // 查詢狀態
  get_status: "gamma_get_status",
  // 列表
  list_themes: "gamma_list_themes",
  list_folders: "gamma_list_folders",
};

// ============================================================
// 操作說明（getSkill 用）
// ============================================================

/** 各 action 的詳細說明 */
const ACTION_SKILLS: Record<string, string> = {
  generate: `## generate
Generate a presentation, document, or social post from text.

**Required params:**
- \`input_text\` (string): Content text or prompt (up to ~400,000 chars)
- \`format\` (string): "presentation" | "document" | "social"

**Optional params:**
- \`text_mode\` (string): "generate" (elaborate) | "condense" (summarize) | "preserve" (keep exact text). Default: "generate"
- \`amount\` (string): "brief" | "medium" | "detailed" | "extensive"
- \`tone\` (string): Mood/voice descriptor (only for generate mode)
- \`audience\` (string): Target audience description
- \`language\` (string): Output language (e.g. "zh-TW", "en")
- \`num_cards\` (number): Number of slides/cards
- \`dimensions\` (string): "fluid" | "16x9" | "4x3"
- \`export_as\` (string): "pdf" | "pptx" | "png"
- \`theme_name\` (string): Theme name (use list_themes to see available themes)
- \`additional_instructions\` (string): Extra generation instructions

**Example:**
\`\`\`json
{
  "input_text": "OctoDock 產品介紹：一個 URL 連接所有 App 的 AI 中介層",
  "format": "presentation",
  "language": "zh-TW",
  "num_cards": 10,
  "dimensions": "16x9",
  "export_as": "pdf"
}
\`\`\``,

  generate_from_template: `## generate_from_template
Generate content from an existing Gamma template.

**Required params:**
- \`gamma_id\` (string): Template Gamma ID (get from Gamma UI)

**Optional params:**
- \`input_text\` (string): Content, image URLs, and instructions
- \`export_as\` (string): "pdf" | "pptx" | "png"
- \`folder_ids\` (array): Destination folder IDs

**Example:**
\`\`\`json
{
  "gamma_id": "abc123def456",
  "input_text": "公司名稱：OctoDock\\n產品：AI MCP 中介層\\n目標客戶：非技術用戶",
  "export_as": "pptx"
}
\`\`\``,

  get_status: `## get_status
Check the status of an ongoing generation.

**Required params:**
- \`generation_id\` (string): The generation ID returned by generate

**Example:**
\`\`\`json
{ "generation_id": "abc123" }
\`\`\``,

  list_themes: `## list_themes
List all available themes in your workspace.
No parameters required.`,

  list_folders: `## list_folders
List all folders in your workspace.
No parameters required.`,
};

// ============================================================
// getSkill：回傳操作說明
// ============================================================

function getSkill(action?: string): string {
  // 帶 action：回傳特定 action 的完整說明
  if (action && ACTION_SKILLS[action]) {
    return ACTION_SKILLS[action];
  }

  // 不帶 action：回傳 App 級別清單
  return `Gamma — AI presentation generator.
Available actions:
- generate: Create a presentation/document/social post from text
- generate_from_template: Create from an existing template
- get_status: Check generation status
- list_themes: List available themes
- list_folders: List workspace folders

Note: Gamma API is generation-only. You can create and export content, but cannot list/edit/delete existing presentations.`;
}

// ============================================================
// formatResponse：API 回傳 → AI 友善格式
// ============================================================

function formatResponse(action: string, rawData: unknown): string {
  const data = rawData as Record<string, unknown>;

  switch (action) {
    case "gamma_generate":
    case "gamma_generate_from_template": {
      // 生成完成的結果
      const lines: string[] = [];
      lines.push(`簡報生成完成！`);
      if (data.title) lines.push(`標題：${data.title}`);
      if (data.url) lines.push(`連結：${data.url}`);
      if (data.exportUrl) lines.push(`匯出檔案：${data.exportUrl}`);
      if (data.credits) {
        const credits = data.credits as Record<string, unknown>;
        lines.push(`消耗 credits：${credits.deducted}（剩餘 ${credits.remaining}）`);
      }
      if (data.numCards) lines.push(`頁數：${data.numCards}`);
      return lines.join("\n");
    }

    case "gamma_get_status": {
      // 生成狀態查詢
      const lines: string[] = [];
      lines.push(`生成狀態：${data.status}`);
      if (data.status === "completed") {
        if (data.title) lines.push(`標題：${data.title}`);
        if (data.url) lines.push(`連結：${data.url}`);
        if (data.exportUrl) lines.push(`匯出檔案：${data.exportUrl}`);
      }
      return lines.join("\n");
    }

    case "gamma_list_themes": {
      // 主題列表
      const themes = Array.isArray(data) ? data : (data.themes as unknown[] || []);
      if (themes.length === 0) return "沒有可用的主題。";
      const lines = ["可用主題："];
      for (const t of themes) {
        const theme = t as Record<string, unknown>;
        lines.push(`- ${theme.name || theme.id}${theme.id ? ` (ID: ${theme.id})` : ""}`);
      }
      return lines.join("\n");
    }

    case "gamma_list_folders": {
      // 資料夾列表
      const folders = Array.isArray(data) ? data : (data.folders as unknown[] || []);
      if (folders.length === 0) return "沒有資料夾。";
      const lines = ["資料夾："];
      for (const f of folders) {
        const folder = f as Record<string, unknown>;
        lines.push(`- ${folder.name || folder.id}${folder.id ? ` (ID: ${folder.id})` : ""}`);
      }
      return lines.join("\n");
    }

    default:
      return JSON.stringify(data, null, 2);
  }
}

// ============================================================
// formatError：常見錯誤 → 友善提示
// ============================================================

function formatError(action: string, errorMessage: string): string | null {
  const msg = errorMessage.toLowerCase();

  // API Key 無效
  if (msg.includes("401") || msg.includes("unauthorized") || msg.includes("invalid api key")) {
    return "「API Key 無效或已過期 (GAMMA_AUTH_ERROR)」\n請到 Gamma 帳號設定 > API Keys 重新產生 API Key。";
  }

  // 付費方案不足
  if (msg.includes("403") || msg.includes("forbidden") || msg.includes("upgrade")) {
    return "「此功能需要 Pro 以上方案 (GAMMA_PLAN_REQUIRED)」\n免費帳號無法使用 API，請升級至 Pro（$18/月）以上方案。";
  }

  // Credits 不足
  if (msg.includes("credit") || msg.includes("insufficient")) {
    return "「AI Credits 不足 (GAMMA_NO_CREDITS)」\n本月 credits 已用完。可到帳號設定購買額外 credits 或等下月重置。";
  }

  // Rate limit
  if (msg.includes("429") || msg.includes("too many")) {
    return "「請求過於頻繁 (GAMMA_RATE_LIMITED)」\n請稍後再試。";
  }

  // 生成超時
  if (msg.includes("timeout") || msg.includes("408")) {
    return "「生成超時 (GAMMA_TIMEOUT)」\n簡報生成耗時過長。可能是內容太多或 Gamma 伺服器繁忙，請稍後再試。";
  }

  return null;
}

// ============================================================
// 工具定義（tools array）
// ============================================================

const tools: ToolDefinition[] = [
  {
    name: "gamma_generate",
    description: "Generate a presentation, document, or social post from text using Gamma AI",
    inputSchema: {
      input_text: z.string().describe("Content text or prompt"),
      format: z.enum(["presentation", "document", "social"]).describe("Output format"),
      text_mode: z.enum(["generate", "condense", "preserve"]).optional().describe("Text processing mode"),
      amount: z.enum(["brief", "medium", "detailed", "extensive"]).optional().describe("Content amount"),
      tone: z.string().optional().describe("Mood/voice descriptor"),
      audience: z.string().optional().describe("Target audience"),
      language: z.string().optional().describe("Output language (e.g. zh-TW, en)"),
      num_cards: z.number().optional().describe("Number of slides/cards"),
      dimensions: z.enum(["fluid", "16x9", "4x3"]).optional().describe("Slide dimensions"),
      export_as: z.enum(["pdf", "pptx", "png"]).optional().describe("Export format"),
      theme_name: z.string().optional().describe("Theme name"),
      additional_instructions: z.string().optional().describe("Extra generation instructions"),
    },
  },
  {
    name: "gamma_generate_from_template",
    description: "Generate content from an existing Gamma template",
    inputSchema: {
      gamma_id: z.string().describe("Template Gamma ID"),
      input_text: z.string().optional().describe("Content and instructions"),
      export_as: z.enum(["pdf", "pptx", "png"]).optional().describe("Export format"),
      folder_ids: z.array(z.string()).optional().describe("Destination folder IDs"),
    },
  },
  {
    name: "gamma_get_status",
    description: "Check the status of a Gamma generation",
    inputSchema: {
      generation_id: z.string().describe("Generation ID"),
    },
  },
  {
    name: "gamma_list_themes",
    description: "List available themes in Gamma workspace",
    inputSchema: {},
  },
  {
    name: "gamma_list_folders",
    description: "List folders in Gamma workspace",
    inputSchema: {},
  },
];

// ============================================================
// execute：實際 API 呼叫
// ============================================================

async function execute(
  toolName: string,
  params: Record<string, unknown>,
  token: string,
): Promise<ToolResult> {
  switch (toolName) {
    // 從文字生成簡報/文件
    case "gamma_generate": {
      // 組裝 API 請求 body（snake_case → camelCase）
      const body: Record<string, unknown> = {
        inputText: params.input_text as string,
        format: params.format as string,
      };
      if (params.text_mode) body.textMode = params.text_mode;
      if (params.amount || params.tone || params.audience || params.language) {
        const textOptions: Record<string, unknown> = {};
        if (params.amount) textOptions.amount = params.amount;
        if (params.tone) textOptions.tone = params.tone;
        if (params.audience) textOptions.audience = params.audience;
        if (params.language) textOptions.language = params.language;
        body.textOptions = textOptions;
      }
      if (params.num_cards) body.numCards = params.num_cards;
      if (params.dimensions) body.dimensions = params.dimensions;
      if (params.export_as) body.exportAs = params.export_as;
      if (params.theme_name) body.themeName = params.theme_name;
      if (params.additional_instructions) body.additionalInstructions = params.additional_instructions;

      // 發起生成請求
      const genResult = await gammaFetch("/generations", token, {
        method: "POST",
        body: JSON.stringify(body),
      }) as Record<string, unknown>;

      const generationId = genResult.generationId as string;

      // 非同步 polling 直到完成
      const completed = await pollGeneration(generationId, token);
      return { content: [{ type: "text", text: JSON.stringify(completed) }] };
    }

    // 從模板生成
    case "gamma_generate_from_template": {
      const body: Record<string, unknown> = {
        gammaId: params.gamma_id as string,
      };
      if (params.input_text) body.inputText = params.input_text;
      if (params.export_as) body.exportAs = params.export_as;
      if (params.folder_ids) body.folderIds = params.folder_ids;

      const genResult = await gammaFetch("/generations/from-template", token, {
        method: "POST",
        body: JSON.stringify(body),
      }) as Record<string, unknown>;

      const generationId = genResult.generationId as string;

      // 非同步 polling 直到完成
      const completed = await pollGeneration(generationId, token);
      return { content: [{ type: "text", text: JSON.stringify(completed) }] };
    }

    // 查詢生成狀態（不等待完成，直接回傳當前狀態）
    case "gamma_get_status": {
      const result = await gammaFetch(
        `/generations/${params.generation_id}`,
        token,
      );
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }

    // 列出主題
    case "gamma_list_themes": {
      const result = await gammaFetch("/themes", token);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }

    // 列出資料夾
    case "gamma_list_folders": {
      const result = await gammaFetch("/folders", token);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }

    default:
      throw new Error(JSON.stringify({
        status: 400,
        message: `Unknown tool: ${toolName}`,
      }));
  }
}

// ============================================================
// 匯出 Adapter
// ============================================================

export const gammaAdapter: AppAdapter = {
  name: "gamma",
  displayName: { zh: "Gamma", en: "Gamma" },
  icon: "gamma",
  authType: "api_key",
  authConfig,
  tools,
  actionMap,
  getSkill,
  formatResponse,
  formatError,
  execute,
};
