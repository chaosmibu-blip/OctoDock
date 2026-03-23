// ============================================================
// G8: 錯誤說明 Mapping Table
// error code / HTTP status → 說明 + 建議修法
// 通用 hints + per-app 覆蓋
// ============================================================

/** 單一 hint 條目 */
interface ErrorHint {
  explanation: string; // 發生了什麼
  suggestion: string;  // 建議怎麼修
}

/** 通用 error code → hint（不分 App） */
const GENERIC_HINTS: Record<string, ErrorHint> = {
  TOKEN_EXPIRED: {
    explanation: "OAuth token has expired or been revoked.",
    suggestion: "Ask user to reconnect this app in OctoDock Dashboard.",
  },
  TOKEN_REFRESH_FAILED: {
    explanation: "Attempted to refresh the token but failed.",
    suggestion: "Ask user to reconnect this app in OctoDock Dashboard.",
  },
  PERMISSION_DENIED: {
    explanation: "The app integration doesn't have permission for this action.",
    suggestion: "Check if the required OAuth scopes are granted. User may need to reconnect with additional permissions.",
  },
  RATE_LIMITED: {
    explanation: "Too many requests in a short time.",
    suggestion: "Wait for the retryAfterMs period, then retry. Reduce request frequency.",
  },
  UPSTREAM_ERROR: {
    explanation: "The app's API returned a server error (5xx).",
    suggestion: "This is usually temporary. Wait a moment and retry.",
  },
  NETWORK_ERROR: {
    explanation: "Could not reach the app's API.",
    suggestion: "Check if the service is down. Retry in a few seconds.",
  },
  SERVICE_UNAVAILABLE: {
    explanation: "OctoDock circuit breaker is open due to repeated failures.",
    suggestion: "The app's API has been failing. Wait for retryAfterMs, then retry.",
  },
  NOT_CONNECTED: {
    explanation: "This app is not connected to OctoDock.",
    suggestion: "Ask user to connect this app in OctoDock Dashboard.",
  },
};

