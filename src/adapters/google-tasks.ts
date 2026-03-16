/**
 * Google Tasks Adapter
 * 提供 Google Tasks 任務清單管理功能：列出清單、建立/更新/刪除/完成/移動任務、清除已完成、建立清單
 */
import { z } from "zod";
import type {
  AppAdapter,
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
  scopes: ["https://www.googleapis.com/auth/tasks"],
  authMethod: "post",
  extraParams: { access_type: "offline", prompt: "consent" },
};

// ── API 基礎設定 ───────────────────────────────────────────
const GTASKS_API = "https://tasks.googleapis.com/tasks/v1";

// ── 輔助函式：Google Tasks API 請求封裝 ────────────────────
async function gtasksFetch(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<unknown> {
  const res = await fetch(`${GTASKS_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers as object),
    },
  });

  // DELETE 成功回傳 204 No Content
  if (res.status === 204) return { ok: true };

  if (!res.ok) {
    const error = await res
      .json()
      .catch(() => ({ error: { message: res.statusText } }));
    throw new Error(
      `Google Tasks API error: ${(error as { error: { message: string } }).error.message} (GTASKS_API_ERROR)`,
    );
  }
  return res.json();
}

// ── do+help 架構：動作對照表 ──────────────────────────────
// 將簡化 action 名稱對應到內部工具名稱
const actionMap: Record<string, string> = {
  list_tasklists: "gtasks_list_tasklists",
  list_tasks: "gtasks_list_tasks",
  get_task: "gtasks_get_task",
  create_task: "gtasks_create_task",
  update_task: "gtasks_update_task",
  delete_task: "gtasks_delete_task",
  complete_task: "gtasks_complete_task",
  move_task: "gtasks_move_task",
  clear_completed: "gtasks_clear_completed",
  create_tasklist: "gtasks_create_tasklist",
  delete_tasklist: "gtasks_delete_tasklist",
};

// ── do+help 架構：技能描述（供 agent 理解可用操作）────────
const ACTION_SKILLS: Record<string, string> = {
  list_tasklists: `## google_tasks.list_tasklists
List all task lists in user's Google Tasks account.
### Parameters
  (none)
### Example
octodock_do(app:"google_tasks", action:"list_tasklists", params:{})`,

  list_tasks: `## google_tasks.list_tasks
List tasks in a specific task list.
### Parameters
  tasklist: Task list ID (use list_tasklists to find IDs)
  show_completed (optional): Include completed tasks (default false)
  max_results (optional): Max results (default 20, max 100)
### Example
octodock_do(app:"google_tasks", action:"list_tasks", params:{tasklist:"MTYzMTY..."})
octodock_do(app:"google_tasks", action:"list_tasks", params:{tasklist:"MTYzMTY...", show_completed:true, max_results:50})`,

  get_task: `## google_tasks.get_task
Get a single task's details.
### Parameters
  tasklist: Task list ID
  task: Task ID
### Example
octodock_do(app:"google_tasks", action:"get_task", params:{tasklist:"MTYzMTY...", task:"dGFzay0x..."})`,

  create_task: `## google_tasks.create_task
Create a new task in a task list.
### Parameters
  tasklist: Task list ID
  title: Task title
  notes (optional): Task description/notes
  due (optional): Due date in RFC 3339 format (e.g. "2026-03-20T00:00:00.000Z")
### Example
octodock_do(app:"google_tasks", action:"create_task", params:{
  tasklist:"MTYzMTY...",
  title:"完成報告",
  notes:"Q1 季度報告，需要包含銷售數據",
  due:"2026-03-20T00:00:00.000Z"
})`,

  update_task: `## google_tasks.update_task
Update an existing task's title, notes, due date, or status.
### Parameters
  tasklist: Task list ID
  task: Task ID
  title (optional): New title
  notes (optional): New notes
  due (optional): New due date in RFC 3339 format
  status (optional): "needsAction" or "completed"
### Example
octodock_do(app:"google_tasks", action:"update_task", params:{
  tasklist:"MTYzMTY...",
  task:"dGFzay0x...",
  title:"完成報告（已更新）",
  due:"2026-03-25T00:00:00.000Z"
})`,

  delete_task: `## google_tasks.delete_task
Delete a task permanently.
### Parameters
  tasklist: Task list ID
  task: Task ID
### Example
octodock_do(app:"google_tasks", action:"delete_task", params:{tasklist:"MTYzMTY...", task:"dGFzay0x..."})`,

  complete_task: `## google_tasks.complete_task
Mark a task as completed.
### Parameters
  tasklist: Task list ID
  task: Task ID
### Example
octodock_do(app:"google_tasks", action:"complete_task", params:{tasklist:"MTYzMTY...", task:"dGFzay0x..."})`,

  move_task: `## google_tasks.move_task
Move a task to a different position, make it a subtask, or reorder within a list.
### Parameters
  tasklist: Task list ID
  task: Task ID
  parent (optional): Parent task ID (makes this task a subtask)
  previous (optional): Previous sibling task ID (positions after this task)
### Example
octodock_do(app:"google_tasks", action:"move_task", params:{tasklist:"MTYzMTY...", task:"dGFzay0x...", parent:"cGFyZW50..."})
octodock_do(app:"google_tasks", action:"move_task", params:{tasklist:"MTYzMTY...", task:"dGFzay0x...", previous:"c2libGluZw..."})`,

  clear_completed: `## google_tasks.clear_completed
Clear all completed tasks from a task list. This permanently removes them.
### Parameters
  tasklist: Task list ID
### Example
octodock_do(app:"google_tasks", action:"clear_completed", params:{tasklist:"MTYzMTY..."})`,

  create_tasklist: `## google_tasks.create_tasklist
Create a new task list.
### Parameters
  title: Task list name
### Example
octodock_do(app:"google_tasks", action:"create_tasklist", params:{title:"Work Projects"})`,
};

function getSkill(action?: string): string {
  // action 級別：回傳該 action 的完整參數 + 範例
  if (action && ACTION_SKILLS[action]) return ACTION_SKILLS[action];
  // 有 action 但找不到：提示可用的 action
  if (action) {
    return `Action "${action}" not found. Available: ${Object.keys(ACTION_SKILLS).join(", ")}`;
  }
  // app 級別：全部 10 個 action
  return `google_tasks actions (${Object.keys(actionMap).length}):
  list_tasklists() — list all task lists
  list_tasks(tasklist, show_completed?, max_results?) — list tasks in a list
  get_task(tasklist, task) — get single task details
  create_task(tasklist, title, notes?, due?) — create new task
  update_task(tasklist, task, title?, notes?, due?, status?) — update task
  delete_task(tasklist, task) — delete task permanently
  complete_task(tasklist, task) — mark task as completed
  move_task(tasklist, task, parent?, previous?) — move/reorder task
  clear_completed(tasklist) — clear all completed tasks
  create_tasklist(title) — create new task list
  delete_tasklist(tasklist) — delete task list permanently
Use octodock_help(app:"google_tasks", action:"ACTION") for detailed params + example.`;
}

// ── 輔助函式：格式化單一任務為 checkbox 文字 ──────────────
interface GTaskItem {
  id?: string;
  title?: string;
  notes?: string;
  status?: string;
  due?: string;
  updated?: string;
  selfLink?: string;
}

function formatTask(task: GTaskItem): string {
  const checked = task.status === "completed" ? "x" : " ";
  let line = `- [${checked}] ${task.title || "(untitled)"}`;
  if (task.due) {
    // 從 RFC 3339 提取日期部分
    const dueDate = task.due.split("T")[0];
    line += ` (due: ${dueDate})`;
  }
  if (task.notes) {
    line += `\n  Notes: ${task.notes}`;
  }
  return line;
}

// ── do+help 架構：格式化回應（將原始資料轉為 AI 友善格式）─
/* eslint-disable @typescript-eslint/no-explicit-any */
function formatResponse(action: string, rawData: unknown): string {
  if (typeof rawData !== "object" || rawData === null) return String(rawData);
  const data = rawData as Record<string, unknown>;

  switch (action) {
    // 任務清單列表
    case "list_tasklists": {
      const items = data.items as Array<{ id: string; title: string }> | undefined;
      if (!items || items.length === 0) return "No task lists found.";
      return items
        .map((list) => `- **${list.title}** (id: ${list.id})`)
        .join("\n");
    }

    // 任務列表：checkbox 格式
    case "list_tasks": {
      const items = data.items as GTaskItem[] | undefined;
      if (!items || items.length === 0) return "No tasks found in this list.";
      return items.map(formatTask).join("\n");
    }

    // 單一任務詳情
    case "get_task": {
      const task = data as GTaskItem;
      let output = formatTask(task);
      if (task.id) output += `\n  ID: ${task.id}`;
      if (task.updated) output += `\n  Updated: ${task.updated}`;
      return output;
    }

    // 建立/更新/完成任務：確認訊息
    case "create_task":
    case "update_task":
    case "complete_task": {
      const task = data as GTaskItem;
      return `Done. ${formatTask(task)}\n  ID: ${task.id}`;
    }

    // 刪除任務
    case "delete_task": {
      return "Done. Task deleted.";
    }

    // 移動任務
    case "move_task": {
      const task = data as GTaskItem;
      return `Done. Task moved. ${formatTask(task)}\n  ID: ${task.id}`;
    }

    // 清除已完成任務
    case "clear_completed": {
      return "Done. All completed tasks cleared.";
    }

    // 建立任務清單
    case "create_tasklist": {
      const id = data.id as string | undefined;
      const title = data.title as string | undefined;
      return `Done. Task list "${title ?? "Untitled"}" created.\n  ID: ${id}`;
    }

    default:
      return JSON.stringify(rawData, null, 2);
  }
}

// ── 智慧錯誤引導：攔截常見 API 錯誤 ──────────────────────
function gtasksFormatError(action: string, errorMessage: string): string | null {
  const msg = errorMessage.toLowerCase();

  // 找不到資源
  if (msg.includes("not found") || msg.includes("404")) {
    return `找不到指定的資源。請確認 tasklist 和 task ID 是否正確。可用 list_tasklists 取得清單 ID，再用 list_tasks 取得任務 ID。(GTASKS_NOT_FOUND)`;
  }

  // 權限不足
  if (msg.includes("unauthorized") || msg.includes("forbidden") || msg.includes("403")) {
    return "權限不足。請確認 Google Tasks 已授權給 OctoDock，並重新連結帳號。(GTASKS_UNAUTHORIZED)";
  }

  // 無效請求
  if (msg.includes("invalid") || msg.includes("bad request") || msg.includes("400")) {
    if (action === "create_task" || action === "update_task") {
      return `參數格式錯誤。title 為必填，due 需為 RFC 3339 格式（例如 "2026-03-20T00:00:00.000Z"），status 須為 "needsAction" 或 "completed"。(GTASKS_INVALID_PARAMS)`;
    }
    return `請求格式錯誤。使用 octodock_help(app:"google_tasks", action:"${action}") 查看正確的參數格式。(GTASKS_INVALID_REQUEST)`;
  }

  // Rate limit
  if (msg.includes("rate limit") || msg.includes("429")) {
    return "Google Tasks API 速率限制。請稍後再試。(GTASKS_RATE_LIMITED)";
  }

  return null;
}

// ── MCP 工具定義（7 個工具）──────────────────────────────
const tools: ToolDefinition[] = [
  {
    name: "gtasks_list_tasklists",
    description:
      "List all task lists in user's Google Tasks account. Returns list names and IDs.",
    inputSchema: {},
  },
  {
    name: "gtasks_list_tasks",
    description:
      "List tasks in a specific Google Tasks list. Returns task titles, statuses, and due dates.",
    inputSchema: {
      tasklist: z.string().describe("Task list ID"),
      show_completed: z
        .boolean()
        .optional()
        .describe("Include completed tasks (default false)"),
      max_results: z
        .number()
        .optional()
        .describe("Maximum number of results (default 20, max 100)"),
    },
  },
  {
    name: "gtasks_get_task",
    description:
      "Get the full details of a single task by its ID, including title, notes, status, and due date.",
    inputSchema: {
      tasklist: z.string().describe("Task list ID"),
      task: z.string().describe("Task ID"),
    },
  },
  {
    name: "gtasks_create_task",
    description:
      "Create a new task in a Google Tasks list. Supports title, notes, and due date.",
    inputSchema: {
      tasklist: z.string().describe("Task list ID"),
      title: z.string().describe("Task title"),
      notes: z.string().optional().describe("Task description/notes"),
      due: z
        .string()
        .optional()
        .describe(
          'Due date in RFC 3339 format (e.g. "2026-03-20T00:00:00.000Z")',
        ),
    },
  },
  {
    name: "gtasks_update_task",
    description:
      "Update an existing task's title, notes, due date, or status. Only provided fields are updated.",
    inputSchema: {
      tasklist: z.string().describe("Task list ID"),
      task: z.string().describe("Task ID"),
      title: z.string().optional().describe("New task title"),
      notes: z.string().optional().describe("New task notes"),
      due: z
        .string()
        .optional()
        .describe(
          'New due date in RFC 3339 format (e.g. "2026-03-20T00:00:00.000Z")',
        ),
      status: z
        .enum(["needsAction", "completed"])
        .optional()
        .describe('Task status: "needsAction" or "completed"'),
    },
  },
  {
    name: "gtasks_delete_task",
    description:
      "Permanently delete a task from a Google Tasks list. This action cannot be undone.",
    inputSchema: {
      tasklist: z.string().describe("Task list ID"),
      task: z.string().describe("Task ID"),
    },
  },
  {
    name: "gtasks_complete_task",
    description:
      'Mark a task as completed by setting its status to "completed".',
    inputSchema: {
      tasklist: z.string().describe("Task list ID"),
      task: z.string().describe("Task ID"),
    },
  },
  // 移動/排序任務
  {
    name: "gtasks_move_task",
    description:
      "Move a task to a different position, make it a subtask of another task, or reorder within a list.",
    inputSchema: {
      tasklist: z.string().describe("Task list ID"),
      task: z.string().describe("Task ID to move"),
      parent: z.string().optional().describe("Parent task ID (makes this task a subtask)"),
      previous: z.string().optional().describe("Previous sibling task ID (positions after this task)"),
    },
  },
  // 清除已完成任務
  {
    name: "gtasks_clear_completed",
    description:
      "Clear all completed tasks from a task list. Permanently removes completed tasks.",
    inputSchema: {
      tasklist: z.string().describe("Task list ID"),
    },
  },
  // 建立任務清單
  {
    name: "gtasks_create_tasklist",
    description:
      "Create a new task list in Google Tasks.",
    inputSchema: {
      title: z.string().describe("Task list name"),
    },
  },
  // 刪除任務清單
  {
    name: "gtasks_delete_tasklist",
    description:
      "Delete a task list permanently from Google Tasks.",
    inputSchema: {
      tasklist: z.string().describe("Task list ID to delete"),
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
    // 列出所有任務清單
    case "gtasks_list_tasklists": {
      const result = await gtasksFetch("/users/@me/lists", token);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 列出某個清單中的任務
    case "gtasks_list_tasks": {
      const tasklist = params.tasklist as string;
      const maxResults = Math.min((params.max_results as number) ?? 20, 100);
      const showCompleted = (params.show_completed as boolean) ?? false;
      const queryParams = new URLSearchParams({
        maxResults: String(maxResults),
        showCompleted: String(showCompleted),
        showHidden: String(showCompleted), // 顯示隱藏的已完成任務
      });
      const result = await gtasksFetch(
        `/lists/${encodeURIComponent(tasklist)}/tasks?${queryParams.toString()}`,
        token,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 取得單一任務詳情
    case "gtasks_get_task": {
      const result = await gtasksFetch(
        `/lists/${encodeURIComponent(params.tasklist as string)}/tasks/${encodeURIComponent(params.task as string)}`,
        token,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 建立新任務
    case "gtasks_create_task": {
      const body: Record<string, unknown> = {
        title: params.title as string,
      };
      if (params.notes) body.notes = params.notes;
      if (params.due) body.due = params.due;

      const result = await gtasksFetch(
        `/lists/${encodeURIComponent(params.tasklist as string)}/tasks`,
        token,
        {
          method: "POST",
          body: JSON.stringify(body),
        },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 更新任務（PATCH：僅更新提供的欄位）
    case "gtasks_update_task": {
      const body: Record<string, unknown> = {};
      if (params.title !== undefined) body.title = params.title;
      if (params.notes !== undefined) body.notes = params.notes;
      if (params.due !== undefined) body.due = params.due;
      if (params.status !== undefined) body.status = params.status;

      const result = await gtasksFetch(
        `/lists/${encodeURIComponent(params.tasklist as string)}/tasks/${encodeURIComponent(params.task as string)}`,
        token,
        {
          method: "PATCH",
          body: JSON.stringify(body),
        },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 刪除任務
    case "gtasks_delete_task": {
      const result = await gtasksFetch(
        `/lists/${encodeURIComponent(params.tasklist as string)}/tasks/${encodeURIComponent(params.task as string)}`,
        token,
        { method: "DELETE" },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 完成任務：設定 status 為 "completed"
    case "gtasks_complete_task": {
      const result = await gtasksFetch(
        `/lists/${encodeURIComponent(params.tasklist as string)}/tasks/${encodeURIComponent(params.task as string)}`,
        token,
        {
          method: "PATCH",
          body: JSON.stringify({ status: "completed" }),
        },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 移動/排序任務
    case "gtasks_move_task": {
      const queryParams = new URLSearchParams();
      if (params.parent) queryParams.set("parent", params.parent as string);
      if (params.previous) queryParams.set("previous", params.previous as string);
      const qs = queryParams.toString();
      const result = await gtasksFetch(
        `/lists/${encodeURIComponent(params.tasklist as string)}/tasks/${encodeURIComponent(params.task as string)}/move${qs ? `?${qs}` : ""}`,
        token,
        { method: "POST" },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 清除已完成任務
    case "gtasks_clear_completed": {
      const result = await gtasksFetch(
        `/lists/${encodeURIComponent(params.tasklist as string)}/clear`,
        token,
        { method: "POST" },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 建立任務清單
    case "gtasks_create_tasklist": {
      const result = await gtasksFetch(
        "/users/@me/lists",
        token,
        {
          method: "POST",
          body: JSON.stringify({ title: params.title as string }),
        },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 刪除任務清單
    case "gtasks_delete_tasklist": {
      await gtasksFetch(
        `/users/@me/lists/${encodeURIComponent(params.tasklist as string)}`,
        token,
        { method: "DELETE" },
      );
      return {
        content: [{ type: "text", text: JSON.stringify({ deleted: true }, null, 2) }],
      };
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
        isError: true,
      };
  }
}

// ── Token 刷新：使用 refresh_token 取得新的 access_token ─
async function refreshGTasksToken(refreshToken: string): Promise<TokenSet> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env.GTASKS_OAUTH_CLIENT_ID!,
      client_secret: process.env.GTASKS_OAUTH_CLIENT_SECRET!,
    }).toString(),
  });

  if (!res.ok) {
    throw new Error(
      "Google Tasks token 刷新失敗，請重新連結帳號。(GTASKS_REFRESH_FAILED)",
    );
  }

  const data = await res.json();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? refreshToken, // Google 不一定回傳新的 refresh_token
    expires_in: data.expires_in,
  };
}

// ── Adapter 匯出 ─────────────────────────────────────────
export const googleTasksAdapter: AppAdapter = {
  name: "google_tasks",
  displayName: { zh: "Google Tasks", en: "Google Tasks" },
  icon: "google-tasks",
  authType: "oauth2",
  authConfig,
  actionMap,
  getSkill,
  formatResponse,
  formatError: gtasksFormatError,
  tools,
  execute,
  refreshToken: refreshGTasksToken,
};
