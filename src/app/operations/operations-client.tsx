"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/** App 圖示對應 */
const APP_ICONS: Record<string, string> = {
  notion: "📝", gmail: "📧", google_calendar: "📅", google_drive: "📁",
  google_sheets: "📊", google_docs: "📄", google_tasks: "✅", youtube: "🎬",
  github: "🐙", telegram: "✈️", telegram_user: "✈️", line: "💬",
  discord: "🎮", slack: "💼", canva: "🎨", todoist: "☑️",
  microsoft_excel: "📊", microsoft_word: "📄", microsoft_powerpoint: "📽️",
  threads: "🧵", instagram: "📸", gamma: "🎞️", system: "⚙️",
};

/** 操作資料型別 */
interface Operation {
  id: string;
  appName: string;
  action: string;
  intent: string | null;
  success: boolean | null;
  durationMs: number | null;
  parentOperationId: string | null;
  createdAt: string;
}

/** 工作階段型別 */
interface Session {
  startedAt: string;
  endedAt: string;
  operationCount: number;
  apps: string[];
  operations: Operation[];
}

/** 操作歷史頁面 — 事件圖譜的用戶介面 */
export function OperationsClient() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(7);
  const [expandedSessions, setExpandedSessions] = useState<Set<number>>(new Set());

  // 載入操作歷史
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/operations?days=${days}`);
        const data = await r.json();
        if (!cancelled) {
          setSessions(data.sessions ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [days]);

  // 展開/收合工作階段
  const toggleSession = (index: number) => {
    setExpandedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  // 格式化時間
  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
  };
  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("zh-TW", { month: "short", day: "numeric" });
  };

  return (
    <main className="max-w-4xl mx-auto px-6 py-8">
      {/* 頁頭 */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <Link href="/dashboard" className="text-sm text-gray-400 hover:text-gray-600 mb-2 inline-block">
            ← Dashboard
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">操作歷史</h1>
          <p className="text-sm text-gray-500 mt-1">AI 代表你做了什麼</p>
        </div>
        {/* 時間篩選 */}
        <select
          value={days}
          onChange={(e) => setDays(parseInt(e.target.value))}
          className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
        >
          <option value={1}>今天</option>
          <option value={3}>近 3 天</option>
          <option value={7}>近 7 天</option>
          <option value={30}>近 30 天</option>
        </select>
      </div>

      {/* 載入中 */}
      {loading && (
        <div className="text-center py-20 text-gray-400">載入中...</div>
      )}

      {/* 錯誤 */}
      {error && (
        <div className="text-center py-20 text-red-500">{error}</div>
      )}

      {/* 空狀態 */}
      {!loading && !error && sessions.length === 0 && (
        <div className="text-center py-20 text-gray-400">
          <p className="text-lg mb-2">還沒有操作紀錄</p>
          <p className="text-sm">用 AI 透過 OctoDock 操作 App 後，歷史會出現在這裡</p>
        </div>
      )}

      {/* 工作階段列表 */}
      {!loading && sessions.map((session, idx) => (
        <div key={idx} className="mb-4">
          {/* Session 摘要（可點擊展開） */}
          <button
            onClick={() => toggleSession(idx)}
            className="w-full text-left px-4 py-3 bg-white border border-gray-200 rounded-lg hover:border-gray-300 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {/* App 圖示 */}
                <div className="flex -space-x-1">
                  {session.apps.slice(0, 4).map((app) => (
                    <span key={app} className="text-lg" title={app}>
                      {APP_ICONS[app] ?? "📦"}
                    </span>
                  ))}
                  {session.apps.length > 4 && (
                    <span className="text-xs text-gray-400 ml-1">+{session.apps.length - 4}</span>
                  )}
                </div>
                {/* 摘要文字 */}
                <div>
                  <span className="text-sm font-medium text-gray-900">
                    {session.operationCount} 個操作
                  </span>
                  <span className="text-xs text-gray-400 ml-2">
                    {session.apps.join("、")}
                  </span>
                </div>
              </div>
              {/* 時間 */}
              <div className="text-xs text-gray-400">
                {formatDate(session.startedAt)} {formatTime(session.startedAt)}
                {session.startedAt !== session.endedAt && ` – ${formatTime(session.endedAt)}`}
              </div>
            </div>
          </button>

          {/* 展開的操作列表 */}
          {expandedSessions.has(idx) && (
            <div className="ml-6 mt-2 border-l-2 border-gray-100 pl-4 space-y-1">
              {session.operations.map((op) => (
                <div
                  key={op.id}
                  className={`flex items-center gap-3 py-1.5 text-sm ${
                    op.parentOperationId ? "ml-4" : ""
                  }`}
                >
                  {/* 因果關係指示 */}
                  {op.parentOperationId && (
                    <span className="text-gray-300 text-xs">↳</span>
                  )}
                  {/* App 圖示 */}
                  <span className="text-base" title={op.appName}>
                    {APP_ICONS[op.appName] ?? "📦"}
                  </span>
                  {/* Action 名稱 */}
                  <span className="font-mono text-xs text-gray-600">
                    {op.action}
                  </span>
                  {/* 成功/失敗 */}
                  <span className={op.success ? "text-emerald-500" : "text-red-400"}>
                    {op.success ? "✓" : "✗"}
                  </span>
                  {/* Intent（如果有） */}
                  {op.intent && (
                    <span className="text-xs text-gray-400 truncate max-w-[200px]">
                      {op.intent}
                    </span>
                  )}
                  {/* 時間 */}
                  <span className="text-xs text-gray-300 ml-auto">
                    {formatTime(op.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </main>
  );
}
