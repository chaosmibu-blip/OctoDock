import { randomBytes } from "crypto";

export function generateMcpApiKey(): string {
  return `ak_${randomBytes(24).toString("hex")}`;
}

export const APP_NAME = "OctoDock";
export const APP_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

/**
 * 網站公開基底 URL（用於 SEO、OAuth、API 回傳等需要完整域名的地方）
 * 優先讀 NEXT_PUBLIC_BASE_URL（前端可用），再 fallback NEXTAUTH_URL，最後 fallback 正式域名
 */
export const BASE_URL =
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.NEXTAUTH_URL ||
  "https://octo-dock.com";

// ── MCP 回應截斷設定 ──
/** 回應超過此字元數時，存入 DB 並回傳摘要 */
export const MAX_RESPONSE_CHARS = 3000;
/** 截斷時保留的前段字元數 */
export const TRUNCATED_HEAD_CHARS = 2000;
/** 截斷時保留的尾段字元數 */
export const TRUNCATED_TAIL_CHARS = 500;
/** 批次操作回傳的最大字元數 */
export const BATCH_MAX_CHARS = 5000;

// ── Notion block 限制 ──
/** 分頁拉取 block 的上限（避免無限迴圈） */
export const NOTION_MAX_BLOCKS = 1000;
/** Blog 文章的 block 上限 */
export const NOTION_BLOG_MAX_BLOCKS = 500;
/** Notion API 單次請求的 block 數量限制 */
export const NOTION_API_BLOCK_LIMIT = 100;

// ── 時間窗口 ──
/** SOP 偵測的 session 間隔（30 分鐘） */
export const SESSION_GAP_MS = 30 * 60 * 1000;
/** 記憶保留天數 */
export const RETENTION_DAYS = 30;
/** 操作日誌保留天數 */
export const OPERATIONS_RETENTION_DAYS = 90;

// ── AI 設定 ──
/** AI 呼叫的預設 max_tokens */
export const DEFAULT_MAX_TOKENS = 1024;

// ── MCP Schema 版本 ──
/**
 * MCP 工具定義的 schema 版本號
 * 只有當 octodock_do / octodock_help 的參數定義（名稱、型別、必填/選填）發生變更時才遞增
 * 用於偵測 client 快取過期：server 回傳中帶此版本，client 缺少必填參數時提示重連
 */
export const MCP_SCHEMA_VERSION = 1;
