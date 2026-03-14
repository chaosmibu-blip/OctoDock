import { db } from "@/db";
import { schedules, connectedApps } from "@/db/schema";
import { eq, and, lte, sql } from "drizzle-orm";
import { getAdapter } from "@/mcp/registry";
import { executeWithMiddleware } from "@/mcp/middleware/logger";
import { queryMemory } from "./memory-engine";

// ============================================================
// 排程引擎（Scheduler）
// AgentDock 的內部排程系統，處理用戶不在線時的自動操作
//
// MCP 是單向的 — AI 呼叫 AgentDock，AgentDock 不能反叫 AI
// 排程引擎解決這個問題：時間到時，AgentDock 內部代為執行
//
// 分層處理：
//   simple → 規則引擎直接執行 agentdock_do（零成本）
//   sop    → 內部 AI 讀 SOP 一步步執行（需要 Anthropic API key）
//   ai     → 內部 AI 理解自然語言並執行（需要 Anthropic API key）
//
// 觸發方式：由外部 cron job 每分鐘呼叫 tickScheduler()
// ============================================================

/** 排程設定的 action config 類型 */
interface SimpleActionConfig {
  app: string;
  action: string;
  params?: Record<string, unknown>;
}

interface SopActionConfig {
  sop_name: string;
}

interface AiActionConfig {
  prompt: string;
}

/**
 * 排程引擎主循環
 * 查找所有到期的排程，逐一執行
 * 應由外部 cron job 每分鐘呼叫一次
 */
export async function tickScheduler(): Promise<void> {
  const now = new Date();

  // 查找所有到期且啟用的排程
  const dueSchedules = await db
    .select()
    .from(schedules)
    .where(
      and(
        eq(schedules.isActive, true),
        lte(schedules.nextRunAt, now),
      ),
    )
    .limit(20); // 每次最多處理 20 個，避免一次太多

  for (const schedule of dueSchedules) {
    try {
      const result = await executeSchedule(schedule);

      // 更新執行結果和下次執行時間
      const nextRun = calculateNextRun(schedule.cronExpression, schedule.timezone ?? "Asia/Taipei");
      await db
        .update(schedules)
        .set({
          lastRunAt: now,
          lastRunResult: result as Record<string, unknown>,
          nextRunAt: nextRun,
          updatedAt: now,
        })
        .where(eq(schedules.id, schedule.id));
    } catch (error) {
      // 執行失敗：記錄錯誤，不停用排程
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      await db
        .update(schedules)
        .set({
          lastRunAt: now,
          lastRunResult: { ok: false, error: errorMsg },
          nextRunAt: calculateNextRun(schedule.cronExpression, schedule.timezone ?? "Asia/Taipei"),
          updatedAt: now,
        })
        .where(eq(schedules.id, schedule.id));
    }
  }
}

/**
 * 執行單一排程
 * 根據 actionType 分派到不同的處理邏輯
 */
async function executeSchedule(
  schedule: typeof schedules.$inferSelect,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const config = schedule.actionConfig as Record<string, unknown>;

  switch (schedule.actionType) {
    // ── 簡單排程：直接執行 agentdock_do（零成本） ──
    case "simple": {
      const { app, action, params = {} } = config as unknown as SimpleActionConfig;

      // 驗證 App 已連結
      const apps = await db
        .select()
        .from(connectedApps)
        .where(
          and(
            eq(connectedApps.userId, schedule.userId),
            eq(connectedApps.appName, app),
            eq(connectedApps.status, "active"),
          ),
        )
        .limit(1);

      if (apps.length === 0) {
        return { ok: false, error: `App "${app}" not connected` };
      }

      const adapter = getAdapter(app);
      if (!adapter) {
        return { ok: false, error: `Adapter "${app}" not found` };
      }

      // 透過 actionMap 找內部工具名稱
      const toolName = adapter.actionMap?.[action];
      if (!toolName) {
        return { ok: false, error: `Unknown action "${action}" for ${app}` };
      }

      // 執行
      const result = await executeWithMiddleware(
        schedule.userId,
        app,
        toolName,
        params,
        (p, token) => adapter.execute(toolName, p, token),
      );

      return {
        ok: !result.isError,
        data: result.content[0]?.text,
      };
    }

    // ── SOP 排程：讀取 SOP 並執行（需要內部 AI） ──
    case "sop": {
      const { sop_name } = config as unknown as SopActionConfig;

      // 取得 SOP 內容
      const sops = await queryMemory(schedule.userId, sop_name, "sop");
      const sop = sops.find((s) => s.key === sop_name);

      if (!sop) {
        return { ok: false, error: `SOP "${sop_name}" not found` };
      }

      // TODO Phase 5.2: 用內部 AI（Haiku）解析 SOP 並一步步執行
      // 目前先記錄 SOP 內容，等 internal-ai.ts 實作後再串接
      return {
        ok: true,
        data: `SOP "${sop_name}" triggered. Internal AI execution pending implementation.`,
      };
    }

    // ── AI 排程：自然語言任務（需要內部 AI） ──
    case "ai": {
      const { prompt } = config as unknown as AiActionConfig;

      // TODO Phase 5.2: 用內部 AI（Haiku）理解 prompt 並執行
      return {
        ok: true,
        data: `AI task triggered: "${prompt}". Internal AI execution pending implementation.`,
      };
    }

    default:
      return { ok: false, error: `Unknown action type: ${schedule.actionType}` };
  }
}

