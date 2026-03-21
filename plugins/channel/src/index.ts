#!/usr/bin/env node

// ============================================================
// OctoDock Channel Plugin for Claude Code
//
// 架構：
// Claude Code ←(stdio)→ 此 Plugin（本地） ←(SSE)→ OctoDock 雲端
//
// 功能：
// 1. 宣告 claude/channel capability → Claude Code 認它是 channel
// 2. 透過 SSE 連回 OctoDock 雲端監聽事件
// 3. 收到事件 → 包成 notifications/claude/channel → 推給 Claude Code
// 4. 暴露 reply tool → 讓 Claude Code 透過 OctoDock 回覆
// ============================================================

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { EventSource } from "eventsource";
import { loadConfig, type PluginConfig } from "./config.js";

/** OctoDock 事件格式（與後端 types.ts 一致） */
interface OctoDockEvent {
  id: string;
  app: string;
  event_type: string;
  content: string;
  meta: Record<string, unknown>;
  raw?: unknown;
  timestamp: string;
}

// ── 建立 MCP Server ──
const server = new Server(
  { name: "octodock", version: "0.1.0" },
  {
    capabilities: {
      // 宣告 channel capability → Claude Code 會透過 stdio 接收推送
      experimental: { "claude/channel": {} },
      // 暴露 reply tool
      tools: {},
    },
    instructions: [
      'Events from OctoDock arrive as <channel source="octodock" app="...">.',
      "These are real-time events from the user's connected apps",
      "(Telegram, Gmail, GitHub, Notion, Google Calendar, etc.).",
      "When you receive an event, acknowledge it and ask the user if they want to take action.",
    ].join(" "),
  },
);

// ── 註冊 reply tool（讓 Claude Code 能透過 OctoDock 回覆） ──
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "octodock_reply",
      description:
        "Reply to an event through OctoDock. Use this to respond to messages (Telegram, LINE), " +
        "reply to emails (Gmail), comment on PRs (GitHub), etc.",
      inputSchema: {
        type: "object" as const,
        properties: {
          app: {
            type: "string",
            description: "Target app (e.g. telegram, gmail, github)",
          },
          action: {
            type: "string",
            description: "Reply action (e.g. send_message, reply_email, create_comment)",
          },
          params: {
            type: "object",
            description: "Action parameters (varies by app/action)",
            additionalProperties: true,
          },
          event_id: {
            type: "string",
            description: "Original event ID being replied to (for context tracking)",
          },
        },
        required: ["app", "action", "params"],
      },
    },
  ],
}));

// ── reply tool 執行邏輯 ──
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "octodock_reply") {
    return {
      content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }],
      isError: true,
    };
  }

  const { app, action, params, event_id } = request.params.arguments as {
    app: string;
    action: string;
    params: Record<string, unknown>;
    event_id?: string;
  };

  // 透過 OctoDock MCP endpoint 執行操作（用 octodock_do 的 HTTP API）
  const config = loadConfig();
  if (!config.apiKey) {
    return {
      content: [
        {
          type: "text",
          text: "OctoDock API key not configured. Run /octodock:configure to set it up.",
        },
      ],
      isError: true,
    };
  }

  try {
    // 呼叫 OctoDock 雲端的 REST API 執行回覆操作
    const response = await fetch(
      `${config.serverUrl}/api/tools/${app}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({ action, params, event_id }),
      },
    );

    const result = await response.json();
    return {
      content: [
        {
          type: "text",
          text: result.ok
            ? `✓ Reply sent via ${app}.${action}`
            : `✗ Failed: ${result.error ?? "Unknown error"}`,
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `Failed to reach OctoDock: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    };
  }
});

// ── 主程式 ──
async function main() {
  // 1. 載入設定（API key）
  const config = loadConfig();

  // 2. 透過 stdio 連接 Claude Code
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // 3. 如果有 API key → 連回 OctoDock 雲端監聽事件
  if (config.apiKey) {
    connectToEventStream(config);
  } else {
    console.error(
      "[octodock] No API key configured. Run /octodock:configure to enable event streaming.",
    );
  }
}

/**
 * 連回 OctoDock 雲端的 SSE endpoint
 * 收到事件 → 轉發給 Claude Code
 */
function connectToEventStream(config: PluginConfig): void {
  const url = `${config.serverUrl}/api/events/${config.apiKey}`;
  const es = new EventSource(url);

  es.onopen = () => {
    console.error("[octodock] Connected to OctoDock event stream");
  };

  es.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);

      // 跳過連線確認訊息
      if (data.type === "connected") return;

      const octodockEvent = data as OctoDockEvent;

      // 包成 channel notification → 推給 Claude Code
      await server.notification({
        method: "notifications/claude/channel",
        params: {
          content: octodockEvent.content,
          meta: {
            source: octodockEvent.app,
            event_type: octodockEvent.event_type,
            event_id: octodockEvent.id,
            ...octodockEvent.meta,
          },
        },
      });
    } catch (err) {
      console.error("[octodock] Failed to process event:", err);
    }
  };

  es.onerror = (err) => {
    console.error("[octodock] SSE connection error, will auto-reconnect:", err);
    // EventSource 會自動重連，不需手動處理
  };
}

// 啟動
main().catch((err) => {
  console.error("[octodock] Fatal error:", err);
  process.exit(1);
});
