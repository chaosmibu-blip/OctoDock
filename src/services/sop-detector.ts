import { db } from "@/db";
import { operations } from "@/db/schema";
import { eq, and, desc, gte } from "drizzle-orm";

// ============================================================
// SOP 自動辨識引擎（Phase 8）
// 從用戶的操作記錄中自動偵測重複的操作流程
// 偵測到時，在 octodock_do 的回傳裡塞 suggestions
// 讓正在連接的 AI 自然地問用戶「要不要存成 SOP？」
//
// 核心設計：OctoDock 負責觀察和記錄，AI 負責理解和溝通
// 不需要內部 AI — 用規則引擎（LCS 序列比對）就能偵測
// ============================================================

/** SOP 候選建議 */
export interface SopSuggestion {
  type: "sop_candidate";
  message: string;
  pattern: string[];
  frequency: number;
}

/** 觸發偵測的最低重複次數 */
const MIN_REPEAT_COUNT = 3;

/** 分析的時間窗口（最近 14 天） */
const ANALYSIS_WINDOW_DAYS = 14;

/** 單次 session 的最大時間間隔（分鐘）— 超過這個間隔視為新 session */
const SESSION_GAP_MINUTES = 30;

/**
 * 檢查用戶是否有重複的操作模式，回傳 SOP 候選建議
 * 在每次 octodock_do 完成後呼叫，如果偵測到候選 SOP 就附在回傳裡
 *
 * @param userId 用戶 ID
 * @returns SOP 候選建議，或 null
 */
export async function detectSopCandidate(
  userId: string,
): Promise<SopSuggestion | null> {
  try {
    const since = new Date();
    since.setDate(since.getDate() - ANALYSIS_WINDOW_DAYS);

    // 取得最近的操作記錄
    const recentOps = await db
      .select({
        appName: operations.appName,
        action: operations.action,
        createdAt: operations.createdAt,
      })
      .from(operations)
      .where(
        and(
          eq(operations.userId, userId),
          eq(operations.success, true),
          gte(operations.createdAt, since),
        ),
      )
      .orderBy(operations.createdAt)
      .limit(200);

    if (recentOps.length < MIN_REPEAT_COUNT * 2) return null;

    // 按 session 分組（30 分鐘間隔 = 新 session）
    const sessions = groupIntoSessions(recentOps);
    if (sessions.length < MIN_REPEAT_COUNT) return null;

    // 提取每個 session 的 app.action 序列
    const sequences = sessions.map((session) =>
      session.map((op) => `${op.appName}.${op.action}`),
    );

    // 找出重複出現的子序列
    const candidate = findRepeatingPattern(sequences);
    if (!candidate) return null;

    // 過濾太短的模式（至少 2 步）
    if (candidate.pattern.length < 2) return null;

    // 產生人類可讀的描述
    const steps = candidate.pattern
      .map((p) => {
        const [app, action] = p.split(".");
        return `${app} ${action}`;
      })
      .join(" → ");

    return {
      type: "sop_candidate",
      message: `你已經第 ${candidate.count} 次執行「${steps}」的流程。要存成 SOP 自動執行嗎？`,
      pattern: candidate.pattern,
      frequency: candidate.count,
    };
  } catch {
    return null;
  }
}

// ============================================================
// 內部工具函式
// ============================================================

interface OpRecord {
  appName: string;
  action: string;
  createdAt: Date | null;
}

/** 按時間間隔將操作分組為 sessions */
function groupIntoSessions(ops: OpRecord[]): OpRecord[][] {
  const sessions: OpRecord[][] = [];
  let currentSession: OpRecord[] = [];

  for (let i = 0; i < ops.length; i++) {
    if (i === 0) {
      currentSession.push(ops[i]);
      continue;
    }

    const prevTime = ops[i - 1].createdAt?.getTime() ?? 0;
    const currTime = ops[i].createdAt?.getTime() ?? 0;
    const gapMinutes = (currTime - prevTime) / (1000 * 60);

    if (gapMinutes > SESSION_GAP_MINUTES) {
      // 超過間隔，開啟新 session
      if (currentSession.length >= 2) {
        sessions.push(currentSession);
      }
      currentSession = [ops[i]];
    } else {
      currentSession.push(ops[i]);
    }
  }

  // 最後一個 session
  if (currentSession.length >= 2) {
    sessions.push(currentSession);
  }

  return sessions;
}

/** 找出在多個 session 中重複出現的操作子序列 */
function findRepeatingPattern(
  sequences: string[][],
): { pattern: string[]; count: number } | null {
  // 提取所有長度 >= 2 的子序列，計算出現次數
  const patternCounts = new Map<string, number>();

  for (const seq of sequences) {
    // 提取長度 2-5 的連續子序列
    const seen = new Set<string>(); // 同一個 session 不重複計數
    for (let len = 2; len <= Math.min(5, seq.length); len++) {
      for (let start = 0; start <= seq.length - len; start++) {
        const sub = seq.slice(start, start + len);
        const key = sub.join(" → ");
        if (!seen.has(key)) {
          seen.add(key);
          patternCounts.set(key, (patternCounts.get(key) ?? 0) + 1);
        }
      }
    }
  }

  // 找出出現次數 >= MIN_REPEAT_COUNT 的最長模式
  let best: { pattern: string[]; count: number } | null = null;

  for (const [key, count] of patternCounts.entries()) {
    if (count < MIN_REPEAT_COUNT) continue;
    const pattern = key.split(" → ");
    if (!best || pattern.length > best.pattern.length || (pattern.length === best.pattern.length && count > best.count)) {
      best = { pattern, count };
    }
  }

  return best;
}
