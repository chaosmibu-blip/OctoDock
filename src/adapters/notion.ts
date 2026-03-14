import { z } from "zod";
import type {
  AppAdapter,
  OAuthConfig,
  ToolDefinition,
  ToolResult,
} from "./types";

// ============================================================
// Notion OAuth 設定
// Notion 使用 Basic Auth 交換 token（與 Google/Meta 的 POST body 不同）
// Notion token 不會過期，不需要 refresh 機制
// ============================================================

const authConfig: OAuthConfig = {
  type: "oauth2",
  authorizeUrl: "https://api.notion.com/v1/oauth/authorize",
  tokenUrl: "https://api.notion.com/v1/oauth/token",
  scopes: [], // Notion 的權限由 integration 設定決定，不走傳統 scope
  authMethod: "basic", // Notion 要求用 Basic Auth（base64(clientId:clientSecret)）
};

// ============================================================
// Notion API 基礎設定
// ============================================================

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28"; // Notion API 版本，固定不動

/** 組合 Notion API 請求所需的 headers */
function notionHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

/**
 * 統一的 Notion API 請求函式
 * 處理 headers 組合、錯誤捕捉、JSON 解析
 * 所有 Notion 操作都透過這個函式發出 HTTP 請求
 */
async function notionFetch(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<unknown> {
  const res = await fetch(`${NOTION_API}${path}`, {
    ...options,
    headers: { ...notionHeaders(token), ...(options.headers as object) },
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(
      `Notion API error: ${(error as { message: string }).message} (NOTION_API_ERROR)`,
    );
  }
  return res.json();
}

// ============================================================
// 簡化 Action → 內部工具名稱對應表
// agentdock_do 收到 action 後查這張表，找到要呼叫的內部工具
// 例如：AI 呼叫 do(app:"notion", action:"search") → 內部執行 notion_search
// ============================================================

const actionMap: Record<string, string> = {
  // 搜尋
  search: "notion_search",
  // 頁面操作
  get_page: "notion_get_page",
  create_page: "notion_create_page",
  update_page: "notion_update_page",
  delete_page: "notion_delete_page",
  get_page_property: "notion_get_page_property",
  // 區塊操作
  get_block: "notion_get_block",
  get_block_children: "notion_get_block_children",
  append_blocks: "notion_append_blocks",
  update_block: "notion_update_block",
  delete_block: "notion_delete_block",
  // 資料庫操作
  query_database: "notion_query_database",
  create_database_item: "notion_create_database_item",
  create_database: "notion_create_database",
  update_database: "notion_update_database",
  // 評論
  add_comment: "notion_create_comment",
  get_comments: "notion_get_comments",
  // 用戶
  get_users: "notion_get_users",
};

/**
 * 回傳 Notion 的 Skill 文字（精簡操作說明）
 * AI 第一次用 Notion 時，透過 agentdock_help(app:"notion") 取得這段文字
 * 控制在 ~150 tokens，只列出最常用的 action 和參數
 * 進入對話歷史後，同一個 chat 不需要再問
 */
function getSkill(): string {
  return `notion actions:
  search(query, filter?) — search pages/databases in workspace
  create_page(title, content?, folder?) — create page. folder can be a name (auto-resolved) or ID
  get_page(page) — get page content. page can be a name or ID
  update_page(page_id, properties?, icon?, cover?) — update page properties
  delete_page(page_id) — archive page (recoverable within 30 days)
  query_database(database, filter?, sorts?) — query database by name or ID
  create_database_item(database, properties, content?) — add row to database
  create_database(parent_page_id, title, properties) — create new database
  append_blocks(block_id, children) — append content blocks to page
  add_comment(page_id, text) — comment on a page
  get_comments(block_id) — list comments
  get_users() — list workspace members
You can use names instead of IDs for folder/page/database — AgentDock resolves them via memory. Use search to find items if resolution fails.`;
}

// ============================================================
// 內部工具定義（18 個工具）
// 這些定義保留用於內部路由，不再直接暴露給 MCP
// agentdock_do 透過 actionMap 找到工具名稱後，交給 execute() 執行
// ============================================================

const tools: ToolDefinition[] = [
  // ── 搜尋 ──
  {
    name: "notion_search",
    description:
      "Search pages and databases in user's Notion workspace by title or content. Returns matching pages with their IDs and titles.",
    inputSchema: {
      query: z.string().describe("Search query text"),
      filter: z
        .enum(["page", "database"])
        .optional()
        .describe("Filter results by object type"),
    },
  },

  // ── 頁面操作 ──
  {
    name: "notion_get_page",
    description:
      "Get the content of a specific Notion page by its ID. Returns page properties and block children.",
    inputSchema: {
      page_id: z.string().describe("Notion page ID"),
    },
  },
  {
    name: "notion_create_page",
    description:
      "Create a new page in user's Notion workspace. Can specify parent page or database, title, and content. If no location is specified, use notion_search first to find a suitable parent.",
    inputSchema: {
      title: z.string().describe("Page title"),
      content: z
        .string()
        .optional()
        .describe("Page content in Markdown format"),
      parent_id: z
        .string()
        .optional()
        .describe("Parent page or database ID. Use notion_search first if unsure."),
      parent_type: z
        .enum(["page_id", "database_id"])
        .optional()
        .describe("Parent type (default: page_id)"),
    },
  },
  {
    name: "notion_update_page",
    description:
      "Update properties, icon, or cover of an existing Notion page. Use notion_get_page first to see current properties.",
    inputSchema: {
      page_id: z.string().describe("Notion page ID to update"),
      properties: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Properties to update in Notion API format"),
      icon: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Icon object (emoji or external URL)"),
      cover: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Cover image object"),
    },
  },
  {
    name: "notion_delete_page",
    description:
      "Move a Notion page to trash (archive). Can be restored from trash within 30 days.",
    inputSchema: {
      page_id: z.string().describe("Notion page ID to delete"),
    },
  },
  {
    name: "notion_get_page_property",
    description:
      "Retrieve a specific property value from a Notion page. Useful for paginated properties like rollups or relations.",
    inputSchema: {
      page_id: z.string().describe("Notion page ID"),
      property_id: z.string().describe("Property ID to retrieve"),
    },
  },

  // ── 區塊操作 ──
  {
    name: "notion_get_block",
    description:
      "Retrieve a single block object by its ID, including its type and content.",
    inputSchema: {
      block_id: z.string().describe("Block ID"),
    },
  },
  {
    name: "notion_get_block_children",
    description:
      "Get all child blocks of a specific block or page. Returns the content structure of a page.",
    inputSchema: {
      block_id: z.string().describe("Block or page ID"),
      page_size: z.number().optional().describe("Results per page (max 100, default 100)"),
    },
  },
  {
    name: "notion_append_blocks",
    description:
      "Append new content blocks to a page or block. Supports paragraphs, headings, lists, code, and more.",
    inputSchema: {
      block_id: z.string().describe("Parent block or page ID"),
      children: z
        .array(z.record(z.string(), z.unknown()))
        .describe("Array of block objects to append"),
    },
  },
  {
    name: "notion_update_block",
    description:
      "Update the content or properties of an existing block.",
    inputSchema: {
      block_id: z.string().describe("Block ID to update"),
      block_data: z
        .record(z.string(), z.unknown())
        .describe("Block type object with updated content (e.g. { paragraph: { rich_text: [...] } })"),
    },
  },
  {
    name: "notion_delete_block",
    description:
      "Delete a specific block from a page. The block is moved to trash.",
    inputSchema: {
      block_id: z.string().describe("Block ID to delete"),
    },
  },

  // ── 資料庫操作 ──
  {
    name: "notion_query_database",
    description:
      "Query a Notion database with optional filters and sorts. Returns matching items with their properties.",
    inputSchema: {
      database_id: z.string().describe("Notion database ID"),
      filter: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Notion filter object"),
      sorts: z
        .array(z.record(z.string(), z.unknown()))
        .optional()
        .describe("Notion sorts array"),
      page_size: z
        .number()
        .optional()
        .describe("Number of results (max 100, default 20)"),
    },
  },
  {
    name: "notion_create_database_item",
    description:
      "Create a new item (page) in a Notion database with specified properties.",
    inputSchema: {
      database_id: z.string().describe("Target database ID"),
      properties: z
        .record(z.string(), z.unknown())
        .describe("Item properties in Notion API format"),
      content: z
        .string()
        .optional()
        .describe("Page content in Markdown format"),
    },
  },
  {
    name: "notion_create_database",
    description:
      "Create a new database as a child of an existing page. Define columns (properties) and title.",
    inputSchema: {
      parent_page_id: z.string().describe("Parent page ID"),
      title: z.string().describe("Database title"),
      properties: z
        .record(z.string(), z.unknown())
        .describe("Database property schema (column definitions)"),
    },
  },
  {
    name: "notion_update_database",
    description:
      "Update a database's title, description, or property schema (add/modify columns).",
    inputSchema: {
      database_id: z.string().describe("Database ID to update"),
      title: z.string().optional().describe("New database title"),
      description: z.string().optional().describe("New database description"),
      properties: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Property schema updates"),
    },
  },

  // ── 評論 ──
  {
    name: "notion_create_comment",
    description:
      "Add a comment to a Notion page or a specific block within a page.",
    inputSchema: {
      page_id: z.string().optional().describe("Page ID to comment on (for page-level comments)"),
      discussion_id: z.string().optional().describe("Discussion ID to reply to an existing thread"),
      text: z.string().describe("Comment text content"),
    },
  },
  {
    name: "notion_get_comments",
    description:
      "List all comments on a Notion page, including block-level discussions.",
    inputSchema: {
      block_id: z.string().describe("Page or block ID to get comments for"),
    },
  },

  // ── 用戶 ──
  {
    name: "notion_get_users",
    description:
      "List all users in the Notion workspace, including their names, emails, and avatar URLs.",
    inputSchema: {},
  },
];

// ============================================================
// Markdown → Notion Blocks 轉換器
// 讓 AI 可以用 Markdown 格式寫內容，AgentDock 自動轉成 Notion API 格式
// 支援：標題（H1-H3）、項目符號、編號列表、待辦事項、分隔線
// ============================================================

/** 將 Markdown 文字轉換為 Notion block 陣列 */
function markdownToBlocks(
  markdown: string,
): Array<Record<string, unknown>> {
  return markdown.split("\n").map((line) => {
    // H3 標題
    if (line.startsWith("### ")) {
      return {
        object: "block",
        type: "heading_3",
        heading_3: {
          rich_text: [{ type: "text", text: { content: line.slice(4) } }],
        },
      };
    }
    // H2 標題
    if (line.startsWith("## ")) {
      return {
        object: "block",
        type: "heading_2",
        heading_2: {
          rich_text: [{ type: "text", text: { content: line.slice(3) } }],
        },
      };
    }
    // H1 標題
    if (line.startsWith("# ")) {
      return {
        object: "block",
        type: "heading_1",
        heading_1: {
          rich_text: [{ type: "text", text: { content: line.slice(2) } }],
        },
      };
    }
    // 項目符號列表
    if (line.startsWith("- ") || line.startsWith("* ")) {
      return {
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: [{ type: "text", text: { content: line.slice(2) } }],
        },
      };
    }
    // 編號列表
    const numberedMatch = line.match(/^\d+\.\s/);
    if (numberedMatch) {
      return {
        object: "block",
        type: "numbered_list_item",
        numbered_list_item: {
          rich_text: [{ type: "text", text: { content: line.slice(numberedMatch[0].length) } }],
        },
      };
    }
    // 待辦事項（勾選 / 未勾選）
    if (line.startsWith("- [ ] ") || line.startsWith("- [x] ")) {
      const checked = line.startsWith("- [x] ");
      return {
        object: "block",
        type: "to_do",
        to_do: {
          rich_text: [{ type: "text", text: { content: line.slice(6) } }],
          checked,
        },
      };
    }
    // 程式碼區塊標記（簡化處理：跳過 ``` 行）
    if (line.startsWith("```")) {
      return {
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: [] },
      };
    }
    // 分隔線
    if (line === "---" || line === "***") {
      return { object: "block", type: "divider", divider: {} };
    }
    // 預設：一般段落
    return {
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [{ type: "text", text: { content: line } }],
      },
    };
  }).filter((b) => {
    // 過濾掉程式碼區塊標記產生的空段落
    if (b.type === "paragraph") {
      const rt = (b.paragraph as { rich_text: Array<{ text: { content: string } }> }).rich_text;
      return rt.length > 0;
    }
    return true;
  });
}

