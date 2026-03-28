// ============================================================
// 第三層：全域錯誤學習（自動優化）
// 錯誤發生時分析「錯在哪」，把「錯 → 對」的經驗寫進 memory
// 下次任何 AI 呼叫同一個 action 時，pre-context 自動帶出提示
// ============================================================

import { db } from "@/db";
import { memory } from "@/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * 從錯誤中學習 — 分析 AI 傳入的參數問題並記錄到 memory
 *
 * @param userId 用戶 ID（用來關聯 memory）
 * @param app App 名稱
 * @param action Action 名稱
 * @param params AI 傳入的參數
 * @param errorMessage 錯誤訊息
 * @param errorCode 錯誤分類碼（TOKEN_EXPIRED 等跟參數無關的跳過）
 */
export async function learnFromError(
  userId: string,
  app: string,
  action: string,
  params: Record<string, unknown>,
  errorMessage: string,
  errorCode?: string,
): Promise<void> {
  // 跳過與參數無關的錯誤（token / rate limit / network）
  const skipCodes = ["TOKEN_EXPIRED", "TOKEN_REVOKED", "RATE_LIMITED", "NETWORK_ERROR", "SERVER_ERROR"];
  if (errorCode && skipCodes.includes(errorCode)) return;

  try {
    const key = `error_pattern:${app}:${action}`;

    // 查是否已有此 action 的錯誤記錄
    const existing = await db
      .select({ value: memory.value })
      .from(memory)
      .where(
        and(
          eq(memory.userId, userId),
          eq(memory.category, "pattern"),
          eq(memory.key, key),
        ),
      )
      .limit(1);

    // 組合錯誤資訊
    const errorInfo = {
      lastError: errorMessage.slice(0, 200),
      lastParams: Object.keys(params),
      count: 1,
      updatedAt: new Date().toISOString(),
    };

    if (existing.length > 0) {
      // 更新已有的記錄（累加 count）
      try {
        const prev = JSON.parse(existing[0].value);
        errorInfo.count = (prev.count ?? 0) + 1;
      } catch {
        // parse 失敗 → 用新值
      }

      await db
        .update(memory)
        .set({
          value: JSON.stringify(errorInfo),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(memory.userId, userId),
            eq(memory.category, "pattern"),
            eq(memory.key, key),
          ),
        );
    } else {
      // 新建錯誤記錄
      await db.insert(memory).values({
        userId,
        category: "pattern",
        key,
        value: JSON.stringify(errorInfo),
        appName: app,
      });
    }
  } catch (err) {
    // 錯誤學習本身失敗不應影響主流程
    console.error("[error-learner] Failed to learn from error:", err);
  }
}

/**
 * 查詢某 action 的歷史錯誤模式（供 pre-context 使用）
 *
 * @returns 有歷史錯誤的話回傳提示文字，否則 null
 */
export async function getErrorPattern(
  userId: string,
  app: string,
  action: string,
): Promise<string | null> {
  try {
    const key = `error_pattern:${app}:${action}`;
    const rows = await db
      .select({ value: memory.value })
      .from(memory)
      .where(
        and(
          eq(memory.userId, userId),
          eq(memory.category, "pattern"),
          eq(memory.key, key),
        ),
      )
      .limit(1);

    if (rows.length === 0) return null;

    const data = JSON.parse(rows[0].value);
    // 發生過 1 次就提示，讓 AI 第一時間知道歷史錯誤
    if ((data.count ?? 0) < 1) return null;

    return `⚠️ This action has failed ${data.count} times recently. Last error: "${data.lastError}"`;
  } catch {
    return null;
  }
}
