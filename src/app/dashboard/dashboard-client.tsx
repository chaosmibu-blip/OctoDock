"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useI18n, LanguageSwitcher } from "@/lib/i18n";

interface ToolInfo {
  name: string;
  description: string;
}

interface DashboardProps {
  user: { name: string; email: string; mcpApiKey: string };
  connectedApps: Array<{
    appName: string;
    status: string;
    connectedAt: string;
  }>;
  origin: string;
}

/* App 定義清單 — 已上線的 */
const APP_KEYS = [
  // 筆記 / 文件
  { name: "notion", displayName: "Notion", descKey: "app.notion.desc" },
  { name: "google_docs", displayName: "Google Docs", descKey: "app.google_docs.desc" },
  // 信箱
  { name: "gmail", displayName: "Gmail", descKey: "app.gmail.desc" },
  // 行事曆 / 待辦
  { name: "google_calendar", displayName: "Google Calendar", descKey: "app.google_calendar.desc" },
  { name: "google_tasks", displayName: "Google Tasks", descKey: "app.google_tasks.desc" },
  // 雲端 / 試算表
  { name: "google_drive", displayName: "Google Drive", descKey: "app.google_drive.desc" },
  { name: "google_sheets", displayName: "Google Sheets", descKey: "app.google_sheets.desc" },
  // 社群
  { name: "youtube", displayName: "YouTube", descKey: "app.youtube.desc" },
  // 開發
  { name: "github", displayName: "GitHub", descKey: "app.github.desc" },
  // 通訊
  { name: "line", displayName: "LINE", descKey: "app.line.desc" },
  { name: "telegram", displayName: "Telegram", descKey: "app.telegram.desc" },
  { name: "discord", displayName: "Discord", descKey: "app.discord.desc" },
  { name: "slack", displayName: "Slack", descKey: "app.slack.desc" },
  // 社群
  { name: "threads", displayName: "Threads", descKey: "app.threads.desc" },
  { name: "instagram", displayName: "Instagram", descKey: "app.instagram.desc" },
  // 設計
  { name: "canva", displayName: "Canva", descKey: "app.canva.desc" },
  // 簡報
  { name: "gamma", displayName: "Gamma", descKey: "app.gamma.desc" },
];

