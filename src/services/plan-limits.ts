import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { eq } from "drizzle-orm";

// ============================================================
// 方案管理（Plan Management）
// 目前所有功能對所有用戶開放，不做功能限制
// 付費版的價值是託管服務（零維護），不是功能差異
// 保留方案識別供未來需要時使用
// ============================================================

export type PlanName = "free" | "pro" | "team";

/**
 * 取得用戶的訂閱方案
 * 如果沒有訂閱記錄或已過期，回傳 'free'
 */
export async function getUserPlan(userId: string): Promise<PlanName> {
  const sub = await db
    .select({
      plan: subscriptions.plan,
      status: subscriptions.status,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
    })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);

  if (sub.length === 0) return "free";

  const { plan, status, currentPeriodEnd } = sub[0];

  if (status !== "active") return "free";
  if (currentPeriodEnd && currentPeriodEnd < new Date()) return "free";

  return (plan as PlanName) || "free";
}
