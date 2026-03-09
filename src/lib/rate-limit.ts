// In-memory sliding window rate limiter
// Prevents agents from overwhelming App APIs (spec section 14)

interface WindowEntry {
  count: number;
  resetAt: number;
}

const windows = new Map<string, WindowEntry>();

const DEFAULT_LIMIT = 60; // requests per window
const DEFAULT_WINDOW_MS = 60_000; // 1 minute

export function checkRateLimit(
  userId: string,
  limit = DEFAULT_LIMIT,
  windowMs = DEFAULT_WINDOW_MS,
): { allowed: boolean; remaining: number; resetAt: number } {
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
