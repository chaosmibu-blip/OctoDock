import { z } from "zod";

// ============================================================
// 認證設定類型
// 每個 App Adapter 需要選擇一種認證方式
// ============================================================

/** OAuth 2.0 認證設定（Notion、Google、Meta 等） */
export type OAuthConfig = {
  type: "oauth2";
  authorizeUrl: string; // OAuth 授權頁 URL
  tokenUrl: string; // Token 交換 URL
  scopes: string[]; // 申請的權限範圍
  authMethod: "basic" | "post"; // Notion 用 basic，Google/Meta 用 post
  extraParams?: Record<string, string>; // 額外的 OAuth 參數（如 access_type, prompt）
};

/** API Key 認證設定（簡單的 key-based 認證） */
export type ApiKeyConfig = {
  type: "api_key";
  instructions: Record<string, string>; // 多語系設定說明
  validateEndpoint: string; // 驗證 key 有效性的 API 端點
};

/** Bot Token 認證設定（LINE 等 bot 平台） */
export type BotTokenConfig = {
  type: "bot_token";
  instructions: Record<string, string>; // 多語系設定說明
  setupWebhook: boolean; // 是否需要設定 webhook
};

/** 手機號碼認證設定（Telegram Client API 等需要手機驗證碼的平台） */
export type PhoneAuthConfig = {
  type: "phone_auth";
  instructions: Record<string, string>; // 多語系設定說明
};

/** 四種認證方式的聯合類型 */
export type AuthConfig = OAuthConfig | ApiKeyConfig | BotTokenConfig | PhoneAuthConfig;

// ============================================================
// 工具類型定義
// 用於 MCP server 註冊工具時的結構
// ============================================================

/** 單一工具的定義：名稱、描述、輸入參數 schema */
export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, z.ZodTypeAny>;
}

/** 工具執行結果：MCP 協議要求的回傳格式 */
export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean; // 標記是否為錯誤結果
}

/** OAuth token 交換後的回傳結構 */
export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

// ============================================================
// 名稱驗證結果
// validateAndResolveNames 全域攔截用的三級信心結構
// ============================================================

/** 名稱→ID 驗證的三級結果 */
export interface NameValidationResult {
  /** certain = 精確匹配（自動執行）、partial = 模糊匹配（攔截）、not_found = 找不到（攔截） */
  confidence: "certain" | "partial" | "not_found";
  /** 解析到的 ID（certain / partial 時有值） */
  resolvedId?: string;
  /** 實際匹配到的名稱（fuzzy match 時跟輸入不同） */
  resolvedName?: string;
  /** 用戶現有的選項列表（partial / not_found 時回傳） */
  candidates?: Array<{ name: string; id: string }>;
  /** 附加提醒（partial 時說明為何是模糊匹配） */
  warning?: string;
}

// ============================================================
// octodock_do 標準回傳格式
// 所有 App 操作統一回傳這個結構，讓 AI 容易理解
// ============================================================

export interface DoResult {
  ok: boolean; // 操作是否成功
  data?: unknown; // 回傳的資料（成功時）
  url?: string; // 相關連結（例如建立的頁面 URL）
  title?: string; // 資源標題（例如頁面標題）
  error?: string; // 錯誤訊息（失敗時）
  errorCode?: string; // B1: 結構化錯誤碼（TOKEN_EXPIRED、RATE_LIMITED 等）
  retryable?: boolean; // B1: Agent 可據此決定是否重試
  retryAfterMs?: number; // B1: 建議重試間隔（毫秒）
  suggestions?: string[]; // 已廢棄（N 組實測結論：AI 完全不看此欄位，僅保留向下相容）
  context?: string; // 用戶上下文摘要（僅 session 首次 do() 附帶）
  summary?: Record<string, unknown>; // C5: 操作結果可驗證摘要
  warnings?: string[]; // C2: 異常偵測警告
  nextSuggestion?: { app: string; action: string; reason: string; probability: number; exampleCall?: string }; // E1: 操作鏈建議（含呼叫語法範例）
  recoveryHint?: { lastSuccessfulParams: Record<string, unknown>; note: string }; // E2: 失敗修復建議
  candidates?: Array<{ title: string; id: string }>; // NOT_FOUND 時自動搜尋的候選結果
  frequentFailure?: { count: number; since: string; suggestion: string }; // 高頻失敗偵測
  affectedResources?: Array<{ id: string; title: string; status?: string }>; // G6: 錯誤時列出被影響的資源
}

// ============================================================
// AppAdapter 介面
// 每個 App（Notion、Gmail、LINE 等）實作這個介面
// 核心系統透過 Adapter Registry 自動掃描和註冊
// ============================================================

export interface AppAdapter {
  name: string; // App 識別名稱：'notion' | 'gmail' | 'line' | ...
  displayName: Record<string, string>; // 多語系顯示名稱：{ zh: 'Notion', en: 'Notion' }
  icon: string; // 圖示識別碼

