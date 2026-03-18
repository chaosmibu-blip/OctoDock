// ============================================================
// J3: 參數防呆中間層
// 在 action 執行前攔截明顯錯誤的參數
// - J3a: UUID 自動補全提示
// - J3b: Google Drive 查詢語法自動偵測
// - J3d: 必填參數 / 格式攔截
// ============================================================

/** J3a: Notion UUID 格式驗證 — 需要完整 36 字元（含 dash） */
const NOTION_UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Notion 短 UUID（不含 dash，32 字元） */
const NOTION_SHORT_UUID_REGEX = /^[0-9a-f]{32}$/i;

/** J3b: Google Drive 查詢運算子 */
const DRIVE_QUERY_OPERATORS = /\b(contains|=|!=|<|>|in|and|or|not|has)\b/i;

/** J3d: Email 格式驗證 */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** J3d: ISO 8601 日期格式 */
const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?/;

/** 參數防呆結果 */
export interface ParamGuardResult {
  blocked: boolean;       // true = 攔截，不執行
  error?: string;         // 攔截時的錯誤訊息
  warnings?: string[];    // 警告但不攔截
  transformed?: Record<string, unknown>; // 自動轉換後的參數
}

/**
 * 在 action 執行前檢查參數
 * 回傳 null 表示通過，不需要攔截
 */
export function checkParams(
  app: string,
  toolName: string,
  params: Record<string, unknown>,
): ParamGuardResult | null {
  const warnings: string[] = [];

  // ── J3a: Notion UUID 格式檢查 ──
  if (app === "notion") {
    for (const key of ["page_id", "block_id", "database_id", "parent_id", "new_parent_id"]) {
      const val = params[key];
      if (!val || typeof val !== "string") continue;

      // 短 UUID → 提示需要完整格式
      if (NOTION_SHORT_UUID_REGEX.test(val) && !NOTION_UUID_REGEX.test(val)) {
        // 嘗試自動補 dash
        const formatted = `${val.slice(0, 8)}-${val.slice(8, 12)}-${val.slice(12, 16)}-${val.slice(16, 20)}-${val.slice(20)}`;
        if (NOTION_UUID_REGEX.test(formatted)) {
          // 自動補全成功
          params[key] = formatted;
          warnings.push(`Auto-formatted ${key} from short UUID to full format: ${formatted}`);
        }
      }

      // 格式明顯不對
      if (val.length > 0 && val.length < 32 && !val.includes("-")) {
        return {
          blocked: true,
          error: `Invalid ${key} format. Notion requires full 36-char UUID (e.g., 320a9617-875f-81cd-ba5b-c6ceeb441de2). Use octodock_do(app:"notion", action:"search", params:{query:"..."}) to find the correct ID.`,
        };
      }
    }
  }

  // ── J3b: Google Drive 查詢語法偵測 ──
  if (toolName.includes("gdrive_search") || (app === "google_drive" && toolName.includes("search"))) {
    const query = params.query as string | undefined;
    if (query && !DRIVE_QUERY_OPERATORS.test(query)) {
      // 自然語言 → 自動轉換成 name contains 'xxx'
      params.query = `name contains '${query}'`;
      warnings.push(`Auto-converted natural language query to Drive syntax: name contains '${query}'`);
    }
  }

  // ── J3d: Email 格式檢查 ──
  if (toolName.includes("send") || toolName.includes("reply") || toolName.includes("draft")) {
    const to = params.to as string | undefined;
    if (to && !EMAIL_REGEX.test(to) && !to.includes(",")) {
      return {
        blocked: true,
        error: `Invalid email format: "${to}". Expected format: user@example.com`,
      };
    }
  }

  // ── J3d: 日期格式檢查（Google Calendar） ──
  if (app === "google_calendar") {
    for (const key of ["start", "end", "timeMin", "timeMax"]) {
      const val = params[key];
      if (val && typeof val === "string" && !ISO_DATE_REGEX.test(val)) {
        return {
          blocked: true,
          error: `Invalid date format for ${key}: "${val}". Expected ISO 8601 format: 2026-03-18T10:00 or 2026-03-18`,
        };
      }
    }
  }

  if (warnings.length > 0) {
    return { blocked: false, warnings, transformed: params };
  }

  return null; // 通過，不需攔截
}
