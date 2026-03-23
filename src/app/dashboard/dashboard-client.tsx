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

interface UsageSummary {
  plan: string;
  used: number;
  limit: number | null; // null = 無限制（Pro）
  month: string;
}

interface DashboardProps {
  user: { name: string; email: string; mcpApiKey: string };
  connectedApps: Array<{
    appName: string;
    status: string;
    connectedAt: string;
  }>;
  origin: string;
  usage: UsageSummary;
}

/* App 定義清單 — 已上線的 */
/* authType: 區分 OAuth（一鍵跳轉）和 token 類（卡片內嵌輸入框） */
const APP_KEYS: Array<{ name: string; displayName: string; descKey: string; authType?: "bot_token" | "api_key" | "phone_auth" }> = [
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
  { name: "line", displayName: "LINE", descKey: "app.line.desc", authType: "api_key" },
  { name: "telegram", displayName: "Telegram", descKey: "app.telegram.desc", authType: "bot_token" },
  { name: "telegram_user", displayName: "Telegram (User)", descKey: "app.telegram_user.desc", authType: "phone_auth" },
  { name: "discord", displayName: "Discord", descKey: "app.discord.desc", authType: "bot_token" },
  { name: "slack", displayName: "Slack", descKey: "app.slack.desc" },
  // 社群
  { name: "threads", displayName: "Threads", descKey: "app.threads.desc" },
  { name: "instagram", displayName: "Instagram", descKey: "app.instagram.desc" },
  // 待辦
  { name: "todoist", displayName: "Todoist", descKey: "app.todoist.desc" },
  // Microsoft Office
  { name: "microsoft_excel", displayName: "Excel", descKey: "app.microsoft_excel.desc" },
  { name: "microsoft_word", displayName: "Word", descKey: "app.microsoft_word.desc" },
  { name: "microsoft_powerpoint", displayName: "PowerPoint", descKey: "app.microsoft_powerpoint.desc" },
  // 設計
  { name: "canva", displayName: "Canva", descKey: "app.canva.desc" },
  // 簡報
  { name: "gamma", displayName: "Gamma", descKey: "app.gamma.desc" },
];

