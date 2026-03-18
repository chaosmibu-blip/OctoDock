// ============================================================
// 統一錯誤處理（B1）
// 結構化錯誤類型 + 分類器，替代原本的純字串錯誤
// Agent 可據 retryable 決定是否重試，據 code 決定如何處理
// ============================================================

/** OctoDock 結構化錯誤，所有 App 操作失敗都轉成這個格式 */
export interface OctoDockError {
  code: OctoDockErrorCode;
  message: string;        // 人類可讀訊息
  retryable: boolean;     // Agent 可據此決定是否重試
  retryAfterMs?: number;  // 建議重試間隔
  app: string;
  action: string;
  upstream?: { status: number; body: string }; // 上游 API 原始錯誤
}

/** 錯誤碼枚舉 */
export type OctoDockErrorCode =
  | "TOKEN_EXPIRED"
  | "TOKEN_REFRESH_FAILED"
  | "PERMISSION_DENIED"
  | "RATE_LIMITED"
  | "NOT_FOUND"
  | "INVALID_PARAMS"
  | "CONFLICT"
  | "UPSTREAM_ERROR"
  | "NETWORK_ERROR"
  | "SERVICE_UNAVAILABLE"
  | "NOT_CONNECTED"
  | "UNKNOWN";

/** 預設的 rate limit 重試間隔（毫秒） */
const DEFAULT_RATE_LIMIT_RETRY_MS = 30_000;

/**
 * 將任意 Error 分類成結構化的 OctoDockError
 * 根據 error.message 中的關鍵字和 HTTP 狀態碼判斷錯誤類型
 *
 * 注意：token-manager.ts 的六種 throw 路徑都在 message 裡帶有辨識碼：
 * - NOT_CONNECTED / TOKEN_EXPIRED / REFRESH_NOT_SUPPORTED / REFRESH_FAILED
 * - 還有 status 為 expired/revoked 的情況
 */
export function classifyError(
  error: unknown,
  appName: string,
  action: string,
): OctoDockError {
  const message = error instanceof Error ? error.message : String(error);
  const base = { app: appName, action, message };

  // ── Token 相關（token-manager.ts 的 throw 路徑）──
  if (message.includes("NOT_CONNECTED")) {
    return { ...base, code: "NOT_CONNECTED", retryable: false };
  }
  if (
    message.includes("TOKEN_EXPIRED") ||
    message.includes("REFRESH_FAILED") ||
    message.includes("REFRESH_NOT_SUPPORTED") ||
    message.includes("_EXPIRED") ||
    message.includes("_REVOKED")
  ) {
    return { ...base, code: "TOKEN_EXPIRED", retryable: false };
  }

  // ── HTTP 狀態碼（adapter 的 fetch 錯誤）──
  const httpStatus = extractHttpStatus(message);

  if (httpStatus === 401) {
    return { ...base, code: "TOKEN_EXPIRED", retryable: false };
  }
  if (httpStatus === 403) {
    return { ...base, code: "PERMISSION_DENIED", retryable: false };
  }
  if (httpStatus === 404) {
    return { ...base, code: "NOT_FOUND", retryable: false };
  }
  if (httpStatus === 409) {
    return { ...base, code: "CONFLICT", retryable: false };
  }
  if (httpStatus === 422) {
    return { ...base, code: "INVALID_PARAMS", retryable: false };
  }
  if (httpStatus === 429) {
    const retryAfterMs = extractRetryAfter(message) ?? DEFAULT_RATE_LIMIT_RETRY_MS;
    return { ...base, code: "RATE_LIMITED", retryable: true, retryAfterMs };
  }
  if (httpStatus && httpStatus >= 500) {
    return {
      ...base,
      code: "UPSTREAM_ERROR",
      retryable: true,
      upstream: { status: httpStatus, body: message },
    };
  }

  // ── 文字模式匹配（無 HTTP 狀態碼時的 fallback）──
  if (
    message.includes("not found") ||
    message.includes("not_found") ||
    message.includes("object not found") ||
    message.includes("Could not find")
  ) {
    return { ...base, code: "NOT_FOUND", retryable: false };
  }
  if (
    message.includes("validation_error") ||
    message.includes("invalid") ||
    message.includes("Invalid")
  ) {
    return { ...base, code: "INVALID_PARAMS", retryable: false };
  }
  if (message.includes("conflict") || message.includes("already exists")) {
    return { ...base, code: "CONFLICT", retryable: false };
  }

  // ── 網路錯誤 ──
  if (
    message.includes("fetch failed") ||
    message.includes("ECONNREFUSED") ||
    message.includes("ECONNRESET") ||
    message.includes("ETIMEDOUT") ||
    message.includes("network") ||
    message.includes("DNS")
  ) {
    return { ...base, code: "NETWORK_ERROR", retryable: true };
  }

  // ── 未分類 ──
  return { ...base, code: "UNKNOWN", retryable: false };
}

/** 從錯誤訊息中提取 HTTP 狀態碼（共用工具函式） */
export function extractHttpStatus(message: string): number | null {
  // 常見格式："HTTP 429"、"status 429"、"Error 429"、"(429)"
  const match = message.match(/(?:HTTP|status|Error)\s*:?\s*(\d{3})|[(\s](\d{3})[)\s]/i);
  if (match) {
    const code = parseInt(match[1] ?? match[2], 10);
    if (code >= 400 && code < 600) return code;
  }
  return null;
}

/** 從錯誤訊息中提取 Retry-After 秒數，轉成毫秒 */
function extractRetryAfter(message: string): number | null {
  const match = message.match(/retry.?after\s*:?\s*(\d+)/i);
  if (match) return parseInt(match[1], 10) * 1000;
  return null;
}
