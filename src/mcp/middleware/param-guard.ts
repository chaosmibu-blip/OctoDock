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
      // 錯誤訊息告訴 AI「該做什麼」，而非「哪裡錯了」
      if (val.length > 0 && val.length < 36) {
        return {
          blocked: true,
          error: `找不到名為 "${val}" 的頁面。Try: octodock_do(app:"notion", action:"search", params:{query:"${val}"})`,
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
        // 自然語言 → 自動轉換成 name contains 'xxx'（跳脫單引號防注入）
        const escapedQuery = query.replace(/'/g, "\\'");
        params.query = `name contains '${escapedQuery}'`;
        warnings.push(`Auto-converted natural language query to Drive syntax: name contains '${escapedQuery}'`);
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

    // ── J3e: Google Calendar start/end 字串 → 物件自動轉換 ──
    // Google Calendar API 要求 start/end 為 {dateTime:"..."} 或 {date:"..."}
    // AI 常傳字串（"2026-03-25T15:00:00+08:00"），自動包裝成物件
    for (const key of ["start", "end"]) {
      const val = params[key];
      if (typeof val === "string") {
        params[key] = /^\d{4}-\d{2}-\d{2}$/.test(val)
          ? { date: val }
          : { dateTime: val };
        warnings.push(`Auto-wrapped ${key} string to object: ${JSON.stringify(params[key])}`);
      }
    }
  }

  // ── J3f: Google Tasks due 日期格式正規化 ──
  // Google Tasks API 要求 due 為 RFC 3339 格式（含完整時間）
  // AI 可能傳 "2026-03-25"（純日期）或帶毫秒的格式
  if (app === "google_tasks" && params.due && typeof params.due === "string") {
    const due = params.due as string;
    if (/^\d{4}-\d{2}-\d{2}$/.test(due)) {
      params.due = `${due}T00:00:00.000Z`;
      warnings.push(`Auto-expanded date-only due to RFC 3339: ${params.due}`);
    } else {
      // 確保轉成標準 ISO 格式（處理帶時區偏移的格式）
      try {
        const d = new Date(due);
        if (!isNaN(d.getTime())) {
          params.due = d.toISOString();
        }
      } catch { /* 保持原值 */ }
    }
  }

  // ── J3g: 路徑尾部斜線清理（GitHub） ──
  // GitHub API 不接受 "src/components/"，只接受 "src/components"
  if (app === "github" && params.path && typeof params.path === "string") {
    const cleanPath = (params.path as string).replace(/\/+$/, "");
    if (cleanPath !== params.path) {
      params.path = cleanPath;
      warnings.push(`Auto-removed trailing slash from path: "${cleanPath}"`);
    }
  }

  // ── J3h: 通用參數格式正規化（跨 App 共用） ──

  // Gmail: to/cc/bcc 陣列 → 逗號分隔字串
  if (app === "gmail") {
    for (const key of ["to", "cc", "bcc"]) {
      if (Array.isArray(params[key])) {
        params[key] = (params[key] as string[]).join(", ");
        warnings.push(`Auto-joined ${key} array to comma-separated string`);
      }
    }
  }

  // GitHub: labels/assignees 逗號字串 → 陣列
  if (app === "github") {
    for (const key of ["labels", "assignees"]) {
      if (typeof params[key] === "string") {
        params[key] = (params[key] as string).split(",").map(s => s.trim()).filter(Boolean);
        warnings.push(`Auto-split ${key} string to array`);
      }
    }
  }

  // Discord: message_ids 數字 → 字串
  if (app === "discord" && Array.isArray(params.message_ids)) {
    params.message_ids = (params.message_ids as unknown[]).map(id => String(id));
  }

  // Google Sheets: values 1D 陣列 → 2D 陣列（單列包裝）
  if (app === "google_sheets" && Array.isArray(params.values)) {
    const vals = params.values as unknown[];
    // 如果第一個元素不是陣列，代表 AI 傳了 1D 陣列，自動包成 2D
    if (vals.length > 0 && !Array.isArray(vals[0])) {
      params.values = [vals];
      warnings.push(`Auto-wrapped 1D values array to 2D: [[...]]`);
    }
  }

  // Google Docs: rows/columns 字串 → 數字
  if (app === "google_docs") {
    for (const key of ["rows", "columns", "index"]) {
      if (typeof params[key] === "string" && /^\d+$/.test(params[key] as string)) {
        params[key] = parseInt(params[key] as string, 10);
        warnings.push(`Auto-converted ${key} from string to number`);
      }
    }
  }

  // Google Drive: share type 別名正規化
  if (app === "google_drive" && params.type === "email") {
    params.type = "user";
    warnings.push(`Auto-corrected share type: "email" → "user"`);
  }

  // Canva: pages 參數正規化（範圍字串/單一數字 → 0-based 陣列）
  if (app === "canva" && params.pages !== undefined) {
    const pages = params.pages;
    if (typeof pages === "number") {
      // 單一數字 → 0-based 陣列
      params.pages = [pages > 0 ? pages - 1 : 0];
      warnings.push(`Auto-wrapped single page number to array (0-based)`);
    } else if (typeof pages === "string") {
      // 範圍字串 "1-3" → [0, 1, 2]
      const match = (pages as string).match(/^(\d+)-(\d+)$/);
      if (match) {
        const start = Math.max(0, parseInt(match[1], 10) - 1);
        const end = parseInt(match[2], 10) - 1;
        params.pages = Array.from({ length: end - start + 1 }, (_, i) => start + i);
        warnings.push(`Auto-converted page range "${pages}" to 0-based array`);
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
    // ── Microsoft 系 ──
    microsoft_excel: {
      mexcel_create_workbook: ["name"],
      mexcel_list_worksheets: ["file_id"],
      mexcel_create_worksheet: ["file_id", "name"],
      mexcel_read_range: ["file_id", "sheet", "range"],
      mexcel_write_range: ["file_id", "sheet", "range", "values"],
      mexcel_append_rows: ["file_id", "table", "values"],
      mexcel_list_tables: ["file_id"],
      mexcel_create_table: ["file_id", "address"],
      mexcel_add_chart: ["file_id", "sheet", "type", "sourceData"],
      mexcel_calculate: ["file_id", "calculationType"],
      mexcel_export_pdf: ["file_id"],
      mexcel_search_files: ["query"],
      mexcel_get_file_info: ["file_id"],
      mexcel_delete_file: ["file_id"],
    },
    microsoft_word: {
      msword_create_document: ["title", "content"],
      msword_read_document: ["file_id"],
      msword_search_files: ["query"],
      msword_export_pdf: ["file_id"],
      msword_delete_file: ["file_id"],
      msword_get_file_info: ["file_id"],
    },
    microsoft_powerpoint: {
      pptx_create_presentation: ["title", "slides"],
      pptx_read_presentation: ["file_id"],
      pptx_search_files: ["query"],
      pptx_export_pdf: ["file_id"],
      pptx_delete_file: ["file_id"],
      pptx_get_file_info: ["file_id"],
    },
    // ── 通訊平台 ──
    slack: {
      slack_create_channel: ["name"],
      slack_archive_channel: ["channel"],
      slack_set_topic: ["channel", "topic"],
      slack_set_purpose: ["channel", "purpose"],
      slack_invite_to_channel: ["channel", "users"],
      slack_kick_from_channel: ["channel", "user"],
      slack_get_messages: ["channel"],
      slack_get_replies: ["channel", "ts"],
      slack_send_message: ["channel", "text"],
      slack_update_message: ["channel", "ts", "text"],
      slack_delete_message: ["channel", "ts"],
      slack_get_user: ["user"],
      slack_add_reaction: ["channel", "timestamp", "name"],
      slack_get_reactions: ["channel", "timestamp"],
      slack_pin: ["channel", "timestamp"],
      slack_unpin: ["channel", "timestamp"],
      slack_list_pins: ["channel"],
      slack_add_bookmark: ["channel_id", "title"],
      slack_list_bookmarks: ["channel_id"],
    },
    discord: {
      discord_send_message: ["channel_id"],
      discord_get_messages: ["channel_id"],
      discord_get_message: ["channel_id", "message_id"],
      discord_edit_message: ["channel_id", "message_id"],
      discord_delete_message: ["channel_id", "message_id"],
      discord_bulk_delete: ["channel_id", "message_ids"],
      discord_add_reaction: ["channel_id", "message_id", "emoji"],
      discord_pin_message: ["channel_id", "message_id"],
      discord_unpin_message: ["channel_id", "message_id"],
      discord_get_pinned: ["channel_id"],
      discord_get_channel: ["channel_id"],
      discord_edit_channel: ["channel_id"],
      discord_delete_channel: ["channel_id"],
      discord_create_channel: ["guild_id", "name"],
      discord_start_thread: ["channel_id", "message_id", "name"],
      discord_start_thread_no_message: ["channel_id", "name"],
      discord_get_guild: ["guild_id"],
      discord_get_guild_channels: ["guild_id"],
      discord_get_member: ["guild_id", "user_id"],
      discord_list_members: ["guild_id"],
      discord_search_members: ["guild_id", "query"],
      discord_kick_member: ["guild_id", "user_id"],
      discord_ban_member: ["guild_id", "user_id"],
      discord_unban_member: ["guild_id", "user_id"],
      discord_add_role: ["guild_id", "user_id", "role_id"],
      discord_remove_role: ["guild_id", "user_id", "role_id"],
      discord_create_role: ["guild_id", "name"],
      discord_delete_role: ["guild_id", "role_id"],
      discord_create_webhook: ["channel_id", "name"],
      discord_get_webhooks: ["channel_id"],
      discord_execute_webhook: ["webhook_id", "webhook_token"],
      discord_delete_webhook: ["webhook_id"],
      discord_get_user: ["user_id"],
      discord_create_dm: ["user_id"],
    },
    telegram: {
      tg_send_message: ["chat_id", "text"],
      tg_send_photo: ["chat_id", "photo"],
      tg_send_video: ["chat_id", "video"],
      tg_send_document: ["chat_id", "document"],
      tg_send_audio: ["chat_id", "audio"],
      tg_send_voice: ["chat_id", "voice"],
      tg_send_sticker: ["chat_id", "sticker"],
      tg_send_location: ["chat_id", "latitude", "longitude"],
      tg_send_contact: ["chat_id", "phone_number", "first_name"],
      tg_send_poll: ["chat_id", "question", "options"],
      tg_forward_message: ["chat_id", "from_chat_id", "message_id"],
      tg_copy_message: ["chat_id", "from_chat_id", "message_id"],
      tg_edit_message: ["chat_id", "message_id", "text"],
      tg_delete_message: ["chat_id", "message_id"],
      tg_set_reaction: ["chat_id", "message_id", "emoji"],
      tg_pin_message: ["chat_id", "message_id"],
      tg_unpin_message: ["chat_id", "message_id"],
      tg_unpin_all: ["chat_id"],
      tg_get_chat: ["chat_id"],
      tg_get_chat_member: ["chat_id", "user_id"],
      tg_get_chat_member_count: ["chat_id"],
      tg_get_chat_admins: ["chat_id"],
      tg_ban_member: ["chat_id", "user_id"],
      tg_unban_member: ["chat_id", "user_id"],
      tg_restrict_member: ["chat_id", "user_id", "permissions"],
      tg_promote_member: ["chat_id", "user_id"],
      tg_set_chat_title: ["chat_id", "title"],
      tg_set_chat_description: ["chat_id", "description"],
      tg_leave_chat: ["chat_id"],
      tg_get_invite_link: ["chat_id"],
      tg_create_forum_topic: ["chat_id", "name"],
      tg_edit_forum_topic: ["chat_id", "message_thread_id"],
      tg_close_forum_topic: ["chat_id", "message_thread_id"],
      tg_reopen_forum_topic: ["chat_id", "message_thread_id"],
      tg_set_my_commands: ["commands"],
      tg_set_my_name: ["name"],
      tg_set_my_description: ["description"],
      tg_set_webhook: ["url"],
      tg_get_file: ["file_id"],
      tg_get_user_photos: ["user_id"],
      tg_answer_callback: ["callback_query_id"],
    },
    telegram_user: {
      tgu_get_history: ["chat"],
      tgu_search_messages: ["query"],
      tgu_send_message: ["chat", "text"],
      tgu_read_history: ["chat"],
      tgu_search_contacts: ["query"],
      tgu_resolve_username: ["username"],
      tgu_join_channel: ["username"],
      tgu_leave_channel: ["chat"],
      tgu_get_participants: ["chat"],
      tgu_create_channel: ["title"],
      tgu_get_channel_info: ["chat"],
      tgu_update_profile: ["first_name"],
      tgu_get_privacy: ["setting"],
      tgu_download_media: ["message_id", "chat"],
      tgu_send_file: ["chat", "file_path"],
      tgu_forward_messages: ["from_chat", "to_chat", "message_ids"],
    },
    line: {
      line_send_message: ["user_id", "message"],
      line_send_image: ["user_id", "image_url"],
      line_send_sticker: ["user_id", "sticker_package_id", "sticker_id"],
      line_send_flex: ["user_id", "alt_text", "contents"],
      line_multicast: ["user_ids", "message"],
      line_broadcast: ["message"],
      line_reply: ["reply_token", "message"],
      line_mark_as_read: ["user_id"],
      line_show_loading: ["user_id"],
      line_get_content_url: ["message_id"],
      line_get_profile: ["user_id"],
      line_get_group_summary: ["group_id"],
      line_get_group_member_count: ["group_id"],
      line_get_group_members: ["group_id"],
      line_get_group_member_profile: ["group_id", "user_id"],
      line_leave_group: ["group_id"],
      line_get_room_members: ["room_id"],
      line_get_room_member_profile: ["room_id", "user_id"],
      line_leave_room: ["room_id"],
      line_create_rich_menu: ["rich_menu"],
      line_get_rich_menu: ["rich_menu_id"],
      line_delete_rich_menu: ["rich_menu_id"],
      line_set_default_rich_menu: ["rich_menu_id"],
      line_link_rich_menu_to_user: ["user_id", "rich_menu_id"],
      line_unlink_rich_menu_from_user: ["user_id"],
      line_get_user_rich_menu: ["user_id"],
      line_create_audience: ["description"],
      line_get_audience: ["audience_id"],
      line_delete_audience: ["audience_id"],
      line_create_coupon: ["coupon"],
      line_get_coupon: ["coupon_id"],
      line_get_user_membership: ["user_id"],
      line_set_webhook: ["endpoint"],
    },
    // ── 社群媒體 ──
    instagram: {
      instagram_publish: ["image_url"],
      instagram_reply_comment: ["comment_id", "message"],
      instagram_get_comments: ["media_id"],
      instagram_get_insights: ["media_id"],
    },
    threads: {
      threads_publish: ["text"],
      threads_reply: ["post_id", "text"],
      threads_get_insights: ["post_id"],
    },
    // ── 生產力工具 ──
    todoist: {
      todoist_get_project: ["project_id"],
      todoist_create_project: ["name"],
      todoist_update_project: ["project_id"],
      todoist_delete_project: ["project_id"],
      todoist_get_task: ["task_id"],
      todoist_create_task: ["content"],
      todoist_update_task: ["task_id"],
      todoist_delete_task: ["task_id"],
      todoist_close_task: ["task_id"],
      todoist_reopen_task: ["task_id"],
      todoist_quick_add: ["text"],
      todoist_list_sections: ["project_id"],
      todoist_create_section: ["name", "project_id"],
      todoist_update_section: ["section_id", "name"],
      todoist_delete_section: ["section_id"],
      todoist_list_comments: ["task_id"],
      todoist_create_comment: ["task_id", "content"],
      todoist_update_comment: ["comment_id", "content"],
      todoist_delete_comment: ["comment_id"],
      todoist_create_label: ["name"],
      todoist_update_label: ["label_id", "name"],
      todoist_delete_label: ["label_id"],
    },
    gamma: {
      gamma_generate: ["input_text", "format"],
      gamma_generate_from_template: ["gamma_id"],
      gamma_get_status: ["generation_id"],
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
