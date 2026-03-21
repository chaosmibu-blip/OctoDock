"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useI18n, LanguageSwitcher } from "@/lib/i18n";
import Image from "next/image";

// ============================================================
// 排程管理頁面（客戶端）
// 列出所有排程、狀態、下次執行時間，可啟停和刪除
// ============================================================

interface Schedule {
  id: string;
  name: string;
  cronExpression: string;
  timezone: string;
  actionType: string;
  actionConfig: Record<string, unknown>;
  isActive: boolean;
  lastRunAt: string | null;
  lastRunResult: Record<string, unknown> | null;
  nextRunAt: string | null;
  createdAt: string;
}

interface SchedulesProps {
  schedules: Schedule[];
}

/** 將 cron 表達式轉成可讀文字 */
function cronToHuman(cron: string): string {
  const parts = cron.split(" ");
  if (parts.length < 5) return cron;
  const [min, hour, dom, mon, dow] = parts;

  // 常見模式
  if (dom === "*" && mon === "*" && dow === "*") {
    if (hour === "*" && min === "*") return "每分鐘";
    if (hour === "*") return `每小時第 ${min} 分`;
    return `每天 ${hour}:${min.padStart(2, "0")}`;
  }
  if (dom === "*" && mon === "*" && dow !== "*") {
    const dayNames: Record<string, string> = { "0": "日", "1": "一", "2": "二", "3": "三", "4": "四", "5": "五", "6": "六" };
    const days = dow.split(",").map((d) => dayNames[d] ?? d).join("、");
    return `每週${days} ${hour}:${min.padStart(2, "0")}`;
  }
  return cron;
}

/** 動作類型標籤 */
function actionTypeLabel(type: string): string {
  switch (type) {
    case "simple": return "規則";
    case "sop": return "SOP";
    case "ai": return "AI";
    default: return type;
  }
}

export function SchedulesClient({ schedules: initialSchedules }: SchedulesProps) {
  const [schedules, setSchedules] = useState(initialSchedules);
  const [toggling, setToggling] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const router = useRouter();
  const { t } = useI18n();

  /** 啟停排程 */
  const toggleSchedule = useCallback(async (id: string, isActive: boolean) => {
    setToggling(id);
    try {
      const res = await fetch("/api/schedules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, isActive: !isActive }),
      });
      if (res.ok) {
        setSchedules((prev) =>
          prev.map((s) => (s.id === id ? { ...s, isActive: !s.isActive } : s)),
        );
      }
    } catch {
      // 切換失敗不更新本地狀態
    } finally {
      setToggling(null);
    }
  }, []);

  /** 刪除排程 */
  const deleteSchedule = useCallback(async (id: string) => {
    try {
      const res = await fetch("/api/schedules", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        setSchedules((prev) => prev.filter((s) => s.id !== id));
      }
    } catch {
      // 刪除失敗不更新本地狀態
    }
    setDeleteConfirm(null);
  }, []);

  return (
    <div className="min-h-screen bg-[#faf9f6] py-6 px-4">
      <div className="max-w-4xl mx-auto space-y-5">

        {/* Nav bar */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Image src="/icon-192.png" alt="OctoDock" width={28} height={28} className="rounded-lg" />
            <h1 className="text-xl font-bold text-gray-900">{t("schedules.title")}</h1>
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <LanguageSwitcher />
            <Link
              href="/dashboard"
              className="px-3 py-1.5 text-xs border rounded-lg hover:bg-gray-100 transition-colors"
            >
              {t("common.back")}
            </Link>
          </div>
        </div>

        {/* 排程列表 */}
        {schedules.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center">
            <p className="text-sm text-gray-400">{t("schedules.empty")}</p>
            <p className="text-xs text-gray-300 mt-2">{t("schedules.empty_hint")}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {schedules.map((schedule) => {
              const actionConfig = schedule.actionConfig;
              const actionDesc = schedule.actionType === "simple"
                ? `${actionConfig.app}.${actionConfig.action}`
                : schedule.actionType === "sop"
                  ? `SOP: ${actionConfig.sop_name}`
                  : `AI: ${String(actionConfig.prompt ?? "").slice(0, 50)}`;

              return (
                <div
                  key={schedule.id}
                  className={`rounded-lg border bg-white p-4 transition-opacity ${
                    schedule.isActive ? "" : "opacity-50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      {/* 名稱和狀態 */}
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-sm font-medium text-gray-900 truncate">{schedule.name}</h3>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                          schedule.isActive
                            ? "bg-green-100 text-green-700"
                            : "bg-gray-100 text-gray-500"
                        }`}>
                          {schedule.isActive ? t("schedules.active") : t("schedules.paused")}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600">
                          {actionTypeLabel(schedule.actionType)}
                        </span>
                      </div>

                      {/* 排程規則和動作 */}
                      <p className="text-xs text-gray-500">
                        {cronToHuman(schedule.cronExpression)} ({schedule.timezone})
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5 truncate">{actionDesc}</p>

                      {/* 執行狀態 */}
                      <div className="flex gap-4 mt-2 text-[11px] text-gray-400">
                        {schedule.lastRunAt && (
                          <span>{t("schedules.last_run")}: {new Date(schedule.lastRunAt).toLocaleString()}</span>
                        )}
                        {schedule.nextRunAt && schedule.isActive && (
                          <span>{t("schedules.next_run")}: {new Date(schedule.nextRunAt).toLocaleString()}</span>
                        )}
                      </div>
                    </div>

                    {/* 操作按鈕 */}
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => toggleSchedule(schedule.id, schedule.isActive)}
                        disabled={toggling === schedule.id}
                        className="px-3 py-1.5 text-[11px] border rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50"
                      >
                        {schedule.isActive ? t("schedules.pause") : t("schedules.resume")}
                      </button>
                      {deleteConfirm === schedule.id ? (
                        <div className="flex gap-1">
                          <button
                            onClick={() => deleteSchedule(schedule.id)}
                            className="px-3 py-1.5 text-[11px] bg-red-500 text-white rounded-lg hover:bg-red-600"
                          >
                            {t("common.delete")}
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            className="px-2 py-1.5 text-[11px] text-gray-500 hover:text-gray-700"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirm(schedule.id)}
                          className="px-3 py-1.5 text-[11px] border border-red-200 text-red-500 rounded-lg hover:bg-red-50 transition-colors"
                        >
                          {t("common.delete")}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
