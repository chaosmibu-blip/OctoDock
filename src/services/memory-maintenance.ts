import { db } from "@/db";
import { memory } from "@/db/schema";
import { eq, and, sql, desc, or } from "drizzle-orm";
import { inferPreferences } from "./preference-inference";

// ============================================================
// 記憶維護服務
// 負責記憶衰減、清理、偏好推斷的定期執行
// 由 middleware/logger.ts 在每次操作後非同步觸發
// 每用戶每小時最多執行一次（記憶體節流）
// ============================================================

/** 節流紀錄：userId → 上次執行時間戳 */
const lastRunMap = new Map<string, number>();
const THROTTLE_MS = 60 * 60 * 1000; // 1 小時

/**
 * 如果距離上次執行超過 1 小時，執行記憶維護
 * 包含：衰減 → 清理 → 偏好推斷
 */
export async function runMaintenanceIfNeeded(userId: string): Promise<void> {
  const now = Date.now();
  const lastRun = lastRunMap.get(userId) ?? 0;
  if (now - lastRun < THROTTLE_MS) return; // 節流：跳過

  lastRunMap.set(userId, now);

  try {
    await decayMemories(userId);
    await cleanupMemories(userId);
    // 偏好推斷（如果函式存在）
    try {
      await inferPreferences(userId);
    } catch {
      // preference-inference 可能沒有 export，忽略
    }
  } catch (err) {
    console.error("Memory maintenance failed:", err);
  }
}

/**
 * 記憶衰減：超過 60 天沒使用的記憶降低 confidence
 * SOP 和手動存的記憶不衰減
 */
async function decayMemories(userId: string): Promise<void> {
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

  await db.execute(sql`
    UPDATE memory
    SET confidence = GREATEST(0.1, confidence - 0.1),
        updated_at = NOW()
    WHERE user_id = ${userId}
      AND category != 'sop'
      AND confidence > 0.1
      AND (
        (last_used_at IS NOT NULL AND last_used_at < ${sixtyDaysAgo})
        OR
        (last_used_at IS NULL AND updated_at < ${sixtyDaysAgo})
      )
  `);
}

/**
 * 記憶清理：刪除 confidence 極低且長期未使用的記憶
 * SOP 永遠不自動刪除
 */
async function cleanupMemories(userId: string): Promise<void> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

  await db.execute(sql`
    DELETE FROM memory
    WHERE user_id = ${userId}
      AND category != 'sop'
      AND confidence <= 0.1
      AND (
        (last_used_at IS NOT NULL AND last_used_at < ${ninetyDaysAgo})
        OR
        (last_used_at IS NULL AND updated_at < ${ninetyDaysAgo})
      )
  `);
}

// ============================================================
// Session 偵測 + 記憶足夠度判斷
// 供 server.ts 的 do() 和 help() 使用
// ============================================================

/** Session 狀態 */
export interface SessionState {
  isNewSession: boolean; // 是否為新 session（>30 分鐘沒操作）
  memoryCount: number; // 用戶的記憶總數
  contextAgeDays: number; // context 類記憶的最舊天數
  newAppsWithoutMemory: string[]; // 新連結但沒有記憶的 App
}

/** 已偵測的 session 快取（避免每次 do() 都查 DB） */
const sessionCache = new Map<string, number>();
const SESSION_GAP_MS = 30 * 60 * 1000; // 30 分鐘

/**
 * 偵測 session 狀態
 * 用記憶體快取判斷是否為新 session，是的話查 DB 取記憶統計
 */
