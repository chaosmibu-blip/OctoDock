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

      // 已經是完整 UUID → 通過
      if (NOTION_UUID_REGEX.test(val)) continue;

      // 短 UUID（32 hex 無 dash）→ 嘗試自動補 dash
      if (NOTION_SHORT_UUID_REGEX.test(val)) {
        const formatted = `${val.slice(0, 8)}-${val.slice(8, 12)}-${val.slice(12, 16)}-${val.slice(16, 20)}-${val.slice(20)}`;
        if (NOTION_UUID_REGEX.test(formatted)) {
          params[key] = formatted;
          warnings.push(`Auto-formatted ${key} from short UUID to full format: ${formatted}`);
          continue;
        }
      }

      // 不完整的 UUID（含 dash 但不足 36 字元，或不含 dash 但不足 32 字元）→ 攔截
      if (val.length > 0 && val.length < 36) {
        return {
          blocked: true,
          error: `Invalid ${key} format: "${val}" (${val.length} chars). Notion requires full 36-char UUID (e.g., 320a9617-875f-81cd-ba5b-c6ceeb441de2). Use octodock_do(app:"notion", action:"search", params:{query:"..."}) to find the correct ID.`,
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

  // ── J3d: 日期格式檢查 + 時區自動補全（Google Calendar） ──
  if (app === "google_calendar") {
    /** 偵測日期字串是否已帶時區（+HH:MM / -HH:MM / Z） */
    const HAS_TZ = /([+-]\d{2}:\d{2}|Z)$/;
    /** 預設時區偏移（台灣 UTC+8） */
    const DEFAULT_TZ = "+08:00";

    for (const key of ["start", "end", "timeMin", "timeMax", "time_min", "time_max"]) {
      const val = params[key];
      if (!val || typeof val !== "string") continue;

      // 格式不對 → 攔截
      if (!ISO_DATE_REGEX.test(val)) {
        return {
          blocked: true,
          error: `Invalid date format for ${key}: "${val}". Expected ISO 8601 format: 2026-03-18T10:00+08:00 or 2026-03-18`,
        };
      }

      // 有時間但沒帶時區 → 自動補上預設時區
      if (val.includes("T") && !HAS_TZ.test(val)) {
        params[key] = `${val}${DEFAULT_TZ}`;
        warnings.push(`Auto-appended timezone ${DEFAULT_TZ} to ${key}: ${params[key]}`);
      }

      // 純日期（2026-03-18）→ 補成完整的 ISO 時間戳
      if (!val.includes("T")) {
        const isEnd = key === "end" || key === "timeMax" || key === "time_max";
        params[key] = isEnd
          ? `${val}T23:59:00${DEFAULT_TZ}`
          : `${val}T00:00:00${DEFAULT_TZ}`;
        warnings.push(`Auto-expanded date-only ${key} to full timestamp: ${params[key]}`);
      }
    }
  }

  // ── U7: 必填參數攔截（不等上游 API 噴不明確的 validation error）──
  const REQUIRED_PARAMS: Record<string, Record<string, string[]>> = {
    notion: {
      create_page: ["title"],
      get_page: ["page_id"],
      update_page: ["page_id"],
      replace_content: ["page_id", "content"],
      append_content: ["page_id", "content"],
      move_page: ["page_id", "new_parent_id"],
      delete_page: ["page_id"],
      query_database: ["database_id"],
    },
    gmail: {
      send: ["to", "subject"],
      reply: ["message_id"],
      read: ["message_id"],
    },
    google_calendar: {
      create_event: ["summary", "start", "end"],
      get_event: ["event_id"],
      delete_event: ["event_id"],
    },
    google_drive: {
      get_file: ["file_id"],
      delete: ["file_id"],
    },
    github: {
      create_issue: ["owner", "repo", "title"],
      get_file: ["owner", "repo", "path"],
    },
  };
  // 從 toolName 提取 action name（去掉 app prefix）
  const actionName = toolName.replace(/^[^_]+_/, "");
  const requiredForAction = REQUIRED_PARAMS[app]?.[actionName];
  if (requiredForAction) {
    const missing = requiredForAction.filter((key) => !params[key] && params[key] !== 0 && params[key] !== false);
    if (missing.length > 0) {
      return {
        blocked: true,
        error: `${app}.${actionName} 缺少必填參數：${missing.join(", ")}。Use octodock_help(app:"${app}", action:"${actionName}") for details.`,
      };
    }
  }

  if (warnings.length > 0) {
    return { blocked: false, warnings, transformed: params };
  }

  return null; // 通過，不需攔截
}