  authType: "oauth2" | "api_key" | "bot_token" | "phone_auth"; // 使用的認證方式
  authConfig: AuthConfig; // 認證設定細節

  tools: ToolDefinition[]; // 內部工具定義（用於 execute 的路由）

  // === do + help 架構新增 ===

  // === 以下全部必填 — 漏了任何一個 TypeScript 會報錯 ===

  /**
   * 簡化 action 名稱 → 內部工具名稱的對應表
   * 必填。octodock_do 收到 action 後查這張表找到要執行的內部工具
   */
  actionMap: Record<string, string>;

  /**
   * 回傳操作說明（Skill）
   * 必填。不帶 action：App 級別清單。帶 action：完整參數 + 範例
   * 找不到 action 時回傳 null，讓 server.ts 用 actionMap fallback
   */
  getSkill(action?: string): string | null;

  /**
   * 將 API 原始回傳轉成 AI 友善格式
   * 必填。不准把 raw JSON 直接丟給 AI
   */
  formatResponse(action: string, rawData: unknown): string;

  /**
   * 智慧錯誤引導
   * 必填。攔截常見 API 錯誤，回傳有用提示。不需要攔截的回傳 null
   */
  formatError(action: string, errorMessage: string): string | null;

  /**
   * 執行內部工具（原始 API 呼叫）
   * octodock_do 在完成參數轉換後，最終會呼叫這個方法
   */
  execute(
    toolName: string,
    params: Record<string, unknown>,
    token: string,
  ): Promise<ToolResult>;

  /** C5: 從操作結果中提取結構化摘要（optional，有預設 fallback） */
  extractSummary?(action: string, rawResult: unknown): Record<string, unknown> | null;

  /**
   * 從操作結果中提取可學習的實體（名稱→ID 映射）
   * 架構層會自動呼叫 learnIdentifier 學習回傳的實體
   * 讓 AI 下次能直接用自然語言名稱操作，不用查 ID
   */
  extractEntities?(action: string, rawData: unknown): EntityInfo[];

  /** OAuth token 過期時的自動刷新（Notion 不需要，Google 等需要） */
  refreshToken?(refreshToken: string): Promise<TokenSet>;

  // === 必經路徑機制：全域名稱驗證 + Per-App 攔截 ===

  /**
   * 宣告哪些參數是「名稱」（需要驗證是否存在）
   * key = 參數名（AI 可能傳的欄位名），value = 實體類型
   * 例如 { project_name: "project", label: "label" }
   * server.ts 的 validateAndResolveNames 會根據這張表自動檢查
   */
  nameParamMap?: Record<string, string>;

  /**
   * 驗證名稱是否存在於用戶的 App 中
   * 當 memory 查不到時，server.ts 會呼叫此方法走 API 驗證
   * 回傳 null 表示「這個參數我不處理」
   */
  validateNameParam?(
    paramKey: string,
    paramValue: string,
    token: string,
  ): Promise<NameValidationResult | null>;

  /**
   * 執行前驗證 hook — 超出名稱驗證範圍的 Per-App 專屬檢查
   * 例如：Notion 查 DB schema、Calendar 套用用戶規則
   * 回傳 DoResult 表示攔截（不執行），回傳 null 表示放行
   */
  preValidate?(
    action: string,
    params: Record<string, unknown>,
    token: string,
  ): Promise<DoResult | null>;
}

/** 可學習的實體資訊（名稱→ID 映射） */
export interface EntityInfo {
  name: string;   // 實體名稱（頁面標題、檔名、repo 名稱等）
  id: string;     // 實體 ID
  type: string;   // 實體類型（page, file, repo, message, event, task 等）
}

// ============================================================
// 類型守衛
// Adapter Registry 掃描模組時用來判斷是否為合法的 AppAdapter
// ============================================================

/**
 * 從 Notion 物件的 properties 中提取標題文字（共用工具函式）
 * 檢查 title 屬性和 Name 屬性（資料庫項目常用）
 */
export function extractNotionTitle(obj: Record<string, unknown>): string | undefined {
  const props = obj.properties as Record<string, unknown> | undefined;
  if (!props) return undefined;
  if (props.title) {
    const titleProp = props.title as { title?: Array<{ plain_text: string }> };
    if (titleProp.title?.[0]?.plain_text) return titleProp.title[0].plain_text;
  }
  if (props.Name) {
    const nameProp = props.Name as { title?: Array<{ plain_text: string }> };
    if (nameProp.title?.[0]?.plain_text) return nameProp.title[0].plain_text;
  }
  return undefined;
}

/** 檢查一個物件是否實作了 AppAdapter 介面的所有必要屬性 */
export function isAppAdapter(obj: unknown): obj is AppAdapter {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "name" in obj &&
    "authType" in obj &&
    "tools" in obj &&
    "execute" in obj &&
    "actionMap" in obj &&
    "getSkill" in obj &&
    "formatResponse" in obj &&
    "formatError" in obj
  );
}
