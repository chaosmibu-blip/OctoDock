/**
 * Canva Connect API Adapter
 * 提供設計管理（列表、建立、取得）、匯出（PDF/PNG/JPG）、素材管理、資料夾、留言、用戶資料功能
 * API 文件：https://www.canva.dev/docs/connect/
 * Base URL：https://api.canva.com/rest/v1
 * 認證：OAuth 2.0（Basic Auth token exchange）
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
  authorizeUrl: "https://www.canva.com/api/oauth/authorize",
  tokenUrl: "https://api.canva.com/rest/v1/oauth/token",
  scopes: [
    "asset:read",
    "asset:write",
    "design:content:read",
    "design:content:write",
    "design:meta:read",
    "comment:read",
    "comment:write",
    "folder:read",
    "folder:write",
    "profile:read",
  ],
  authMethod: "basic", // Canva 用 HTTP Basic Auth 交換 token
  extraParams: { code_challenge_method: "S256" },
};

// ── API 基礎設定 ───────────────────────────────────────────
const CANVA_API = "https://api.canva.com/rest/v1";

// ── 輔助函式：Canva API 請求封裝 ──────────────────────────
async function canvaFetch(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<unknown> {
  const res = await fetch(`${CANVA_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers as object),
    },
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    const msg = (error as { message?: string; error?: { message?: string } }).message
      ?? (error as { error?: { message?: string } }).error?.message
      ?? res.statusText;
    throw new Error(`Canva API error: ${msg} (CANVA_API_ERROR)`);
  }
  // DELETE 回傳 204 No Content
  if (res.status === 204) return { success: true };
  return res.json();
}

// ── actionMap：簡化 action 名稱 → 內部工具名稱 ─────────────
const actionMap: Record<string, string> = {
  // 設計管理
  list_designs: "canva_list_designs",
  get_design: "canva_get_design",
  create_design: "canva_create_design",
  // 匯出
  export_design: "canva_export_design",
  get_export: "canva_get_export",
  // 素材管理
  upload_asset: "canva_upload_asset",
  get_asset: "canva_get_asset",
  update_asset: "canva_update_asset",
  delete_asset: "canva_delete_asset",
  // 資料夾
  list_folder_items: "canva_list_folder_items",
  create_folder: "canva_create_folder",
  move_to_folder: "canva_move_to_folder",
  delete_folder: "canva_delete_folder",
  // 留言
  get_comments: "canva_get_comments",
  create_comment: "canva_create_comment",
  reply_comment: "canva_reply_comment",
  // 用戶
  get_profile: "canva_get_profile",
};

// ── ACTION_SKILLS：每個 action 的詳細說明 ─────────────────
const ACTION_SKILLS: Record<string, string> = {
  list_designs: `## list_designs
List the user's designs.
- **continuation** (optional): Pagination token from previous response
- **limit** (optional): Number of results (default 20, max 100)
Example: \`octodock_do(app:"canva", action:"list_designs")\``,

  get_design: `## get_design
Get metadata for a specific design.
- **design_id** (required): The design's ID
Example: \`octodock_do(app:"canva", action:"get_design", params:{design_id:"DAGxxxxxx"})\``,

  create_design: `## create_design
Create a new blank design.
- **title** (optional): Design title
- **width** (optional): Width in pixels (default 1080)
- **height** (optional): Height in pixels (default 1080)
- **design_type** (optional): Preset type — one of "doc", "whiteboard", "presentation"
Example: \`octodock_do(app:"canva", action:"create_design", params:{title:"社群貼文", width:1080, height:1080})\``,

  export_design: `## export_design
Start an async export job. Returns a job ID — use get_export to poll status.
- **design_id** (required): The design to export
- **format** (optional): "pdf" | "png" | "jpg" | "gif" | "pptx" | "mp4" (default "png")
- **quality** (optional): "regular" | "pro" (default "regular")
- **pages** (optional): Array of page indices to export (0-based)
Example: \`octodock_do(app:"canva", action:"export_design", params:{design_id:"DAGxxxxxx", format:"pdf"})\``,

  get_export: `## get_export
Check the status of an export job and get download URLs.
- **job_id** (required): Export job ID from export_design
Example: \`octodock_do(app:"canva", action:"get_export", params:{job_id:"JOBxxxxxx"})\``,

  upload_asset: `## upload_asset
Upload an asset (image/video) to the user's Canva library from a URL.
- **url** (required): Public URL of the file to upload
- **name** (optional): Asset name
- **tags** (optional): Array of tags
Example: \`octodock_do(app:"canva", action:"upload_asset", params:{url:"https://example.com/photo.jpg", name:"Logo"})\``,

  get_asset: `## get_asset
Get metadata for a specific asset.
- **asset_id** (required): The asset's ID
Example: \`octodock_do(app:"canva", action:"get_asset", params:{asset_id:"AAAxxxxxx"})\``,

  update_asset: `## update_asset
Update asset metadata (name, tags).
- **asset_id** (required): The asset's ID
- **name** (optional): New name
- **tags** (optional): New tags array
Example: \`octodock_do(app:"canva", action:"update_asset", params:{asset_id:"AAAxxxxxx", name:"New Logo"})\``,

  delete_asset: `## delete_asset
Delete an asset from the user's library.
- **asset_id** (required): The asset's ID
Example: \`octodock_do(app:"canva", action:"delete_asset", params:{asset_id:"AAAxxxxxx"})\``,

  list_folder_items: `## list_folder_items
List items in a folder (designs, images, folders). Use "root" for the top-level Projects folder.
- **folder_id** (required): Folder ID (use "root" for top level)
- **continuation** (optional): Pagination token
- **limit** (optional): Number of results (default 20, max 100)
Example: \`octodock_do(app:"canva", action:"list_folder_items", params:{folder_id:"root"})\``,

  create_folder: `## create_folder
Create a new folder in the user's Projects.
- **name** (required): Folder name
- **parent_folder_id** (optional): Parent folder ID (default "root")
Example: \`octodock_do(app:"canva", action:"create_folder", params:{name:"社群素材"})\``,

  move_to_folder: `## move_to_folder
Move an item (design or asset) into a folder.
- **folder_id** (required): Target folder ID
- **item_id** (required): ID of the item to move
- **item_type** (required): "design" | "folder" | "image" | "video"
Example: \`octodock_do(app:"canva", action:"move_to_folder", params:{folder_id:"FABxxxxxx", item_id:"DAGxxxxxx", item_type:"design"})\``,

  delete_folder: `## delete_folder
Delete a folder.
- **folder_id** (required): Folder ID to delete
Example: \`octodock_do(app:"canva", action:"delete_folder", params:{folder_id:"FABxxxxxx"})\``,

  get_comments: `## get_comments
Get comments on a design.
- **design_id** (required): The design's ID
- **continuation** (optional): Pagination token
Example: \`octodock_do(app:"canva", action:"get_comments", params:{design_id:"DAGxxxxxx"})\``,

  create_comment: `## create_comment
Add a comment to a design.
- **design_id** (required): The design's ID
- **message** (required): Comment text
- **assignee_id** (optional): User ID to assign (creates a task)
Example: \`octodock_do(app:"canva", action:"create_comment", params:{design_id:"DAGxxxxxx", message:"Logo 請換成新版"})\``,

  reply_comment: `## reply_comment
Reply to an existing comment thread.
- **design_id** (required): The design's ID
- **thread_id** (required): Comment thread ID
- **message** (required): Reply text
Example: \`octodock_do(app:"canva", action:"reply_comment", params:{design_id:"DAGxxxxxx", thread_id:"CTxxxxxx", message:"已更新"})\``,

  get_profile: `## get_profile
Get the authorized user's profile information.
Example: \`octodock_do(app:"canva", action:"get_profile")\``,
};

// ── getSkill：回傳操作說明 ────────────────────────────────
function getSkill(action?: string): string {
  // 有指定 action → 回傳該 action 的詳細說明
  if (action && ACTION_SKILLS[action]) return ACTION_SKILLS[action];
  if (action) return `Action "${action}" not found. Use octodock_help(app:"canva") to see all actions.`;

  // 沒指定 → 回傳 App 級別總覽
  return `# Canva — Design platform
Available actions:
- **list_designs** — List user's designs
- **get_design** — Get design metadata
- **create_design** — Create a new blank design
- **export_design** — Export design as PDF/PNG/JPG/GIF/PPTX/MP4
- **get_export** — Check export job status & get download URL
- **upload_asset** — Upload image/video to Canva library
- **get_asset** — Get asset metadata
- **update_asset** — Update asset name/tags
- **delete_asset** — Delete an asset
- **list_folder_items** — List folder contents
- **create_folder** — Create a folder
- **move_to_folder** — Move item into a folder
- **delete_folder** — Delete a folder
- **get_comments** — Get design comments
- **create_comment** — Add a comment to a design
- **reply_comment** — Reply to a comment
- **get_profile** — Get user profile

Use octodock_help(app:"canva", action:"<name>") for detailed params.`;
}

// ── formatResponse：API 原始回傳 → AI 友善格式 ───────────
function formatResponse(action: string, rawData: unknown): string {
  const data = rawData as Record<string, unknown>;

  switch (action) {
    case "list_designs": {
      // 設計列表 → 簡化成 Markdown 列表
      const items = (data.items ?? []) as Array<Record<string, unknown>>;
      if (items.length === 0) return "沒有找到設計。";
      const lines = items.map((d) => {
        const title = d.title ?? "(無標題)";
        const id = d.id ?? "";
        const created = d.created_at ? ` | 建立於 ${String(d.created_at).substring(0, 10)}` : "";
        const thumb = (d.thumbnail as Record<string, unknown>)?.url ? ` | [預覽](${(d.thumbnail as Record<string, unknown>).url})` : "";
        return `- **${title}** (${id})${created}${thumb}`;
      });
      const cont = data.continuation ? `\n\n還有更多結果，使用 continuation: "${data.continuation}" 繼續` : "";
      return `找到 ${items.length} 個設計：\n\n${lines.join("\n")}${cont}`;
    }

    case "get_design": {
      // 單一設計 → 結構化摘要
      const design = (data.design ?? data) as Record<string, unknown>;
      const title = design.title ?? "(無標題)";
      const id = design.id ?? "";
      const created = design.created_at ? String(design.created_at).substring(0, 10) : "未知";
      const updated = design.updated_at ? String(design.updated_at).substring(0, 10) : "未知";
      const pageCount = (design.page_count ?? "未知");
      const thumb = (design.thumbnail as Record<string, unknown>)?.url ?? "";
      const urls = design.urls as Record<string, unknown> | undefined;
      const editUrl = urls?.edit_url ?? "";
      const viewUrl = urls?.view_url ?? "";
      return [
        `# ${title}`,
        `- ID: ${id}`,
        `- 頁數: ${pageCount}`,
        `- 建立: ${created} | 更新: ${updated}`,
        editUrl ? `- 編輯連結: ${editUrl}` : "",
        viewUrl ? `- 檢視連結: ${viewUrl}` : "",
        thumb ? `- 縮圖: ${thumb}` : "",
      ].filter(Boolean).join("\n");
    }

    case "create_design": {
      // 建立設計 → 回傳連結
      const design = (data.design ?? data) as Record<string, unknown>;
      const urls = design.urls as Record<string, unknown> | undefined;
      return [
        `設計已建立！`,
        `- ID: ${design.id}`,
        `- 標題: ${design.title ?? "(無標題)"}`,
        urls?.edit_url ? `- 編輯連結: ${urls.edit_url}` : "",
      ].filter(Boolean).join("\n");
    }

    case "export_design": {
      // 匯出任務已建立 → 回傳 job ID
      const job = (data.job ?? data) as Record<string, unknown>;
      return [
        `匯出任務已建立！`,
        `- Job ID: ${job.id}`,
        `- 狀態: ${job.status}`,
        `\n用 get_export(job_id:"${job.id}") 查詢匯出狀態和下載連結。`,
      ].join("\n");
    }

    case "get_export": {
      // 匯出狀態 → 下載連結
      const job = (data.job ?? data) as Record<string, unknown>;
      const status = job.status ?? "unknown";
      if (status === "success" || status === "completed") {
        const urls = (job.urls ?? []) as Array<Record<string, unknown>>;
        if (urls.length > 0) {
          const links = urls.map((u, i) => `  ${i + 1}. ${u.url ?? u}`).join("\n");
          return `匯出完成！下載連結：\n${links}`;
        }
        return `匯出完成！但未取得下載連結。\n${JSON.stringify(job, null, 2)}`;
      }
      if (status === "failed") {
        return `匯出失敗。${job.error ? `錯誤: ${JSON.stringify(job.error)}` : ""}`;
      }
      return `匯出進行中，狀態: ${status}\n請稍候再用 get_export 查詢。`;
    }

    case "upload_asset": {
      // 上傳素材 → 回傳結果
      const job = (data.job ?? data) as Record<string, unknown>;
      const asset = job.asset as Record<string, unknown> | undefined;
      if (asset) {
        return [
          `素材上傳完成！`,
          `- ID: ${asset.id}`,
          `- 名稱: ${asset.name ?? "(未命名)"}`,
          `- 類型: ${asset.type ?? "unknown"}`,
        ].join("\n");
      }
      return `素材上傳任務已建立。Job ID: ${job.id}\n狀態: ${job.status}`;
    }

    case "get_asset": {
      // 素材資訊
      const asset = (data.asset ?? data) as Record<string, unknown>;
      return [
        `# ${asset.name ?? "(未命名)"}`,
        `- ID: ${asset.id}`,
        `- 類型: ${asset.type ?? "unknown"}`,
        asset.tags ? `- 標籤: ${(asset.tags as string[]).join(", ")}` : "",
        asset.created_at ? `- 建立: ${String(asset.created_at).substring(0, 10)}` : "",
        asset.updated_at ? `- 更新: ${String(asset.updated_at).substring(0, 10)}` : "",
      ].filter(Boolean).join("\n");
    }

    case "update_asset":
      return `素材已更新。`;

    case "delete_asset":
      return `素材已刪除。`;

    case "list_folder_items": {
      // 資料夾內容 → Markdown 列表
      const items = (data.items ?? []) as Array<Record<string, unknown>>;
      if (items.length === 0) return "資料夾是空的。";
      const lines = items.map((item) => {
        const name = item.name ?? item.title ?? "(未命名)";
        const type = item.type ?? "item";
        const id = item.id ?? "";
        return `- [${type}] **${name}** (${id})`;
      });
      const cont = data.continuation ? `\n\n還有更多，使用 continuation: "${data.continuation}" 繼續` : "";
      return `資料夾內容（${items.length} 項）：\n\n${lines.join("\n")}${cont}`;
    }

    case "create_folder": {
      const folder = (data.folder ?? data) as Record<string, unknown>;
      return `資料夾已建立！\n- ID: ${folder.id}\n- 名稱: ${folder.name ?? "(未命名)"}`;
    }

    case "move_to_folder":
      return `項目已移動到資料夾。`;

    case "delete_folder":
      return `資料夾已刪除。`;

    case "get_comments": {
      // 留言列表 → 可讀格式
      const items = (data.items ?? []) as Array<Record<string, unknown>>;
      if (items.length === 0) return "沒有留言。";
      const lines = items.map((c) => {
        const author = (c.author as Record<string, unknown>)?.display_name ?? "未知";
        const message = c.message ?? "";
        const created = c.created_at ? String(c.created_at).substring(0, 10) : "";
        const threadId = c.thread_id ?? c.id ?? "";
        return `- **${author}** (${created}) [thread:${threadId}]\n  ${message}`;
      });
      return `留言（${items.length} 則）：\n\n${lines.join("\n")}`;
    }

    case "create_comment":
    case "reply_comment": {
      const comment = (data.comment ?? data) as Record<string, unknown>;
      return `留言已發佈。Thread ID: ${comment.thread_id ?? comment.id ?? "unknown"}`;
    }

    case "get_profile": {
      // 用戶資料 → 精簡格式
      const profile = (data.profile ?? data) as Record<string, unknown>;
      return [
        `# Canva 用戶資料`,
        `- 名稱: ${profile.display_name ?? "(未知)"}`,
        `- ID: ${profile.id ?? ""}`,
        profile.email ? `- Email: ${profile.email}` : "",
      ].filter(Boolean).join("\n");
    }

    default:
      return JSON.stringify(data, null, 2);
  }
}

// ── formatError：智慧錯誤引導 ────────────────────────────
function formatError(action: string, errorMessage: string): string | null {
  if (errorMessage.includes("401") || errorMessage.includes("Unauthorized") || errorMessage.includes("invalid_token")) {
    return `「Canva 授權已過期 (TOKEN_EXPIRED)」— 請到 Dashboard 重新連結 Canva`;
  }
  if (errorMessage.includes("403") || errorMessage.includes("Forbidden") || errorMessage.includes("insufficient_scopes")) {
    return `「權限不足 (INSUFFICIENT_SCOPES)」— 請到 Dashboard 重新連結 Canva 以取得所需權限`;
  }
  if (errorMessage.includes("404") || errorMessage.includes("not_found")) {
    return `「找不到資源 (NOT_FOUND)」— 請確認 ID 正確，且該資源屬於已授權的帳號`;
  }
  if (errorMessage.includes("429") || errorMessage.includes("rate_limit")) {
    return `「API 請求過於頻繁 (RATE_LIMITED)」— 請稍候 1 分鐘再試。Canva 的限制：建立設計 20 次/分鐘、匯出 10 次/分鐘`;
  }
  if (errorMessage.includes("enterprise") || errorMessage.includes("brand_template")) {
    return `「此功能需要 Canva Enterprise 方案 (ENTERPRISE_REQUIRED)」— Autofill 和 Brand Template 僅限企業方案使用`;
  }
  return null;
}

// ── 工具定義 ──────────────────────────────────────────────
const tools: ToolDefinition[] = [
  // --- 設計管理 ---
  {
    name: "canva_list_designs",
    description: "List the user's Canva designs. Returns design titles, IDs, and thumbnails.",
    inputSchema: {
      continuation: z.string().optional().describe("Pagination token from previous response"),
      limit: z.number().optional().describe("Number of results (max 100, default 20)"),
    },
  },
  {
    name: "canva_get_design",
    description: "Get metadata for a specific Canva design, including title, page count, and URLs.",
    inputSchema: {
      design_id: z.string().describe("The Canva design ID"),
    },
  },
  {
    name: "canva_create_design",
    description: "Create a new blank Canva design. Returns an edit URL for the user to design in Canva.",
    inputSchema: {
      title: z.string().optional().describe("Design title"),
      width: z.number().optional().describe("Width in pixels (default 1080)"),
      height: z.number().optional().describe("Height in pixels (default 1080)"),
      design_type: z.enum(["doc", "whiteboard", "presentation"]).optional().describe("Preset design type (overrides width/height)"),
    },
  },
  // --- 匯出 ---
  {
    name: "canva_export_design",
    description: "Start an async export job for a Canva design. Use get_export to check status and get download URLs.",
    inputSchema: {
      design_id: z.string().describe("The design ID to export"),
      format: z.enum(["pdf", "png", "jpg", "gif", "pptx", "mp4"]).optional().describe("Export format (default png)"),
      quality: z.enum(["regular", "pro"]).optional().describe("Export quality (default regular)"),
      pages: z.array(z.number()).optional().describe("Array of page indices to export (0-based)"),
    },
  },
  {
    name: "canva_get_export",
    description: "Check the status of an export job and get download URLs when complete.",
    inputSchema: {
      job_id: z.string().describe("Export job ID from export_design"),
    },
  },
  // --- 素材管理 ---
  {
    name: "canva_upload_asset",
    description: "Upload an asset (image/video) to the user's Canva library from a URL.",
    inputSchema: {
      url: z.string().describe("Public URL of the file to upload"),
      name: z.string().optional().describe("Asset display name"),
      tags: z.array(z.string()).optional().describe("Tags for organization"),
    },
  },
  {
    name: "canva_get_asset",
    description: "Get metadata for a specific asset in the user's Canva library.",
    inputSchema: {
      asset_id: z.string().describe("The asset ID"),
    },
  },
  {
    name: "canva_update_asset",
    description: "Update an asset's name or tags.",
    inputSchema: {
      asset_id: z.string().describe("The asset ID"),
      name: z.string().optional().describe("New display name"),
      tags: z.array(z.string()).optional().describe("New tags array"),
    },
  },
  {
    name: "canva_delete_asset",
    description: "Delete an asset from the user's Canva library.",
    inputSchema: {
      asset_id: z.string().describe("The asset ID to delete"),
    },
  },
  // --- 資料夾 ---
  {
    name: "canva_list_folder_items",
    description: "List items in a Canva folder. Use folder_id 'root' for top-level Projects.",
    inputSchema: {
      folder_id: z.string().describe("Folder ID (use 'root' for top level)"),
      continuation: z.string().optional().describe("Pagination token"),
      limit: z.number().optional().describe("Number of results (max 100, default 20)"),
    },
  },
  {
    name: "canva_create_folder",
    description: "Create a new folder in the user's Canva Projects.",
    inputSchema: {
      name: z.string().describe("Folder name"),
      parent_folder_id: z.string().optional().describe("Parent folder ID (default root)"),
    },
  },
  {
    name: "canva_move_to_folder",
    description: "Move a design or asset into a Canva folder.",
    inputSchema: {
      folder_id: z.string().describe("Target folder ID"),
      item_id: z.string().describe("ID of the item to move"),
      item_type: z.enum(["design", "folder", "image", "video"]).describe("Type of item"),
    },
  },
  {
    name: "canva_delete_folder",
    description: "Delete a Canva folder.",
    inputSchema: {
      folder_id: z.string().describe("Folder ID to delete"),
    },
  },
  // --- 留言 ---
  {
    name: "canva_get_comments",
    description: "Get comments on a Canva design.",
    inputSchema: {
      design_id: z.string().describe("The design ID"),
      continuation: z.string().optional().describe("Pagination token"),
    },
  },
  {
    name: "canva_create_comment",
    description: "Add a comment to a Canva design.",
    inputSchema: {
      design_id: z.string().describe("The design ID"),
      message: z.string().describe("Comment text"),
      assignee_id: z.string().optional().describe("User ID to assign as a task"),
    },
  },
  {
    name: "canva_reply_comment",
    description: "Reply to an existing comment thread on a Canva design.",
    inputSchema: {
      design_id: z.string().describe("The design ID"),
      thread_id: z.string().describe("Comment thread ID"),
      message: z.string().describe("Reply text"),
    },
  },
  // --- 用戶 ---
  {
    name: "canva_get_profile",
    description: "Get the authorized Canva user's profile information.",
    inputSchema: {},
  },
];

// ── execute：實際 API 呼叫 ────────────────────────────────
async function execute(
  toolName: string,
  params: Record<string, unknown>,
  token: string,
): Promise<ToolResult> {
  switch (toolName) {
    // ── 設計管理 ──
    case "canva_list_designs": {
      const query = new URLSearchParams();
      if (params.continuation) query.set("continuation", String(params.continuation));
      if (params.limit) query.set("limit", String(params.limit));
      const qs = query.toString();
      const result = await canvaFetch(`/designs${qs ? `?${qs}` : ""}`, token);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }

    case "canva_get_design": {
      const result = await canvaFetch(`/designs/${params.design_id}`, token);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }

    case "canva_create_design": {
      // 組裝 body
      const body: Record<string, unknown> = {};
      if (params.title) body.title = params.title;
      if (params.design_type) {
        // 使用預設設計類型
        body.design_type = { type: params.design_type };
      } else {
        // 自訂尺寸
        body.design_type = {
          type: "custom",
          width: params.width ?? 1080,
          height: params.height ?? 1080,
        };
      }
      const result = await canvaFetch("/designs", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }

    // ── 匯出 ──
    case "canva_export_design": {
      const body: Record<string, unknown> = {
        design_id: params.design_id,
        format: { type: params.format ?? "png" },
      };
      if (params.quality) (body.format as Record<string, unknown>).quality = params.quality;
      if (params.pages) body.pages = params.pages;
      const result = await canvaFetch("/exports", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }

    case "canva_get_export": {
      const result = await canvaFetch(`/exports/${params.job_id}`, token);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }

    // ── 素材管理 ──
    case "canva_upload_asset": {
      const body: Record<string, unknown> = {};
      // Canva asset upload 使用 URL-based 上傳
      body.name = params.name ?? "Uploaded asset";
      if (params.tags) body.tags = params.tags;
      // Canva API 需要先建立 upload job
      const uploadBody: Record<string, unknown> = {
        ...body,
        url: params.url,
      };
      const result = await canvaFetch("/asset-uploads", token, {
        method: "POST",
        body: JSON.stringify(uploadBody),
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }

    case "canva_get_asset": {
      const result = await canvaFetch(`/assets/${params.asset_id}`, token);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }

    case "canva_update_asset": {
      const body: Record<string, unknown> = {};
      if (params.name !== undefined) body.name = params.name;
      if (params.tags !== undefined) body.tags = params.tags;
      const result = await canvaFetch(`/assets/${params.asset_id}`, token, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }

    case "canva_delete_asset": {
      const result = await canvaFetch(`/assets/${params.asset_id}`, token, {
        method: "DELETE",
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }

    // ── 資料夾 ──
    case "canva_list_folder_items": {
      const query = new URLSearchParams();
      if (params.continuation) query.set("continuation", String(params.continuation));
      if (params.limit) query.set("limit", String(params.limit));
      const qs = query.toString();
      const result = await canvaFetch(
        `/folders/${params.folder_id}/items${qs ? `?${qs}` : ""}`,
        token,
      );
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }

    case "canva_create_folder": {
      const body: Record<string, unknown> = { name: params.name };
      if (params.parent_folder_id) body.parent_folder_id = params.parent_folder_id;
      const result = await canvaFetch("/folders", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }

    case "canva_move_to_folder": {
      const body = {
        item_id: params.item_id,
        item_type: params.item_type,
      };
      const result = await canvaFetch(`/folders/${params.folder_id}/items`, token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }

    case "canva_delete_folder": {
      const result = await canvaFetch(`/folders/${params.folder_id}`, token, {
        method: "DELETE",
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }

    // ── 留言 ──
    case "canva_get_comments": {
      const query = new URLSearchParams();
      if (params.continuation) query.set("continuation", String(params.continuation));
      const qs = query.toString();
      const result = await canvaFetch(
        `/designs/${params.design_id}/comments${qs ? `?${qs}` : ""}`,
        token,
      );
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }

    case "canva_create_comment": {
      const body: Record<string, unknown> = {
        message: params.message,
      };
      if (params.assignee_id) body.assignee_id = params.assignee_id;
      const result = await canvaFetch(`/designs/${params.design_id}/comments`, token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }

    case "canva_reply_comment": {
      const body = { message: params.message };
      const result = await canvaFetch(
        `/designs/${params.design_id}/comments/${params.thread_id}/replies`,
        token,
        {
          method: "POST",
          body: JSON.stringify(body),
        },
      );
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }

    // ── 用戶 ──
    case "canva_get_profile": {
      const result = await canvaFetch("/users/me", token);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
        isError: true,
      };
  }
}

// ── Token 刷新 ────────────────────────────────────────────
async function refreshCanvaToken(refreshToken: string): Promise<TokenSet> {
  const clientId = process.env.CANVA_CLIENT_ID ?? "";
  const clientSecret = process.env.CANVA_CLIENT_SECRET ?? "";

  const res = await fetch("https://api.canva.com/rest/v1/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }).toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Canva token refresh failed: ${err} (CANVA_TOKEN_REFRESH_ERROR)`);
  }

  const data = await res.json();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
  };
}

// ── 匯出 Adapter ─────────────────────────────────────────
export const canvaAdapter: AppAdapter = {
  name: "canva",
  displayName: { zh: "Canva", en: "Canva" },
  icon: "canva",
  authType: "oauth2",
  authConfig,
  actionMap,
  getSkill,
  formatResponse,
  formatError,
  tools,
  execute,
  refreshToken: refreshCanvaToken,
};
