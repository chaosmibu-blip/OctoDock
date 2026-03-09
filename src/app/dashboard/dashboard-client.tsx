"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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

const APP_KEYS = [
  { name: "notion", displayName: "Notion", descKey: "app.notion.desc" },
  { name: "gmail", displayName: "Gmail", descKey: "app.gmail.desc" },
  { name: "threads", displayName: "Threads", descKey: "app.threads.desc" },
  { name: "instagram", displayName: "Instagram", descKey: "app.instagram.desc" },
  { name: "line", displayName: "LINE", descKey: "app.line.desc" },
  { name: "telegram", displayName: "Telegram", descKey: "app.telegram.desc" },
];

export function DashboardClient({ user, connectedApps, origin }: DashboardProps) {
  const [copied, setCopied] = useState(false);
  const [expandedApp, setExpandedApp] = useState<string | null>(null);
  const [toolsCache, setToolsCache] = useState<Record<string, ToolInfo[]>>({});
  const [loadingTools, setLoadingTools] = useState<string | null>(null);
  const router = useRouter();
  const { t } = useI18n();

  const mcpUrl = `${origin}/mcp/${user.mcpApiKey}`;

  const copyMcpUrl = useCallback(() => {
    navigator.clipboard.writeText(mcpUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [mcpUrl]);

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

  const isConnected = (appName: string) =>
    connectedApps.some((a) => a.appName === appName && a.status === "active");

  const connectApp = useCallback((appName: string) => {
    router.push(`/api/connect/${appName}`);
  }, [router]);

  const disconnectApp = useCallback(async (appName: string) => {
    await fetch(`/api/connect/${appName}`, { method: "DELETE" });
    router.refresh();
  }, [router]);

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">{t("app.title")}</h1>
          <div className="flex gap-2 items-center">
            <LanguageSwitcher />
            <Link
              href="/bots"
              className="px-4 py-2 text-sm border rounded hover:bg-gray-100 transition-colors"
            >
              {t("nav.bots")}
            </Link>
            <Link
              href="/preferences"
              className="px-4 py-2 text-sm border rounded hover:bg-gray-100 transition-colors"
            >
              {t("nav.memory")}
            </Link>
          </div>
        </div>
        <div>
          <p className="text-gray-500 mt-1">
            {user.name} ({user.email})
          </p>
        </div>

        {/* MCP URL */}
        <div className="bg-white rounded-lg border p-6">
          <h2 className="text-lg font-semibold mb-2">{t("dashboard.mcp_url")}</h2>
          <p className="text-sm text-gray-500 mb-4">
            {t("dashboard.mcp_desc")}
          </p>
          <div className="flex gap-2">
            <code className="flex-1 bg-gray-100 rounded px-3 py-2 text-sm font-mono text-gray-700 overflow-x-auto">
              {mcpUrl}
            </code>
            <button
              onClick={copyMcpUrl}
              className="px-4 py-2 bg-black text-white text-sm rounded hover:bg-gray-800 transition-colors whitespace-nowrap"
            >
              {copied ? t("common.copied") : t("common.copy")}
            </button>
          </div>
        </div>

        {/* Connected Apps */}
        <div className="bg-white rounded-lg border p-6">
          <h2 className="text-lg font-semibold mb-4">{t("dashboard.apps")}</h2>
          <div className="space-y-4">
            {APP_KEYS.map((app) => {
              const connected = isConnected(app.name);
              const connectedApp = connectedApps.find(
                (a) => a.appName === app.name,
              );
              const isExpanded = expandedApp === app.name;
              const appTools = toolsCache[app.name];
              const isLoading = loadingTools === app.name;

              return (
                <div
                  key={app.name}
                  className="py-3 border-b last:border-b-0"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium text-gray-900">
                        {app.displayName}
                      </h3>
                      <p className="text-sm text-gray-500">{t(app.descKey)}</p>
                      <div className="flex items-center gap-3 mt-1">
                        {connected && connectedApp && (
                          <p className="text-xs text-green-600">
                            {t("dashboard.connected")}
                          </p>
                        )}
                        <button
                          onClick={() => toggleTools(app.name)}
                          className="text-xs text-blue-600 hover:text-blue-800 transition-colors"
                        >
                          {isExpanded ? t("dashboard.hide_tools") : t("dashboard.view_tools")}
                        </button>
                      </div>
                    </div>
                    {connected ? (
                      <button
                        onClick={() => disconnectApp(app.name)}
                        className="px-4 py-2 text-sm border border-red-200 text-red-600 rounded hover:bg-red-50 transition-colors"
                      >
                        {t("dashboard.disconnect")}
                      </button>
                    ) : (
                      <button
                        onClick={() => connectApp(app.name)}
                        className="px-4 py-2 text-sm bg-black text-white rounded hover:bg-gray-800 transition-colors"
                      >
                        {t("dashboard.connect")}
                      </button>
                    )}
                  </div>
                  {isExpanded && (
                    <div className="mt-3 ml-1 bg-gray-50 rounded-lg p-4">
                      {isLoading ? (
                        <p className="text-sm text-gray-400">{t("common.loading")}</p>
                      ) : appTools && appTools.length > 0 ? (
                        <>
                          <p className="text-xs text-gray-500 mb-3">
                            {appTools.length} {t("dashboard.tool_count")}
                          </p>
                          <div className="space-y-2">
                            {appTools.map((tool: ToolInfo) => (
                              <div key={tool.name} className="text-sm">
                                <code className="text-xs bg-white px-1.5 py-0.5 rounded border text-gray-800">
                                  {tool.name}
                                </code>
                                <p className="text-xs text-gray-500 mt-0.5 ml-1">
                                  {t(`tool.${tool.name}`) !== `tool.${tool.name}`
                                    ? t(`tool.${tool.name}`)
                                    : tool.description}
                                </p>
                              </div>
                            ))}
                          </div>
                        </>
                      ) : (
                        <p className="text-sm text-gray-400">
                          {t("dashboard.no_tools")}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