export function DashboardClient({ user, connectedApps, origin, usage }: DashboardProps) {
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
  // 反饋表單狀態
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackCategory, setFeedbackCategory] = useState<string>("feature");
  const [feedbackContent, setFeedbackContent] = useState("");
  const [feedbackEmail, setFeedbackEmail] = useState("");
  const [feedbackStatus, setFeedbackStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
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
  /* Token 內嵌輸入狀態（bot_token / api_key 類 App 卡片用） */
  const [tokenInputs, setTokenInputs] = useState<Record<string, string>>({});
  const [tokenSubmitting, setTokenSubmitting] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  /* Phone auth 多步驟狀態（telegram_user 等） */
  const [phoneAuth, setPhoneAuth] = useState<Record<string, {
    step: "phone" | "code" | "2fa";
    phone: string;
    code: string;
    password: string;
    loading: boolean;
    error: string;
  }>>({});
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetchTools 故意不放依賴，用 setTimeout 延遲呼叫避免循環依賴
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

  /* #8 #10: 連結 OAuth App — 直接跳轉到授權頁 */
  const connectApp = useCallback((appName: string) => {
    setConnectingApp(appName);
    window.location.href = `/api/connect/${appName}`;
  }, []);

  /* 提交 bot token / api key（卡片內嵌輸入框用） */
  const submitToken = useCallback(async (appName: string) => {
    const token = tokenInputs[appName]?.trim();
    if (!token) return;
    setTokenSubmitting(appName);
    setTokenError(null);
    try {
      const res = await fetch(`/api/connect/${appName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (res.ok) {
        setTokenInputs(prev => { const next = { ...prev }; delete next[appName]; return next; });
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setTokenError(data.error || t("token_modal.error"));
      }
    } catch {
      setTokenError(t("token_modal.error"));
    } finally {
      setTokenSubmitting(null);
    }
  }, [tokenInputs, router, t]);

  /* Phone auth 多步驟處理（send_code → verify → 2fa） */
  const handlePhoneAuth = useCallback(async (appName: string) => {
    const state = phoneAuth[appName];
    if (!state) return;
    const update = (patch: Partial<typeof state>) =>
      setPhoneAuth(prev => ({ ...prev, [appName]: { ...prev[appName], ...patch } }));
    update({ loading: true, error: "" });

    try {
      if (state.step === "phone") {
        /* 步驟 1：發送驗證碼 */
        const res = await fetch(`/api/connect/${appName}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ step: "send_code", phone: state.phone }),
        });
        const data = await res.json();
        if (!res.ok) { update({ loading: false, error: data.error || t("token_modal.error") }); return; }
        update({ step: "code", loading: false });
      } else if (state.step === "code") {
        /* 步驟 2：驗證碼 */
        const res = await fetch(`/api/connect/${appName}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ step: "verify", code: state.code }),
        });
        const data = await res.json();
        if (!res.ok) { update({ loading: false, error: data.error || t("token_modal.error") }); return; }
        if (data.step === "need_2fa") {
          update({ step: "2fa", loading: false });
          return;
        }
        if (data.success) {
          setPhoneAuth(prev => { const next = { ...prev }; delete next[appName]; return next; });
          router.refresh();
          return;
        }
      } else if (state.step === "2fa") {
        /* 步驟 3：2FA 密碼 */
        const res = await fetch(`/api/connect/${appName}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ step: "2fa", password: state.password }),
        });
        const data = await res.json();
        if (!res.ok) { update({ loading: false, error: data.error || t("token_modal.error") }); return; }
        if (data.success) {
          setPhoneAuth(prev => { const next = { ...prev }; delete next[appName]; return next; });
          router.refresh();
          return;
        }
      }
    } catch {
      update({ loading: false, error: t("token_modal.error") });
    }
    update({ loading: false });
  }, [phoneAuth, router, t]);

  /* 初始化 phone auth 狀態 */
  const initPhoneAuth = useCallback((appName: string) => {
    setPhoneAuth(prev => ({
      ...prev,
      [appName]: { step: "phone", phone: "", code: "", password: "", loading: false, error: "" },
    }));
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

  /** 反饋表單送出 — API route 負責存 DB + 寄信 */
  const handleFeedbackSubmit = useCallback(async () => {
    if (!feedbackContent.trim()) return;
    setFeedbackStatus("submitting");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: feedbackCategory,
          content: feedbackContent,
          email: feedbackEmail || user.email,
          userName: user.name,
        }),
      });
      if (res.ok) {
        setFeedbackStatus("success");
        // 2 秒後關閉並重置表單
        setTimeout(() => {
          setShowFeedback(false);
          setFeedbackCategory("feature");
          setFeedbackContent("");
          setFeedbackEmail("");
          setFeedbackStatus("idle");
        }, 2000);
      } else {
        setFeedbackStatus("error");
      }
    } catch {
      setFeedbackStatus("error");
    }
  }, [feedbackCategory, feedbackContent, feedbackEmail, user.email, user.name]);

  /** 打開反饋表單（可預選分類） */
  const openFeedback = useCallback((category?: string) => {
    if (category) setFeedbackCategory(category);
    setFeedbackStatus("idle");
    setShowFeedback(true);
  }, []);

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
              href="/bots"
              className="px-3 py-1.5 text-xs border rounded-lg hover:bg-gray-100 transition-colors"
            >
              {t("nav.bots")}
            </Link>
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

        {/* ── 用量條 + 訂閱管理 ── */}
        <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-gray-500">
              {t("usage.title")} — {usage.plan === "pro" ? "Pro" : "Free"}
            </span>
            <div className="flex gap-2">
              {usage.plan !== "pro" && (
                <Link
                  href="/pricing"
                  className="text-xs text-emerald-600 hover:text-emerald-700 font-medium no-underline"
                >
                  {t("usage.upgrade")}
                </Link>
              )}
              {usage.plan === "pro" && (
                <a
                  href="https://customer-portal.paddle.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-gray-500 hover:text-gray-700 no-underline"
                >
                  {t("usage.manage_subscription")}
                </a>
              )}
            </div>
          </div>
          {/* 用量進度條（Free 用戶才顯示） */}
          {usage.limit !== null && (
            <>
              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    usage.used >= usage.limit
                      ? "bg-red-500"
                      : usage.used >= usage.limit * 0.8
                        ? "bg-yellow-500"
                        : "bg-emerald-500"
                  }`}
                  style={{ width: `${Math.min((usage.used / usage.limit) * 100, 100)}%` }}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className={`text-xs ${
                  usage.used >= usage.limit
                    ? "text-red-600 font-medium"
                    : usage.used >= usage.limit * 0.8
                      ? "text-yellow-600"
                      : "text-gray-400"
                }`}>
                  {t("usage.count_prefix")}{usage.used} / {usage.limit}{t("usage.count_suffix")}
                </span>
                {usage.used >= usage.limit && (
                  <Link
                    href="/pricing"
                    className="text-xs bg-emerald-600 text-white px-2 py-0.5 rounded no-underline hover:bg-emerald-700 transition-colors"
                  >
                    {t("usage.upgrade_now")}
                  </Link>
                )}
              </div>
            </>
          )}
          {/* Pro 用戶顯示無限制 */}
          {usage.limit === null && (
            <span className="text-xs text-gray-400">
              {t("usage.unlimited")}
            </span>
          )}
        </div>

        {/* ── 引導區塊（已連接 >= 1 個 App 時顯示）── 分步引導用戶把 MCP URL 設進 AI 工具 */}
        {connected.length > 0 && (
          <div className="rounded-lg bg-[#E1F5EE] px-5 py-5 space-y-4">
            <p className="text-sm font-medium text-[#085041]">{t("dashboard.guide_title")}</p>

            {/* 選擇 AI 工具平台（MCP URL 已在上方顯示，不重複） */}
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
                  href="https://claude.ai/settings/connectors"
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
                <p className="text-xs text-[#085041] whitespace-pre-line">{t("dashboard.guide_cursor_steps")}</p>
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

        {/* ── Microsoft 一鍵連接 ── */}
        {(() => {
          const msApps = APP_KEYS.filter((a) => a.name.startsWith("microsoft_")).map((a) => a.name);
          const msConnected = msApps.filter((a) => isConnected(a)).length;
          const msTotal = msApps.length;
          if (msConnected >= msTotal || msTotal === 0) return null;
          const label = msConnected === 0
            ? t("dashboard.microsoft_all")
            : t("dashboard.microsoft_remaining");
          return (
            <div className="bg-[#E8F0FE] border border-[#4285F4]/20 rounded-lg p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
              <div>
                <span className="text-sm font-medium text-[#1a73e8]">{label}</span>
                <span className="text-xs text-gray-500 ml-2">({msConnected}/{msTotal})</span>
              </div>
              <button
                onClick={() => connectApp("microsoft_all")}
                className="px-4 py-1.5 bg-[#1a73e8] text-white text-xs font-medium rounded-lg hover:bg-[#1557b0] transition-colors"
              >
                {t("dashboard.microsoft_all_btn")}
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
                const isTokenApp = app.authType === "bot_token" || app.authType === "api_key";
                const isPhoneAuth = app.authType === "phone_auth";
                const isSubmitting = tokenSubmitting === app.name;
                const pa = phoneAuth[app.name]; // phone auth state
                return (
                  <div key={app.name} className="rounded-lg border border-dashed border-gray-300 bg-white p-4">
                    <h3 className="text-sm text-gray-400 mb-1">{app.displayName}</h3>
                    <p className="text-[11px] text-gray-300 leading-snug mb-3">{t(app.descKey)}</p>
                    {isPhoneAuth ? (
                      /* phone_auth 類：多步驟手機驗證 */
                      !pa ? (
                        /* 尚未開始 → 顯示「連接」按鈕 */
                        <button
                          onClick={() => initPhoneAuth(app.name)}
                          className="px-3 py-1.5 text-[11px] bg-black text-white rounded-lg hover:bg-gray-800 transition-colors"
                        >
                          {t("dashboard.connect")}
                        </button>
                      ) : (
                        <div className="space-y-2">
                          {/* 步驟 1：手機號碼 */}
                          {pa.step === "phone" && (
                            <div className="flex gap-1.5">
                              <input
                                type="tel"
                                value={pa.phone}
                                onChange={(e) => setPhoneAuth(prev => ({ ...prev, [app.name]: { ...prev[app.name], phone: e.target.value } }))}
                                onKeyDown={(e) => { if (e.key === "Enter" && pa.phone.trim()) handlePhoneAuth(app.name); }}
                                placeholder={t("phone_auth.phone_placeholder")}
                                className="flex-1 min-w-0 px-2 py-1.5 text-[11px] border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#0F6E56]"
                                autoFocus
                              />
                              <button
                                onClick={() => handlePhoneAuth(app.name)}
                                disabled={!pa.phone.trim() || pa.loading}
                                className="px-3 py-1.5 text-[11px] bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
                              >
                                {pa.loading ? t("common.loading") : t("phone_auth.send_code")}
                              </button>
                            </div>
                          )}
                          {/* 步驟 2：驗證碼 */}
                          {pa.step === "code" && (
                            <div className="flex gap-1.5">
                              <input
                                type="text"
                                value={pa.code}
                                onChange={(e) => setPhoneAuth(prev => ({ ...prev, [app.name]: { ...prev[app.name], code: e.target.value } }))}
                                onKeyDown={(e) => { if (e.key === "Enter" && pa.code.trim()) handlePhoneAuth(app.name); }}
                                placeholder={t("phone_auth.code_placeholder")}
                                className="flex-1 min-w-0 px-2 py-1.5 text-[11px] border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#0F6E56] tracking-widest text-center"
                                autoFocus
                                maxLength={6}
                              />
                              <button
                                onClick={() => handlePhoneAuth(app.name)}
                                disabled={!pa.code.trim() || pa.loading}
                                className="px-3 py-1.5 text-[11px] bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
                              >
                                {pa.loading ? t("common.loading") : t("phone_auth.verify")}
                              </button>
                            </div>
                          )}
                          {/* 步驟 3：2FA 密碼 */}
                          {pa.step === "2fa" && (
                            <div className="flex gap-1.5">
                              <input
                                type="password"
                                value={pa.password}
                                onChange={(e) => setPhoneAuth(prev => ({ ...prev, [app.name]: { ...prev[app.name], password: e.target.value } }))}
                                onKeyDown={(e) => { if (e.key === "Enter" && pa.password.trim()) handlePhoneAuth(app.name); }}
                                placeholder={t("phone_auth.2fa_placeholder")}
                                className="flex-1 min-w-0 px-2 py-1.5 text-[11px] border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#0F6E56]"
                                autoFocus
                              />
                              <button
                                onClick={() => handlePhoneAuth(app.name)}
                                disabled={!pa.password.trim() || pa.loading}
                                className="px-3 py-1.5 text-[11px] bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
                              >
                                {pa.loading ? t("common.loading") : t("phone_auth.verify")}
                              </button>
                            </div>
                          )}
                          {/* 步驟提示 */}
                          <p className="text-[10px] text-gray-300">
                            {pa.step === "phone" && t("phone_auth.hint_phone")}
                            {pa.step === "code" && t("phone_auth.hint_code")}
                            {pa.step === "2fa" && t("phone_auth.hint_2fa")}
                          </p>
                          {pa.error && <p className="text-[10px] text-red-500">{pa.error}</p>}
                        </div>
                      )
                    ) : isTokenApp ? (
                      /* bot_token / api_key 類：卡片內嵌 token 輸入框 */
                      <div className="space-y-2">
                        <div className="flex gap-1.5">
                          <input
                            type="password"
                            value={tokenInputs[app.name] ?? ""}
                            onChange={(e) => setTokenInputs(prev => ({ ...prev, [app.name]: e.target.value }))}
                            onKeyDown={(e) => { if (e.key === "Enter" && tokenInputs[app.name]?.trim()) submitToken(app.name); }}
                            placeholder={t("token_modal.placeholder")}
                            className="flex-1 min-w-0 px-2 py-1.5 text-[11px] border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#0F6E56] font-mono"
                          />
                          <button
                            onClick={() => submitToken(app.name)}
                            disabled={!tokenInputs[app.name]?.trim() || isSubmitting}
                            className="px-3 py-1.5 text-[11px] bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
                          >
                            {isSubmitting ? t("common.loading") : t("token_modal.submit")}
                          </button>
                        </div>
                        {tokenError && tokenSubmitting === null && (
                          <p className="text-[10px] text-red-500">{tokenError}</p>
                        )}
                        <p className="text-[10px] text-gray-300">{t(`token_modal.hint.${app.name}`)}</p>
                      </div>
                    ) : (
                      /* OAuth 類：一鍵連接按鈕 */
                      <button
                        onClick={() => connectApp(app.name)}
                        disabled={isConnecting}
                        className="px-3 py-1.5 text-[11px] bg-black text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {isConnecting ? t("common.loading") : t("dashboard.connect")}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            {/* 「想要更多 App」入口 — 連到開發者入口頁面 */}
            <Link
              href="/developers"
              className="mt-3 inline-block px-4 py-2 text-xs bg-[#1D9E75] text-white rounded-lg hover:bg-[#0F6E56] transition-colors"
            >
              {t("dev.dashboard_cta")}
            </Link>
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

      {/* ── 固定反饋按鈕（右下角） ── */}
      <button
        onClick={() => openFeedback()}
        className="fixed bottom-6 right-6 w-12 h-12 bg-[#0F6E56] text-white rounded-full shadow-lg hover:bg-[#0a5a46] transition-colors flex items-center justify-center z-40"
        title={t("feedback.btn")}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </button>

      {/* ── 反饋表單彈窗 ── */}
      {showFeedback && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-semibold text-gray-900">{t("feedback.title")}</h3>

            {feedbackStatus === "success" ? (
              <p className="text-sm text-green-600 py-4 text-center">{t("feedback.success")}</p>
            ) : (
              <>
                {/* 分類選擇 */}
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">{t("feedback.category")}</label>
                  <select
                    value={feedbackCategory}
                    onChange={(e) => setFeedbackCategory(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0F6E56] bg-white"
                  >
                    <option value="bug">{t("feedback.category.bug")}</option>
                    <option value="feature">{t("feedback.category.feature")}</option>
                    <option value="app_request">{t("feedback.category.app_request")}</option>
                    <option value="other">{t("feedback.category.other")}</option>
                  </select>
                </div>

                {/* 內容 */}
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">{t("feedback.content")}</label>
                  <textarea
                    value={feedbackContent}
                    onChange={(e) => setFeedbackContent(e.target.value)}
                    placeholder={t("feedback.content_placeholder")}
                    rows={4}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0F6E56] resize-none"
                  />
                </div>

                {/* Email */}
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">{t("feedback.email")}</label>
                  <input
                    type="email"
                    value={feedbackEmail}
                    onChange={(e) => setFeedbackEmail(e.target.value)}
                    placeholder={t("feedback.email_placeholder")}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0F6E56]"
                  />
                </div>

                {feedbackStatus === "error" && (
                  <p className="text-xs text-red-500">{t("feedback.error")}</p>
                )}

                {/* 按鈕 */}
                <div className="flex gap-3 justify-end">
                  <button
                    onClick={() => { setShowFeedback(false); setFeedbackStatus("idle"); }}
                    className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 transition-colors"
                  >
                    {t("feedback.cancel")}
                  </button>
                  <button
                    onClick={handleFeedbackSubmit}
                    disabled={!feedbackContent.trim() || feedbackStatus === "submitting"}
                    className="px-4 py-2 text-sm bg-[#0F6E56] text-white rounded-lg hover:bg-[#0a5a46] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    {feedbackStatus === "submitting" ? t("feedback.submitting") : t("feedback.submit")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
