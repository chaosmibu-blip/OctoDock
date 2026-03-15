import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { eq } from "drizzle-orm";

// ============================================================
// 方案分級與功能限制（Plan Limits）
// 控制免費版 vs 付費版的功能差異
//
// 免費版：讓用戶體驗核心價值（MCP 連接 + 基本操作）
// Pro 版：解鎖進階功能（排程、SOP、更多 App 連接數）
// Team 版：多人團隊（未來）
// ============================================================

/** 各方案的功能限制 */
export const PLAN_LIMITS = {
  free: {
    maxConnectedApps: 2, // 最多連接 2 個 App
    maxOperationsPerDay: 50, // 每天最多 50 次操作
    maxMemoryEntries: 100, // 最多 100 筆記憶
    maxSops: 3, // 最多 3 個 SOP
    schedulesEnabled: false, // 不能用排程
    maxSchedules: 0,
    internalAiEnabled: false, // 不能用內部 AI
    prioritySupport: false,
  },
  pro: {
    maxConnectedApps: 10, // 最多 10 個 App
    maxOperationsPerDay: 1000, // 每天 1000 次操作
    maxMemoryEntries: 10000, // 10000 筆記憶
    maxSops: 50, // 50 個 SOP
    schedulesEnabled: true, // 可以用排程
    maxSchedules: 20, // 最多 20 個排程
    internalAiEnabled: true, // 可以用內部 AI
    prioritySupport: true,
  },
  team: {
    maxConnectedApps: 50,
    maxOperationsPerDay: 10000,
    maxMemoryEntries: 100000,
    maxSops: 500,
    schedulesEnabled: true,
    maxSchedules: 100,
    internalAiEnabled: true,
    prioritySupport: true,
  },
} as const;

export type PlanName = keyof typeof PLAN_LIMITS;

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

  // 檢查是否有效
  if (status !== "active") return "free";
  if (currentPeriodEnd && currentPeriodEnd < new Date()) return "free";

  return (plan as PlanName) || "free";
}

/**
 * 取得用戶的功能限制
 */
export async function getUserLimits(userId: string) {
  const plan = await getUserPlan(userId);
  return { plan, limits: PLAN_LIMITS[plan] };
}

/**
 * 檢查用戶是否可以執行某個操作
 * 回傳 { allowed: true } 或 { allowed: false, reason: "..." }
 */
export async function checkPlanLimit(
  userId: string,
  feature: "schedule" | "sop" | "internal_ai" | "connect_app",
): Promise<{ allowed: boolean; reason?: string; plan?: PlanName }> {
  const { plan, limits } = await getUserLimits(userId);

  switch (feature) {
    case "schedule":
      if (!limits.schedulesEnabled) {
        return {
          allowed: false,
          reason: "Scheduling requires Pro plan. Upgrade to unlock automated tasks.",
          plan,
        };
      }
      return { allowed: true, plan };

    case "internal_ai":
      if (!limits.internalAiEnabled) {
        return {
          allowed: false,
          reason: "Internal AI requires Pro plan.",
          plan,
        };
      }
      return { allowed: true, plan };

    case "sop":
      // SOP 本身免費版也能用，只是數量有限（在 sop_create 裡檢查數量）
      return { allowed: true, plan };

    case "connect_app":
      // App 連接數在 connect API 裡檢查
      return { allowed: true, plan };

    default:
      return { allowed: true, plan };
  }
}

/**
 * 檢查每日操作次數是否超過方案限制
 */
export async function checkDailyOperationLimit(
  userId: string,
): Promise<{ allowed: boolean; reason?: string; remaining?: number }> {
  const { plan, limits } = await getUserLimits(userId);

  // 查詢今日操作次數
  const { db } = await import("@/db");
  const { operations } = await import("@/db/schema");
  const { eq, and, gte, sql } = await import("drizzle-orm");

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(operations)
    .where(
      and(
        eq(operations.userId, userId),
        gte(operations.createdAt, today),
      ),
    );

  const todayCount = result[0]?.count ?? 0;
  const remaining = limits.maxOperationsPerDay - todayCount;

  if (remaining <= 0) {
    return {
      allowed: false,
      reason: `Daily operation limit reached (${limits.maxOperationsPerDay}/day on ${plan} plan). Upgrade for more.`,
      remaining: 0,
    };
  }

  return { allowed: true, remaining };
}
