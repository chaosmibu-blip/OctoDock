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

/** 檢查是否允許請求，同時遞增計數（HTTP 層用，fixed window） */
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

// ============================================================
// B3: MCP 層 sliding window rate limiter
// 獨立於 HTTP 層的 rate limit，支援 per-action 高風險限制
// ============================================================

/** sliding window：記錄每次請求的時間戳 */
const mcpWindows = new Map<string, number[]>();

/** MCP 層預設限制：每分鐘 60 次 */
const MCP_DEFAULT_LIMIT = parseInt(process.env.MCP_RATE_LIMIT ?? "60", 10);
const MCP_DEFAULT_WINDOW_MS = 60_000;

/** 高風險操作的額外限制（toolName → { limit, windowMs }） */
const HIGH_RISK_LIMITS: Record<string, { limit: number; windowMs: number }> = {
  gmail_send: { limit: parseInt(process.env.MCP_GMAIL_SEND_LIMIT ?? "20", 10), windowMs: 3_600_000 },
  gmail_trash: { limit: parseInt(process.env.MCP_GMAIL_TRASH_LIMIT ?? "50", 10), windowMs: 3_600_000 },
  gmail_delete: { limit: parseInt(process.env.MCP_GMAIL_DELETE_LIMIT ?? "50", 10), windowMs: 3_600_000 },
};

/** 定期清理 MCP sliding window 的過期時間戳 */
let mcpCleanupTimer: ReturnType<typeof setInterval> | null = null;
function ensureMcpCleanup(): void {
  if (mcpCleanupTimer) return;
  mcpCleanupTimer = setInterval(() => {
    const cutoff = Date.now() - 3_600_000; // 清理超過 1 小時的時間戳
    for (const [key, timestamps] of mcpWindows) {
      const filtered = timestamps.filter((t) => t > cutoff);
      if (filtered.length === 0) mcpWindows.delete(key);
      else mcpWindows.set(key, filtered);
    }
  }, CLEANUP_INTERVAL_MS);
  if (mcpCleanupTimer && typeof mcpCleanupTimer === "object" && "unref" in mcpCleanupTimer) {
    mcpCleanupTimer.unref();
  }
}

/**
 * MCP 層 rate limit 檢查（sliding window）
 * 同時檢查全域限制和 per-action 高風險限制
 *
 * @param userId 用戶 ID
 * @param toolName 內部工具名稱（用於判斷高風險操作）
 * @returns allowed 為 false 時，retryAfterMs 告訴 Agent 何時可以重試
 */
export function checkMcpRateLimit(
  userId: string,
  toolName?: string,
): { allowed: boolean; retryAfterMs?: number } {
  ensureMcpCleanup();
  const now = Date.now();

  // 1. 全域 per-user 限制
  const globalKey = `mcp:${userId}`;
  const globalResult = slidingWindowCheck(globalKey, now, MCP_DEFAULT_LIMIT, MCP_DEFAULT_WINDOW_MS);
  if (!globalResult.allowed) return globalResult;

  // 2. 高風險 per-action 限制
  if (toolName) {
    // 精確匹配
    const highRisk = HIGH_RISK_LIMITS[toolName];
    if (highRisk) {
      const actionKey = `mcp:${userId}:${toolName}`;
      const actionResult = slidingWindowCheck(actionKey, now, highRisk.limit, highRisk.windowMs);
      if (!actionResult.allowed) return actionResult;
    }
    // 通用 delete 類限制（toolName 包含 delete 或 trash）
    if (!highRisk && (toolName.includes("delete") || toolName.includes("trash"))) {
      const deleteKey = `mcp:${userId}:_delete`;
      const deleteLimit = parseInt(process.env.MCP_DELETE_LIMIT ?? "100", 10);
      const deleteResult = slidingWindowCheck(deleteKey, now, deleteLimit, 3_600_000);
      if (!deleteResult.allowed) return deleteResult;
    }
  }

  return { allowed: true };
}

/** sliding window 核心：檢查 + 記錄 */
function slidingWindowCheck(
  key: string,
  now: number,
  limit: number,
  windowMs: number,
): { allowed: boolean; retryAfterMs?: number } {
  const timestamps = mcpWindows.get(key) ?? [];
  const windowStart = now - windowMs;
  // 過濾掉窗口外的時間戳
  const inWindow = timestamps.filter((t) => t > windowStart);

  if (inWindow.length >= limit) {
    // 計算最早的時間戳何時會滑出窗口
    const retryAfterMs = inWindow[0] - windowStart;
    return { allowed: false, retryAfterMs: Math.max(retryAfterMs, 1000) };
  }

  inWindow.push(now);
  mcpWindows.set(key, inWindow);
  return { allowed: true };
}
