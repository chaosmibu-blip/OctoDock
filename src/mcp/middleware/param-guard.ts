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
 * 第二層：camelCase → snake_case 自動轉換
 * AI 模型可能用不同命名風格，統一成 snake_case
 * 例如 spreadsheetId → spreadsheet_id, documentId → document_id
 */
function normalizeParamKeys(params: Record<string, unknown>): { normalized: Record<string, unknown>; renames: string[] } {
  const normalized: Record<string, unknown> = {};
  const renames: string[] = [];

  for (const [key, value] of Object.entries(params)) {
    // 將 camelCase 轉成 snake_case
    const snakeKey = key.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
    if (snakeKey !== key) {
      // camelCase 被轉換了 → 記錄
      normalized[snakeKey] = value;
      renames.push(`${key} → ${snakeKey}`);
    } else {
      normalized[key] = value;
    }
  }

  return { normalized, renames };
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

  // ── 第二層：camelCase → snake_case 自動轉換 ──
  const { normalized, renames } = normalizeParamKeys(params);
  if (renames.length > 0) {
    // 用轉換後的參數覆蓋原始參數
    for (const key of Object.keys(params)) {
      delete params[key];
    }
    Object.assign(params, normalized);
    warnings.push(`Auto-renamed params: ${renames.join(", ")}`);
  }

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

  // ── J3b: Google Drive 查詢語法偵測（C: 智慧判斷已是 API 語法則不轉） ──
  if (toolName.includes("gdrive_search") || (app === "google_drive" && toolName.includes("search"))) {
    const query = params.query as string | undefined;
    if (query) {
      // C: 檢查是否已經是 Drive API 語法（包含 = > < 或 API 關鍵字）
      const isDriveApiSyntax = DRIVE_QUERY_OPERATORS.test(query) ||
        /\b(mimeType|modifiedTime|createdTime|trashed|viewedByMeTime|sharedWithMe|owners|writers|readers)\b/.test(query);
      if (!isDriveApiSyntax) {
        // 自然語言 → 自動轉換成 name contains 'xxx'
        params.query = `name contains '${query}'`;
        warnings.push(`Auto-converted natural language query to Drive syntax: name contains '${query}'`);
      }
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

  // ── U7/J3d: 必填參數攔截 — 在打上游 API 前就攔截缺少必填參數的情況 ──
  const REQUIRED_PARAMS: Record<string, Record<string, string[]>> = {
    notion: {
      notion_create_page: ["title"],
      notion_replace_content: ["page_id", "content"],
      notion_append_content: ["page_id", "content"],
      notion_delete_page: ["page_id"],
      notion_get_page: ["page_id"],
      notion_move_page: ["page_id", "new_parent_id"],
      notion_update_page: ["page_id"],
      notion_get_block: ["block_id"],
      notion_delete_block: ["block_id"],
      notion_update_block: ["block_id"],
      notion_query_database: ["database_id"],
      notion_create_database_item: ["database_id", "properties"],
      notion_add_comment: ["page_id", "text"],
    },
    gmail: {
      gmail_send: ["to", "subject"],
      gmail_read: ["message_id"],
      gmail_reply: ["message_id", "body"],
      gmail_create_draft: ["to", "subject"],
    },
    google_calendar: {
      gcal_create_event: ["summary", "start", "end"],
      gcal_update_event: ["event_id"],
      gcal_delete_event: ["event_id"],
      gcal_get_event: ["event_id"],
      gcal_quick_add: ["text"],
      gcal_freebusy: ["time_min", "time_max"],
      gcal_delete_calendar: ["calendar_id"],
      gcal_share_calendar: ["email", "role"],
      gcal_remove_sharing: ["email"],
    },
    google_drive: {
      gdrive_download: ["file_id"],
      gdrive_delete: ["file_id"],
      gdrive_move: ["file_id", "new_parent_id"],
      gdrive_rename: ["file_id", "new_name"],
      gdrive_share: ["file_id", "email", "role"],
      gdrive_copy: ["file_id"],
    },
    google_tasks: {
      gtasks_create_task: ["title"],
      gtasks_complete_task: ["task_id"],
      gtasks_delete_task: ["task_id"],
      gtasks_update_task: ["task_id"],
    },
    google_sheets: {
      gsheets_read: ["spreadsheet_id", "range"],
      gsheets_write: ["spreadsheet_id", "range", "values"],
      gsheets_append: ["spreadsheet_id", "range", "values"],
      gsheets_clear: ["spreadsheet_id", "range"],
      gsheets_add_sheet: ["spreadsheet_id", "title"],
      gsheets_delete_sheet: ["spreadsheet_id", "sheet_id"],
    },
    google_docs: {
      gdocs_get: ["document_id"],
      gdocs_insert_text: ["document_id", "text"],
      gdocs_replace_text: ["document_id", "find", "replace"],
      gdocs_append_text: ["document_id", "text"],
    },
    github: {
      github_create_issue: ["owner", "repo", "title"],
      github_get_file: ["owner", "repo", "path"],
      github_create_file: ["owner", "repo", "path", "content"],
      github_update_file: ["owner", "repo", "path", "content", "sha"],
      github_delete_file: ["owner", "repo", "path", "sha"],
      github_create_pr: ["owner", "repo", "title", "head", "base"],
      github_search_code: ["query"],
    },
    canva: {
      canva_create_design: ["design_type"],
    },
    youtube: {
      youtube_search: ["query"],
      youtube_get_video: ["video_id"],
    },
  };

  const requiredForTool = REQUIRED_PARAMS[app]?.[toolName];
  if (requiredForTool) {
    const missing = requiredForTool.filter((p) => {
      const val = params[p];
      return val === undefined || val === null || val === "";
    });
    if (missing.length > 0) {
      // 反查 action 名稱（從 toolName 推回）
      const actionName = toolName.replace(/^[^_]+_/, ""); // 簡易推導
      return {
        blocked: true,
        error: `${app}.${actionName} 缺少必填參數：${missing.join(", ")}。Use octodock_help(app:"${app}", action:"${actionName}") to see required params.`,
      };
    }
  }

  if (warnings.length > 0) {
    return { blocked: false, warnings, transformed: params };
  }

  return null; // 通過，不需攔截
}
