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
};

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
  const httpStatus = extractStatusFromMessage(errorMessage);
  if (httpStatus) {
    const appHint = APP_HINTS[appName]?.[String(httpStatus)];
    if (appHint) {
      return `💡 ${appHint.explanation}\n→ ${appHint.suggestion}`;
    }
  }

  // 2. 從通用 error code hints 找
  const genericHint = GENERIC_HINTS[errorCode];
  if (genericHint) {
    return `💡 ${genericHint.explanation}\n→ ${genericHint.suggestion}`;
  }

  return null;
}

/** 從錯誤訊息中提取 HTTP 狀態碼 */
function extractStatusFromMessage(message: string): number | null {
  const match = message.match(/(?:HTTP|status|Error)\s*:?\s*(\d{3})|[(\s](\d{3})[)\s]/i);
  if (match) {
    const code = parseInt(match[1] ?? match[2], 10);
    if (code >= 400 && code < 600) return code;
  }
  return null;
}
