/**
 * Google Drive Adapter
 * 提供 Google Drive 檔案搜尋、取得、下載、建立、更新、刪除、分享、複製、移動、建立資料夾、匯出、權限列表、新增留言功能
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
  scopes: [
    "https://www.googleapis.com/auth/drive.file",
    "https://www.googleapis.com/auth/drive.readonly",
  ],
  authMethod: "post",
  extraParams: { access_type: "offline", prompt: "consent" },
};

// ── API 基礎設定 ───────────────────────────────────────────
const DRIVE_API = "https://www.googleapis.com/drive/v3";

// ── 輔助函式：Drive API 請求封裝 ──────────────────────────
async function driveFetch(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<unknown> {
  const res = await fetch(`${DRIVE_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers as object),
    },
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error(
      `Google Drive API error (${res.status}): ${(error as { error: { message: string } }).error.message} (GDRIVE_API_ERROR)`,
    );
  }
  // DELETE 回傳 204 No Content
  if (res.status === 204) return { success: true };
  return res.json();
}

// ── 輔助函式：下載文字檔案內容 ─────────────────────────────
async function driveDownloadText(
  fileId: string,
  token: string,
): Promise<string> {
  const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error(
      `Google Drive download error: ${(error as { error: { message: string } }).error.message} (GDRIVE_DOWNLOAD_ERROR)`,
    );
  }
  return res.text();
}

// ── 輔助函式：多部分上傳（建立檔案含內容）──────────────────
async function driveMultipartUpload(
  metadata: Record<string, unknown>,
  content: string,
  mimeType: string,
  token: string,
): Promise<unknown> {
  const boundary = "octodock_boundary_" + Date.now();
  const body = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${mimeType}`,
    "",
    content,
    `--${boundary}--`,
  ].join("\r\n");

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error(
      `Google Drive upload error: ${(error as { error: { message: string } }).error.message} (GDRIVE_UPLOAD_ERROR)`,
    );
  }
  return res.json();
}

// ── 輔助函式：檔案大小格式化（bytes → KB/MB/GB）──────────
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

// ── 輔助函式：MIME 類型轉可讀名稱 ─────────────────────────
function mimeToLabel(mimeType: string): string {
  const map: Record<string, string> = {
    "application/vnd.google-apps.folder": "Folder",
    "application/vnd.google-apps.document": "Google Doc",
    "application/vnd.google-apps.spreadsheet": "Google Sheet",
    "application/vnd.google-apps.presentation": "Google Slides",
    "application/vnd.google-apps.form": "Google Form",
    "application/pdf": "PDF",
    "text/plain": "Text",
    "text/csv": "CSV",
    "image/png": "PNG Image",
    "image/jpeg": "JPEG Image",
    "application/json": "JSON",
  };
  return map[mimeType] ?? mimeType;
}

// ── do+help 架構：動作對照表 ──────────────────────────────
// 將自然語言動作名稱對應到 MCP 工具名稱
const actionMap: Record<string, string> = {
  search: "gdrive_search",
  get_file: "gdrive_get_file",
  download: "gdrive_download",
  create: "gdrive_create",
  update: "gdrive_update",
  delete: "gdrive_delete",
  share: "gdrive_share",
  copy: "gdrive_copy",
  move: "gdrive_move",
  create_folder: "gdrive_create_folder",
  export: "gdrive_export",
  list_permissions: "gdrive_list_permissions",
  add_comment: "gdrive_add_comment",
  list_comments: "gdrive_list_comments",
  delete_permission: "gdrive_delete_permission",
  empty_trash: "gdrive_empty_trash",
  read_pdf: "gdrive_read_pdf",
};

// ── do+help 架構：技能描述（供 agent 理解可用操作）────────
const ACTION_SKILLS: Record<string, string> = {
  search: `## google_drive.search
Search files in Google Drive by name, type, or other criteria using Drive query syntax.
### Parameters
  query: Drive search query (e.g. "name contains 'report'", "mimeType='application/pdf'")
  max_results (optional): Max results (default 10, max 100)
### Example
octodock_do(app:"google_drive", action:"search", params:{query:"name contains 'quarterly report'"})
octodock_do(app:"google_drive", action:"search", params:{query:"mimeType='application/vnd.google-apps.spreadsheet'", max_results:5})`,

  get_file: `## google_drive.get_file
Get detailed metadata for a specific file by its ID.
### Parameters
  file_id: Google Drive file ID
### Example
octodock_do(app:"google_drive", action:"get_file", params:{file_id:"1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"})`,

  download: `## google_drive.download
Download and read the text content of a file. Only works for text-based files (txt, csv, json, etc.).
### Parameters
  file_id: Google Drive file ID
### Example
octodock_do(app:"google_drive", action:"download", params:{file_id:"1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms"})`,

  create: `## google_drive.create
Create a new file in Google Drive with optional content.
### Parameters
  name: File name (e.g. "meeting-notes.txt")
  content (optional): File content as plain text
  mime_type (optional): MIME type (default "text/plain")
  parent_id (optional): Parent folder ID (default root)
### Example
octodock_do(app:"google_drive", action:"create", params:{name:"notes.txt", content:"Meeting notes for March 14..."})
octodock_do(app:"google_drive", action:"create", params:{name:"Reports", mime_type:"application/vnd.google-apps.folder"})`,

  update: `## google_drive.update
Update file metadata (name, description). Does not update file content.
### Parameters
  file_id: Google Drive file ID
  name (optional): New file name
  description (optional): New file description
### Example
octodock_do(app:"google_drive", action:"update", params:{file_id:"1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms", name:"Q1-Report-Final.pdf"})`,

  delete: `## google_drive.delete
Delete a file in Google Drive. Default: move to trash. Set permanent=true for permanent deletion.
### Parameters
  file_id: Google Drive file ID
  permanent (optional): true = permanently delete (cannot be undone). Default: false (move to trash)
### Example
octodock_do(app:"google_drive", action:"delete", params:{file_id:"1Bxi..."})
octodock_do(app:"google_drive", action:"delete", params:{file_id:"1Bxi...", permanent:true})`,

  empty_trash: `## google_drive.empty_trash ⚠️
Permanently delete ALL files in Google Drive trash. Cannot be undone.
### Parameters
  (none)
### Example
octodock_do(app:"google_drive", action:"empty_trash", params:{})`,

  share: `## google_drive.share
Share a file with a specific email or make it accessible to anyone with the link.
### Parameters
  file_id: Google Drive file ID
  role: Permission role ("reader", "writer", "commenter")
  type: Share type ("user", "anyone")
  email (optional): Email address (required when type is "user")
### Example
octodock_do(app:"google_drive", action:"share", params:{file_id:"1Bxi...", role:"reader", type:"user", email:"colleague@company.com"})
octodock_do(app:"google_drive", action:"share", params:{file_id:"1Bxi...", role:"reader", type:"anyone"})`,

  copy: `## google_drive.copy
Copy a file in Google Drive, optionally with a new name.
### Parameters
  file_id: Google Drive file ID
  name (optional): New name for the copied file
### Example
octodock_do(app:"google_drive", action:"copy", params:{file_id:"1Bxi...", name:"Report Copy"})`,

  move: `## google_drive.move
Move a file to a different folder in Google Drive.
### Parameters
  file_id: Google Drive file ID
  new_parent_id: Destination folder ID
### Example
octodock_do(app:"google_drive", action:"move", params:{file_id:"1Bxi...", new_parent_id:"0BxiFolder..."})`,

  create_folder: `## google_drive.create_folder
Create a new folder in Google Drive.
### Parameters
  name: Folder name
  parent_id (optional): Parent folder ID (default: root)
### Example
octodock_do(app:"google_drive", action:"create_folder", params:{name:"Project Files"})
octodock_do(app:"google_drive", action:"create_folder", params:{name:"Subfolder", parent_id:"0BxiFolder..."})`,

  export: `## google_drive.export
Export a Google Workspace file (Doc, Sheet, Slides) to a downloadable format.
### Parameters
  file_id: Google Drive file ID
  format: Export format ("pdf", "docx", "txt", "csv")
### Example
octodock_do(app:"google_drive", action:"export", params:{file_id:"1Bxi...", format:"pdf"})
octodock_do(app:"google_drive", action:"export", params:{file_id:"1Bxi...", format:"csv"})`,

  list_permissions: `## google_drive.list_permissions
List all permissions (sharing settings) for a file in Google Drive.
### Parameters
  file_id: Google Drive file ID
### Example
octodock_do(app:"google_drive", action:"list_permissions", params:{file_id:"1Bxi..."})`,

  add_comment: `## google_drive.add_comment
Add a comment to a file in Google Drive.
### Parameters
  file_id: Google Drive file ID
  content: Comment text
### Example
octodock_do(app:"google_drive", action:"add_comment", params:{file_id:"1Bxi...", content:"Please review this section."})`,

  list_comments: `## google_drive.list_comments
List all comments on a file in Google Drive.
### Parameters
  file_id: Google Drive file ID
### Example
octodock_do(app:"google_drive", action:"list_comments", params:{file_id:"1Bxi..."})`,

  delete_permission: `## google_drive.delete_permission
Remove a specific permission (sharing) from a file.
### Parameters
  file_id: Google Drive file ID
  permission_id: Permission ID (from list_permissions)
### Example
octodock_do(app:"google_drive", action:"delete_permission", params:{file_id:"1Bxi...", permission_id:"12345"})`,

  read_pdf: `## google_drive.read_pdf
Download a PDF file from Google Drive and extract its text content. Returns plain text.
### Parameters
  file_id: Google Drive file ID of the PDF
### Example
octodock_do(app:"google_drive", action:"read_pdf", params:{file_id:"1a6nCHFdxzjMWGmDcuzOcdzPgd6sLdH1c"})`,
};

function getSkill(action?: string): string | null {
  if (action && ACTION_SKILLS[action]) return ACTION_SKILLS[action];
  if (action) return null; // ACTION_SKILLS 沒有的 action → 回傳 null 讓 server.ts fallback 用 actionMap 自動查
  return `google_drive actions (${Object.keys(actionMap).length}):
  search(query, max_results?) — search files by name/type (Drive query syntax)
  get_file(file_id) — get file metadata
  download(file_id) — download text file content
  create(name, content?, mime_type?, parent_id?) — create file or folder
  update(file_id, name?, description?) — update file metadata
  delete(file_id, permanent?) — delete file (default: trash, permanent=true: permanent delete)
  empty_trash() — permanently delete all trashed files
  share(file_id, role, type, email?) — share file with user or anyone
  copy(file_id, name?) — copy a file
  move(file_id, new_parent_id) — move file to another folder
  create_folder(name, parent_id?) — create a new folder
  export(file_id, format) — export Google Workspace file to pdf/docx/txt/csv
  list_permissions(file_id) — list file permissions
  add_comment(file_id, content) — add a comment to a file
  list_comments(file_id) — list all comments on a file
  delete_permission(file_id, permission_id) — remove a sharing permission
  read_pdf(file_id) — download PDF and extract text content
Use octodock_help(app:"google_drive", action:"ACTION") for detailed params + example.`;
}

// ── do+help 架構：格式化回應（將原始資料轉為簡潔文字）────
/* eslint-disable @typescript-eslint/no-explicit-any */
function formatResponse(action: string, rawData: unknown): string {
  if (typeof rawData !== "object" || rawData === null) return String(rawData);

  switch (action) {
    // 搜尋結果：檔案清單摘要
    // F1: rawData 可能是 { files: [...], nextPageToken } 或直接是陣列
    case "search": {
      const data = rawData as Record<string, unknown>;
      const files = Array.isArray(rawData) ? rawData : (data.files as any[]);
      if (!files || files.length === 0) return "No files found.";
      let result = files
        .map(
          (f: any) =>
            `- ${f.name} (${mimeToLabel(f.mimeType)}) id:${f.id} url:${f.webViewLink ?? "N/A"}`,
        )
        .join("\n");
      if (data.nextPageToken) result += `\n\n_More results available. Use page_token: "${data.nextPageToken}" to see next page._`;
      return result;
    }
    // 取得檔案：詳細資訊
    case "get_file": {
      const f = rawData as any;
      return [
        `Name: ${f.name}`,
        `Type: ${mimeToLabel(f.mimeType)}`,
        `ID: ${f.id}`,
        // Google 原生檔案（Docs/Sheets/Slides）不回傳 size；一般檔案 size 是字串
        `Size: ${f.size && Number(f.size) > 0 ? formatFileSize(Number(f.size)) : f.mimeType?.startsWith("application/vnd.google-apps") ? "(Google native)" : "N/A"}`,
        `Created: ${f.createdTime ?? "N/A"}`,
        `Modified: ${f.modifiedTime ?? "N/A"}`,
        `URL: ${f.webViewLink ?? "N/A"}`,
        f.description ? `Description: ${f.description}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    }
    // 下載結果：直接回傳文字內容
    case "download": {
      const d = rawData as any;
      return d.content ?? String(rawData);
    }
    // 建立/更新/刪除/分享：完成確認
    case "create": {
      const c = rawData as any;
      return `Created: ${c.name} (${mimeToLabel(c.mimeType)})\nID: ${c.id}\nURL: ${c.webViewLink ?? "N/A"}`;
    }
    case "update": {
      const u = rawData as any;
      return `Updated: ${u.name}\nID: ${u.id}`;
    }
    case "delete": {
      const del = rawData as { action?: string };
      return del.action === "permanently_deleted" ? "File permanently deleted." : "File moved to trash.";
    }
    case "empty_trash": {
      return "All trashed files permanently deleted.";
    }
    case "share": {
      const s = rawData as any;
      return `Shared. Permission ID: ${s.id}, Role: ${s.role}, Type: ${s.type}`;
    }
    // 複製檔案：確認副本資訊
    case "copy": {
      const cp = rawData as any;
      return `Copied: ${cp.name}\nID: ${cp.id}\nURL: ${cp.webViewLink ?? "N/A"}`;
    }
    // 移動檔案：確認新位置
    case "move": {
      const mv = rawData as any;
      return `Moved: ${mv.name}\nID: ${mv.id}\nNew parents: ${(mv.parents ?? []).join(", ")}`;
    }
    // 建立資料夾：確認資料夾資訊
    case "create_folder": {
      const cf = rawData as any;
      return `Folder created: ${cf.name}\nID: ${cf.id}\nURL: ${cf.webViewLink ?? "N/A"}`;
    }
    // 匯出檔案：回傳匯出結果
    case "export": {
      const ex = rawData as any;
      if (ex.content) return ex.content;
      return ex.message ?? `Export completed (${ex.format}).`;
    }
    // 列出權限：權限清單
    case "list_permissions": {
      const lp = rawData as any;
      const perms = lp.permissions ?? [];
      if (perms.length === 0) return "No permissions found.";
      return perms
        .map((p: any) => `- ${p.emailAddress ?? p.type} (${p.role}) id:${p.id}`)
        .join("\n");
    }
    // 新增留言：確認留言
    case "add_comment": {
      const ac = rawData as any;
      return `Comment added by ${ac.author?.displayName ?? "unknown"}: "${ac.content}"`;
    }
    case "list_comments": {
      const comments = (rawData as any).comments;
      if (!Array.isArray(comments) || comments.length === 0) return "No comments found.";
      return comments.map((c: any) =>
        `- **${c.author?.displayName ?? "unknown"}** (${c.createdTime ?? ""}): ${c.content}${c.resolved ? " [resolved]" : ""}`
      ).join("\n");
    }
    case "delete_permission":
      return `Done. Permission removed.`;
    // PDF 文字提取：直接回傳文字內容
    case "read_pdf": {
      const d = rawData as any;
      return d.text ?? d.content ?? String(rawData);
    }
    default:
      return JSON.stringify(rawData, null, 2);
  }
}

// ── 智慧錯誤引導 ──────────────────────────────────────────
function formatError(action: string, errorMessage: string): string | null {
  if (errorMessage.includes("File not found")) {
    return `「找不到檔案 (FILE_NOT_FOUND)」— 請確認 file_id 正確，且該檔案已授權給此應用程式存取。`;
  }
  if (errorMessage.includes("insufficientPermissions") || errorMessage.includes("403")) {
    return `「權限不足 (INSUFFICIENT_PERMISSIONS)」— 請確認已授權 Google Drive 存取權限，並重新連結帳號。`;
  }
  if (errorMessage.includes("notFound") && action === "share") {
    return `「檔案不存在或無權分享 (SHARE_NOT_FOUND)」— 請確認您是檔案擁有者或有管理者權限。`;
  }
  // Drive search 用自然語言會失敗，需要提示正確語法
  if (errorMessage.includes("Invalid Value") || errorMessage.includes("invalid_query") || errorMessage.includes("400")) {
    return `「查詢格式錯誤 (GDRIVE_INVALID_QUERY)」— Google Drive 需要使用 query 語法，不支援自然語言搜尋。\n範例：\n- name contains '報告'\n- mimeType='application/pdf'\n- modifiedTime > '2026-01-01'\n- name contains 'meeting' and mimeType='application/vnd.google-apps.document'`;
  }
  return null;
}

// ── MCP 工具定義 ──────────────────────────────────────────
const tools: ToolDefinition[] = [
  {
    name: "gdrive_search",
    description:
      "Search files in user's Google Drive. Uses Drive query syntax (e.g., \"name contains 'report'\", \"mimeType='application/pdf'\"). Returns a list of matching files with metadata.",
    inputSchema: {
      query: z
        .string()
        .describe("Drive search query (e.g. \"name contains 'report'\", \"mimeType='application/pdf'\")"),
      max_results: z
        .number()
        .optional()
        .describe("Maximum number of results (default 10, max 100)"),
    },
  },
  {
    name: "gdrive_get_file",
    description:
      "Get detailed metadata for a specific file in Google Drive by its ID. Returns name, type, size, dates, and sharing info.",
    inputSchema: {
      file_id: z.string().describe("Google Drive file ID"),
    },
  },
  {
    name: "gdrive_download",
    description:
      "Download and read the text content of a file from Google Drive. Only works for text-based files (txt, csv, json, etc.). Not suitable for binary files.",
    inputSchema: {
      file_id: z.string().describe("Google Drive file ID"),
    },
  },
  {
    name: "gdrive_create",
    description:
      "Create a new file or folder in Google Drive. Supports plain text content upload. For folders, set mime_type to 'application/vnd.google-apps.folder'.",
    inputSchema: {
      name: z.string().describe("File or folder name"),
      content: z
        .string()
        .optional()
        .describe("File content as plain text (not needed for folders)"),
      mime_type: z
        .string()
        .optional()
        .describe("MIME type (default 'text/plain', use 'application/vnd.google-apps.folder' for folders)"),
      parent_id: z
        .string()
        .optional()
        .describe("Parent folder ID (default: root)"),
    },
  },
  {
    name: "gdrive_update",
    description:
      "Update file metadata (name and/or description) in Google Drive. Does not modify file content.",
    inputSchema: {
      file_id: z.string().describe("Google Drive file ID"),
      name: z.string().optional().describe("New file name"),
      description: z.string().optional().describe("New file description"),
    },
  },
  {
    name: "gdrive_delete",
    description:
      "Delete a file in Google Drive. Default: move to trash (recoverable 30 days). Set permanent=true for permanent deletion.",
    inputSchema: {
      file_id: z.string().describe("Google Drive file ID"),
      permanent: z.boolean().optional().describe("Set true to permanently delete (cannot be undone). Default: false (move to trash)"),
    },
  },
  {
    name: "gdrive_empty_trash",
    description:
      "Permanently delete ALL files in Google Drive trash. Cannot be undone.",
    inputSchema: {},
  },
  {
    name: "gdrive_read_pdf",
    description:
      "Download a PDF file from Google Drive and extract its text content. Returns plain text.",
    inputSchema: {
      file_id: z.string().describe("Google Drive file ID of the PDF"),
    },
  },
  {
    name: "gdrive_share",
    description:
      "Share a file in Google Drive with a specific user by email or make it accessible to anyone with the link.",
    inputSchema: {
      file_id: z.string().describe("Google Drive file ID"),
      role: z
        .enum(["reader", "writer", "commenter"])
        .describe("Permission role"),
      type: z
        .enum(["user", "anyone"])
        .describe("Share type: 'user' for specific email, 'anyone' for link sharing"),
      email: z
        .string()
        .optional()
        .describe("Recipient email address (required when type is 'user')"),
    },
  },
  // 複製檔案
  {
    name: "gdrive_copy",
    description:
      "Copy a file in Google Drive, optionally giving the copy a new name.",
    inputSchema: {
      file_id: z.string().describe("Google Drive file ID"),
      name: z.string().optional().describe("New name for the copied file"),
    },
  },
  // 移動檔案到其他資料夾
  {
    name: "gdrive_move",
    description:
      "Move a file to a different folder in Google Drive by updating its parents.",
    inputSchema: {
      file_id: z.string().describe("Google Drive file ID"),
      new_parent_id: z.string().describe("Destination folder ID"),
    },
  },
  // 建立資料夾
  {
    name: "gdrive_create_folder",
    description:
      "Create a new folder in Google Drive.",
    inputSchema: {
      name: z.string().describe("Folder name"),
      parent_id: z.string().optional().describe("Parent folder ID (default: root)"),
    },
  },
  // 匯出 Google Workspace 檔案
  {
    name: "gdrive_export",
    description:
      "Export a Google Workspace file (Doc, Sheet, Slides) to a specified format (pdf, docx, txt, csv). Returns content for text formats or a confirmation for binary formats.",
    inputSchema: {
      file_id: z.string().describe("Google Drive file ID"),
      format: z
        .enum(["pdf", "docx", "txt", "csv"])
        .describe("Export format: pdf, docx, txt, or csv"),
    },
  },
  // 列出檔案權限
  {
    name: "gdrive_list_permissions",
    description:
      "List all permissions (sharing settings) for a file in Google Drive, including role, type, and email.",
    inputSchema: {
      file_id: z.string().describe("Google Drive file ID"),
    },
  },
  // 新增留言
  {
    name: "gdrive_add_comment",
    description:
      "Add a comment to a file in Google Drive.",
    inputSchema: {
      file_id: z.string().describe("Google Drive file ID"),
      content: z.string().describe("Comment text"),
    },
  },
  {
    name: "gdrive_list_comments",
    description:
      "List all comments on a file in Google Drive. Returns author, content, creation time, and resolved status.",
    inputSchema: {
      file_id: z.string().describe("Google Drive file ID"),
    },
  },
  {
    name: "gdrive_delete_permission",
    description:
      "Remove a specific sharing permission from a file. Use list_permissions first to find the permission ID.",
    inputSchema: {
      file_id: z.string().describe("Google Drive file ID"),
      permission_id: z.string().describe("Permission ID (from list_permissions)"),
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
    // 搜尋檔案：使用 Drive 查詢語法，回傳檔案清單
    // F1: 支援 page_token 分頁
    case "gdrive_search": {
      const maxResults = Math.min((params.max_results as number) ?? 10, 100);
      const query = encodeURIComponent(params.query as string);
      const fields = encodeURIComponent(
        "nextPageToken,files(id,name,mimeType,webViewLink,modifiedTime,size)",
      );
      const pageToken = params.page_token ? `&pageToken=${encodeURIComponent(params.page_token as string)}` : "";
      const result = (await driveFetch(
        `/files?q=${query}&fields=${fields}&pageSize=${maxResults}&orderBy=modifiedTime desc${pageToken}`,
        token,
      )) as { files?: Array<Record<string, unknown>>; nextPageToken?: string };

      const response: Record<string, unknown> = { files: result.files ?? [] };
      if (result.nextPageToken) response.nextPageToken = result.nextPageToken;
      return {
        content: [
          { type: "text", text: JSON.stringify(response, null, 2) },
        ],
      };
    }

    // 取得檔案資訊：回傳完整中繼資料
    case "gdrive_get_file": {
      const fields = encodeURIComponent(
        "id,name,mimeType,size,createdTime,modifiedTime,webViewLink,description,owners,shared",
      );
      const file = await driveFetch(
        `/files/${params.file_id}?fields=${fields}`,
        token,
      );
      return {
        content: [
          { type: "text", text: JSON.stringify(file, null, 2) },
        ],
      };
    }

    // 下載檔案：僅支援文字類型檔案
    case "gdrive_download": {
      const text = await driveDownloadText(params.file_id as string, token);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ file_id: params.file_id, content: text }, null, 2),
          },
        ],
      };
    }

    // 建立檔案：支援資料夾和文字檔案（multipart upload）
    case "gdrive_create": {
      const mimeType = (params.mime_type as string) ?? "text/plain";
      const metadata: Record<string, unknown> = { name: params.name };

      // 如果指定了父資料夾
      if (params.parent_id) {
        metadata.parents = [params.parent_id];
      }

      // 資料夾不需要上傳內容
      if (mimeType === "application/vnd.google-apps.folder") {
        metadata.mimeType = mimeType;
        const result = await driveFetch(
          "/files?fields=id,name,mimeType,webViewLink",
          token,
          {
            method: "POST",
            body: JSON.stringify(metadata),
          },
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      // 文字檔案使用 multipart upload
      const content = (params.content as string) ?? "";
      const result = await driveMultipartUpload(metadata, content, mimeType, token);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 更新檔案：修改名稱或描述等中繼資料
    case "gdrive_update": {
      const body: Record<string, unknown> = {};
      if (params.name) body.name = params.name;
      if (params.description) body.description = params.description;

      const result = await driveFetch(
        `/files/${params.file_id}?fields=id,name,mimeType,webViewLink,description`,
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

    // 刪除檔案：預設移至垃圾桶，permanent=true 永久刪除
    case "gdrive_delete": {
      if (params.permanent) {
        // 永久刪除：DELETE /files/{fileId}（不可復原）
        await driveFetch(
          `/files/${params.file_id}`,
          token,
          { method: "DELETE" },
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ success: true, file_id: params.file_id, action: "permanently_deleted" }, null, 2),
            },
          ],
        };
      }
      // 預設：移至垃圾桶（30 天內可復原）
      await driveFetch(
        `/files/${params.file_id}`,
        token,
        {
          method: "PATCH",
          body: JSON.stringify({ trashed: true }),
        },
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, file_id: params.file_id, action: "moved_to_trash" }, null, 2),
          },
        ],
      };
    }

    // 讀取 PDF：下載 PDF binary 並提取文字內容
    case "gdrive_read_pdf": {
      // 1. 下載 PDF binary
      const dlRes = await fetch(
        `${DRIVE_API}/files/${params.file_id}?alt=media`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!dlRes.ok) {
        throw new Error(
          `Failed to download PDF: ${dlRes.status} ${dlRes.statusText} (GDRIVE_DOWNLOAD_ERROR)`,
        );
      }
      const buffer = Buffer.from(await dlRes.arrayBuffer());

      // 2. 用 pdf-parse 提取文字
      const pdfParse = (await import("pdf-parse")).default;
      const pdfData = await pdfParse(buffer);

      // 3. 掃描型 PDF（無文字層）回傳提示
      if (!pdfData.text || pdfData.text.trim().length === 0) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              text: "",
              message: "PDF has no extractable text (may be scanned image). Try uploading to Google Drive as Google Doc format for OCR.",
            }),
          }],
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify({ text: pdfData.text, pages: pdfData.numpages }) }],
      };
    }

    // 清空垃圾桶：一次刪除所有已移至垃圾桶的檔案（不可復原）
    case "gdrive_empty_trash": {
      await driveFetch(
        "/files/trash",
        token,
        { method: "DELETE" },
      );
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, action: "trash_emptied" }, null, 2),
          },
        ],
      };
    }

    // 分享檔案：透過 permissions API 設定權限
    case "gdrive_share": {
      const permission: Record<string, unknown> = {
        role: params.role,
        type: params.type,
      };
      if (params.type === "user" && params.email) {
        permission.emailAddress = params.email;
      }

      const result = await driveFetch(
        `/files/${params.file_id}/permissions`,
        token,
        {
          method: "POST",
          body: JSON.stringify(permission),
        },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 複製檔案：POST /files/{fileId}/copy
    case "gdrive_copy": {
      const body: Record<string, unknown> = {};
      if (params.name) body.name = params.name;

      const result = await driveFetch(
        `/files/${params.file_id}/copy?fields=id,name,mimeType,webViewLink`,
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

    // 移動檔案：先取得目前父資料夾，再 PATCH 搬移
    case "gdrive_move": {
      // 取得檔案目前的 parents
      const file = (await driveFetch(
        `/files/${params.file_id}?fields=parents`,
        token,
      )) as { parents?: string[] };
      const oldParents = (file.parents ?? []).join(",");

      const result = await driveFetch(
        `/files/${params.file_id}?addParents=${encodeURIComponent(params.new_parent_id as string)}&removeParents=${encodeURIComponent(oldParents)}&fields=id,name,parents`,
        token,
        {
          method: "PATCH",
          body: JSON.stringify({}),
        },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 建立資料夾：POST /files，mimeType 為 folder
    case "gdrive_create_folder": {
      const metadata: Record<string, unknown> = {
        name: params.name,
        mimeType: "application/vnd.google-apps.folder",
      };
      if (params.parent_id) {
        metadata.parents = [params.parent_id];
      }

      const result = await driveFetch(
        "/files?fields=id,name,mimeType,webViewLink",
        token,
        {
          method: "POST",
          body: JSON.stringify(metadata),
        },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 匯出檔案：GET /files/{fileId}/export，將 Google Workspace 檔案轉為指定格式
    case "gdrive_export": {
      const formatMimeMap: Record<string, string> = {
        pdf: "application/pdf",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        txt: "text/plain",
        csv: "text/csv",
      };
      const format = params.format as string;
      const exportMime = formatMimeMap[format];

      const res = await fetch(
        `${DRIVE_API}/files/${params.file_id}/export?mimeType=${encodeURIComponent(exportMime)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: { message: res.statusText } }));
        throw new Error(
          `Google Drive export error: ${(error as { error: { message: string } }).error.message} (GDRIVE_EXPORT_ERROR)`,
        );
      }

      // 文字格式直接回傳內容，二進位格式回傳完成訊息
      if (format === "txt" || format === "csv") {
        const textContent = await res.text();
        return {
          content: [{ type: "text", text: JSON.stringify({ file_id: params.file_id, format, content: textContent }, null, 2) }],
        };
      }

      return {
        content: [{ type: "text", text: JSON.stringify({ file_id: params.file_id, format, message: `Done. Export completed as ${format}.` }, null, 2) }],
      };
    }

    // 列出檔案權限：GET /files/{fileId}/permissions
    case "gdrive_list_permissions": {
      const result = await driveFetch(
        `/files/${params.file_id}/permissions?fields=permissions(id,type,role,emailAddress)`,
        token,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 新增留言：POST /files/{fileId}/comments
    case "gdrive_add_comment": {
      const result = await driveFetch(
        `/files/${params.file_id}/comments?fields=*`,
        token,
        {
          method: "POST",
          body: JSON.stringify({ content: params.content }),
        },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 列出檔案上的所有留言
    case "gdrive_list_comments": {
      const result = await driveFetch(
        `/files/${params.file_id}/comments?fields=comments(id,author,content,createdTime,resolved)`,
        token,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 移除權限（取消分享）
    case "gdrive_delete_permission": {
      await driveFetch(
        `/files/${params.file_id}/permissions/${params.permission_id}`,
        token,
        { method: "DELETE" },
      );
      return {
        content: [{ type: "text", text: JSON.stringify({ deleted: true }) }],
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
async function refreshGDriveToken(refreshToken: string): Promise<TokenSet> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
    }).toString(),
  });

  if (!res.ok) {
    throw new Error(`Google Drive token refresh failed (GDRIVE_REFRESH_FAILED)`);
  }

  const data = await res.json();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? refreshToken, // Google 不一定回傳新的 refresh_token
    expires_in: data.expires_in,
  };
}

// ── Adapter 匯出 ─────────────────────────────────────────
export const googleDriveAdapter: AppAdapter = {
  name: "google_drive",
  displayName: { zh: "Google Drive", en: "Google Drive" },
  icon: "google-drive",
  authType: "oauth2",
  authConfig,
  actionMap,
  getSkill,
  formatResponse,
  formatError,
  tools,
  execute,
  refreshToken: refreshGDriveToken,
};
