import { db } from "@/db";
import { schedules, connectedApps } from "@/db/schema";
import { eq, and, lte } from "drizzle-orm";
import { getAdapter } from "@/mcp/registry";
import { executeWithMiddleware } from "@/mcp/middleware/logger";
import { queryMemory } from "./memory-engine";

// ============================================================
// 排程引擎（Scheduler）
// OctoDock 的內部排程系統，處理用戶不在線時的自動操作
//
// MCP 是單向的 — AI 呼叫 OctoDock，OctoDock 不能反叫 AI
// 排程引擎解決這個問題：時間到時，OctoDock 內部代為執行
//
// 分層處理：
//   simple → 規則引擎直接執行 octodock_do（零成本）
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
    // ── 簡單排程：直接執行 octodock_do（零成本） ──
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
/**
 * 計算 cron 表達式的下一次執行時間
 * 支援完整 5 欄位 cron：分 時 日 月 週
 * 暴力搜尋最多 366 天內的下一個匹配時間點
 */
export function calculateNextRun(cronExpr: string, __timezone: string): Date {
  const parts = cronExpr.split(" ");
  if (parts.length !== 5) {
    const fallback = new Date();
    fallback.setHours(fallback.getHours() + 1);
    return fallback;
  }

  const [minuteExpr, hourExpr, domExpr, monthExpr, dowExpr] = parts;

  /** 解析 cron 欄位為允許的數值集合，支援 *、數字、逗號、範圍(-)、間隔(/) */
  function parseField(expr: string, min: number, max: number): Set<number> | null {
    if (expr === "*") return null; // null = 任意值都匹配
    const values = new Set<number>();
    for (const part of expr.split(",")) {
      const stepMatch = part.match(/^(\*|\d+-\d+)\/(\d+)$/);
      if (stepMatch) {
        const step = parseInt(stepMatch[2]);
        let start = min, end = max;
        if (stepMatch[1] !== "*") {
          const [a, b] = stepMatch[1].split("-").map(Number);
          start = a; end = b;
        }
        for (let v = start; v <= end; v += step) values.add(v);
      } else if (part.includes("-")) {
        const [a, b] = part.split("-").map(Number);
        for (let v = a; v <= b; v++) values.add(v);
      } else {
        values.add(parseInt(part));
      }
    }
    return values;
  }

  const minutes = parseField(minuteExpr, 0, 59);
  const hours = parseField(hourExpr, 0, 23);
  const doms = parseField(domExpr, 1, 31);
  const months = parseField(monthExpr, 1, 12);
  const dows = parseField(dowExpr, 0, 6); // 0=週日

  /** 檢查某個時間點是否匹配 cron */
  function matches(d: Date): boolean {
    if (minutes && !minutes.has(d.getMinutes())) return false;
    if (hours && !hours.has(d.getHours())) return false;
    if (months && !months.has(d.getMonth() + 1)) return false;
    /* 日和週的關係：cron 標準是兩者都指定時取聯集（OR） */
    if (doms && dows) {
      if (!doms.has(d.getDate()) && !dows.has(d.getDay())) return false;
    } else if (doms) {
      if (!doms.has(d.getDate())) return false;
    } else if (dows) {
      if (!dows.has(d.getDay())) return false;
    }
    return true;
  }

  /* 從下一分鐘開始暴力搜尋 */
  const now = new Date();
  const candidate = new Date(now);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  /* 最多搜尋 366 天 × 24 小時 × 60 分鐘 = 527,040 分鐘 */
  const maxIterations = 366 * 24 * 60;
  for (let i = 0; i < maxIterations; i++) {
    if (matches(candidate)) return candidate;
    candidate.setMinutes(candidate.getMinutes() + 1);
  }

  /* 找不到匹配（理論上不會發生），fallback 1 小時後 */
  const fallback = new Date();
  fallback.setHours(fallback.getHours() + 1);
  return fallback;
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
