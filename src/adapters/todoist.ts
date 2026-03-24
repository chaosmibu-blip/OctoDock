/**
 * Todoist Adapter
 *
 * 完整覆蓋 Todoist REST API v2 核心功能：
 * 專案、任務、區段、留言、標籤的 CRUD + 快速新增。
 * 認證方式：API Token（Personal Token），從 Todoist 設定頁取得。
 */
import { z } from "zod";
import type {
  AppAdapter,
  DoResult,
  EntityInfo,
  NameValidationResult,
  OAuthConfig,
  ToolDefinition,
  ToolResult,
} from "./types";

// ── OAuth 設定 ─────────────────────────────────────────────
const authConfig: OAuthConfig = {
  type: "oauth2",
  authorizeUrl: "https://app.todoist.com/oauth/authorize",
  tokenUrl: "https://api.todoist.com/oauth/access_token",
  scopes: ["data:read_write,data:delete,project:delete"],  // Todoist 用逗號分隔 scope（非標準）
  authMethod: "post",
};

// ── API 基礎設定 ───────────────────────────────────────────
const TODOIST_API = "https://api.todoist.com/api/v1";

// ── 輔助函式：Todoist API 請求封裝 ──────────────────────────
async function todoistFetch(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<unknown> {
  const res = await fetch(`${TODOIST_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers as object),
    },
  });

  /* DELETE 成功回傳 204 No Content */
  if (res.status === 204) return { ok: true };

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(
      `Todoist API error: ${res.status} ${errText} (TODOIST_API_ERROR)`,
    );
  }
  return res.json();
}

// ── actionMap：簡化 action 名稱 → 內部工具名稱 ──────────────
const actionMap: Record<string, string> = {
  // 專案（5）
  list_projects: "todoist_list_projects",
  get_project: "todoist_get_project",
  create_project: "todoist_create_project",
  update_project: "todoist_update_project",
  delete_project: "todoist_delete_project",
  // 任務（8）
  list_tasks: "todoist_list_tasks",
  get_task: "todoist_get_task",
  create_task: "todoist_create_task",
  update_task: "todoist_update_task",
  delete_task: "todoist_delete_task",
  close_task: "todoist_close_task",
  reopen_task: "todoist_reopen_task",
  quick_add: "todoist_quick_add",
  // 區段（4）
  list_sections: "todoist_list_sections",
  create_section: "todoist_create_section",
  update_section: "todoist_update_section",
  delete_section: "todoist_delete_section",
  // 留言（4）
  list_comments: "todoist_list_comments",
  create_comment: "todoist_create_comment",
  update_comment: "todoist_update_comment",
  delete_comment: "todoist_delete_comment",
  // 標籤（4）
  list_labels: "todoist_list_labels",
  create_label: "todoist_create_label",
  update_label: "todoist_update_label",
  delete_label: "todoist_delete_label",
};

// ── ACTION_SKILLS：每個 action 的操作說明（供 AI 理解） ──────
const ACTION_SKILLS: Record<string, string> = {
  // ── 專案 ──
  list_projects: `## todoist.list_projects
List all projects.
### Parameters
  (none)
### Example
octodock_do(app:"todoist", action:"list_projects", params:{})`,

  get_project: `## todoist.get_project
Get a single project.
### Parameters
  project_id: Project ID
### Example
octodock_do(app:"todoist", action:"get_project", params:{project_id:"2203306141"})`,

  create_project: `## todoist.create_project
Create a new project.
### Parameters
  name: Project name
  color (optional): Color name (e.g. "berry_red", "blue", "green")
  parent_id (optional): Parent project ID (for sub-projects)
  is_favorite (optional): true/false
### Example
octodock_do(app:"todoist", action:"create_project", params:{name:"Work Tasks", color:"blue"})`,

  update_project: `## todoist.update_project
Update a project.
### Parameters
  project_id: Project ID
  name (optional): New name
  color (optional): New color
  is_favorite (optional): true/false
### Example
octodock_do(app:"todoist", action:"update_project", params:{project_id:"2203306141", name:"Updated Name"})`,

  delete_project: `## todoist.delete_project
Delete a project permanently.
### Parameters
  project_id: Project ID
### Example
octodock_do(app:"todoist", action:"delete_project", params:{project_id:"2203306141"})`,

  // ── 任務 ──
  list_tasks: `## todoist.list_tasks
List tasks. Can filter by project, section, label, or Todoist filter string.
### Parameters
  project_id (optional): Filter by project
  section_id (optional): Filter by section
  label (optional): Filter by label name
  filter (optional): Todoist filter query (e.g. "today", "overdue", "p1", "#Work")
### Example
octodock_do(app:"todoist", action:"list_tasks", params:{})
octodock_do(app:"todoist", action:"list_tasks", params:{project_id:"2203306141"})
octodock_do(app:"todoist", action:"list_tasks", params:{filter:"today | overdue"})`,

  get_task: `## todoist.get_task
Get a single task with full details.
### Parameters
  task_id: Task ID
### Example
octodock_do(app:"todoist", action:"get_task", params:{task_id:"2995104339"})`,

  create_task: `## todoist.create_task
Create a new task.
### Parameters
  content: Task title (supports markdown)
  description (optional): Task description (supports markdown)
  project_id (optional): Project to add to (default: Inbox)
  section_id (optional): Section within project
  parent_id (optional): Parent task ID (for subtasks)
  labels (optional): Array of label names, e.g. ["work","urgent"]
  priority (optional): 1 (normal) to 4 (urgent)
  due_string (optional): Natural language due date, e.g. "tomorrow at 3pm", "every monday"
  due_date (optional): Specific date "YYYY-MM-DD"
  due_datetime (optional): Specific datetime "YYYY-MM-DDTHH:MM:SS" (requires due_timezone or defaults to UTC)
### Example
octodock_do(app:"todoist", action:"create_task", params:{content:"Review PR #123", project_id:"2203306141", priority:3, due_string:"tomorrow at 10am", labels:["work"]})`,

  update_task: `## todoist.update_task
Update an existing task.
### Parameters
  task_id: Task ID
  content (optional): New title
  description (optional): New description
  labels (optional): Replace all labels
  priority (optional): 1-4
  due_string (optional): New due date in natural language
  due_date (optional): New due date "YYYY-MM-DD"
### Example
octodock_do(app:"todoist", action:"update_task", params:{task_id:"2995104339", content:"Updated title", priority:4})`,

  delete_task: `## todoist.delete_task
Delete a task permanently.
### Parameters
  task_id: Task ID
### Example
octodock_do(app:"todoist", action:"delete_task", params:{task_id:"2995104339"})`,

  close_task: `## todoist.close_task
Mark a task as completed.
### Parameters
  task_id: Task ID
### Example
octodock_do(app:"todoist", action:"close_task", params:{task_id:"2995104339"})`,

  reopen_task: `## todoist.reopen_task
Reopen a completed task.
### Parameters
  task_id: Task ID
### Example
octodock_do(app:"todoist", action:"reopen_task", params:{task_id:"2995104339"})`,

  quick_add: `## todoist.quick_add
Quick add a task using natural language (auto-parses dates, projects, labels, priorities).
### Parameters
  text: Natural language task, e.g. "Buy milk tomorrow p1 #Shopping @groceries"
### Example
octodock_do(app:"todoist", action:"quick_add", params:{text:"Call dentist tomorrow at 2pm p2 #Personal"})`,

  // ── 區段 ──
  list_sections: `## todoist.list_sections
List sections in a project.
### Parameters
  project_id: Project ID
### Example
octodock_do(app:"todoist", action:"list_sections", params:{project_id:"2203306141"})`,

  create_section: `## todoist.create_section
Create a new section in a project.
### Parameters
  name: Section name
  project_id: Project ID
  order (optional): Position order
### Example
octodock_do(app:"todoist", action:"create_section", params:{name:"In Progress", project_id:"2203306141"})`,

  update_section: `## todoist.update_section
Update a section name.
### Parameters
  section_id: Section ID
  name: New name
### Example
octodock_do(app:"todoist", action:"update_section", params:{section_id:"7025", name:"Done"})`,

  delete_section: `## todoist.delete_section
Delete a section.
### Parameters
  section_id: Section ID
### Example
octodock_do(app:"todoist", action:"delete_section", params:{section_id:"7025"})`,

  // ── 留言 ──
  list_comments: `## todoist.list_comments
List comments on a task or project.
### Parameters
  task_id (optional): Task ID (either task_id or project_id required)
  project_id (optional): Project ID
### Example
octodock_do(app:"todoist", action:"list_comments", params:{task_id:"2995104339"})`,

  create_comment: `## todoist.create_comment
Add a comment to a task or project.
### Parameters
  content: Comment text (supports markdown)
  task_id (optional): Task ID (either task_id or project_id required)
  project_id (optional): Project ID
### Example
octodock_do(app:"todoist", action:"create_comment", params:{task_id:"2995104339", content:"Done reviewing, looks good!"})`,

  update_comment: `## todoist.update_comment
Update a comment.
### Parameters
  comment_id: Comment ID
  content: New content
### Example
octodock_do(app:"todoist", action:"update_comment", params:{comment_id:"2992679862", content:"Updated comment"})`,

  delete_comment: `## todoist.delete_comment
Delete a comment.
### Parameters
  comment_id: Comment ID
### Example
octodock_do(app:"todoist", action:"delete_comment", params:{comment_id:"2992679862"})`,

  // ── 標籤 ──
  list_labels: `## todoist.list_labels
List all personal labels.
### Parameters
  (none)
### Example
octodock_do(app:"todoist", action:"list_labels", params:{})`,

  create_label: `## todoist.create_label
Create a new label.
### Parameters
  name: Label name
  color (optional): Color name
  order (optional): Position order
  is_favorite (optional): true/false
### Example
octodock_do(app:"todoist", action:"create_label", params:{name:"urgent", color:"red"})`,

  update_label: `## todoist.update_label
Update a label.
### Parameters
  label_id: Label ID
  name (optional): New name
  color (optional): New color
### Example
octodock_do(app:"todoist", action:"update_label", params:{label_id:"2156154810", name:"critical"})`,

  delete_label: `## todoist.delete_label
Delete a label.
### Parameters
  label_id: Label ID
### Example
octodock_do(app:"todoist", action:"delete_label", params:{label_id:"2156154810"})`,
};

/** getSkill：回傳指定 action 的操作說明，找不到回傳 null 讓 server.ts 兜底 */
function getSkill(action?: string): string | null {
  if (!action) {
    /* 回傳整體概覽，列出每個 action */
    return `todoist — Task management with projects, tasks, sections, comments, labels.

**Projects**: list_projects, get_project, create_project, update_project, delete_project
**Tasks**: list_tasks, get_task, create_task, update_task, delete_task, close_task, reopen_task, quick_add
**Sections**: list_sections, create_section, update_section, delete_section
**Comments**: list_comments, create_comment, update_comment, delete_comment
**Labels**: list_labels, create_label, update_label, delete_label

Use octodock_help(app:"todoist", action:"<action>") for parameter details.`;
  }
  return ACTION_SKILLS[action] ?? null;
}

// ── 工具定義（供 MCP 註冊用，所有 action 的 inputSchema） ────
const tools: ToolDefinition[] = [
  // 專案
  {
    name: "todoist_list_projects",
    description: "List all Todoist projects",
    inputSchema: {},
  },
  {
    name: "todoist_get_project",
    description: "Get a Todoist project",
    inputSchema: { project_id: z.string() },
  },
  {
    name: "todoist_create_project",
    description: "Create a Todoist project",
    inputSchema: {
      name: z.string(),
      color: z.string().optional(),
      parent_id: z.string().optional(),
      is_favorite: z.boolean().optional(),
    },
  },
  {
    name: "todoist_update_project",
    description: "Update a Todoist project",
    inputSchema: {
      project_id: z.string(),
      name: z.string().optional(),
      color: z.string().optional(),
      is_favorite: z.boolean().optional(),
    },
  },
  {
    name: "todoist_delete_project",
    description: "Delete a Todoist project",
    inputSchema: { project_id: z.string() },
  },
  // 任務
  {
    name: "todoist_list_tasks",
    description: "List Todoist tasks with optional filters",
    inputSchema: {
      project_id: z.string().optional(),
      section_id: z.string().optional(),
      label: z.string().optional(),
      filter: z.string().optional(),
    },
  },
  {
    name: "todoist_get_task",
    description: "Get a Todoist task",
    inputSchema: { task_id: z.string() },
  },
  {
    name: "todoist_create_task",
    description: "Create a Todoist task",
    inputSchema: {
      content: z.string(),
      description: z.string().optional(),
      project_id: z.string().optional(),
      section_id: z.string().optional(),
      parent_id: z.string().optional(),
      labels: z.array(z.string()).optional(),
      priority: z.number().min(1).max(4).optional(),
      due_string: z.string().optional(),
      due_date: z.string().optional(),
      due_datetime: z.string().optional(),
    },
  },
  {
    name: "todoist_update_task",
    description: "Update a Todoist task",
    inputSchema: {
      task_id: z.string(),
      content: z.string().optional(),
      description: z.string().optional(),
      labels: z.array(z.string()).optional(),
      priority: z.number().min(1).max(4).optional(),
      due_string: z.string().optional(),
      due_date: z.string().optional(),
    },
  },
  {
    name: "todoist_delete_task",
    description: "Delete a Todoist task",
    inputSchema: { task_id: z.string() },
  },
  {
    name: "todoist_close_task",
    description: "Complete a Todoist task",
    inputSchema: { task_id: z.string() },
  },
  {
    name: "todoist_reopen_task",
    description: "Reopen a completed Todoist task",
    inputSchema: { task_id: z.string() },
  },
  {
    name: "todoist_quick_add",
    description: "Quick add a Todoist task using natural language",
    inputSchema: { text: z.string() },
  },
  // 區段
  {
    name: "todoist_list_sections",
    description: "List sections in a Todoist project",
    inputSchema: { project_id: z.string() },
  },
  {
    name: "todoist_create_section",
    description: "Create a section in a Todoist project",
    inputSchema: {
      name: z.string(),
      project_id: z.string(),
      order: z.number().optional(),
    },
  },
  {
    name: "todoist_update_section",
    description: "Update a Todoist section",
    inputSchema: {
      section_id: z.string(),
      name: z.string(),
    },
  },
  {
    name: "todoist_delete_section",
    description: "Delete a Todoist section",
    inputSchema: { section_id: z.string() },
  },
  // 留言
  {
    name: "todoist_list_comments",
    description: "List comments on a Todoist task or project",
    inputSchema: {
      task_id: z.string().optional(),
      project_id: z.string().optional(),
    },
  },
  {
    name: "todoist_create_comment",
    description: "Add a comment to a Todoist task or project",
    inputSchema: {
      content: z.string(),
      task_id: z.string().optional(),
      project_id: z.string().optional(),
    },
  },
  {
    name: "todoist_update_comment",
    description: "Update a Todoist comment",
    inputSchema: {
      comment_id: z.string(),
      content: z.string(),
    },
  },
  {
    name: "todoist_delete_comment",
    description: "Delete a Todoist comment",
    inputSchema: { comment_id: z.string() },
  },
  // 標籤
  {
    name: "todoist_list_labels",
    description: "List all Todoist labels",
    inputSchema: {},
  },
  {
    name: "todoist_create_label",
    description: "Create a Todoist label",
    inputSchema: {
      name: z.string(),
      color: z.string().optional(),
      order: z.number().optional(),
      is_favorite: z.boolean().optional(),
    },
  },
  {
    name: "todoist_update_label",
    description: "Update a Todoist label",
    inputSchema: {
      label_id: z.string(),
      name: z.string().optional(),
      color: z.string().optional(),
    },
  },
  {
    name: "todoist_delete_label",
    description: "Delete a Todoist label",
    inputSchema: { label_id: z.string() },
  },
];

// ── 輔助函式：優先順序數字 → 人類可讀 ──────────────────────
function priorityLabel(p: number): string {
  switch (p) {
    case 4: return "P1 (Urgent)";
    case 3: return "P2 (High)";
    case 2: return "P3 (Medium)";
    default: return "P4 (Normal)";
  }
}

// ── formatResponse：將 API raw JSON 轉成 AI 友善格式 ────────
function formatResponse(action: string, data: unknown): string {
  try {
    switch (action) {
      /* ── 專案列表 ── */
      case "list_projects": {
        const projects = data as Array<{ id: string; name: string; color: string; is_favorite: boolean; parent_id: string | null }>;
        if (projects.length === 0) return "No projects found.";
        return projects.map((p) => {
          const fav = p.is_favorite ? " ★" : "";
          const sub = p.parent_id ? " (sub-project)" : "";
          return `- **${p.name}**${fav}${sub}  (ID: ${p.id})`;
        }).join("\n");
      }

      /* ── 單一專案 ── */
      case "get_project": {
        const p = data as { id: string; name: string; color: string; comment_count: number; is_favorite: boolean; url: string };
        return `**${p.name}**\nID: ${p.id}\nColor: ${p.color}\nComments: ${p.comment_count}\nFavorite: ${p.is_favorite}\nURL: ${p.url}`;
      }

      /* ── 任務列表（Markdown 表格） ── */
      case "list_tasks": {
        const tasks = data as Array<{ id: string; content: string; description: string; priority: number; due: { string: string; date: string } | null; labels: string[]; section_id: string | null; is_completed: boolean; project_name?: string; project_id?: string }>;
        if (tasks.length === 0) return "No tasks found.";
        // 標題列
        const header = "| Status | Title | Priority | Due | Project | ID |";
        const sep    = "|--------|-------|----------|-----|---------|-----|";
        const rows = tasks.map((t) => {
          const status = t.is_completed ? "Done" : "Active";
          const title = t.content || "(untitled)";
          const pri = priorityLabel(t.priority);
          const due = t.due ? (t.due.string || t.due.date) : "-";
          const project = t.project_name || (t.project_id ? `#${t.project_id}` : "-");
          return `| ${status} | ${title} | ${pri} | ${due} | ${project} | ${t.id} |`;
        });
        return [header, sep, ...rows].join("\n");
      }

      /* ── 單一任務 ── */
      case "get_task": {
        const t = data as { id: string; content: string; description: string; priority: number; due: { string: string; date: string; datetime: string } | null; labels: string[]; project_id: string; section_id: string | null; parent_id: string | null; is_completed: boolean; comment_count: number; url: string; created_at: string };
        const due = t.due ? `Due: ${t.due.string || t.due.datetime || t.due.date}` : "Due: (none)";
        const labels = t.labels.length > 0 ? `Labels: ${t.labels.join(", ")}` : "Labels: (none)";
        const desc = t.description ? `\n\n${t.description}` : "";
        return `**${t.content}**\nID: ${t.id}\nProject: ${t.project_id}\nPriority: ${priorityLabel(t.priority)}\n${due}\n${labels}\nCompleted: ${t.is_completed}\nComments: ${t.comment_count}\nURL: ${t.url}${desc}`;
      }

      /* ── 區段列表 ── */
      case "list_sections": {
        const sections = data as Array<{ id: string; name: string; order: number }>;
        if (sections.length === 0) return "No sections found.";
        return sections.map((s) => `- **${s.name}**  (ID: ${s.id})`).join("\n");
      }

      /* ── 留言列表 ── */
      case "list_comments": {
        const comments = data as Array<{ id: string; content: string; posted_at: string }>;
        if (comments.length === 0) return "No comments found.";
        return comments.map((c) => {
          const date = new Date(c.posted_at).toLocaleString();
          return `[${date}] ${c.content}  (ID: ${c.id})`;
        }).join("\n");
      }

      /* ── 標籤列表 ── */
      case "list_labels": {
        const labels = data as Array<{ id: string; name: string; color: string; is_favorite: boolean }>;
        if (labels.length === 0) return "No labels found.";
        return labels.map((l) => {
          const fav = l.is_favorite ? " ★" : "";
          return `- **${l.name}**${fav} (${l.color})  (ID: ${l.id})`;
        }).join("\n");
      }

      /* ── 建立/更新回傳 ── */
      case "create_project":
      case "update_project":
      case "create_task":
      case "update_task":
      case "create_section":
      case "update_section":
      case "create_comment":
      case "update_comment":
      case "create_label":
      case "update_label":
      case "quick_add": {
        const item = data as { id: string; content?: string; name?: string; text?: string };
        const label = item.content || item.name || item.text || "item";
        return `✓ ${action.replace("_", " ")}: "${label}" (ID: ${item.id})`;
      }

      /* ── 刪除/完成/重開 ── */
      case "delete_project":
      case "delete_task":
      case "delete_section":
      case "delete_comment":
      case "delete_label":
      case "close_task":
      case "reopen_task":
        return `✓ ${action.replace(/_/g, " ")} done.`;

      default:
        return JSON.stringify(data, null, 2);
    }
  } catch {
    return JSON.stringify(data, null, 2);
  }
}