/** Per-app 的 HTTP status → hint 覆蓋（更具體的建議） */
const APP_HINTS: Record<string, Record<string, ErrorHint>> = {
  notion: {
    "403": {
      explanation: "Notion integration doesn't have access to this page/database.",
      suggestion: "Go to the Notion page → '...' menu → 'Connections' → Add the OctoDock integration.",
    },
    "404": {
      explanation: "Page or database not found. It may have been deleted or the ID is wrong.",
      suggestion: "Use octodock_do(app:'notion', action:'search', params:{query:'...'}) to find the correct ID.",
    },
    "409": {
      explanation: "Conflict: the page was modified by someone else at the same time.",
      suggestion: "Retry the operation. If it persists, read the page first to get the latest version.",
    },
  },
  gmail: {
    "400": {
      explanation: "找不到這封郵件，請確認 message_id 是否正確。",
      suggestion: "Use octodock_do(app:'gmail', action:'search', params:{query:'...'}) to find the correct message ID.",
    },
    "403": {
      explanation: "Gmail API scope insufficient or quota exceeded.",
      suggestion: "User may need to reconnect Gmail with additional scopes. Check Google API Console for quota.",
    },
    "404": {
      explanation: "Email or thread not found. It may have been deleted.",
      suggestion: "Use octodock_do(app:'gmail', action:'search', params:{query:'...'}) to find the correct message.",
    },
  },
  github: {
    "403": {
      explanation: "GitHub token lacks required permissions, or rate limit exceeded.",
      suggestion: "Check X-RateLimit-Remaining header. User may need to reconnect with additional repo permissions.",
    },
    "404": {
      explanation: "Repository, issue, or resource not found. It may be private.",
      suggestion: "Verify the repo name and check if the GitHub token has access to private repos.",
    },
    "422": {
      explanation: "GitHub rejected the request due to validation errors.",
      suggestion: "Check the request parameters. Common issues: duplicate issue title, invalid branch name.",
    },
  },
  "google-drive": {
    "403": {
      explanation: "No permission to access this file, or Drive API quota exceeded.",
      suggestion: "Check if the file is shared with the user. For quota issues, wait and retry.",
    },
  },
  "google-calendar": {
    "403": {
      explanation: "No permission to access this calendar.",
      suggestion: "Check if the calendar is shared with the user's Google account.",
    },
  },
  youtube: {
    "403": {
      explanation: "YouTube API quota exceeded (daily limit) or action not allowed.",
      suggestion: "YouTube API has a strict daily quota (10,000 units). Search costs 100 units. Wait until tomorrow or reduce usage.",
    },
  },
  // ── Microsoft 系（共用 Microsoft Graph API）──
  "microsoft-excel": {
    "403": {
      explanation: "No permission to access this Excel file, or Microsoft Graph API scope insufficient.",
      suggestion: "Check if the file is shared with the user. User may need to reconnect Microsoft account with Files.ReadWrite scope.",
    },
    "404": {
      explanation: "Excel file, worksheet, or range not found.",
      suggestion: "Verify file_id is correct. Use octodock_do(app:'microsoft_excel', action:'list_files') to find available files.",
    },
  },
  "microsoft-word": {
    "403": {
      explanation: "No permission to access this Word document.",
      suggestion: "Check if the file is shared with the user. User may need to reconnect Microsoft account.",
    },
    "404": {
      explanation: "Word document not found.",
      suggestion: "Verify file_id is correct. Use octodock_do(app:'microsoft_word', action:'list_files') to find available files.",
    },
  },
  "microsoft-powerpoint": {
    "403": {
      explanation: "No permission to access this PowerPoint file.",
      suggestion: "Check if the file is shared with the user. User may need to reconnect Microsoft account.",
    },
    "404": {
      explanation: "PowerPoint file not found.",
      suggestion: "Verify file_id is correct. Use octodock_do(app:'microsoft_powerpoint', action:'list_files') to find available files.",
    },
  },
  // ── 通訊平台 ──
  slack: {
    "401": {
      explanation: "Slack token is invalid or expired.",
      suggestion: "User needs to reconnect Slack in OctoDock Dashboard.",
    },
    "403": {
      explanation: "Bot lacks required Slack permissions for this action.",
      suggestion: "Check bot scopes in Slack App settings. Common missing scopes: channels:write, chat:write, users:read.",
    },
    "404": {
      explanation: "Slack channel, user, or message not found.",
      suggestion: "Verify the channel/user ID. Use octodock_do(app:'slack', action:'list_channels') to find channels.",
    },
  },
  discord: {
    "403": {
      explanation: "Discord bot lacks permissions for this action.",
      suggestion: "Check bot role permissions in Discord server settings. Bot may need Administrator or specific channel permissions.",
    },
    "404": {
      explanation: "Discord channel, message, or guild not found.",
      suggestion: "Verify the ID is correct. The bot must be a member of the server to access its resources.",
    },
    "429": {
      explanation: "Discord API rate limit hit.",
      suggestion: "Wait a few seconds and retry. Discord has strict per-route rate limits.",
    },
  },
  telegram: {
    "400": {
      explanation: "Invalid request to Telegram Bot API. Common causes: wrong chat_id, empty text, or invalid file_id.",
      suggestion: "Check parameters. chat_id must be a number or @username. text cannot be empty.",
    },
    "403": {
      explanation: "Bot was blocked by the user or lacks group permissions.",
      suggestion: "The user may have blocked the bot. For groups, bot needs to be added as member with send message permission.",
    },
  },
  "telegram-user": {
    "400": {
      explanation: "Invalid Telegram User API request.",
      suggestion: "Check chat ID format. Use octodock_do(app:'telegram_user', action:'resolve_username', params:{username:'...'}) to find chat IDs.",
    },
    "403": {
      explanation: "No permission for this action. Account may be restricted.",
      suggestion: "Check if the user account has been restricted by Telegram. Some actions require mutual contacts.",
    },
  },
  line: {
    "400": {
      explanation: "Invalid LINE API request. Common causes: wrong user_id format or invalid message structure.",
      suggestion: "LINE user_id starts with 'U'. Use octodock_do(app:'line', action:'get_bot_info') to verify bot setup.",
    },
    "403": {
      explanation: "LINE API permission denied. Bot may not have required channel permissions.",
      suggestion: "Check LINE Developers Console for channel permissions. Messaging API requires proper channel access token.",
    },
    "429": {
      explanation: "LINE API rate limit exceeded.",
      suggestion: "LINE limits: 100k messages/month (free), more on paid plans. Wait and retry.",
    },
  },
  // ── 社群媒體 ──
  instagram: {
    "400": {
      explanation: "Invalid Instagram API request. Common causes: invalid media format or missing caption.",
      suggestion: "Instagram requires JPEG images for publishing. Check image_url is accessible and image format is correct.",
    },
    "403": {
      explanation: "Instagram API permission denied or business account required.",
      suggestion: "Instagram API requires a Business or Creator account connected via Facebook Page.",
    },
  },
  threads: {
    "400": {
      explanation: "Invalid Threads API request.",
      suggestion: "Check text content. Threads has a character limit similar to Twitter/X.",
    },
    "403": {
      explanation: "Threads API access denied.",
      suggestion: "Threads API requires an Instagram Professional account. Check account type and permissions.",
    },
  },
  // ── 生產力工具 ──
  todoist: {
    "403": {
      explanation: "Todoist API token is invalid or lacks permissions.",
      suggestion: "User needs to reconnect Todoist in OctoDock Dashboard to refresh the token.",
    },
    "404": {
      explanation: "Todoist project, task, or resource not found.",
      suggestion: "The item may have been deleted. Use octodock_do(app:'todoist', action:'list_tasks') to find available tasks.",
    },
  },
  gamma: {
    "400": {
      explanation: "Invalid Gamma API request. Check format parameter (must be 'presentation', 'document', or 'webpage').",
      suggestion: "Valid formats: presentation, document, webpage. input_text should describe what you want to generate.",
    },
    "403": {
      explanation: "Gamma API access denied or quota exceeded.",
      suggestion: "Check Gamma account plan and API quota. User may need to upgrade or wait for quota reset.",
    },
  },
};

