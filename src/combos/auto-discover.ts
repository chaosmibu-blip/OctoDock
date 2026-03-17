/**
 * 第三層：自動發現候選組合技
 * 從用戶的操作記錄中偵測跨 App 的操作模式
 * 重複出現的模式自動標記為「候選組合技」
 *
 * 三層關係：
 * - 第一層：原始 API action（adapter 定義）
 * - 第二層：策展組合技（combos/registry.ts 人工定義）
 * - 第三層：自動發現（本檔案，從使用數據長出來）
 */

import { db } from "@/db";
import { operations } from "@/db/schema";
import { eq, and, gte, desc } from "drizzle-orm";
import { getAllAdapters } from "@/mcp/registry";

/** 自動發現的候選組合技 */
export interface DiscoveredCombo {
  id: string;
  pattern: Array<{ app: string; action: string }>;
  frequency: number;      // 出現次數
  lastSeen: string;        // 最後一次出現時間
  suggestedName: string;   // 自動產生的名稱
}

/* 觸發門檻 */
const MIN_CROSS_APP_REPEATS = 3;  // 跨 App 模式至少出現 3 次
const ANALYSIS_WINDOW_DAYS = 30;  // 分析最近 30 天
const SESSION_GAP_MS = 30 * 60 * 1000; // 30 分鐘間隔 = 新 session

/**
 * 從用戶的操作記錄中自動發現跨 App 的操作模式
 * 回傳候選組合技列表
 */
export async function discoverCombos(userId: string): Promise<DiscoveredCombo[]> {
  const since = new Date(Date.now() - ANALYSIS_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  /* 取得最近的成功操作 */
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
    .limit(500);

  if (recentOps.length < MIN_CROSS_APP_REPEATS * 2) return [];

  /* 按 session 分組 */
  const sessions = groupSessions(recentOps);
  if (sessions.length < MIN_CROSS_APP_REPEATS) return [];

  /* 提取跨 App 子序列 */
  const crossAppPatterns = findCrossAppPatterns(sessions);

  /* 驗證 pattern 中的 action 是否真的存在於 adapter */
  const adapters = getAllAdapters();
  const validActions = new Set<string>();
  for (const adapter of adapters) {
    for (const actionName of Object.keys(adapter.actionMap)) {
      validActions.add(`${adapter.name}.${actionName}`);
    }
  }

  /* 過濾並轉換 */
  const discovered: DiscoveredCombo[] = [];
  for (const { pattern, count, lastSeen } of crossAppPatterns) {
    /* 每個步驟都必須在 adapter 中存在 */
    const steps = pattern.map(p => {
      const [app, action] = p.split('.');
      return { app, action };
    });

    const allValid = steps.every(s => validActions.has(`${s.app}.${s.action}`));
    if (!allValid) continue;

    /* 必須跨 App（至少 2 個不同的 App） */
    const uniqueApps = new Set(steps.map(s => s.app));
    if (uniqueApps.size < 2) continue;

    /* 產生 ID 和名稱 */
    const id = `discovered-${pattern.join('-').replace(/\./g, '_')}`;
    const appNames = [...uniqueApps].map(a => {
      const adapter = adapters.find(ad => ad.name === a);
      return adapter?.displayName.zh ?? a;
    });
    const suggestedName = `${appNames.join(' + ')} 自動流程`;

    discovered.push({
      id,
      pattern: steps,
      frequency: count,
      lastSeen: lastSeen.toISOString(),
      suggestedName,
    });
  }

  /* 按頻率排序，最多回傳 5 個 */
  return discovered.sort((a, b) => b.frequency - a.frequency).slice(0, 5);
}

/* ── 內部工具函式 ── */

interface OpRecord {
  appName: string;
  action: string;
  createdAt: Date | null;
}

/** 按時間間隔分組為 session */
function groupSessions(ops: OpRecord[]): OpRecord[][] {
  const sessions: OpRecord[][] = [];
  let current: OpRecord[] = [];

  for (let i = 0; i < ops.length; i++) {
    if (i === 0) { current.push(ops[i]); continue; }
    const prev = ops[i - 1].createdAt?.getTime() ?? 0;
    const curr = ops[i].createdAt?.getTime() ?? 0;
    if (curr - prev > SESSION_GAP_MS) {
      if (current.length >= 2) sessions.push(current);
      current = [ops[i]];
    } else {
      current.push(ops[i]);
    }
  }
  if (current.length >= 2) sessions.push(current);
  return sessions;
}

/** 找出跨 App 的重複操作子序列 */
function findCrossAppPatterns(
  sessions: OpRecord[][],
): Array<{ pattern: string[]; count: number; lastSeen: Date }> {
  /* 計算所有長度 2-4 的連續子序列出現次數 */
  const patternInfo = new Map<string, { count: number; lastSeen: Date }>();

  for (const session of sessions) {
    const seq = session.map(op => `${op.appName}.${op.action}`);
    const seen = new Set<string>();

    for (let len = 2; len <= Math.min(4, seq.length); len++) {
      for (let start = 0; start <= seq.length - len; start++) {
        const sub = seq.slice(start, start + len);

        /* 只保留跨 App 的序列 */
        const apps = new Set(sub.map(s => s.split('.')[0]));
        if (apps.size < 2) continue;

        const key = sub.join('|');
        if (seen.has(key)) continue;
        seen.add(key);

        const existing = patternInfo.get(key);
        const lastOp = session[start + len - 1];
        const lastTime = lastOp.createdAt ?? new Date();

        if (existing) {
          existing.count++;
          if (lastTime > existing.lastSeen) existing.lastSeen = lastTime;
        } else {
          patternInfo.set(key, { count: 1, lastSeen: lastTime });
        }
      }
    }
  }

  /* 過濾出重複次數達標的 */
  const results: Array<{ pattern: string[]; count: number; lastSeen: Date }> = [];
  for (const [key, info] of patternInfo) {
    if (info.count >= MIN_CROSS_APP_REPEATS) {
      results.push({ pattern: key.split('|'), count: info.count, lastSeen: info.lastSeen });
    }
  }

  return results;
}
