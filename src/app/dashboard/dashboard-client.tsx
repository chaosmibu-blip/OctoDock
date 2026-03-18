"use client";

import { useState, useCallback, useMemo } from "react";
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
  // 社群
  { name: "threads", displayName: "Threads", descKey: "app.threads.desc" },
  { name: "instagram", displayName: "Instagram", descKey: "app.instagram.desc" },
];

export function DashboardClient({ user, connectedApps, origin }: DashboardProps) {
  const [copied, setCopied] = useState(false);
  const [guideCopied, setGuideCopied] = useState(false);
  const [expandedApp, setExpandedApp] = useState<string | null>(null);
  const [toolsCache, setToolsCache] = useState<Record<string, ToolInfo[]>>({});
  const [loadingTools, setLoadingTools] = useState<string | null>(null);
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

  /* 複製 MCP URL */
  const copyMcpUrl = useCallback(() => {
    navigator.clipboard.writeText(mcpUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [mcpUrl]);

  /* 複製引導指令 */
  const copyGuidePrompt = useCallback(() => {
    navigator.clipboard.writeText(t("dashboard.guide_prompt"));
    setGuideCopied(true);
    setTimeout(() => setGuideCopied(false), 2000);
  }, [t]);

  /* 展開/收合工具清單 */
  const toggleTools = useCallback(async (appName: string) => {
    if (expandedApp === appName) {
      setExpandedApp(null);
      return;
    }
    setExpandedApp(appName);
    if (!toolsCache[appName]) {
      setLoadingTools(appName);
      try {
        const res = await fetch(`/api/tools/${appName}`);
        if (res.ok) {
          const data = await res.json();
          setToolsCache((prev) => ({ ...prev, [appName]: data.tools }));
        }
      } catch {
        // ignore
      } finally {
        setLoadingTools(null);
      }
    }
  }, [expandedApp, toolsCache]);

  const connectApp = useCallback((appName: string) => {
    router.push(`/api/connect/${appName}`);
  }, [router]);

  const disconnectApp = useCallback(async (appName: string) => {
    await fetch(`/api/connect/${appName}`, { method: "DELETE" });
    router.refresh();
  }, [router]);

  return (
    <div className="min-h-screen bg-[#faf9f6] py-6 px-4">
      <div className="max-w-4xl mx-auto space-y-5">

        {/* ── Nav bar ── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Image src="/icon-192.png" alt="OctoDock" width={28} height={28} className="rounded" />
            <h1 className="text-xl font-bold text-gray-900">OctoDock</h1>
          </div>
          <div className="flex gap-2 items-center">
            <LanguageSwitcher />
            <Link
              href="/preferences"
              className="px-3 py-1.5 text-xs border rounded-md hover:bg-gray-100 transition-colors"
            >
              {t("nav.memory")}
            </Link>
            <button
              onClick={() => { window.location.href = "/api/auth/signout"; }}
              className="px-3 py-1.5 text-xs border border-red-200 text-red-500 rounded-md hover:bg-red-50 transition-colors"
            >
              {t("common.logout")}
            </button>
          </div>
        </div>

        {/* ── 用戶資訊 ── */}
        <p className="text-sm text-gray-400">
          {user.name} ({user.email})
        </p>

        {/* ── MCP URL 橫條（緊湊） ── */}
        <div className="flex items-center gap-3 rounded-[10px] border border-gray-200 bg-white px-4 py-2.5">
          <span className="text-xs font-semibold text-gray-500 shrink-0">{t("dashboard.mcp_url")}</span>
          <code className="flex-1 text-xs font-mono text-gray-600 bg-[#F1EFE8] rounded px-3 py-1.5 overflow-x-auto">
            {mcpUrl}
          </code>
          <button
            onClick={copyMcpUrl}
            className="px-3 py-1.5 bg-black text-white text-xs rounded-md hover:bg-gray-800 transition-colors whitespace-nowrap"
          >
            {copied ? t("common.copied") : t("common.copy")}
          </button>
        </div>

        {/* ── 引導區塊（已連接 >= 1 個 App 時顯示） ── */}
        {connected.length > 0 && (
          <div className="rounded-[10px] bg-[#E1F5EE] px-5 py-4">
            <p className="text-sm font-medium text-[#085041]">{t("dashboard.guide_title")}</p>
            <div className="flex items-center gap-3 mt-2">
              <code className="flex-1 text-sm text-[#085041] bg-white/60 rounded-md px-3 py-2">
                {t("dashboard.guide_prompt")}
              </code>
              <button
                onClick={copyGuidePrompt}
                className="px-4 py-2 bg-[#0F6E56] text-white text-xs font-medium rounded-md hover:bg-[#0a5a46] transition-colors whitespace-nowrap"
              >
                {guideCopied ? t("dashboard.guide_copied") : t("dashboard.guide_copy")}
              </button>
            </div>
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
                return (
                  <div key={app.name} className="rounded-[10px] border border-gray-200 bg-white p-4">
                    {/* 卡片頭部 */}
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-sm font-medium text-gray-900">{app.displayName}</h3>
                      {appTools && (
                        <span className="text-[10px] bg-[#E1F5EE] text-[#1D9E75] rounded px-1.5 py-0.5 font-medium">
                          {appTools.length}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-400 leading-snug mb-2">{t(app.descKey)}</p>
                    {/* 操作列 */}
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => toggleTools(app.name)}
                        className="text-[10px] text-blue-500 hover:text-blue-700 transition-colors"
                      >
                        {isExpanded ? t("dashboard.hide_tools") : t("dashboard.view_tools")}
                      </button>
                      <button
                        onClick={() => disconnectApp(app.name)}
                        className="text-[10px] text-[#B4B2A9] hover:text-[#E24B4A] transition-colors"
                      >
                        {t("dashboard.disconnect")}
                      </button>
                    </div>
                    {/* 展開的工具清單 */}
                    {isExpanded && (
                      <div className="mt-3 pt-3 border-t border-gray-100">
                        {isLoading ? (
                          <p className="text-[11px] text-gray-300">{t("common.loading")}</p>
                        ) : appTools && appTools.length > 0 ? (
                          <div className="space-y-1.5 max-h-48 overflow-y-auto">
                            {appTools.map((tool: ToolInfo) => (
                              <div key={tool.name}>
                                <code className="text-[10px] bg-gray-50 px-1.5 py-0.5 rounded border text-gray-700">
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

        {/* ── Google 一鍵連接 ── */}
        {(() => {
          const googleApps = ["gmail", "google_calendar", "google_drive", "google_sheets", "google_docs", "google_tasks", "youtube"];
          const googleConnected = googleApps.filter((a) => isConnected(a)).length;
          const googleTotal = googleApps.length;
          // 全部已連接就不顯示
          if (googleConnected >= googleTotal) return null;
          const label = googleConnected === 0
            ? t("dashboard.google_all")
            : t("dashboard.google_remaining");
          return (
            <div className="bg-[#E1F5EE] border border-[#1D9E75]/20 rounded-lg p-3 flex items-center justify-between">
              <div>
                <span className="text-sm font-medium text-[#0F6E56]">{label}</span>
                <span className="text-xs text-gray-500 ml-2">({googleConnected}/{googleTotal})</span>
              </div>
              <button
                onClick={() => connectApp("google_all")}
                className="px-4 py-1.5 bg-[#0F6E56] text-white text-xs font-medium rounded-md hover:bg-[#0d5e49] transition-colors"
              >
                {t("dashboard.google_all_btn")}
              </button>
            </div>
          );
        })()}

        {/* ── 可連結 App ── */}
        {available.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-gray-700 mb-3">
              {t("dashboard.available_section")}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {available.map((app) => (
                <div key={app.name} className="rounded-[10px] border border-dashed border-gray-300 bg-white p-4">
                  <h3 className="text-sm text-gray-400 mb-1">{app.displayName}</h3>
                  <p className="text-[11px] text-gray-300 leading-snug mb-3">{t(app.descKey)}</p>
                  <button
                    onClick={() => connectApp(app.name)}
                    className="px-3 py-1.5 text-[11px] bg-black text-white rounded-md hover:bg-gray-800 transition-colors"
                  >
                    {t("dashboard.connect")}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
