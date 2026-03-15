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

/** 三種認證方式的聯合類型 */
export type AuthConfig = OAuthConfig | ApiKeyConfig | BotTokenConfig;

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
// octodock_do 標準回傳格式
// 所有 App 操作統一回傳這個結構，讓 AI 容易理解
// ============================================================

export interface DoResult {
  ok: boolean; // 操作是否成功
  data?: unknown; // 回傳的資料（成功時）
  url?: string; // 相關連結（例如建立的頁面 URL）
  title?: string; // 資源標題（例如頁面標題）
  error?: string; // 錯誤訊息（失敗時）
  suggestions?: string[]; // 建議（失敗時提供替代方案）
  context?: string; // 用戶上下文摘要（僅 session 首次 do() 附帶）
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

  authType: "oauth2" | "api_key" | "bot_token"; // 使用的認證方式
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
   */
  getSkill(action?: string): string;

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

  /** OAuth token 過期時的自動刷新（Notion 不需要，Google 等需要） */
  refreshToken?(refreshToken: string): Promise<TokenSet>;
}

// ============================================================
// 類型守衛
// Adapter Registry 掃描模組時用來判斷是否為合法的 AppAdapter
// ============================================================

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
