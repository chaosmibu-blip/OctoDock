/**
 * 通用 Session 機制
 *
 * 讓多次 octodock_do 呼叫能歸屬同一個任務，無需改動工具定義。
 * AI 第一次呼叫時正常填寫 intent，回傳帶 session 編號引導。
 * 後續呼叫 intent 尾部帶 +N，OctoDock 自動歸入同一 session。
 */
import { db } from "@/db";
import { operations } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";

/** Session 解析結果 */
export interface SessionInfo {
  /** 清理後的 intent（移除尾部 +N） */
  cleanIntent: string;
  /** 預分配的 sessionSeq（供本次操作使用） */
  sessionSeq: number;
  /** 此操作的 sessionId（同 session 共用） */
  sessionId: string;
  /** 是否為既有 session 的延續 */
  isContinuation: boolean;
}

/** 從 intent 尾部解析 +N session 編號 */
function parseSessionRef(intent: string): { cleanIntent: string; refSeq: number | null } {
  const match = intent.match(/\+(\d+)\s*$/);
  if (!match) return { cleanIntent: intent, refSeq: null };
  const refSeq = parseInt(match[1], 10);
  const cleanIntent = intent.slice(0, match.index).trim();
  return { cleanIntent, refSeq };
}

/** 從 DB sequence 預分配一個 sessionSeq */
async function allocateSessionSeq(): Promise<number> {
  const rows = await db.execute(sql`SELECT nextval('operations_session_seq_seq') AS seq`);
  return Number((rows.rows[0] as { seq: string }).seq);
}

/**
 * 解析 intent 中的 session 引用，回傳 session 資訊
 *
 * - intent 無 +N → 新 session（新 UUID + 預分配 sessionSeq）
 * - intent 有 +N → 查 operations 表找 sessionSeq = N，延續其 sessionId
 *
 * sessionSeq 在此預分配，確保 exitDo 能在回傳時帶上引導文字
 */
export async function resolveSession(
  userId: string,
  intent: string,
): Promise<SessionInfo> {
  const { cleanIntent, refSeq } = parseSessionRef(intent);

  // 預分配 sessionSeq（不管新舊 session 都需要，每筆操作各自有自己的 seq）
  const sessionSeq = await allocateSessionSeq();

  // 有 +N 引用 → 查既有 session
  if (refSeq !== null) {
    try {
      const rows = await db
        .select({ sessionId: operations.sessionId })
        .from(operations)
        .where(
          and(
            eq(operations.userId, userId),
            eq(operations.sessionSeq, refSeq),
          ),
        )
        .limit(1);

      if (rows.length > 0 && rows[0].sessionId) {
        return {
          cleanIntent,
          sessionSeq,
          sessionId: rows[0].sessionId,
          isContinuation: true,
        };
      }
    } catch {
      // 查詢失敗 → fallback 當新 session
    }
  }

  // 無引用或查不到 → 新 session
  return {
    cleanIntent,
    sessionSeq,
    sessionId: randomUUID(),
    isContinuation: false,
  };
}

/**
 * 產生 session 引導文字，附在回傳結果中
 * 告訴 AI 下次呼叫時如何引用此 session
 */
export function buildSessionGuide(sessionSeq: number): string {
  return `[Session #${sessionSeq}] If your next call is related to this task, append +${sessionSeq} to your intent (e.g. "your description+${sessionSeq}"). Otherwise, write intent normally.`;
}