import { extractHttpStatus } from "./error-types";

/**
 * G8: 根據 error code 和 App 名稱取得最佳的錯誤提示
 * 優先用 per-app hint，fallback 到通用 hint
 */
export function getErrorHint(
  appName: string,
  errorCode: string,
  errorMessage: string,
): string | null {
  // 1. 嘗試從 per-app hints 找 HTTP status
  const httpStatus = extractHttpStatus(errorMessage);
  if (httpStatus) {
    const appHint = APP_HINTS[appName]?.[String(httpStatus)];
    if (appHint) {
      return `💡 ${appHint.explanation}\n→ ${appHint.suggestion}`;
    }
  }

  // U14: 文字模式匹配 — 攔截常見 raw API error 轉人話
  const TEXT_PATTERNS: Array<{ pattern: RegExp; app?: string; hint: ErrorHint }> = [
    {
      pattern: /Invalid id value/i,
      app: "gmail",
      hint: {
        explanation: "找不到這封郵件，請確認 message_id 是否正確。",
        suggestion: "Use octodock_do(app:'gmail', action:'search', params:{query:'...'}) to find the correct message ID.",
      },
    },
    {
      pattern: /body\.properties\.title/i,
      app: "notion",
      hint: {
        explanation: "建立頁面需要提供標題。",
        suggestion: "Add title parameter: octodock_do(app:'notion', action:'create_page', params:{title:'...'})",
      },
    },
  ];

  for (const tp of TEXT_PATTERNS) {
    if (tp.pattern.test(errorMessage) && (!tp.app || tp.app === appName)) {
      return `💡 ${tp.hint.explanation}\n→ ${tp.hint.suggestion}`;
    }
  }

  // 2. 從通用 error code hints 找
  const genericHint = GENERIC_HINTS[errorCode];
  if (genericHint) {
    return `💡 ${genericHint.explanation}\n→ ${genericHint.suggestion}`;
  }

  return null;
}
