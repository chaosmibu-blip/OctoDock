import { db } from "@/db";
import { oauthCodes, oauthTokens, operations } from "@/db/schema";
import { eq, lt, or, and, sql } from "drizzle-orm";

// ============================================================
// 資料庫清理服務
// 定期清理過期或無用的資料，防止表無限膨脹
// 由 server.ts 的 cleanExpiredResults() 同步觸發（非同步、不阻塞主流程）
// ============================================================

/** 操作紀錄保留天數（90 天，供稽核用） */
const OPERATIONS_RETENTION_DAYS = 90;

/**
 * 清理已使用或過期的 OAuth authorization codes
 * - used=true：已兌換成 token，不再需要
 * - expires_at < now()：超過 10 分鐘未使用，已過期
 */
async function cleanOAuthCodes(): Promise<number> {
  const result = await db.delete(oauthCodes).where(
    or(
      eq(oauthCodes.used, true),
      lt(oauthCodes.expiresAt, new Date()),
    ),
  );
  return result.rowCount ?? 0;
}

/**
 * 清理過期的 OAuth access tokens
 * - expires_at < now()：token 已過期且未被 refresh（refresh 時舊 token 會被刪除）
 * - 過期的 token 已無法使用，安全刪除
 */
async function cleanOAuthTokens(): Promise<number> {
  const result = await db.delete(oauthTokens).where(
    lt(oauthTokens.expiresAt, new Date()),
  );
  return result.rowCount ?? 0;
}

/**
 * 清理超過 90 天的操作紀錄
 * - 保留近 90 天的紀錄供稽核和 SOP 偵測使用
 * - 超過 90 天的紀錄自動刪除，防止表無限膨脹
 */
async function cleanOldOperations(): Promise<number> {
  const cutoffDate = new Date(
    Date.now() - OPERATIONS_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  );
  const result = await db.delete(operations).where(
    lt(operations.createdAt, cutoffDate),
  );
  return result.rowCount ?? 0;
}

/**
 * 執行所有資料庫清理任務
 * 各任務獨立執行，一個失敗不影響其他
 * 回傳各表清理的行數
 */
export async function cleanExpiredData(): Promise<void> {
  const results: Record<string, number> = {};

  // 清理 OAuth codes（已使用 + 已過期）
  try {
    results.oauthCodes = await cleanOAuthCodes();
  } catch (err) {
    console.error("[db-cleanup] Failed to clean oauth_codes:", err);
  }

  // 清理 OAuth tokens（已過期）
  try {
    results.oauthTokens = await cleanOAuthTokens();
  } catch (err) {
    console.error("[db-cleanup] Failed to clean oauth_tokens:", err);
  }

  // 清理操作紀錄（超過 90 天）
  try {
    results.operations = await cleanOldOperations();
  } catch (err) {
    console.error("[db-cleanup] Failed to clean operations:", err);
  }

  // 記錄清理結果（只在有清理時才 log，避免噪音）
  const totalCleaned = Object.values(results).reduce((sum, n) => sum + (n || 0), 0);
  if (totalCleaned > 0) {
    console.log(
      `[db-cleanup] 清理完成：oauth_codes=${results.oauthCodes ?? 0}, oauth_tokens=${results.oauthTokens ?? 0}, operations=${results.operations ?? 0}`,
    );
  }
}