// ============================================================
// 工具執行路由
// 根據工具名稱分派到對應的 Notion API 呼叫
// 這是 Adapter 的核心邏輯，agentdock_do 最終會呼叫這裡
// ============================================================

async function execute(
  toolName: string,
  params: Record<string, unknown>,
  token: string,
): Promise<ToolResult> {
  switch (toolName) {
    // ── 搜尋 ──
    case "notion_search": {
      const body: Record<string, unknown> = { query: params.query };
      if (params.filter) {
        body.filter = { value: params.filter, property: "object" };
      }
      const result = await notionFetch("/search", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // ── 取得頁面（同時拉頁面屬性和內容區塊） ──
    case "notion_get_page": {
      const [page, blocks] = await Promise.all([
        notionFetch(`/pages/${params.page_id}`, token),
        notionFetch(`/blocks/${params.page_id}/children?page_size=100`, token),
      ]);
      return {
        content: [
          { type: "text", text: JSON.stringify({ page, blocks }, null, 2) },
        ],
      };
    }

    // ── 建立頁面 ──
    case "notion_create_page": {
      const parentType = (params.parent_type as string) ?? "page_id";
      const body: Record<string, unknown> = {
        properties: {
          title: {
            title: [
              { type: "text", text: { content: params.title as string } },
            ],
          },
        },
      };

      // 設定父頁面或父資料庫
      if (params.parent_id) {
        body.parent = { [parentType]: params.parent_id };
      }

      // 如果有內容，轉換 Markdown 為 Notion blocks
      if (params.content) {
        body.children = markdownToBlocks(params.content as string);
      }

      const result = await notionFetch("/pages", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // ── 更新頁面屬性 ──
    case "notion_update_page": {
      const body: Record<string, unknown> = {};
      if (params.properties) body.properties = params.properties;
      if (params.icon) body.icon = params.icon;
      if (params.cover) body.cover = params.cover;

      const result = await notionFetch(`/pages/${params.page_id}`, token, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // ── 刪除（封存）頁面 ──
    case "notion_delete_page": {
      const result = await notionFetch(`/pages/${params.page_id}`, token, {
        method: "PATCH",
        body: JSON.stringify({ archived: true }),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // ── 取得頁面特定屬性（用於分頁屬性如 rollup、relation） ──
    case "notion_get_page_property": {
      const result = await notionFetch(
        `/pages/${params.page_id}/properties/${params.property_id}`,
        token,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // ── 取得單一區塊 ──
    case "notion_get_block": {
      const result = await notionFetch(`/blocks/${params.block_id}`, token);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // ── 取得區塊的子區塊（頁面內容結構） ──
    case "notion_get_block_children": {
      const pageSize = (params.page_size as number) ?? 100;
      const result = await notionFetch(
        `/blocks/${params.block_id}/children?page_size=${pageSize}`,
        token,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // ── 追加區塊到頁面 ──
    case "notion_append_blocks": {
      const result = await notionFetch(
        `/blocks/${params.block_id}/children`,
        token,
        {
          method: "PATCH",
          body: JSON.stringify({
            children: params.children,
          }),
        },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // ── 更新區塊內容 ──
    case "notion_update_block": {
      const result = await notionFetch(`/blocks/${params.block_id}`, token, {
        method: "PATCH",
        body: JSON.stringify(params.block_data),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // ── 刪除區塊 ──
    case "notion_delete_block": {
      const result = await notionFetch(`/blocks/${params.block_id}`, token, {
        method: "DELETE",
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // ── 查詢資料庫 ──
    case "notion_query_database": {
      const body: Record<string, unknown> = {
        page_size: (params.page_size as number) ?? 20,
      };
      if (params.filter) body.filter = params.filter;
      if (params.sorts) body.sorts = params.sorts;

      const result = await notionFetch(
        `/databases/${params.database_id}/query`,
        token,
        { method: "POST", body: JSON.stringify(body) },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // ── 新增資料庫項目（在資料庫裡建立新的一行） ──
    case "notion_create_database_item": {
      const body: Record<string, unknown> = {
        parent: { database_id: params.database_id },
        properties: params.properties,
      };
      if (params.content) {
        body.children = markdownToBlocks(params.content as string);
      }
      const result = await notionFetch("/pages", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // ── 建立資料庫（在某個頁面下建立新的資料庫） ──
    case "notion_create_database": {
      const result = await notionFetch("/databases", token, {
        method: "POST",
        body: JSON.stringify({
          parent: { page_id: params.parent_page_id },
          title: [
            { type: "text", text: { content: params.title as string } },
          ],
          properties: params.properties,
        }),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // ── 更新資料庫設定（標題、描述、欄位定義） ──
    case "notion_update_database": {
      const body: Record<string, unknown> = {};
      if (params.title) {
        body.title = [
          { type: "text", text: { content: params.title as string } },
        ];
      }
      if (params.description) {
        body.description = [
          { type: "text", text: { content: params.description as string } },
        ];
      }
      if (params.properties) body.properties = params.properties;

      const result = await notionFetch(
        `/databases/${params.database_id}`,
        token,
        { method: "PATCH", body: JSON.stringify(body) },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // ── 新增評論 ──
    case "notion_create_comment": {
      const body: Record<string, unknown> = {
        rich_text: [
          { type: "text", text: { content: params.text as string } },
        ],
      };
      if (params.page_id) body.parent = { page_id: params.page_id };
      if (params.discussion_id) body.discussion_id = params.discussion_id;

      const result = await notionFetch("/comments", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // ── 取得評論列表 ──
    case "notion_get_comments": {
      const result = await notionFetch(
        `/comments?block_id=${params.block_id}`,
        token,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // ── 列出工作區成員 ──
    case "notion_get_users": {
      const result = await notionFetch("/users", token);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // ── 未知工具 ──
    default:
      return {
        content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
        isError: true,
      };
  }
}

// ============================================================
// 匯出 Notion Adapter
// Adapter Registry 會自動掃描這個檔案並註冊
// ============================================================

export const notionAdapter: AppAdapter = {
  name: "notion",
  displayName: { zh: "Notion", en: "Notion" },
  icon: "notion",
  authType: "oauth2",
  authConfig,
  tools,
  actionMap, // do + help 架構：簡化 action → 內部工具對應
  getSkill, // do + help 架構：回傳精簡操作說明
  execute,
  // Notion token 不會過期 — 不需要 refreshToken
};
