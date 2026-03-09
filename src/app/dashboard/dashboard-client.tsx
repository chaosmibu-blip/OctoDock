"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

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

const AVAILABLE_APPS = [
  {
    name: "notion",
    displayName: "Notion",
    description: "搜尋、建立、更新頁面和資料庫",
  },
  {
    name: "gmail",
    displayName: "Gmail",
    description: "搜尋、讀取、寄送和草擬郵件",
  },
  {
    name: "threads",
    displayName: "Threads",
    description: "發布貼文、回覆和查看洞察",
  },
  {
    name: "instagram",
    displayName: "Instagram",
    description: "發布照片、管理留言和查看洞察",
  },
  {
    name: "line",
    displayName: "LINE",
    description: "發送訊息、廣播和管理追蹤者",
  },
  {
    name: "telegram",
    displayName: "Telegram",
    description: "發送訊息、照片和管理 Bot Webhook",
  },
];

export function DashboardClient({ user, connectedApps, origin }: DashboardProps) {
  const [copied, setCopied] = useState(false);
  const [expandedApp, setExpandedApp] = useState<string | null>(null);
  const [toolsCache, setToolsCache] = useState<Record<string, ToolInfo[]>>({});
  const [loadingTools, setLoadingTools] = useState<string | null>(null);
  const router = useRouter();

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
          <h1 className="text-2xl font-bold text-gray-900">AgentDock</h1>
          <div className="flex gap-2">
            <Link
              href="/bots"
              className="px-4 py-2 text-sm border rounded hover:bg-gray-100 transition-colors"
            >
              Bot 設定
            </Link>
            <Link
              href="/preferences"
              className="px-4 py-2 text-sm border rounded hover:bg-gray-100 transition-colors"
            >
              記憶
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
          <h2 className="text-lg font-semibold mb-2">MCP URL</h2>
          <p className="text-sm text-gray-500 mb-4">
            複製此 URL，貼到你的 AI agent 的 MCP 設定中。
          </p>
          <div className="flex gap-2">
            <code className="flex-1 bg-gray-100 rounded px-3 py-2 text-sm font-mono text-gray-700 overflow-x-auto">
              {mcpUrl}
            </code>
            <button
              onClick={copyMcpUrl}
              className="px-4 py-2 bg-black text-white text-sm rounded hover:bg-gray-800 transition-colors whitespace-nowrap"
            >
              {copied ? "已複製！" : "複製"}
            </button>
          </div>
        </div>

        {/* Connected Apps */}
        <div className="bg-white rounded-lg border p-6">
          <h2 className="text-lg font-semibold mb-4">應用程式</h2>
          <div className="space-y-4">
            {AVAILABLE_APPS.map((app) => {
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
                      <p className="text-sm text-gray-500">{app.description}</p>
                      <div className="flex items-center gap-3 mt-1">
                        {connected && connectedApp && (
                          <p className="text-xs text-green-600">
                            已連結
                          </p>
                        )}
                        <button
                          onClick={() => toggleTools(app.name)}
                          className="text-xs text-blue-600 hover:text-blue-800 transition-colors"
                        >
                          {isExpanded ? "收起工具清單" : "查看工具清單"}
                        </button>
                      </div>
                    </div>
                    {connected ? (
                      <button
                        onClick={() => disconnectApp(app.name)}
                        className="px-4 py-2 text-sm border border-red-200 text-red-600 rounded hover:bg-red-50 transition-colors"
                      >
                        中斷連結
                      </button>
                    ) : (
                      <button
                        onClick={() => connectApp(app.name)}
                        className="px-4 py-2 text-sm bg-black text-white rounded hover:bg-gray-800 transition-colors"
                      >
                        連結
                      </button>
                    )}
                  </div>
                  {isExpanded && (
                    <div className="mt-3 ml-1 bg-gray-50 rounded-lg p-4">
                      {isLoading ? (
                        <p className="text-sm text-gray-400">載入中...</p>
                      ) : appTools && appTools.length > 0 ? (
                        <>
                          <p className="text-xs text-gray-500 mb-3">
                            共 {appTools.length} 個工具，AI agent 可透過 MCP 使用：
                          </p>
                          <div className="space-y-2">
                            {appTools.map((tool: ToolInfo) => (
                              <div key={tool.name} className="text-sm">
                                <code className="text-xs bg-white px-1.5 py-0.5 rounded border text-gray-800">
                                  {tool.name}
                                </code>
                                <p className="text-xs text-gray-500 mt-0.5 ml-1">
                                  {tool.description}
                                </p>
                              </div>
                            ))}
                          </div>
                        </>
                      ) : (
                        <p className="text-sm text-gray-400">
                          尚未建立工具（此 App 的 Adapter 尚未實作）
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