export async function detectSessionState(
  userId: string,
  connectedAppNames: string[],
): Promise<SessionState | null> {
  const now = Date.now();
  const lastSeen = sessionCache.get(userId) ?? 0;

  // 不是新 session → 回傳 null（省 DB 查詢）
  if (now - lastSeen < SESSION_GAP_MS) {
    sessionCache.set(userId, now);
    return null;
  }

  sessionCache.set(userId, now);

  // 是新 session → 查 DB
  const [memoryStats, appMemories] = await Promise.all([
    // 記憶統計
    db.execute(sql`
      SELECT
        COUNT(*) as count,
        MIN(CASE WHEN category = 'context' THEN COALESCE(last_used_at, updated_at) END) as oldest_context
      FROM memory
      WHERE user_id = ${userId}
    `),
    // 每個 App 的記憶數
    db.execute(sql`
      SELECT app_name, COUNT(*) as count
      FROM memory
      WHERE user_id = ${userId} AND app_name IS NOT NULL
      GROUP BY app_name
    `),
  ]);

  const stats = memoryStats.rows[0] as { count: string; oldest_context: string | null };
  const memoryCount = parseInt(stats.count) || 0;

  // 計算 context 記憶的最舊天數
  let contextAgeDays = 0;
  if (stats.oldest_context) {
    contextAgeDays = Math.floor(
      (Date.now() - new Date(stats.oldest_context).getTime()) / (24 * 60 * 60 * 1000),
    );
  }

  // 找出新連結但沒記憶的 App
  const appMemoryMap = new Set(
    (appMemories.rows as Array<{ app_name: string }>).map((r) => r.app_name),
  );
  const newAppsWithoutMemory = connectedAppNames.filter(
    (app) => !appMemoryMap.has(app),
  );

  return {
    isNewSession: true,
    memoryCount,
    contextAgeDays,
    newAppsWithoutMemory,
  };
}

/**
 * 判斷是否需要向 AI 請求用戶記憶
 * 條件（任一成立就觸發）：
 * 1. 記憶總數 < 3（新用戶）
 * 2. 有新連結的 App 但該 App 沒有記憶
 * 3. context 記憶超過 30 天沒更新
 */
export function shouldSolicitMemory(state: SessionState): string | null {
  if (state.memoryCount < 3) {
    return `💡 I don't know much about this user yet. If you have context about them from past conversations, please ask if they'd like to share it with OctoDock (so all their AI agents can benefit). If they agree: octodock_do(app:"system", action:"import_memory", params:{memories:[{key:"user_context", value:"<summary>", category:"context"}]})`;
  }

  if (state.contextAgeDays > 30) {
    return `💡 User context hasn't been updated in ${state.contextAgeDays} days. If you have newer information about the user, consider updating: octodock_do(app:"system", action:"import_memory", params:{memories:[...]})`;
  }

  if (state.newAppsWithoutMemory.length > 0) {
    return `💡 New apps connected without memories: ${state.newAppsWithoutMemory.join(", ")}. If you know the user's preferences for these apps, consider storing them.`;
  }

  return null;
}

/**
 * 產生用戶記憶摘要（供 do() 的第一次呼叫附帶）
 * 精簡版：最多 5 個偏好 + 3 個模式
 */
export async function getUserSummary(userId: string): Promise<string | null> {
  const memories = await db
    .select({
      key: memory.key,
      value: memory.value,
      category: memory.category,
    })
    .from(memory)
    .where(
      and(
        eq(memory.userId, userId),
        // 只取偏好和模式，不取 context（太多 ID 對應）
        or(eq(memory.category, "preference"), eq(memory.category, "pattern")),
      ),
    )
    .orderBy(desc(memory.confidence))
    .limit(8);

  if (memories.length === 0) return null;

  const prefs = memories
    .filter((m) => m.category === "preference")
    .slice(0, 5)
    .map((m) => `- ${m.key}: ${m.value}`);
  const patterns = memories
    .filter((m) => m.category === "pattern")
    .slice(0, 3)
    .map((m) => `- ${m.key}: ${m.value}`);

  const sections: string[] = [];
  if (prefs.length > 0) sections.push("Preferences:\n" + prefs.join("\n"));
  if (patterns.length > 0) sections.push("Patterns:\n" + patterns.join("\n"));

  return sections.length > 0 ? "## About This User\n" + sections.join("\n") : null;
}