export function DashboardClient({ user, connectedApps, origin }: DashboardProps) {
  const [copied, setCopied] = useState(false);
  /* 引導區塊：選擇的 AI 工具平台 */
  const [selectedPlatform, setSelectedPlatform] = useState<"claude" | "cursor" | null>(null);
  /* Cursor config 複製狀態 */
  const [cursorCopied, setCursorCopied] = useState(false);
  const [expandedApp, setExpandedApp] = useState<string | null>(null);
  const [toolsCache, setToolsCache] = useState<Record<string, ToolInfo[]>>({});
  const [loadingTools, setLoadingTools] = useState<string | null>(null);
  /* #7: 工具載入錯誤狀態 */
  const [toolsError, setToolsError] = useState<string | null>(null);
  // U23: 帳號刪除狀態
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteInput, setDeleteInput] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  /* #5: 中斷連結確認狀態 */
  const [disconnectConfirm, setDisconnectConfirm] = useState<string | null>(null);
  /* #6: 中斷連結錯誤狀態 */
  const [disconnectError, setDisconnectError] = useState<string | null>(null);
  /* #8: 連結中 loading 狀態 */
  const [connectingApp, setConnectingApp] = useState<string | null>(null);
  const router = useRouter();
  const { t } = useI18n();

  const mcpUrl = `${origin}/mcp/${user.mcpApiKey}`;

  /* 區分已連結 / 未連結 App */
  const isConnected = useCallback(
    (appName: string) => connectedApps.some((a) => a.appName === appName && a.status === "active"),
    [connectedApps],
  );

  const { connected, available } = useMemo(() => {
    const c: typeof APP_KEYS = [];
    const a: typeof APP_KEYS = [];
    APP_KEYS.forEach((app) => (isConnected(app.name) ? c : a).push(app));
    return { connected: c, available: a };
  }, [isConnected]);

  /* 計算已連結 App 的總工具數 */
  const totalTools = useMemo(() => {
    return Object.values(toolsCache).reduce((sum, tools) => sum + tools.length, 0);
  }, [toolsCache]);

  /* #1: 自動重置 timer — 用 ref 追蹤，unmount 時清理 */
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cursorCopiedTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const disconnectErrorTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /* unmount 時清理所有 timer */
  useEffect(() => {
    return () => {
      clearTimeout(copiedTimerRef.current);
      clearTimeout(cursorCopiedTimerRef.current);
      clearTimeout(disconnectErrorTimerRef.current);
    };
  }, []);

  /* 複製 MCP URL */
  const copyMcpUrl = useCallback(() => {
    navigator.clipboard.writeText(mcpUrl);
    setCopied(true);
    clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopied(false), 2000);
  }, [mcpUrl]);

  /* 複製 Cursor MCP config JSON */
  const copyCursorConfig = useCallback(() => {
    const config = JSON.stringify({
      mcpServers: {
        octodock: {
          url: mcpUrl
        }
      }
    }, null, 2);
    navigator.clipboard.writeText(config);
    setCursorCopied(true);
    clearTimeout(cursorCopiedTimerRef.current);
    cursorCopiedTimerRef.current = setTimeout(() => setCursorCopied(false), 2000);
  }, [mcpUrl]);

  /* #2: fetch abort 用 ref 追蹤 */
  const toolsAbortRef = useRef<AbortController | undefined>(undefined);

  /* #6 #7: 展開/收合工具清單（修正依賴 + abort + 錯誤處理） */
  const toggleTools = useCallback(async (appName: string) => {
    /* #6: 用 functional setState 避免依賴 expandedApp */
    setExpandedApp((prev) => {
      if (prev === appName) return null;
      return appName;
    });
    setToolsError(null);
    /* 用 functional check 避免依賴 toolsCache */
    setToolsCache((prev) => {
      if (prev[appName]) return prev; // 已有快取，不需 fetch
      /* 觸發 fetch（在 setState 外執行，透過 setTimeout 延遲） */
      setTimeout(() => fetchTools(appName), 0);
      return prev;
    });
  }, []);

  /* 獨立的 fetch 函式，避免 useCallback 依賴膨脹 */
  const fetchTools = useCallback(async (appName: string) => {
    toolsAbortRef.current?.abort();
    const controller = new AbortController();
    toolsAbortRef.current = controller;
    setLoadingTools(appName);
    try {
      const res = await fetch(`/api/tools/${appName}`, { signal: controller.signal });
      if (res.ok) {
        const data = await res.json();
        setToolsCache((prev) => ({ ...prev, [appName]: data.tools }));
      } else {
        setToolsError(t("dashboard.tools_load_error"));
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setToolsError(t("dashboard.tools_load_error"));
    } finally {
      setLoadingTools(null);
    }
  }, [t]);

  /* #8 #10: 連結 App — 用 window.location.href 因為是 API route redirect */
  const connectApp = useCallback((appName: string) => {
    setConnectingApp(appName);
    window.location.href = `/api/connect/${appName}`;
  }, []);

  /* #5 #6: 中斷連結（帶確認 + 錯誤處理 + timer cleanup） */
  const disconnectApp = useCallback(async (appName: string) => {
    try {
      const res = await fetch(`/api/connect/${appName}`, { method: "DELETE" });
      if (!res.ok) {
        setDisconnectError(appName);
        clearTimeout(disconnectErrorTimerRef.current);
        disconnectErrorTimerRef.current = setTimeout(() => setDisconnectError(null), 3000);
        return;
      }
      setDisconnectConfirm(null);
      router.refresh();
    } catch {
      setDisconnectError(appName);
      clearTimeout(disconnectErrorTimerRef.current);
      disconnectErrorTimerRef.current = setTimeout(() => setDisconnectError(null), 3000);
    }
  }, [router]);

  /** U23: 帳號刪除處理 — 呼叫 DELETE /api/account 並跳轉 */
  const handleDeleteAccount = useCallback(async () => {
    if (deleteInput !== "DELETE") return;
    setDeleting(true);
    setDeleteError("");
    try {
      const res = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "DELETE" }),
      });
      if (res.ok) {
        window.location.href = "/?deleted=1";
      } else {
        const data = await res.json().catch(() => ({}));
        setDeleteError(data.error || t("account.delete_error"));
      }
    } catch {
      setDeleteError(t("account.delete_error"));
    } finally {
      setDeleting(false);
    }
  }, [deleteInput, t]);

  return (
    <div className="min-h-screen bg-[#faf9f6] py-6 px-4">
      <div className="max-w-4xl mx-auto space-y-5">

        {/* ── Nav bar ── #3: 加 flex-wrap 避免小螢幕溢出 */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Image src="/icon-192.png" alt="OctoDock" width={28} height={28} className="rounded-lg" />
            <h1 className="text-xl font-bold text-gray-900">OctoDock</h1>
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <LanguageSwitcher />
            <Link
              href="/preferences"
              className="px-3 py-1.5 text-xs border rounded-lg hover:bg-gray-100 transition-colors"
            >
              {t("nav.memory")}
            </Link>
            <button
              onClick={() => { window.location.href = "/api/auth/signout"; }}
              className="px-3 py-1.5 text-xs border border-red-200 text-red-500 rounded-lg hover:bg-red-50 transition-colors"
            >
              {t("common.logout")}
            </button>
          </div>
        </div>

        {/* ── 用戶資訊 ── */}
        <p className="text-sm text-gray-400">
          {user.name} ({user.email})
        </p>

        {/* ── MCP URL 橫條 ── #1: 手機改 flex-col #9: 統一 rounded-lg #11: 統一背景色 */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3 rounded-lg border border-gray-200 bg-white px-4 py-2.5">
          <span className="text-xs font-semibold text-gray-500 shrink-0">{t("dashboard.mcp_url")}</span>
          <code className="w-full sm:flex-1 text-xs font-mono text-gray-600 bg-[#F1EFE8] rounded-lg px-3 py-1.5 overflow-x-auto">
            {mcpUrl}
          </code>
          <button
            onClick={copyMcpUrl}
            className="px-3 py-1.5 bg-black text-white text-xs rounded-lg hover:bg-gray-800 transition-colors whitespace-nowrap"
          >
            {copied ? t("common.copied") : t("common.copy")}
          </button>
        </div>

        {/* ── 引導區塊（已連接 >= 1 個 App 時顯示）── 分步引導用戶把 MCP URL 設進 AI 工具 */}
        {connected.length > 0 && (
          <div className="rounded-lg bg-[#E1F5EE] px-5 py-5 space-y-4">
            <p className="text-sm font-medium text-[#085041]">{t("dashboard.guide_title")}</p>

            {/* Step 1: 複製 MCP URL — #2: 手機改 flex-col */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3">
              <span className="text-xs font-semibold text-[#0F6E56] shrink-0">{t("dashboard.guide_step1")}</span>
              <code className="w-full sm:flex-1 text-xs font-mono text-[#085041] bg-[#F1EFE8] rounded-lg px-3 py-2 overflow-x-auto">
                {mcpUrl}
              </code>
              <button
                onClick={() => { copyMcpUrl(); }}
                className={`px-4 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                  copied
                    ? "bg-[#085041] text-white"
                    : "bg-[#0F6E56] text-white hover:bg-[#0a5a46]"
                }`}
              >
                {copied ? t("dashboard.guide_step1_done") : t("dashboard.guide_copy")}
              </button>
            </div>

            {/* Step 2: 選擇 AI 工具平台 */}
            <div>
              <span className="text-xs font-semibold text-[#0F6E56]">{t("dashboard.guide_step2")}</span>
              <div className="flex gap-3 mt-2">
                {/* Claude.ai 按鈕 */}
                <button
                  onClick={() => setSelectedPlatform(selectedPlatform === "claude" ? null : "claude")}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                    selectedPlatform === "claude"
                      ? "border-[#0F6E56] bg-white text-[#085041] shadow-sm"
                      : "border-white/40 bg-white/50 text-[#085041] hover:bg-white/80"
                  }`}
                >
                  <span>Claude.ai</span>
                </button>
                {/* Cursor 按鈕 */}
                <button
                  onClick={() => setSelectedPlatform(selectedPlatform === "cursor" ? null : "cursor")}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                    selectedPlatform === "cursor"
                      ? "border-[#0F6E56] bg-white text-[#085041] shadow-sm"
                      : "border-white/40 bg-white/50 text-[#085041] hover:bg-white/80"
                  }`}
                >
                  <span>Cursor</span>
                </button>
              </div>
            </div>

            {/* 平台教學展開區 */}
            {selectedPlatform === "claude" && (
              <div className="bg-white/70 rounded-lg px-4 py-3 space-y-2">
                <p className="text-xs text-[#085041]">{t("dashboard.guide_claude_steps")}</p>
                <a
                  href="https://claude.ai/settings/integrations"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => { if (!copied) copyMcpUrl(); }}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#0F6E56] text-white text-xs font-medium rounded-lg hover:bg-[#0a5a46] transition-colors"
                >
                  {t("dashboard.guide_claude_btn")}
                  <span className="text-[10px]">↗</span>
                </a>
              </div>
            )}
            {/* #17: Cursor 教學 — 複製 MCP config JSON */}
            {selectedPlatform === "cursor" && (
              <div className="bg-white/70 rounded-lg px-4 py-3 space-y-3">
                <p className="text-xs text-[#085041]">{t("dashboard.guide_cursor_steps")}</p>
                <code className="block text-[11px] font-mono text-[#085041] bg-[#F1EFE8] rounded-lg px-3 py-2 overflow-x-auto whitespace-pre">
{`{
  "mcpServers": {
    "octodock": {
      "url": "${mcpUrl}"
    }
  }
}`}
                </code>
                <button
                  onClick={copyCursorConfig}
                  className={`inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg transition-colors ${
                    cursorCopied
                      ? "bg-[#085041] text-white"
                      : "bg-[#0F6E56] text-white hover:bg-[#0a5a46]"
                  }`}
                >
                  {cursorCopied ? t("dashboard.guide_cursor_copied") : t("dashboard.guide_cursor_copy_config")}
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── 已連結 App ── */}
        {connected.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-gray-700 mb-3">
              {t("dashboard.connected_section")} — {connected.length} {t("dashboard.apps_count")}
              {totalTools > 0 && <span className="text-gray-400 font-normal"> · {totalTools} {t("dashboard.tools_count")}</span>}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {connected.map((app) => {
                const appTools = toolsCache[app.name];
                const isExpanded = expandedApp === app.name;
                const isLoading = loadingTools === app.name;
                const isConfirmingDisconnect = disconnectConfirm === app.name;
                const hasDisconnectError = disconnectError === app.name;
                return (
                  <div key={app.name} className="rounded-lg border border-gray-200 bg-white p-4">
                    {/* 卡片頭部 */}
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-medium text-gray-900">{app.displayName}</h3>
                      {appTools && (
                        <span className="text-[10px] bg-[#E1F5EE] text-[#1D9E75] rounded-lg px-1.5 py-0.5 font-medium">
                          {appTools.length}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-400 leading-snug mb-2">{t(app.descKey)}</p>
                    {/* 操作列 — #12: 加 padding 撐大觸控目標 #13: 中斷連結改深色 */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleTools(app.name)}
                        className="text-[11px] text-blue-500 hover:text-blue-700 transition-colors px-1.5 py-1 -ml-1.5"
                      >
                        {isExpanded ? t("dashboard.hide_tools") : t("dashboard.view_tools")}
                      </button>
                      {/* #5: 中斷連結兩步確認 */}
                      {isConfirmingDisconnect ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => disconnectApp(app.name)}
                            className="text-[11px] text-red-500 hover:text-red-700 transition-colors px-1.5 py-1 font-medium"
                          >
                            {t("dashboard.disconnect_confirm")}
                          </button>
                          <button
                            onClick={() => setDisconnectConfirm(null)}
                            className="text-[11px] text-gray-500 hover:text-gray-700 transition-colors px-1.5 py-1"
                          >
                            {t("account.delete_cancel")}
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setDisconnectConfirm(app.name)}
                          className="text-[11px] text-gray-500 hover:text-red-500 transition-colors px-1.5 py-1"
                        >
                          {t("dashboard.disconnect")}
                        </button>
                      )}
                    </div>
                    {/* #6: 中斷連結錯誤提示 */}
                    {hasDisconnectError && (
                      <p className="text-[11px] text-red-500 mt-1">{t("dashboard.disconnect_error")}</p>
                    )}
                    {/* 展開的工具清單 — #7: 錯誤狀態 */}
                    {isExpanded && (
                      <div className="mt-3 pt-3 border-t border-gray-100">
                        {isLoading ? (
                          <p className="text-[11px] text-gray-400">{t("common.loading")}</p>
                        ) : toolsError ? (
                          <p className="text-[11px] text-red-400">{toolsError}</p>
                        ) : appTools && appTools.length > 0 ? (
                          <div className="space-y-1.5 max-h-48 overflow-y-auto">
                            {appTools.map((tool: ToolInfo) => (
                              <div key={tool.name}>
                                <code className="text-[10px] bg-gray-50 px-1.5 py-0.5 rounded-lg border text-gray-700">
                                  {tool.name}
                                </code>
                                <p className="text-[10px] text-gray-400 mt-0.5 ml-0.5">
                                  {t(`tool.${tool.name}`) !== `tool.${tool.name}`
                                    ? t(`tool.${tool.name}`)
                                    : tool.description}
                                </p>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[11px] text-gray-300">{t("dashboard.no_tools")}</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Google 一鍵連接 ── #4: 手機改 flex-col #9: 統一 rounded-lg #10: 統一 hover 色 */}
        {(() => {
          /* #9: 從 APP_KEYS 派生而不是硬編碼 */
          const googleApps = APP_KEYS.filter((a) => a.name.startsWith("google_") || a.name === "gmail" || a.name === "youtube").map((a) => a.name);
          const googleConnected = googleApps.filter((a) => isConnected(a)).length;
          const googleTotal = googleApps.length;
          // 全部已連接就不顯示
          if (googleConnected >= googleTotal) return null;
          const label = googleConnected === 0
            ? t("dashboard.google_all")
            : t("dashboard.google_remaining");
          return (
            <div className="bg-[#E1F5EE] border border-[#1D9E75]/20 rounded-lg p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
              <div>
                <span className="text-sm font-medium text-[#0F6E56]">{label}</span>
                <span className="text-xs text-gray-500 ml-2">({googleConnected}/{googleTotal})</span>
              </div>
              <button
                onClick={() => connectApp("google_all")}
                className="px-4 py-1.5 bg-[#0F6E56] text-white text-xs font-medium rounded-lg hover:bg-[#0a5a46] transition-colors"
              >
                {t("dashboard.google_all_btn")}
              </button>
            </div>
          );
        })()}

        {/* ── 可連結 App ── #8: 連結按鈕加 loading 狀態 */}
        {available.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-gray-700 mb-3">
              {t("dashboard.available_section")}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {available.map((app) => {
                const isConnecting = connectingApp === app.name;
                return (
                  <div key={app.name} className="rounded-lg border border-dashed border-gray-300 bg-white p-4">
                    <h3 className="text-sm text-gray-400 mb-1">{app.displayName}</h3>
                    <p className="text-[11px] text-gray-300 leading-snug mb-3">{t(app.descKey)}</p>
                    <button
                      onClick={() => connectApp(app.name)}
                      disabled={isConnecting}
                      className="px-3 py-1.5 text-[11px] bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {isConnecting ? t("common.loading") : t("dashboard.connect")}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── U23: 危險區域 — 刪除帳號 ── #9: 統一 rounded-lg */}
        <div className="rounded-lg border border-red-200 bg-red-50/50 p-4 mt-6">
          <h2 className="text-sm font-semibold text-red-600 mb-1">{t("account.delete_title")}</h2>
          <p className="text-[11px] text-red-400 mb-3">{t("account.delete_desc")}</p>
          <button
            onClick={() => setShowDeleteModal(true)}
            className="px-3 py-1.5 text-[11px] border border-red-300 text-red-500 rounded-lg hover:bg-red-100 transition-colors"
          >
            {t("account.delete_btn")}
          </button>
        </div>

        {/* U23: 刪除帳號確認彈窗 — #9: 統一 rounded-lg #15: loading 走 i18n */}
        {showDeleteModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg max-w-sm w-full p-6 space-y-4">
              <h3 className="text-base font-semibold text-gray-900">{t("account.delete_confirm_title")}</h3>
              <p className="text-sm text-gray-500">{t("account.delete_confirm_desc")}</p>
              <input
                type="text"
                value={deleteInput}
                onChange={(e) => setDeleteInput(e.target.value)}
                placeholder={t("account.delete_confirm_input")}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-400"
              />
              {deleteError && <p className="text-xs text-red-500">{deleteError}</p>}
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => { setShowDeleteModal(false); setDeleteInput(""); setDeleteError(""); }}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
                >
                  {t("account.delete_cancel")}
                </button>
                <button
                  onClick={handleDeleteAccount}
                  disabled={deleteInput !== "DELETE" || deleting}
                  className="px-4 py-2 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {deleting ? t("common.loading") : t("account.delete_confirm_btn")}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
