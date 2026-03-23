/**
 * Google Calendar Adapter
 * 提供 Google Calendar 日曆查詢、事件管理、快速新增、空閒查詢、日曆建立刪除、週期事件功能
 */
import { z } from "zod";
import type {
  AppAdapter,
  EntityInfo,
  OAuthConfig,
  ToolDefinition,
  ToolResult,
  TokenSet,
} from "./types";

// ── OAuth 設定 ─────────────────────────────────────────────
const authConfig: OAuthConfig = {
  type: "oauth2",
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  scopes: [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/calendar.events",
  ],
  authMethod: "post",
  extraParams: { access_type: "offline", prompt: "consent" },
};

// ── API 基礎設定 ───────────────────────────────────────────
const GCAL_API = "https://www.googleapis.com/calendar/v3";

// ── 輔助函式：Google Calendar API 請求封裝 ─────────────────
async function gcalFetch(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<unknown> {
  const res = await fetch(`${GCAL_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers as object),
    },
  });

  // DELETE 成功時回傳 204 No Content，不需要解析 body
  if (res.status === 204) return { deleted: true };

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error(
      `Google Calendar API error (${res.status}): ${(error as { error: { message: string } }).error.message} (GCAL_API_ERROR)`,
    );
  }
  return res.json();
}

// ── 輔助函式：取得預設時間範圍（未來 7 天）──────────────────
function getDefaultTimeRange(): { timeMin: string; timeMax: string } {
  const now = new Date();
  const weekLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return {
    timeMin: now.toISOString(),
    timeMax: weekLater.toISOString(),
  };
}

// ── 輔助函式：格式化事件時間（支援全天 / 定時事件）─────────
function formatEventTime(event: Record<string, unknown>): string {
  const start = event.start as { dateTime?: string; date?: string } | undefined;
  const end = event.end as { dateTime?: string; date?: string } | undefined;
  if (!start) return "No time specified";

  if (start.dateTime) {
    const startDate = new Date(start.dateTime);
    const endDate = end?.dateTime ? new Date(end.dateTime) : null;
    // 從事件的 start.timeZone 提取時區，用於 toLocaleString 顯示正確時間
    const startObj = event.start as Record<string, unknown> | undefined;
    const tz = (startObj?.timeZone as string | undefined) ?? "Asia/Taipei";
    const startStr = startDate.toLocaleString("zh-TW", {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz,
    });
    if (endDate) {
      const endStr = endDate.toLocaleString("zh-TW", {
        hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz,
      });
      return `${startStr} ~ ${endStr}`;
    }
    return startStr;
  }

  // 全天事件
  if (start.date) {
    const endDate = end?.date;
    if (endDate && endDate !== start.date) {
      return `${start.date} ~ ${endDate} (all-day)`;
    }
    return `${start.date} (all-day)`;
  }

  return "No time specified";
}

// ── 輔助函式：將單一事件格式化為易讀文字 ──────────────────
function formatSingleEvent(event: Record<string, unknown>): string {
  const summary = (event.summary as string) || "(No title)";
  const time = formatEventTime(event);
  const location = event.location ? `\n  Location: ${event.location}` : "";
  const description = event.description ? `\n  Description: ${event.description}` : "";
  const status = event.status ? ` [${event.status}]` : "";
  const id = event.id ? `\n  ID: ${event.id}` : "";
  return `- **${summary}**${status}\n  Time: ${time}${location}${description}${id}`;
}

// ── do+help 架構：動作對照表 ──────────────────────────────
// 將自然語言動作名稱對應到 MCP 工具名稱
const actionMap: Record<string, string> = {
  list_calendars: "gcal_list_calendars",
  get_events: "gcal_get_events",
  get_event: "gcal_get_event",
  create_event: "gcal_create_event",
  update_event: "gcal_update_event",
  delete_event: "gcal_delete_event",
  quick_add: "gcal_quick_add",
  freebusy: "gcal_freebusy",
  list_recurring: "gcal_list_recurring",
  create_calendar: "gcal_create_calendar",
  delete_calendar: "gcal_delete_calendar",
  // U22: ACL 共享功能
  share_calendar: "gcal_share_calendar",
  list_sharing: "gcal_list_sharing",
  remove_sharing: "gcal_remove_sharing",
};

// ── do+help 架構：技能描述（供 agent 理解可用操作）────────
const ACTION_SKILLS: Record<string, string> = {
  list_calendars: `## google_calendar.list_calendars
List all calendars the user has access to.
### Parameters
  (none required)
### Example
octodock_do(app:"google_calendar", action:"list_calendars", params:{})`,

  get_events: `## google_calendar.get_events
List events from a calendar within a time range.
### Parameters
  calendar_id (optional): Calendar ID (default "primary")
  time_min (optional): Start time in ISO 8601 (default: now)
  time_max (optional): End time in ISO 8601 (default: 7 days from now)
  max_results (optional): Max events to return (default 10, max 50)
### Example
octodock_do(app:"google_calendar", action:"get_events", params:{})
octodock_do(app:"google_calendar", action:"get_events", params:{calendar_id:"primary", time_min:"2026-03-15T00:00:00+08:00", time_max:"2026-03-22T00:00:00+08:00", max_results:20})`,

  get_event: `## google_calendar.get_event
Get details of a single event by ID.
### Parameters
  calendar_id (optional): Calendar ID (default "primary")
  event_id: The event ID
### Example
octodock_do(app:"google_calendar", action:"get_event", params:{event_id:"abc123def456"})`,

  create_event: `## google_calendar.create_event
Create a new calendar event.
### Parameters
  calendar_id (optional): Calendar ID (default "primary")
  summary: Event title
  start: Start time — use {dateTime:"2026-03-15T15:00:00+08:00"} for timed events or {date:"2026-03-15"} for all-day
  end: End time — same format as start
  description (optional): Event description
  location (optional): Event location
  attendees (optional): Array of {email:"..."} objects
### Example
octodock_do(app:"google_calendar", action:"create_event", params:{
  summary:"Team standup",
  start:{dateTime:"2026-03-15T09:00:00+08:00"},
  end:{dateTime:"2026-03-15T09:30:00+08:00"},
  location:"Meeting Room A",
  description:"Daily sync"
})`,

  update_event: `## google_calendar.update_event
Update an existing event (partial update via PATCH).
### Parameters
  calendar_id (optional): Calendar ID (default "primary")
  event_id: The event ID to update
  summary (optional): New title
  start (optional): New start time
  end (optional): New end time
  description (optional): New description
  location (optional): New location
### Example
octodock_do(app:"google_calendar", action:"update_event", params:{
  event_id:"abc123def456",
  summary:"Updated meeting title",
  start:{dateTime:"2026-03-15T10:00:00+08:00"},
  end:{dateTime:"2026-03-15T11:00:00+08:00"}
})`,

  delete_event: `## google_calendar.delete_event
Delete an event from a calendar.
### Parameters
  calendar_id (optional): Calendar ID (default "primary")
  event_id: The event ID to delete
### Example
octodock_do(app:"google_calendar", action:"delete_event", params:{event_id:"abc123def456"})`,

  quick_add: `## google_calendar.quick_add
Create an event from natural language text (like "Meeting tomorrow at 3pm").
### Parameters
  calendar_id (optional): Calendar ID (default "primary")
  text: Natural language event description
### Example
octodock_do(app:"google_calendar", action:"quick_add", params:{text:"Lunch with Alice tomorrow at noon"})
octodock_do(app:"google_calendar", action:"quick_add", params:{text:"Team offsite March 20-21"})`,

  freebusy: `## google_calendar.freebusy
Check availability (free/busy) for one or more calendars.
### Parameters
  time_min: Start of the time range (ISO 8601)
  time_max: End of the time range (ISO 8601)
  calendar_ids (optional): Array of calendar IDs to check (default ["primary"])
### Example
octodock_do(app:"google_calendar", action:"freebusy", params:{
  time_min:"2026-03-15T09:00:00+08:00",
  time_max:"2026-03-15T18:00:00+08:00"
})`,

  list_recurring: `## google_calendar.list_recurring
List all instances of a recurring event.
### Parameters
  calendar_id (optional): Calendar ID (default "primary")
  event_id: The recurring event ID
### Example
octodock_do(app:"google_calendar", action:"list_recurring", params:{event_id:"abc123def456"})`,

  create_calendar: `## google_calendar.create_calendar
Create a new Google Calendar.
### Parameters
  summary: Calendar name
  description (optional): Calendar description
  timezone (optional): Timezone (e.g. "Asia/Taipei")
### Example
octodock_do(app:"google_calendar", action:"create_calendar", params:{summary:"Work Calendar", description:"For work events", timezone:"Asia/Taipei"})`,

  delete_calendar: `## google_calendar.delete_calendar
Delete a Google Calendar. This action is irreversible. Cannot delete the primary calendar.
### Parameters
  calendar_id: Calendar ID to delete
### Example
octodock_do(app:"google_calendar", action:"delete_calendar", params:{calendar_id:"abc123@group.calendar.google.com"})`,

  // U22: ACL 共享功能
  share_calendar: `## google_calendar.share_calendar
⚠️ sensitive — Share your calendar with another person.
### Parameters
  calendar_id (optional): Calendar ID (default "primary")
  email: Email address of the person to share with
  role: "reader" (can view) or "writer" (can edit)
### Example
octodock_do(app:"google_calendar", action:"share_calendar", params:{email:"wife@gmail.com", role:"reader"})
octodock_do(app:"google_calendar", action:"share_calendar", params:{email:"colleague@company.com", role:"writer", calendar_id:"work@group.calendar.google.com"})`,

  list_sharing: `## google_calendar.list_sharing
List who the calendar is shared with.
### Parameters
  calendar_id (optional): Calendar ID (default "primary")
### Example
octodock_do(app:"google_calendar", action:"list_sharing", params:{})`,

  remove_sharing: `## google_calendar.remove_sharing
⚠️ destructive — Remove someone's access to your calendar.
### Parameters
  calendar_id (optional): Calendar ID (default "primary")
  email: Email address to remove
### Example
octodock_do(app:"google_calendar", action:"remove_sharing", params:{email:"someone@gmail.com"})`,
};

function getSkill(action?: string): string | null {
  if (action && ACTION_SKILLS[action]) return ACTION_SKILLS[action];
  if (action) return null; // ACTION_SKILLS 沒有的 action → 回傳 null 讓 server.ts fallback 用 actionMap 自動查
  return `## Google Calendar — 行事曆管理
查看、建立、修改行程。支援多個日曆、空閒查詢、自然語言建立事件。

### 常見用法
- 「今天有什麼行程」→ get_events(time_min:"today", time_max:"tomorrow")
- 「明天下午 2 點開會」→ quick_add(text:"Meeting tomorrow 2pm")
- 「我這週哪些時段有空」→ freebusy(time_min, time_max)
- 「取消某個會議」→ delete_event(event_id)

### 注意事項
- 日期格式用 ISO 8601（2026-03-23T14:00:00+08:00），param-guard 會自動補時區
- calendar_id 預設是 "primary"，不用特別指定
- share_calendar 和 remove_sharing 是破壞性操作，需確認

### 全部 actions (${Object.keys(actionMap).length})
  list_calendars, get_events, get_event, create_event, update_event, delete_event,
  quick_add, freebusy, list_recurring, create_calendar, delete_calendar,
  share_calendar, list_sharing, remove_sharing
Use octodock_help(app:"google_calendar", action:"ACTION") for detailed params + example.`;
}

// ── do+help 架構：格式化回應（將原始資料轉為簡潔文字）────
function formatResponse(action: string, rawData: unknown): string {
  if (typeof rawData !== "object" || rawData === null) return String(rawData);

  switch (action) {
    // 日曆清單：以列表呈現
    case "list_calendars": {
      const data = rawData as { items?: Array<Record<string, unknown>> };
      if (!data.items?.length) return "No calendars found.";
      return data.items.map((cal) => {
        const primary = cal.primary ? " ⭐" : "";
        const accessRole = cal.accessRole ? ` (${cal.accessRole})` : "";
        return `- **${cal.summary || "(No name)"}**${primary}${accessRole}\n  ID: ${cal.id}`;
      }).join("\n");
    }

    // 事件清單：格式化每個事件
    case "get_events": {
      const data = rawData as { items?: Array<Record<string, unknown>> };
      if (!data.items?.length) return "No events found in this time range.";
      return `Found ${data.items.length} event(s):\n\n` +
        data.items.map(formatSingleEvent).join("\n\n");
    }

    // 單一事件詳情
    case "get_event": {
      const event = rawData as Record<string, unknown>;
      return formatSingleEvent(event);
    }

    // 建立/更新事件：確認訊息
    case "create_event":
    case "update_event": {
      const event = rawData as Record<string, unknown>;
      const verb = action === "create_event" ? "Created" : "Updated";
      const link = event.htmlLink ? `\nLink: ${event.htmlLink}` : "";
      return `${verb} event: **${event.summary || "(No title)"}**\nTime: ${formatEventTime(event)}\nID: ${event.id}${link}`;
    }

    // 刪除事件：確認訊息
    case "delete_event": {
      return "Event deleted successfully.";
    }

    // 快速新增：確認訊息
    case "quick_add": {
      const event = rawData as Record<string, unknown>;
      const link = event.htmlLink ? `\nLink: ${event.htmlLink}` : "";
      return `Quick-added event: **${event.summary || "(No title)"}**\nTime: ${formatEventTime(event)}\nID: ${event.id}${link}`;
    }

    // 週期事件實例列表
    case "list_recurring": {
      const data = rawData as { items?: Array<Record<string, unknown>> };
      if (!data.items?.length) return "此週期事件沒有實例。";
      return `Found ${data.items.length} instance(s):\n\n` +
        data.items.map(formatSingleEvent).join("\n\n");
    }

    // 建立日曆
    case "create_calendar": {
      const data = rawData as Record<string, unknown>;
      return `已建立日曆：**${data.summary || "(No name)"}**\nID: ${data.id}`;
    }

    // 刪除日曆
    case "delete_calendar": {
      return "已成功刪除日曆。";
    }

    // U22: 共享日曆回傳格式
    case "share_calendar": {
      const data = rawData as Record<string, unknown>;
      const scope = data.scope as { type?: string; value?: string } | undefined;
      return `✅ 已共享日曆給 **${scope?.value || "unknown"}**（權限：${data.role || "unknown"}）`;
    }

    // U22: 列出共享對象
    case "list_sharing": {
      const data = rawData as { items?: Array<Record<string, unknown>> };
      if (!data.items?.length) return "No sharing rules found.";
      const userRules = data.items.filter((rule) => {
        const scope = rule.scope as { type?: string } | undefined;
        return scope?.type === "user";
      });
      if (!userRules.length) return "此日曆尚未與任何人共享。";
      return `共享對象（${userRules.length} 人）：\n` + userRules.map((rule) => {
        const scope = rule.scope as { value?: string } | undefined;
        return `- **${scope?.value}** — ${rule.role}`;
      }).join("\n");
    }

    // U22: 移除共享
    case "remove_sharing": {
      return `✅ 已移除共享權限。`;
    }

    // 空閒/忙碌查詢結果
    case "freebusy": {
      const data = rawData as { calendars?: Record<string, { busy?: Array<{ start: string; end: string }> }> };
      if (!data.calendars) return "No availability data returned.";
      const lines: string[] = [];
      for (const [calId, info] of Object.entries(data.calendars)) {
        const busySlots = info.busy || [];
        if (busySlots.length === 0) {
          lines.push(`- **${calId}**: Free (no busy slots)`);
        } else {
          lines.push(`- **${calId}**: ${busySlots.length} busy slot(s)`);
          for (const slot of busySlots) {
            const freebusyTz = (data as Record<string, unknown>).timeZone as string | undefined ?? "Asia/Taipei";
            const start = new Date(slot.start).toLocaleString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: freebusyTz });
            const end = new Date(slot.end).toLocaleString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: freebusyTz });
            lines.push(`  - ${start} ~ ${end}`);
          }
        }
      }
      return lines.join("\n");
    }

    default:
      return JSON.stringify(rawData, null, 2);
  }
}

// ── 智慧錯誤引導：常見錯誤的友善提示 ────────────────────
function formatError(action: string, errorMessage: string): string | null {
  // 事件找不到
  if (errorMessage.includes("Not Found") || errorMessage.includes("notFound")) {
    return `「找不到指定的事件或日曆 (EVENT_NOT_FOUND)」\n建議：請確認 event_id 或 calendar_id 是否正確，可先用 get_events 查詢。`;
  }
  // 權限不足
  if (errorMessage.includes("forbidden") || errorMessage.includes("Forbidden") || errorMessage.includes("insufficientPermissions")) {
    return `「權限不足，無法執行此操作 (PERMISSION_DENIED)」\n建議：請確認日曆的存取權限，或重新授權 Google Calendar 連結。`;
  }
  // Token 過期
  if (errorMessage.includes("invalid_grant") || errorMessage.includes("Token has been expired")) {
    return `「授權已過期，請重新連結 Google Calendar (TOKEN_EXPIRED)」`;
  }
  // 速率限制
  if (errorMessage.includes("rateLimitExceeded") || errorMessage.includes("Rate Limit")) {
    return `「已達 API 速率限制，請稍後再試 (RATE_LIMITED)」`;
  }
  // 無法匹配的錯誤，回傳 null 讓核心系統處理
  return null;
}

// ── MCP 工具定義 ──────────────────────────────────────────
const tools: ToolDefinition[] = [
  {
    name: "gcal_list_calendars",
    description:
      "List all calendars the user has access to. Returns calendar names, IDs, and access roles.",
    inputSchema: {},
  },
  {
    name: "gcal_get_events",
    description:
      "List events from a Google Calendar within a time range. Defaults to primary calendar and next 7 days.",
    inputSchema: {
      calendar_id: z
        .string()
        .optional()
        .describe('Calendar ID (default "primary")'),
      time_min: z
        .string()
        .optional()
        .describe("Start of time range in ISO 8601 format (default: now)"),
      time_max: z
        .string()
        .optional()
        .describe("End of time range in ISO 8601 format (default: 7 days from now)"),
      max_results: z
        .number()
        .optional()
        .describe("Maximum number of events to return (default 10, max 50)"),
    },
  },
  {
    name: "gcal_get_event",
    description:
      "Get full details of a single calendar event by its ID.",
    inputSchema: {
      calendar_id: z
        .string()
        .optional()
        .describe('Calendar ID (default "primary")'),
      event_id: z.string().describe("The event ID to retrieve"),
    },
  },
  {
    name: "gcal_create_event",
    description:
      "Create a new event on a Google Calendar. Supports timed events (with dateTime) and all-day events (with date).",
    inputSchema: {
      calendar_id: z
        .string()
        .optional()
        .describe('Calendar ID (default "primary")'),
      summary: z.string().describe("Event title"),
      start: z
        .object({
          dateTime: z.string().optional().describe('ISO 8601 datetime for timed events, e.g. "2026-03-15T15:00:00+08:00"'),
          date: z.string().optional().describe('Date string for all-day events, e.g. "2026-03-15"'),
        })
        .describe("Event start time"),
      end: z
        .object({
          dateTime: z.string().optional().describe('ISO 8601 datetime for timed events'),
          date: z.string().optional().describe('Date string for all-day events'),
        })
        .describe("Event end time"),
      description: z.string().optional().describe("Event description"),
      location: z.string().optional().describe("Event location"),
      attendees: z
        .array(z.object({ email: z.string() }))
        .optional()
        .describe("List of attendee email addresses"),
    },
  },
  {
    name: "gcal_update_event",
    description:
      "Update an existing calendar event (partial update). Only provided fields will be changed.",
    inputSchema: {
      calendar_id: z
        .string()
        .optional()
        .describe('Calendar ID (default "primary")'),
      event_id: z.string().describe("The event ID to update"),
      summary: z.string().optional().describe("New event title"),
      start: z
        .object({
          dateTime: z.string().optional(),
          date: z.string().optional(),
        })
        .optional()
        .describe("New start time"),
      end: z
        .object({
          dateTime: z.string().optional(),
          date: z.string().optional(),
        })
        .optional()
        .describe("New end time"),
      description: z.string().optional().describe("New description"),
      location: z.string().optional().describe("New location"),
    },
  },
  {
    name: "gcal_delete_event",
    description:
      "Delete an event from a Google Calendar.",
    inputSchema: {
      calendar_id: z
        .string()
        .optional()
        .describe('Calendar ID (default "primary")'),
      event_id: z.string().describe("The event ID to delete"),
    },
  },
  {
    name: "gcal_quick_add",
    description:
      'Create a calendar event from a natural language string, e.g. "Meeting tomorrow at 3pm" or "Lunch with Alice on Friday noon".',
    inputSchema: {
      calendar_id: z
        .string()
        .optional()
        .describe('Calendar ID (default "primary")'),
      text: z
        .string()
        .describe('Natural language event description, e.g. "Meeting tomorrow 3pm"'),
    },
  },
  {
    name: "gcal_freebusy",
    description:
      "Check free/busy availability for one or more calendars within a time range.",
    inputSchema: {
      time_min: z
        .string()
        .describe("Start of time range in ISO 8601 format"),
      time_max: z
        .string()
        .describe("End of time range in ISO 8601 format"),
      calendar_ids: z
        .array(z.string())
        .optional()
        .describe('Calendar IDs to check (default ["primary"])'),
    },
  },
  {
    name: "gcal_list_recurring",
    description:
      "List all instances of a recurring calendar event.",
    inputSchema: {
      calendar_id: z
        .string()
        .optional()
        .describe('Calendar ID (default "primary")'),
      event_id: z.string().describe("The recurring event ID"),
    },
  },
  {
    name: "gcal_create_calendar",
    description:
      "Create a new Google Calendar with a name, optional description, and timezone.",
    inputSchema: {
      summary: z.string().describe("Calendar name"),
      description: z.string().optional().describe("Calendar description"),
      timezone: z
        .string()
        .optional()
        .describe('Timezone, e.g. "Asia/Taipei"'),
    },
  },
  {
    name: "gcal_delete_calendar",
    description:
      "Delete a Google Calendar. This action is irreversible. Cannot delete the primary calendar.",
    inputSchema: {
      calendar_id: z.string().describe("Calendar ID to delete"),
    },
  },
  // U22: ACL 共享功能
  {
    name: "gcal_share_calendar",
    description: "Share a calendar with another person by email. Requires email and role (reader or writer).",
    inputSchema: {
      calendar_id: z.string().optional().describe("Calendar ID (default primary)"),
      email: z.string().describe("Email of the person to share with"),
      role: z.string().describe("Access level: reader (view only) or writer (can edit)"),
    },
  },
  {
    name: "gcal_list_sharing",
    description: "List all people the calendar is shared with and their access levels.",
    inputSchema: {
      calendar_id: z.string().optional().describe("Calendar ID (default primary)"),
    },
  },
  {
    name: "gcal_remove_sharing",
    description: "Remove someone's access to your calendar.",
    inputSchema: {
      calendar_id: z.string().optional().describe("Calendar ID (default primary)"),
      email: z.string().describe("Email of the person to remove"),
    },
  },
];

// ── 工具執行邏輯 ──────────────────────────────────────────
async function execute(
  toolName: string,
  params: Record<string, unknown>,
  token: string,
): Promise<ToolResult> {
  switch (toolName) {
    // 列出所有日曆
    case "gcal_list_calendars": {
      const result = await gcalFetch("/users/me/calendarList", token);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 查詢事件清單：支援時間範圍與最大筆數
    // F1: 支援 page_token 分頁
    case "gcal_get_events": {
      const calendarId = encodeURIComponent((params.calendar_id as string) || "primary");
      const defaults = getDefaultTimeRange();
      const timeMin = (params.time_min as string) || defaults.timeMin;
      const timeMax = (params.time_max as string) || defaults.timeMax;
      const maxResults = Math.min((params.max_results as number) ?? 10, 50);

      const queryParams = new URLSearchParams({
        timeMin,
        timeMax,
        maxResults: String(maxResults),
        singleEvents: "true",
        orderBy: "startTime",
      });
      if (params.page_token) queryParams.set("pageToken", params.page_token as string);

      const result = await gcalFetch(
        `/calendars/${calendarId}/events?${queryParams.toString()}`,
        token,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 取得單一事件詳情
    case "gcal_get_event": {
      const calendarId = encodeURIComponent((params.calendar_id as string) || "primary");
      const eventId = encodeURIComponent(params.event_id as string);

      const result = await gcalFetch(
        `/calendars/${calendarId}/events/${eventId}`,
        token,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 建立新事件：支援定時事件與全天事件
    case "gcal_create_event": {
      const calendarId = encodeURIComponent((params.calendar_id as string) || "primary");

      // 組裝事件物件，只包含有值的欄位
      const eventBody: Record<string, unknown> = {
        summary: params.summary,
        start: params.start,
        end: params.end,
      };
      if (params.description) eventBody.description = params.description;
      if (params.location) eventBody.location = params.location;
      if (params.attendees) eventBody.attendees = params.attendees;

      const result = await gcalFetch(
        `/calendars/${calendarId}/events`,
        token,
        {
          method: "POST",
          body: JSON.stringify(eventBody),
        },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 更新事件：使用 PATCH 進行部分更新
    case "gcal_update_event": {
      const calendarId = encodeURIComponent((params.calendar_id as string) || "primary");
      const eventId = encodeURIComponent(params.event_id as string);

      // 只傳送需要更新的欄位
      const patchBody: Record<string, unknown> = {};
      if (params.summary !== undefined) patchBody.summary = params.summary;
      if (params.start !== undefined) patchBody.start = params.start;
      if (params.end !== undefined) patchBody.end = params.end;
      if (params.description !== undefined) patchBody.description = params.description;
      if (params.location !== undefined) patchBody.location = params.location;

      const result = await gcalFetch(
        `/calendars/${calendarId}/events/${eventId}`,
        token,
        {
          method: "PATCH",
          body: JSON.stringify(patchBody),
        },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 刪除事件
    case "gcal_delete_event": {
      const calendarId = encodeURIComponent((params.calendar_id as string) || "primary");
      const eventId = encodeURIComponent(params.event_id as string);

      await gcalFetch(
        `/calendars/${calendarId}/events/${eventId}`,
        token,
        { method: "DELETE" },
      );
      return {
        content: [{ type: "text", text: JSON.stringify({ deleted: true }, null, 2) }],
      };
    }

    // 快速新增：用自然語言建立事件
    case "gcal_quick_add": {
      const calendarId = encodeURIComponent((params.calendar_id as string) || "primary");
      const text = encodeURIComponent(params.text as string);

      const result = await gcalFetch(
        `/calendars/${calendarId}/events/quickAdd?text=${text}`,
        token,
        { method: "POST" },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 列出週期事件的所有實例
    case "gcal_list_recurring": {
      const calendarId = encodeURIComponent((params.calendar_id as string) || "primary");
      const eventId = encodeURIComponent(params.event_id as string);

      const result = await gcalFetch(
        `/calendars/${calendarId}/events/${eventId}/instances`,
        token,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 建立新日曆
    case "gcal_create_calendar": {
      const body: Record<string, unknown> = {
        summary: params.summary,
      };
      if (params.description) body.description = params.description;
      if (params.timezone) body.timeZone = params.timezone;

      const result = await gcalFetch("/calendars", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 刪除日曆
    case "gcal_delete_calendar": {
      const calendarId = encodeURIComponent(params.calendar_id as string);

      await gcalFetch(`/calendars/${calendarId}`, token, {
        method: "DELETE",
      });
      return {
        content: [{ type: "text", text: JSON.stringify({ deleted: true }, null, 2) }],
      };
    }

    // U22: 共享日曆 — 新增共享對象
    case "gcal_share_calendar": {
      const calendarId = (params.calendar_id as string) || "primary";
      const result = await gcalFetch(`/calendars/${encodeURIComponent(calendarId)}/acl`, token, {
        method: "POST",
        body: JSON.stringify({
          role: params.role,
          scope: { type: "user", value: params.email },
        }),
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    // U22: 列出共享對象
    case "gcal_list_sharing": {
      const calendarId = (params.calendar_id as string) || "primary";
      const result = await gcalFetch(`/calendars/${encodeURIComponent(calendarId)}/acl`, token);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    // U22: 移除共享
    case "gcal_remove_sharing": {
      const calendarId = (params.calendar_id as string) || "primary";
      const ruleId = `user:${params.email}`;
      const result = await gcalFetch(`/calendars/${encodeURIComponent(calendarId)}/acl/${encodeURIComponent(ruleId)}`, token, {
        method: "DELETE",
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    // 空閒/忙碌查詢：檢查指定時間範圍的可用性
    case "gcal_freebusy": {
      const calendarIds = (params.calendar_ids as string[]) || ["primary"];

      const requestBody = {
        timeMin: params.time_min,
        timeMax: params.time_max,
        items: calendarIds.map((id) => ({ id })),
      };

      const result = await gcalFetch("/freeBusy", token, {
        method: "POST",
        body: JSON.stringify(requestBody),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
        isError: true,
      };
  }
}

// ── Token 刷新：使用共用的 Google OAuth token 刷新函式 ─
import { refreshGoogleToken } from "../lib/google-refresh";
const refreshGcalToken = (token: string) =>
  refreshGoogleToken(token, "Google Calendar", "GCAL_REFRESH_FAILED");

// ── Adapter 匯出 ─────────────────────────────────────────
// ── 實體擷取：從事件列表中提取事件名稱→event ID 映射 ────
/* eslint-disable @typescript-eslint/no-explicit-any */
function extractEntities(action: string, rawData: unknown): EntityInfo[] {
  const entities: EntityInfo[] = [];
  if (typeof rawData !== "object" || rawData === null) return entities;
  const data = rawData as Record<string, unknown>;

  switch (action) {
    // 事件列表：提取事件摘要→event ID
    case "get_events": {
      const items = (data as any).items as any[] | undefined;
      if (!items) break;
      for (const event of items) {
        if (event.summary && event.id) {
          entities.push({ name: event.summary, id: String(event.id), type: "event" });
        }
      }
      break;
    }
    // 週期事件實例列表：同樣提取事件
    case "list_recurring": {
      const items = (data as any).items as any[] | undefined;
      if (!items) break;
      for (const event of items) {
        if (event.summary && event.id) {
          entities.push({ name: event.summary, id: String(event.id), type: "event" });
        }
      }
      break;
    }
    // 日曆列表：提取日曆名稱→calendar ID
    case "list_calendars": {
      const items = (data as any).items as any[] | undefined;
      if (!items) break;
      for (const cal of items) {
        if (cal.summary && cal.id) {
          entities.push({ name: cal.summary, id: String(cal.id), type: "calendar" });
        }
      }
      break;
    }
  }

  return entities;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export const googleCalendarAdapter: AppAdapter = {
  name: "google_calendar",
  displayName: { zh: "Google 日曆", en: "Google Calendar" },
  icon: "google-calendar",
  authType: "oauth2",
  authConfig,
  actionMap,
  getSkill,
  formatResponse,
  formatError,
  extractEntities,
  tools,
  execute,
  refreshToken: refreshGcalToken,
};
