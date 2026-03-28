import { db } from "@/db";
import { usageTracking } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { getUserPlan } from "@/services/plan-limits";

// ============================================================
// MCP tool call 用量限制中介層
// Free 用戶每月上限 1,000 次，Pro 用戶無限制
// 每次 tool call 成功後非同步 +1，不阻塞主請求
// ============================================================

/** Free 方案每月上限 */
const FREE_MONTHLY_LIMIT = 1000;

/** 取得當前月份字串（yyyy-mm，台灣時間 UTC+8） */
function getCurrentMonth(): string {
  const now = new Date();
  // UTC+8（台灣無日光節約，固定偏移即可）
  const tw = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const year = tw.getUTCFullYear();
  const month = String(tw.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/** 取得用戶本月已使用次數 */
export async function getMonthlyUsage(userId: string): Promise<number> {
  const month = getCurrentMonth();
  const rows = await db
    .select({ count: usageTracking.toolCallCount })
    .from(usageTracking)
    .where(and(eq(usageTracking.userId, userId), eq(usageTracking.month, month)))
    .limit(1);
  return rows[0]?.count ?? 0;
}

/**
 * 檢查用戶是否超過用量上限
 * @returns null 表示允許，否則回傳錯誤訊息
 */
export async function checkUsageLimit(userId: string): Promise<string | null> {
  const plan = await getUserPlan(userId);
  // Pro 用戶無限制
  if (plan === "pro" || plan === "team") return null;

  const usage = await getMonthlyUsage(userId);
  if (usage >= FREE_MONTHLY_LIMIT) {
    // 升級連結使用環境變數決定域名，支援 staging/dev 環境
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || "https://octo-dock.com";
    return `You've reached the Free plan limit of ${FREE_MONTHLY_LIMIT} MCP tool calls this month. Upgrade to Pro for unlimited usage → ${baseUrl}/pricing`;
  }
  return null;
}

/**
 * 記錄一次 tool call 用量（非同步，不阻塞主請求）
 * 使用 upsert：存在就 +1，不存在就建立新記錄
 */
export async function incrementUsage(userId: string): Promise<void> {
  const month = getCurrentMonth();
  await db
    .insert(usageTracking)
    .values({
      userId,
      month,
      toolCallCount: 1,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [usageTracking.userId, usageTracking.month],
      set: {
        toolCallCount: sql`${usageTracking.toolCallCount} + 1`,
        updatedAt: new Date(),
      },
    });
}

/** 取得用戶用量摘要（Dashboard 用） */
export async function getUsageSummary(userId: string): Promise<{
  plan: string;
  used: number;
  limit: number | null; // null = 無限制
  month: string;
}> {
  const plan = await getUserPlan(userId);
  const month = getCurrentMonth();
  const used = await getMonthlyUsage(userId);
  return {
    plan,
    used,
    limit: plan === "pro" || plan === "team" ? null : FREE_MONTHLY_LIMIT,
    month,
  };
}
