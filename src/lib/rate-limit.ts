/**
 * In-memory sliding window rate limiter
 * 防止 agent 過度呼叫 App API
 *
 * 限制：in-memory 實作，serverless 環境下每個 instance 獨立計數。
 * 未來如需跨 instance 共享，可改用 Redis 或 DB-based 方案。
 */

interface WindowEntry {
  count: number;
  resetAt: number;
}

const windows = new Map<string, WindowEntry>();

const DEFAULT_LIMIT = 60; // 每個 window 的最大請求數
const DEFAULT_WINDOW_MS = 60_000; // 1 分鐘
const CLEANUP_INTERVAL_MS = 5 * 60_000; // 每 5 分鐘清理過期 entry

/** 定期清理過期的 rate limit entry，防止 Map 無限增長 */
let cleanupTimer: ReturnType<typeof setInterval> | null = null;
function ensureCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of windows) {
      if (now >= entry.resetAt) windows.delete(key);
    }
  }, CLEANUP_INTERVAL_MS);
  /* 不阻止 Node.js 進程退出 */
  if (cleanupTimer && typeof cleanupTimer === 'object' && 'unref' in cleanupTimer) {
    cleanupTimer.unref();
  }
}

/** 檢查是否允許請求，同時遞增計數 */
export function checkRateLimit(
  userId: string,
  limit = DEFAULT_LIMIT,
  windowMs = DEFAULT_WINDOW_MS,
): { allowed: boolean; remaining: number; resetAt: number } {
  ensureCleanup();
  const now = Date.now();
  const entry = windows.get(userId);

  if (!entry || now >= entry.resetAt) {
    windows.set(userId, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
  }

  entry.count++;
  const remaining = Math.max(0, limit - entry.count);
  return { allowed: entry.count <= limit, remaining, resetAt: entry.resetAt };
}