// ── formatError：常見 Todoist API 錯誤的友善提示 ─────────────
function formatError(_action: string, errorMessage: string): string | null {
  const msg = errorMessage;

  if (msg.includes("403")) {
    return "Todoist API 權限不足。請確認 API Token 是否有效，或功能是否需要 Todoist Pro 方案 (TODOIST_FORBIDDEN)";
  }
  if (msg.includes("404")) {
    return "找不到指定的資源。請確認 ID 是否正確 (TODOIST_NOT_FOUND)";
  }
  if (msg.includes("429")) {
    return "Todoist API 請求過於頻繁，請稍後再試 (TODOIST_RATE_LIMIT)";
  }
  if (msg.includes("401")) {
    return "Todoist API Token 無效或已過期。請到 app.todoist.com/prefs/integrations 重新取得 (TODOIST_UNAUTHORIZED)";
  }
  return null;
}

// ── execute：實際 API 呼叫邏輯 ──────────────────────────────
async function execute(
  toolName: string,
  params: Record<string, unknown>,
  token: string,
): Promise<ToolResult> {
  /** 快速建構 JSON 回應 */
  const json = (data: unknown): ToolResult => ({
    content: [{ type: "text", text: JSON.stringify(data) }],
  });

  switch (toolName) {
    // ════════════════════════════════════════════
    // 專案
    // ════════════════════════════════════════════

    case "todoist_list_projects": {
      const data = await todoistFetch("/projects", token);
      return json(data);
    }

    case "todoist_get_project": {
      const data = await todoistFetch(`/projects/${params.project_id}`, token);
      return json(data);
    }

    case "todoist_create_project": {
      const body: Record<string, unknown> = { name: params.name };
      if (params.color) body.color = params.color;
      if (params.parent_id) body.parent_id = params.parent_id;
      if (params.is_favorite !== undefined) body.is_favorite = params.is_favorite;
      const data = await todoistFetch("/projects", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return json(data);
    }

    case "todoist_update_project": {
      const body: Record<string, unknown> = {};
      if (params.name) body.name = params.name;
      if (params.color) body.color = params.color;
      if (params.is_favorite !== undefined) body.is_favorite = params.is_favorite;
      const data = await todoistFetch(`/projects/${params.project_id}`, token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return json(data);
    }

    case "todoist_delete_project": {
      const data = await todoistFetch(`/projects/${params.project_id}`, token, {
        method: "DELETE",
      });
      return json(data);
    }

    // ════════════════════════════════════════════
    // 任務
    // ════════════════════════════════════════════

    case "todoist_list_tasks": {
      /* 組合查詢參數 */
      const qp = new URLSearchParams();
      if (params.project_id) qp.set("project_id", params.project_id as string);
      if (params.section_id) qp.set("section_id", params.section_id as string);
      if (params.label) qp.set("label", params.label as string);
      if (params.filter) qp.set("filter", params.filter as string);
      const qs = qp.toString() ? `?${qp.toString()}` : "";
      const data = await todoistFetch(`/tasks${qs}`, token);
      return json(data);
    }

    case "todoist_get_task": {
      const data = await todoistFetch(`/tasks/${params.task_id}`, token);
      return json(data);
    }

    case "todoist_create_task": {
      const body: Record<string, unknown> = { content: params.content };
      /* 可選參數逐一加入 */
      for (const key of ["description", "project_id", "section_id", "parent_id", "labels", "priority", "due_string", "due_date", "due_datetime"]) {
        if (params[key] !== undefined) body[key] = params[key];
      }
      const data = await todoistFetch("/tasks", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return json(data);
    }

    case "todoist_update_task": {
      const body: Record<string, unknown> = {};
      for (const key of ["content", "description", "labels", "priority", "due_string", "due_date"]) {
        if (params[key] !== undefined) body[key] = params[key];
      }
      const data = await todoistFetch(`/tasks/${params.task_id}`, token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return json(data);
    }

    case "todoist_delete_task": {
      const data = await todoistFetch(`/tasks/${params.task_id}`, token, {
        method: "DELETE",
      });
      return json(data);
    }

    case "todoist_close_task": {
      const data = await todoistFetch(`/tasks/${params.task_id}/close`, token, {
        method: "POST",
      });
      return json(data);
    }

    case "todoist_reopen_task": {
      const data = await todoistFetch(`/tasks/${params.task_id}/reopen`, token, {
        method: "POST",
      });
      return json(data);
    }

    case "todoist_quick_add": {
      /* Quick Add 端點（v1 API：需要 meta=true 才會回傳完整結果） */
      const data = await todoistFetch("/tasks/quick_add", token, {
        method: "POST",
        body: JSON.stringify({ text: params.text, meta: true }),
      });
      return json(data);
    }

    // ════════════════════════════════════════════
    // 區段
    // ════════════════════════════════════════════

    case "todoist_list_sections": {
      const data = await todoistFetch(`/sections?project_id=${params.project_id}`, token);
      return json(data);
    }

    case "todoist_create_section": {
      const body: Record<string, unknown> = { name: params.name, project_id: params.project_id };
      if (params.order !== undefined) body.order = params.order;
      const data = await todoistFetch("/sections", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return json(data);
    }

    case "todoist_update_section": {
      const data = await todoistFetch(`/sections/${params.section_id}`, token, {
        method: "POST",
        body: JSON.stringify({ name: params.name }),
      });
      return json(data);
    }

    case "todoist_delete_section": {
      const data = await todoistFetch(`/sections/${params.section_id}`, token, {
        method: "DELETE",
      });
      return json(data);
    }

    // ════════════════════════════════════════════
    // 留言
    // ════════════════════════════════════════════

    case "todoist_list_comments": {
      const qp = new URLSearchParams();
      if (params.task_id) qp.set("task_id", params.task_id as string);
      if (params.project_id) qp.set("project_id", params.project_id as string);
      const data = await todoistFetch(`/comments?${qp.toString()}`, token);
      return json(data);
    }

    case "todoist_create_comment": {
      const body: Record<string, unknown> = { content: params.content };
      if (params.task_id) body.task_id = params.task_id;
      if (params.project_id) body.project_id = params.project_id;
      const data = await todoistFetch("/comments", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return json(data);
    }

    case "todoist_update_comment": {
      const data = await todoistFetch(`/comments/${params.comment_id}`, token, {
        method: "POST",
        body: JSON.stringify({ content: params.content }),
      });
      return json(data);
    }

    case "todoist_delete_comment": {
      const data = await todoistFetch(`/comments/${params.comment_id}`, token, {
        method: "DELETE",
      });
      return json(data);
    }

    // ════════════════════════════════════════════
    // 標籤
    // ════════════════════════════════════════════

    case "todoist_list_labels": {
      const data = await todoistFetch("/labels", token);
      return json(data);
    }

    case "todoist_create_label": {
      const body: Record<string, unknown> = { name: params.name };
      if (params.color) body.color = params.color;
      if (params.order !== undefined) body.order = params.order;
      if (params.is_favorite !== undefined) body.is_favorite = params.is_favorite;
      const data = await todoistFetch("/labels", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return json(data);
    }

    case "todoist_update_label": {
      const body: Record<string, unknown> = {};
      if (params.name) body.name = params.name;
      if (params.color) body.color = params.color;
      const data = await todoistFetch(`/labels/${params.label_id}`, token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return json(data);
    }

    case "todoist_delete_label": {
      const data = await todoistFetch(`/labels/${params.label_id}`, token, {
        method: "DELETE",
      });
      return json(data);
    }

    default:
      return { content: [{ type: "text", text: `Unknown tool: ${toolName}` }], isError: true };
  }
}

// ── Adapter 匯出 ──────────────────────────────────────────
// ── 實體擷取：從列表結果中提取名稱→ID 映射 ─────────────
/* eslint-disable @typescript-eslint/no-explicit-any */
function extractEntities(action: string, rawData: unknown): EntityInfo[] {
  const entities: EntityInfo[] = [];

  switch (action) {
    // 任務列表：提取任務內容→task ID
    case "list_tasks": {
      if (!Array.isArray(rawData)) break;
      for (const t of rawData as any[]) {
        if (t.content && t.id) {
          entities.push({ name: t.content, id: String(t.id), type: "task" });
        }
      }
      break;
    }
    // 專案列表：提取專案名稱→project ID
    case "list_projects": {
      if (!Array.isArray(rawData)) break;
      for (const p of rawData as any[]) {
        if (p.name && p.id) {
          entities.push({ name: p.name, id: String(p.id), type: "project" });
        }
      }
      break;
    }
    // 區段列表：提取區段名稱→section ID
    case "list_sections": {
      if (!Array.isArray(rawData)) break;
      for (const s of rawData as any[]) {
        if (s.name && s.id) {
          entities.push({ name: s.name, id: String(s.id), type: "section" });
        }
      }
      break;
    }
    // 標籤列表：提取標籤名稱→label ID
    case "list_labels": {
      if (!Array.isArray(rawData)) break;
      for (const l of rawData as any[]) {
        if (l.name && l.id) {
          entities.push({ name: l.name, id: String(l.id), type: "label" });
        }
      }
      break;
    }
  }

  return entities;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── 必經路徑：名稱參數宣告 ──────────────────────────────────
// 告訴 server.ts 的 validateAndResolveNames 哪些參數是「名稱」
const nameParamMap: Record<string, string> = {
  project_name: "project",   // AI 可能傳 project_name: "工作"
  project: "project",        // AI 也可能傳 project: "工作"（alias）
  label: "label",            // 標籤名稱
  section_name: "section",   // 區段名稱
  section: "section",        // 區段名稱（alias）
};

// ── 必經路徑：名稱→ID 驗證 ──────────────────────────────────
// memory 查不到時，透過 API 驗證名稱是否存在
async function validateNameParam(
  paramKey: string,
  paramValue: string,
  token: string,
): Promise<NameValidationResult | null> {
  // ── 專案名稱驗證 ──
  if (["project_name", "project"].includes(paramKey)) {
    try {
      const projects = await todoistFetch("/projects", token) as Array<{ id: string; name: string }>;
      // 精確匹配（大小寫不敏感）
      const exact = projects.find(p => p.name.toLowerCase() === paramValue.toLowerCase());
      if (exact) {
        return { confidence: "certain", resolvedId: String(exact.id), resolvedName: exact.name };
      }
      // 模糊匹配（包含關係）
      const fuzzy = projects.find(p =>
        p.name.toLowerCase().includes(paramValue.toLowerCase()) ||
        paramValue.toLowerCase().includes(p.name.toLowerCase()),
      );
      if (fuzzy) {
        return {
          confidence: "partial",
          resolvedId: String(fuzzy.id),
          resolvedName: fuzzy.name,
          warning: `Found similar project: "${fuzzy.name}"`,
          candidates: projects.map(p => ({ name: p.name, id: String(p.id) })),
        };
      }
      // 完全找不到
      return {
        confidence: "not_found",
        candidates: projects.map(p => ({ name: p.name, id: String(p.id) })),
      };
    } catch {
      return null; // API 出錯 → 不攔截
    }
  }

  // ── 標籤名稱驗證 ──
  if (paramKey === "label") {
    try {
      const labels = await todoistFetch("/labels", token) as Array<{ id: string; name: string }>;
      const exact = labels.find(l => l.name.toLowerCase() === paramValue.toLowerCase());
      if (exact) {
        return { confidence: "certain", resolvedId: String(exact.id), resolvedName: exact.name };
      }
      const fuzzy = labels.find(l =>
        l.name.toLowerCase().includes(paramValue.toLowerCase()) ||
        paramValue.toLowerCase().includes(l.name.toLowerCase()),
      );
      if (fuzzy) {
        return {
          confidence: "partial",
          resolvedId: String(fuzzy.id),
          resolvedName: fuzzy.name,
          warning: `Found similar label: "${fuzzy.name}"`,
          candidates: labels.map(l => ({ name: l.name, id: String(l.id) })),
        };
      }
      return {
        confidence: "not_found",
        candidates: labels.map(l => ({ name: l.name, id: String(l.id) })),
      };
    } catch {
      return null;
    }
  }

  // ── 區段名稱驗證 ──
  if (["section_name", "section"].includes(paramKey)) {
    try {
      const sections = await todoistFetch("/sections", token) as Array<{ id: string; name: string }>;
      const exact = sections.find(s => s.name.toLowerCase() === paramValue.toLowerCase());
      if (exact) {
        return { confidence: "certain", resolvedId: String(exact.id), resolvedName: exact.name };
      }
      return {
        confidence: "not_found",
        candidates: sections.map(s => ({ name: s.name, id: String(s.id) })),
      };
    } catch {
      return null;
    }
  }

  return null; // 不處理的參數
}

// ── 必經路徑：Per-App 專屬攔截 ──────────────────────────────
// 超出名稱驗證範圍的 Todoist 特有檢查
async function preValidate(
  action: string,
  params: Record<string, unknown>,
  _token: string,
): Promise<DoResult | null> {
  // 日期格式自動修正：如果 due_date 不是自然語言且格式不對，提醒
  if (action === "create_task" || action === "update_task") {
    const dueDate = params.due_date ?? params.due_string;
    if (typeof dueDate === "string" && dueDate.length > 0) {
      // Todoist 的 due_string 支援自然語言（"tomorrow", "every monday"）
      // 但 due_date 只接受 YYYY-MM-DD 格式
      // 如果 AI 把自然語言放到 due_date 裡，自動轉到 due_string
      if (params.due_date && !/^\d{4}-\d{2}-\d{2}/.test(dueDate)) {
        params.due_string = dueDate;
        delete params.due_date;
      }
    }
  }
  return null; // 不攔截，繼續執行
}

export const todoistAdapter: AppAdapter = {
  name: "todoist",
  displayName: { zh: "Todoist", en: "Todoist" },
  icon: "todoist",
  authType: "oauth2",
  authConfig,
  tools,
  actionMap,
  getSkill,
  formatResponse,
  formatError,
  extractEntities,
  execute,
  nameParamMap,
  validateNameParam,
  preValidate,
};