// ============================================================
// Cron 表達式解析
// 簡化版：支援標準 5 欄位 cron（分 時 日 月 週）
// ============================================================

/**
 * 根據 cron 表達式計算下次執行時間
 * 簡化實作：往後推算最近的匹配時間
 *
 * @param cronExpr cron 表達式（分 時 日 月 週）
 * @param timezone 用戶時區
 * @returns 下次執行的 UTC 時間
 */
export function calculateNextRun(cronExpr: string, timezone: string): Date {
  const parts = cronExpr.split(" ");
  if (parts.length !== 5) {
    // 無效的 cron 表達式，預設 1 小時後
    const fallback = new Date();
    fallback.setHours(fallback.getHours() + 1);
    return fallback;
  }

  const [minuteExpr, hourExpr] = parts;

  // 解析分鐘和小時
  const minute = minuteExpr === "*" ? -1 : parseInt(minuteExpr);
  const hour = hourExpr === "*" ? -1 : parseInt(hourExpr);

  // 從現在開始找下一個匹配的時間點
  const now = new Date();
  const candidate = new Date(now);

  // 設定分鐘
  if (minute >= 0) {
    candidate.setMinutes(minute, 0, 0);
  } else {
    // 每分鐘執行：下一分鐘
    candidate.setMinutes(candidate.getMinutes() + 1, 0, 0);
  }

  // 設定小時
  if (hour >= 0) {
    candidate.setHours(hour);
  }

  // 如果算出的時間已經過了，往後推一天（或一小時）
  if (candidate <= now) {
    if (hour >= 0) {
      candidate.setDate(candidate.getDate() + 1);
    } else if (minute >= 0) {
      candidate.setHours(candidate.getHours() + 1);
    }
  }

  return candidate;
}

// ============================================================
// 排程 CRUD（給 system-actions 呼叫）
// ============================================================

/** 建立新排程 */
export async function createSchedule(
  userId: string,
  name: string,
  cronExpression: string,
  actionType: string,
  actionConfig: Record<string, unknown>,
  timezone?: string,
): Promise<string> {
  const tz = timezone ?? "Asia/Taipei";
  const nextRunAt = calculateNextRun(cronExpression, tz);

  const result = await db
    .insert(schedules)
    .values({
      userId,
      name,
      cronExpression,
      timezone: tz,
      actionType,
      actionConfig,
      nextRunAt,
    })
    .returning({ id: schedules.id });

  return result[0].id;
}

/** 列出用戶的所有排程 */
export async function listSchedules(userId: string) {
  return db
    .select({
      id: schedules.id,
      name: schedules.name,
      cronExpression: schedules.cronExpression,
      actionType: schedules.actionType,
      actionConfig: schedules.actionConfig,
      isActive: schedules.isActive,
      lastRunAt: schedules.lastRunAt,
      nextRunAt: schedules.nextRunAt,
    })
    .from(schedules)
    .where(eq(schedules.userId, userId))
    .orderBy(schedules.createdAt);
}

/** 啟用/停用排程 */
export async function toggleSchedule(
  userId: string,
  scheduleId: string,
  isActive: boolean,
): Promise<void> {
  await db
    .update(schedules)
    .set({
      isActive,
      updatedAt: new Date(),
      // 啟用時重新計算下次執行時間
      ...(isActive ? { nextRunAt: new Date() } : {}),
    })
    .where(
      and(
        eq(schedules.id, scheduleId),
        eq(schedules.userId, userId),
      ),
    );
}

/** 刪除排程 */
export async function deleteSchedule(
  userId: string,
  scheduleId: string,
): Promise<void> {
  await db
    .delete(schedules)
    .where(
      and(
        eq(schedules.id, scheduleId),
        eq(schedules.userId, userId),
      ),
    );
}
