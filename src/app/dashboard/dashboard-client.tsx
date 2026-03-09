"use client";

import { useState } from "react";

interface DashboardProps {
  user: { name: string; email: string; mcpApiKey: string };
  connectedApps: Array<{
    appName: string;
    status: string;
    connectedAt: string;
  }>;
}

const AVAILABLE_APPS = [
  {
    name: "notion",
    displayName: "Notion",
    description: "Search, create, and update pages and databases",
  },
  {
    name: "gmail",
    displayName: "Gmail",
    description: "Search, read, send, and draft emails",
  },
];

export function DashboardClient({ user, connectedApps }: DashboardProps) {
  const [copied, setCopied] = useState(false);

  const mcpUrl = `${window.location.origin}/mcp/${user.mcpApiKey}`;

  const copyMcpUrl = () => {
    navigator.clipboard.writeText(mcpUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isConnected = (appName: string) =>
    connectedApps.some((a) => a.appName === appName && a.status === "active");

  const connectApp = (appName: string) => {
    window.location.href = `/api/connect/${appName}`;
  };

  const disconnectApp = async (appName: string) => {
    await fetch(`/api/connect/${appName}`, { method: "DELETE" });
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">AgentDock</h1>
          <p className="text-gray-500 mt-1">
            {user.name} ({user.email})
          </p>
        </div>

        {/* MCP URL */}
        <div className="bg-white rounded-lg border p-6">
          <h2 className="text-lg font-semibold mb-2">MCP URL</h2>
          <p className="text-sm text-gray-500 mb-4">
            Copy this URL and paste it into your AI agent's MCP settings.
          </p>
          <div className="flex gap-2">
            <code className="flex-1 bg-gray-100 rounded px-3 py-2 text-sm font-mono text-gray-700 overflow-x-auto">
              {mcpUrl}
            </code>
            <button
              onClick={copyMcpUrl}
              className="px-4 py-2 bg-black text-white text-sm rounded hover:bg-gray-800 transition-colors whitespace-nowrap"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>

        {/* Connected Apps */}
        <div className="bg-white rounded-lg border p-6">
          <h2 className="text-lg font-semibold mb-4">Apps</h2>
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
                        Connected
                      </p>
                    )}
                  </div>
                  {connected ? (
                    <button
                      onClick={() => disconnectApp(app.name)}
                      className="px-4 py-2 text-sm border border-red-200 text-red-600 rounded hover:bg-red-50 transition-colors"
                    >
                      Disconnect
                    </button>
                  ) : (
                    <button
                      onClick={() => connectApp(app.name)}
                      className="px-4 py-2 text-sm bg-black text-white rounded hover:bg-gray-800 transition-colors"
                    >
                      Connect
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
