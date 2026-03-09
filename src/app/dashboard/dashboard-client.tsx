"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

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
  const router = useRouter();

  const mcpUrl = `${origin}/mcp/${user.mcpApiKey}`;

  const copyMcpUrl = useCallback(() => {
    navigator.clipboard.writeText(mcpUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [mcpUrl]);

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

              return (
                <div
                  key={app.name}
                  className="flex items-center justify-between py-3 border-b last:border-b-0"
                >
                  <div>
                    <h3 className="font-medium text-gray-900">
                      {app.displayName}
                    </h3>
                    <p className="text-sm text-gray-500">{app.description}</p>
                    {connected && connectedApp && (
                      <p className="text-xs text-green-600 mt-1">
                        已連結
                      </p>
                    )}
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
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
