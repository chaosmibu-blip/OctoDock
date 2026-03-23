import { z } from "zod";
import type {
  AppAdapter,
  OAuthConfig,
  ToolDefinition,
  ToolResult,
} from "./types";
import { NOTION_MAX_BLOCKS, NOTION_API_BLOCK_LIMIT } from "@/lib/constants";

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
  extraParams: { owner: "user" },
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
    // 帶上 HTTP status code，讓 error-types.ts 的 extractHttpStatus 能正確分類 403/404
    throw new Error(
      `Notion API error (${res.status}): ${(error as { message: string }).message} (NOTION_API_ERROR)`,
    );
  }
  return res.json();
}

/**
 * F1: 分頁拉取所有 block children
 * loop next_cursor 直到 has_more === false
 * 上限 NOTION_MAX_BLOCKS 避免無限迴圈，超過時標註 truncated
 */
// MAX_BLOCKS 從 @/lib/constants 匯入（NOTION_MAX_BLOCKS）

async function fetchAllBlocks(
  blockId: string,
  token: string,
): Promise<{ results: unknown[]; truncated: boolean; totalCount: number }> {
  const allResults: unknown[] = [];
  let cursor: string | undefined;
  let hasMore = true;

  while (hasMore && allResults.length < NOTION_MAX_BLOCKS) {
    const url = `/blocks/${blockId}/children?page_size=${NOTION_API_BLOCK_LIMIT}${cursor ? `&start_cursor=${cursor}` : ""}`;
    const data = (await notionFetch(url, token)) as {
      results: unknown[];
      has_more: boolean;
      next_cursor: string | null;
    };
    allResults.push(...data.results);
    hasMore = data.has_more;
    cursor = data.next_cursor ?? undefined;
  }

  return {
    results: allResults.slice(0, NOTION_MAX_BLOCKS),
    truncated: allResults.length > NOTION_MAX_BLOCKS || hasMore,
    totalCount: allResults.length,
  };
}

/** 把 fetchAllBlocks 結果包裝成標準回傳格式（含 truncation 標註） */
function wrapBlockResults(allBlocks: { results: unknown[]; truncated: boolean; totalCount: number }) {
  return {
    results: allBlocks.results,
    ...(allBlocks.truncated
      ? { _truncated: true, _note: `Showing ${allBlocks.results.length} of ${allBlocks.totalCount}+ blocks` }
      : {}),
  };
}

// ============================================================
// 簡化 Action → 內部工具名稱對應表
// octodock_do 收到 action 後查這張表，找到要呼叫的內部工具
// 例如：AI 呼叫 do(app:"notion", action:"search") → 內部執行 notion_search
// ============================================================

const actionMap: Record<string, string> = {
  // 搜尋
  search: "notion_search",
  // 頁面操作
  get_page: "notion_get_page",
  create_page: "notion_create_page",
  update_page: "notion_update_page",
  replace_content: "notion_replace_content", // G2: 全文替換頁面內容
  append_content: "notion_append_content", // 尾部追加 Markdown 內容
  move_page: "notion_move_page",
  archive_page: "notion_archive_page", // 歸檔頁面（可復原）
  unarchive_page: "notion_unarchive_page", // 取消歸檔（從垃圾桶復原）
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
 * AI 第一次用 Notion 時，透過 octodock_help(app:"notion") 取得這段文字
 * 控制在 ~150 tokens，只列出最常用的 action 和參數
 * 進入對話歷史後，同一個 chat 不需要再問
 */
/** action 級別的詳細說明 + 使用範例 */
const ACTION_SKILLS: Record<string, string> = {
  search: `## notion.search
Search pages and databases in workspace.
### Parameters
  query: Search text
  filter (optional): "page" or "database"
### Example
octodock_do(app:"notion", action:"search", params:{query:"會議紀錄"})
octodock_do(app:"notion", action:"search", params:{query:"待辦", filter:"database"})`,

  create_page: `## notion.create_page
Create a new page. Content in markdown format.
### Parameters
  title: Page title
  content (optional): Markdown content (headings, lists, code blocks supported)
  folder (optional): Parent page name or ID (auto-resolved via memory)
  parent_type (optional): "page_id" or "database_id" (default: page_id)
### Example
octodock_do(app:"notion", action:"create_page", params:{
  title:"會議紀錄 3/15",
  folder:"會議",
  content:"## 討論事項\\n- 產品進度\\n- 下週計畫\\n\\n## 決議\\n1. 完成 Phase 9\\n2. 準備 demo"
})`,

  get_page: `## notion.get_page
Get page content (returns markdown).
### Parameters
  page_id: Page ID or name (auto-resolved)
### Example
octodock_do(app:"notion", action:"get_page", params:{page_id:"317a9617-..."})
octodock_do(app:"notion", action:"get_page", params:{page:"會議紀錄 3/15"})`,

  replace_content: `## notion.replace_content
Replace entire page body content. Old content is deleted, new content written in markdown.
### Parameters
  page_id: Page ID
  content: New content in markdown format
### Example
octodock_do(app:"notion", action:"replace_content", params:{
  page_id:"317a9617-...",
  content:"## 更新後的內容\\n- 新的項目\\n- 修改過的計畫"
})`,

  update_page: `## notion.update_page
Update page properties (title, icon, cover). Does NOT change body content — use replace_content for that.
### Parameters
  page_id: Page ID
  properties (optional): Notion API properties object
  icon (optional): {emoji:"🐙"} or {external:{url:"..."}}
  cover (optional): {external:{url:"..."}}
### Example
octodock_do(app:"notion", action:"update_page", params:{
  page_id:"317a9617-...",
  icon:{emoji:"🐙"}
})`,

  archive_page: `## notion.archive_page
Archive a page (move to trash, recoverable within 30 days).
### Parameters
  page_id: Page ID
### Example
octodock_do(app:"notion", action:"archive_page", params:{page_id:"317a9617-..."})`,

  unarchive_page: `## notion.unarchive_page
Restore an archived page from trash.
### Parameters
  page_id: Page ID
### Example
octodock_do(app:"notion", action:"unarchive_page", params:{page_id:"317a9617-..."})`,

  delete_page: `## notion.delete_page
Archive a page (recoverable within 30 days). Same as archive_page.
### Parameters
  page_id: Page ID
### Example
octodock_do(app:"notion", action:"delete_page", params:{page_id:"317a9617-..."})`,

  query_database: `## notion.query_database
Query a Notion database with optional filters and sorts.
### Parameters
  database_id: Database ID or name (auto-resolved)
  filter (optional): Notion filter object
  sorts (optional): Array of sort objects
  page_size (optional): Max results (default 20, max 100)
### Example
octodock_do(app:"notion", action:"query_database", params:{
  database:"待辦清單",
  filter:{property:"Status", select:{equals:"In Progress"}},
  sorts:[{property:"Due Date", direction:"ascending"}]
})`,

  create_database_item: `## notion.create_database_item
Add a new row to a database.
### Parameters
  database_id: Database ID or name
  properties: Item properties in Notion API format
  content (optional): Page content in markdown
### Example
octodock_do(app:"notion", action:"create_database_item", params:{
  database:"待辦清單",
  properties:{
    Name:{title:[{text:{content:"完成 README"}}]},
    Status:{select:{name:"Todo"}},
    "Due Date":{date:{start:"2026-03-20"}}
  }
})`,

  add_comment: `## notion.add_comment
Add a comment to a page.
### Parameters
  page_id: Page ID
  text: Comment text
### Example
octodock_do(app:"notion", action:"add_comment", params:{
  page_id:"317a9617-...",
  text:"已確認完成，可以關閉"
})`,

  append_content: `## notion.append_content
Append content to the end of a page (does NOT replace existing content).
### Parameters
  page_id: Page ID
  content: Markdown content to append
### Example
octodock_do(app:"notion", action:"append_content", params:{
  page_id:"317a9617-...",
  content:"## 新增章節\\n- 追加的內容\\n- 不會覆蓋原有內容"
})`,

  move_page: `## notion.move_page
Move a page to a different parent page.
### Parameters
  page_id: Page ID to move
  new_parent_id: Target parent page ID
### Example
octodock_do(app:"notion", action:"move_page", params:{
  page_id:"317a9617-...",
  new_parent_id:"322a9617-..."
})`,

  get_users: `## notion.get_users
List all workspace members.
### Parameters
  (none)
### Example
octodock_do(app:"notion", action:"get_users", params:{})`,
};

function getSkill(action?: string): string | null {
  // action 級別：回傳該 action 的完整參數 + 範例
  if (action && ACTION_SKILLS[action]) {
    return ACTION_SKILLS[action];
  }
  // 有 action 但找不到：提示可用的 action
  if (action) return null; // ACTION_SKILLS 沒有的 action → 回傳 null 讓 server.ts fallback 用 actionMap 自動查
  // app 級別：概覽 + action 列表
  return `## Notion — 知識庫與任務管理
管理頁面、資料庫、筆記。輸入輸出都用 Markdown，名稱會自動轉 ID（不用先查 ID）。

### 常見用法
- 「幫我建一頁筆記」→ create_page(title, content?, folder?)
- 「找上週的會議記錄」→ search(query)
- 「把這段加到頁面底部」→ append_content(page_id, content)
- 「把這頁搬到別的位置」→ move_page(page_id, new_parent_id)
- 「查資料庫裡的資料」→ query_database(database, filter?, sorts?)

### 注意事項
- 用完整 36 字元 UUID，不要用短 ID
- replace_content 會覆蓋整頁正文但保留子頁面，大部分情況用 append_content 更安全
- 建議先 search 或 get_page 確認目標再操作

### 全部 actions (${Object.keys(actionMap).length})
  search(query, filter?) — search pages/databases
  create_page(title, content?, folder?) — create page (markdown)
  get_page(page) — get page content (returns markdown)
  replace_content(page_id, content) — replace page body (preserves child pages)
  append_content(page_id, content) — append to end of page
  move_page(page_id, new_parent_id) — move page to different parent
  update_page(page_id, properties?, icon?, cover?) — update properties
  archive_page(page_id) — archive page (recoverable 30 days)
  unarchive_page(page_id) — restore archived page
  delete_page(page_id) — archive page (alias)
  get_page_property(page_id, property_id) — get specific property value
  get_block(block_id) — get single block
  get_block_children(block_id, page_size?) — get child blocks
  append_blocks(block_id, children) — append blocks to page
  update_block(block_id, block_data) — update block content
  delete_block(block_id) — delete block
  query_database(database, filter?, sorts?) — query database
  create_database_item(database, properties, content?) — add row
  create_database(parent_page_id, title, properties) — create new database
  update_database(database_id, title?, properties?) — update database schema
  add_comment(page_id, text) — comment on page
  get_comments(page_id) — list comments on page
  get_users() — list workspace members
Use octodock_help(app:"notion", action:"ACTION") for detailed params + example.`;
}

// ============================================================
// 內部工具定義（21 個 action，對應 18 個內部工具）
// 這些定義保留用於內部路由，不再直接暴露給 MCP
// octodock_do 透過 actionMap 找到工具名稱後，交給 execute() 執行
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
    name: "notion_replace_content",
    description:
      "Replace the entire body content of a Notion page. Deletes all existing blocks and writes new content from Markdown. Use this to edit/rewrite page content.",
    inputSchema: {
      page_id: z.string().describe("Notion page ID"),
      content: z.string().describe("New page content in Markdown format"),
    },
  },
  {
    name: "notion_append_content",
    description:
      "Append content to the end of a Notion page without replacing existing content. Content in Markdown format.",
    inputSchema: {
      page_id: z.string().describe("Notion page ID"),
      content: z.string().describe("Markdown content to append"),
    },
  },
  {
    name: "notion_move_page",
    description:
      "Move a page to a different parent page in the workspace.",
    inputSchema: {
      page_id: z.string().describe("Page ID to move"),
      new_parent_id: z.string().describe("New parent page ID"),
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
      "List all comments on a Notion page. Requires 'Read comments' capability on the integration.",
    inputSchema: {
      page_id: z.string().optional().describe("Page ID to get comments for (preferred)"),
      block_id: z.string().optional().describe("Block ID to get comments for (alternative)"),
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
// 讓 AI 可以用 Markdown 格式寫內容，OctoDock 自動轉成 Notion API 格式
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
    // 引用區塊（> ）
    if (line.startsWith("> ")) {
      return {
        object: "block",
        type: "quote",
        quote: {
          rich_text: [{ type: "text", text: { content: line.slice(2) } }],
        },
      };
    }
    // 表格行（| ... |）
    if (line.startsWith("|") && line.endsWith("|")) {
      const cells = line.split("|").filter(c => c.trim()).map(c => c.trim());
      if (cells.some(c => /^[-:]+$/.test(c))) {
        // This is a separator line, skip it
        return { object: "block", type: "paragraph", paragraph: { rich_text: [] } };
      }
      return {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [{ type: "text", text: { content: cells.join(" | ") } }],
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
// Notion Blocks → Markdown 轉換器（G1/G3 通用框架實作）
// 將 Notion API 回傳的 blocks JSON 轉成 Markdown
// 讓 AI 讀到的格式跟寫入的格式一致（對稱 I/O）
// JSON blocks 體積是 Markdown 的 5-10 倍，轉換後大幅省 tokens
// ============================================================

/** 從 Notion rich_text 陣列提取純文字 */
function richTextToPlain(richText: Array<{ plain_text: string }> | undefined): string {
  if (!richText || richText.length === 0) return "";
  return richText.map((t) => t.plain_text).join("");
}

/**
 * 將 Notion blocks 陣列轉換成 Markdown 字串
 * 支援：標題、段落、列表、待辦、引用、callout、程式碼、分隔線、表格
 */
function blocksToMarkdown(blocks: Array<Record<string, unknown>>): string {
  const lines: string[] = [];

  for (const block of blocks) {
    const type = block.type as string;
    const data = block[type] as Record<string, unknown> | undefined;
    if (!data) continue;

    const text = richTextToPlain(data.rich_text as Array<{ plain_text: string }>);

    switch (type) {
      case "heading_1":
        lines.push(`# ${text}`);
        break;
      case "heading_2":
        lines.push(`## ${text}`);
        break;
      case "heading_3":
        lines.push(`### ${text}`);
        break;
      case "paragraph":
        lines.push(text || "");
        break;
      case "bulleted_list_item":
        lines.push(`- ${text}`);
        break;
      case "numbered_list_item":
        lines.push(`1. ${text}`);
        break;
      case "to_do": {
        const checked = data.checked ? "x" : " ";
        lines.push(`- [${checked}] ${text}`);
        break;
      }
      case "quote":
        lines.push(`> ${text}`);
        break;
      case "callout": {
        const icon = data.icon as { emoji?: string } | undefined;
        const prefix = icon?.emoji ? `${icon.emoji} ` : "";
        lines.push(`> ${prefix}${text}`);
        break;
      }
      case "code": {
        const lang = (data.language as string) || "";
        lines.push(`\`\`\`${lang}\n${text}\n\`\`\``);
        break;
      }
      case "divider":
        lines.push("---");
        break;
      case "toggle":
        // toggle 標題用 details 語法
        lines.push(`<details><summary>${text}</summary></details>`);
        break;
      case "image": {
        const imgData = data as { type?: string; file?: { url: string }; external?: { url: string } };
        const url = imgData.file?.url || imgData.external?.url || "";
        const caption = richTextToPlain(data.caption as Array<{ plain_text: string }>);
        lines.push(`![${caption}](${url})`);
        break;
      }
      case "bookmark": {
        const bmUrl = (data as { url?: string }).url || "";
        const caption = richTextToPlain(data.caption as Array<{ plain_text: string }>);
        lines.push(`[${caption || bmUrl}](${bmUrl})`);
        break;
      }
      case "table_row": {
        const cells = (data.cells as Array<Array<{ plain_text: string }>>) ||
          ((block as Record<string, { cells?: Array<Array<{ plain_text: string }>> }>).table_row?.cells);
        if (cells) {
          const row = cells.map((cell) => richTextToPlain(cell)).join(" | ");
          lines.push(`| ${row} |`);
        }
        break;
      }
      case "child_page": {
        const title = (data as { title?: string }).title || "";
        lines.push(`📄 ${title}`);
        break;
      }
      case "child_database": {
        const title = (data as { title?: string }).title || "";
        lines.push(`📊 ${title}`);
        break;
      }
      default:
        // 未知類型：標記但不丟掉
        if (text) lines.push(text);
        break;
    }
  }

  return lines.join("\n");
}

/**
 * 從 Notion 搜尋/查詢結果中提取精簡的項目摘要
 * 不回傳完整的 properties JSON，只留 AI 需要的：標題、ID、URL、類型
 */
function summarizeSearchResults(results: Array<Record<string, unknown>>): string {
  const items: string[] = [];

  for (const item of results) {
    const id = item.id as string;
    const type = item.object as string; // "page" | "database"
    const url = item.url as string | undefined;

    // 提取標題
    let title = "";
    const props = item.properties as Record<string, unknown> | undefined;
    if (props) {
      // 頁面的 title 屬性
      const titleProp = props.title as { title?: Array<{ plain_text: string }> } | undefined;
      if (titleProp?.title?.[0]?.plain_text) {
        title = titleProp.title[0].plain_text;
      }
      // 資料庫項目的 Name 屬性
      const nameProp = props.Name as { title?: Array<{ plain_text: string }> } | undefined;
      if (!title && nameProp?.title?.[0]?.plain_text) {
        title = nameProp.title[0].plain_text;
      }
    }
    // 資料庫本身的 title
    const dbTitle = item.title as Array<{ plain_text: string }> | undefined;
    if (!title && dbTitle?.[0]?.plain_text) {
      title = dbTitle[0].plain_text;
    }

    items.push(`- **${title || "(untitled)"}** (${type}) id:${id}${url ? ` ${url}` : ""}`);
  }

  return items.join("\n");
}

/**
 * 從 Notion property value 中提取可讀文字
 * 支援所有常見 property types
 */
function extractPropertyValue(prop: Record<string, unknown>): string {
  const type = prop.type as string;
  switch (type) {
    case "title": {
      const arr = prop.title as Array<{ plain_text: string }> | undefined;
      return arr?.map((t) => t.plain_text).join("") || "";
    }
    case "rich_text": {
      const arr = prop.rich_text as Array<{ plain_text: string }> | undefined;
      return arr?.map((t) => t.plain_text).join("") || "";
    }
    case "number":
      return prop.number != null ? String(prop.number) : "";
    case "select": {
      const sel = prop.select as { name: string } | null;
      return sel?.name || "";
    }
    case "multi_select": {
      const arr = prop.multi_select as Array<{ name: string }> | undefined;
      return arr?.map((s) => s.name).join(", ") || "";
    }
    case "status": {
      const st = prop.status as { name: string } | null;
      return st?.name || "";
    }
    case "date": {
      const d = prop.date as { start: string; end?: string } | null;
      if (!d) return "";
      return d.end ? `${d.start} → ${d.end}` : d.start;
    }
    case "checkbox":
      return prop.checkbox ? "✅" : "⬜";
    case "url":
      return (prop.url as string) || "";
    case "email":
      return (prop.email as string) || "";
    case "phone_number":
      return (prop.phone_number as string) || "";
    case "formula": {
      const f = prop.formula as Record<string, unknown>;
      if (f?.string) return f.string as string;
      if (f?.number != null) return String(f.number);
      if (f?.boolean != null) return f.boolean ? "true" : "false";
      if (f?.date) return (f.date as { start: string }).start || "";
      return "";
    }
    case "relation": {
      const arr = prop.relation as Array<{ id: string }> | undefined;
      return arr?.map((r) => r.id).join(", ") || "";
    }
    case "rollup": {
      const r = prop.rollup as Record<string, unknown>;
      if (r?.number != null) return String(r.number);
      const arr = r?.array as Array<Record<string, unknown>> | undefined;
      if (arr) return arr.map((item) => extractPropertyValue(item)).filter(Boolean).join(", ");
      return "";
    }
    case "people": {
      const arr = prop.people as Array<{ name?: string }> | undefined;
      return arr?.map((p) => p.name || "?").join(", ") || "";
    }
    case "created_time":
      return (prop.created_time as string)?.substring(0, 10) || "";
    case "last_edited_time":
      return (prop.last_edited_time as string)?.substring(0, 10) || "";
    case "created_by":
    case "last_edited_by": {
      const user = prop[type] as { name?: string } | undefined;
      return user?.name || "";
    }
    case "files": {
      const arr = prop.files as Array<{ name: string }> | undefined;
      return arr?.map((f) => f.name).join(", ") || "";
    }
    default:
      return "";
  }
}

/**
 * 從 Notion 資料庫查詢結果中提取項目摘要（包含各欄位值）
 * 比 summarizeSearchResults 更豐富，適合 query_database 的回傳
 */
function summarizeDatabaseItems(results: Array<Record<string, unknown>>): string {
  const items: string[] = [];

  for (const item of results) {
    const id = item.id as string;
    const url = item.url as string | undefined;
    const props = item.properties as Record<string, unknown> | undefined;

    if (!props) {
      items.push(`- (untitled) id:${id}`);
      continue;
    }

    // 提取標題（title 類型的 property）
    let title = "";
    const fields: string[] = [];

    for (const [key, val] of Object.entries(props)) {
      const prop = val as Record<string, unknown>;
      const type = prop.type as string;

      // title 類型 → 作為項目標題
      if (type === "title") {
        const arr = prop.title as Array<{ plain_text: string }> | undefined;
        title = arr?.map((t) => t.plain_text).join("") || "";
        continue;
      }

      // 其他類型 → 提取值
      const value = extractPropertyValue(prop);
      if (value) {
        fields.push(`${key}: ${value}`);
      }
    }

    // 組合輸出
    let line = `- **${title || "(untitled)"}** id:${id}`;
    if (url) line += ` ${url}`;
    if (fields.length > 0) line += `\n  ${fields.join(" | ")}`;
    items.push(line);
  }

  return items.join("\n");
}

/**
 * 回傳格式轉換（G1/G3 通用框架）
 * 將 Notion API 的 raw JSON 轉成 AI 友善的 Markdown
 * 讀出來的格式和寫入的格式一致，AI 可以「讀 → 改 → 寫回」
 */
function formatResponse(action: string, rawData: unknown): string {
  if (typeof rawData !== "object" || rawData === null) {
    return String(rawData);
  }

  const data = rawData as Record<string, unknown>;

  switch (action) {
    // ── 搜尋結果：精簡為 title + id 列表 ──
    case "search": {
      const results = data.results as Array<Record<string, unknown>> | undefined;
      if (!results || results.length === 0) return "No results found.";
      const hasMore = data.has_more as boolean;
      let output = `Found ${results.length} results:\n\n${summarizeSearchResults(results)}`;
      if (hasMore) output += "\n\n(more results available — refine your query)";
      return output;
    }

    // ── 取得頁面：properties 摘要 + 內容轉 Markdown ──
    case "get_page": {
      const page = data.page as Record<string, unknown> | undefined;
      const blocksData = data.blocks as Record<string, unknown> | undefined;
      const sections: string[] = [];

      // 頁面基本資訊
      if (page) {
        const url = page.url as string | undefined;
        const props = page.properties as Record<string, unknown> | undefined;
        if (props) {
          // 提取標題
          const titleProp = props.title as { title?: Array<{ plain_text: string }> } | undefined;
          if (titleProp?.title?.[0]?.plain_text) {
            sections.push(`# ${titleProp.title[0].plain_text}`);
          }
        }
        if (url) sections.push(`URL: ${url}`);
        sections.push(`ID: ${page.id}`);
        sections.push("");
      }

      // 內容轉 Markdown
      if (blocksData) {
        const blocks = (blocksData.results || blocksData) as Array<Record<string, unknown>>;
        if (Array.isArray(blocks)) {
          sections.push(blocksToMarkdown(blocks));
        }
      }

      return sections.join("\n");
    }

    // ── 資料庫查詢結果：包含各欄位的值 ──
    case "query_database": {
      const results = data.results as Array<Record<string, unknown>> | undefined;
      if (!results || results.length === 0) return "No items found in database.";
      return `Found ${results.length} items:\n\n${summarizeDatabaseItems(results)}`;
    }

    // ── 建立頁面：回傳含 parent 資訊 ──
    case "create_page": {
      const url = data.url as string | undefined;
      const id = data.id as string | undefined;
      // 從回傳中提取 parent 資訊
      const parent = data.parent as Record<string, unknown> | undefined;
      let parentInfo = "";
      if (parent) {
        const parentPageId = parent.page_id as string | undefined;
        const parentDbId = parent.database_id as string | undefined;
        const parentWorkspace = parent.workspace as boolean | undefined;
        if (parentPageId) parentInfo = ` | Parent page: ${parentPageId}`;
        else if (parentDbId) parentInfo = ` | Parent database: ${parentDbId}`;
        else if (parentWorkspace) parentInfo = ` | Parent: workspace`;
      }
      return url ? `Done. ${url}${parentInfo}` : `Done. ID: ${id}${parentInfo}`;
    }

    // ── 其他建立/更新/刪除操作：精簡為 ok + url ──
    case "create_database_item":
    case "create_database":
    case "update_page":
    case "replace_content":
    case "append_content":
    case "append_blocks":
    case "update_database":
    case "archive_page":
    case "unarchive_page":
    case "delete_page":
    case "delete_block": {
      const url = data.url as string | undefined;
      const id = data.id as string | undefined;
      return url ? `Done. ${url}` : `Done. ID: ${id}`;
    }

    case "move_page": {
      const url = data.url as string | undefined;
      return url ? `Done. Moved to ${url}` : `Done. Page moved.`;
    }

    // ── 區塊內容：轉 Markdown ──
    case "get_block": {
      // 單一 block 轉 Markdown
      return blocksToMarkdown([data]);
    }

    case "get_block_children": {
      // 子 blocks 轉 Markdown
      const blocks = data.results as Array<Record<string, unknown>> | undefined;
      if (!blocks || blocks.length === 0) return "(empty page)";
      return blocksToMarkdown(blocks);
    }

    case "update_block": {
      return "Done. Block updated.";
    }

    // ── 用戶列表 ──
    case "get_users": {
      const users = data.results as Array<Record<string, unknown>> | undefined;
      if (!users || users.length === 0) return "No users found.";
      return users.map((u) => {
        const name = u.name as string || "?";
        const type = u.type as string || "?";
        const email = (u.person as Record<string, unknown>)?.email as string || "";
        return `- **${name}** (${type})${email ? ` ${email}` : ""}`;
      }).join("\n");
    }

    // ── 評論 ──
    case "get_comments":
    case "add_comment": {
      const comments = data.results as Array<Record<string, unknown>> | undefined;
      if (comments && Array.isArray(comments)) {
        if (comments.length === 0) return "No comments.";
        return comments.map((c) => {
          const rt = (c.rich_text as Array<{ plain_text: string }>) || [];
          const text = rt.map((t) => t.plain_text).join("");
          const by = (c.created_by as Record<string, unknown>)?.name as string || "?";
          return `- **${by}**: ${text}`;
        }).join("\n");
      }
      // add_comment 回傳單一 comment
      const rt = (data.rich_text as Array<{ plain_text: string }>) || [];
      const text = rt.map((t) => t.plain_text).join("");
      return `Done. Comment: "${text}"`;
    }

    // ── 頁面屬性 ──
    case "get_page_property": {
      return JSON.stringify(rawData, null, 2);
    }

    // ── 其他 action ──
    default:
      return JSON.stringify(rawData, null, 2);
  }
}

// ============================================================
// 工具執行路由
// 根據工具名稱分派到對應的 Notion API 呼叫
// 這是 Adapter 的核心邏輯，octodock_do 最終會呼叫這裡
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

    // ── 取得頁面（同時拉頁面屬性和完整內容區塊）──
    // F1: 用 fetchAllBlocks 處理分頁，確保超過 100 blocks 的頁面不會被截斷
    case "notion_get_page": {
      // _metadataOnly: pre-context / dry-run 只需要頁面 metadata，跳過 block 抓取
      if (params._metadataOnly) {
        const page = await notionFetch(`/pages/${params.page_id}`, token);
        return {
          content: [
            { type: "text", text: JSON.stringify({ page }, null, 2) },
          ],
        };
      }
      const [page, allBlocks] = await Promise.all([
        notionFetch(`/pages/${params.page_id}`, token),
        fetchAllBlocks(params.page_id as string, token),
      ]);
      const blocks = wrapBlockResults(allBlocks);
      return {
        content: [
          { type: "text", text: JSON.stringify({ page, blocks }, null, 2) },
        ],
      };
    }

    // ── 建立頁面（自動分批：超過 100 blocks 時先建頁再 append 剩餘）──
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
      let allBlocks: Array<Record<string, unknown>> = [];
      if (params.content) {
        allBlocks = markdownToBlocks(params.content as string);
      }

      // Notion API 限制每次最多 NOTION_API_BLOCK_LIMIT 個 blocks
      body.children = allBlocks.slice(0, NOTION_API_BLOCK_LIMIT);

      const result = await notionFetch("/pages", token, {
        method: "POST",
        body: JSON.stringify(body),
      }) as Record<string, unknown>;

      // 超過 100 blocks：用 append_blocks 補剩下的（對呼叫者透明）
      if (allBlocks.length > NOTION_API_BLOCK_LIMIT) {
        const pageId = result.id as string;
        const remaining = allBlocks.slice(NOTION_API_BLOCK_LIMIT);
        // 每次 append 100 個，直到全部寫完
        for (let i = 0; i < remaining.length; i += NOTION_API_BLOCK_LIMIT) {
          const batch = remaining.slice(i, i + NOTION_API_BLOCK_LIMIT);
          await notionFetch(`/blocks/${pageId}/children`, token, {
            method: "PATCH",
            body: JSON.stringify({ children: batch }),
          });
        }
      }

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // ── 更新頁面屬性 ──
    // H2 修正：支援 title 快捷參數，自動轉成 Notion properties 格式
    // I2: 加 read-back 驗證，確認標題確實改了
    case "notion_update_page": {
      const body: Record<string, unknown> = {};
      // 處理 properties（原生格式或快捷格式）
      const props: Record<string, unknown> = (params.properties as Record<string, unknown>) ?? {};
      // 快捷參數：title 自動轉成 Notion title property 格式
      if (params.title && typeof params.title === "string") {
        props.title = {
          title: [{ type: "text", text: { content: params.title } }],
        };
      }
      if (Object.keys(props).length > 0) body.properties = props;
      if (params.icon) body.icon = params.icon;
      if (params.cover) body.cover = params.cover;

      const result = await notionFetch(`/pages/${params.page_id}`, token, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      // I2: read-back 驗證 — 如果有改標題，確認標題確實變了
      if (params.title && typeof params.title === "string") {
        const verify = await notionFetch(`/pages/${params.page_id}`, token) as Record<string, unknown>;
        const verifyProps = verify.properties as Record<string, unknown> | undefined;
        const titleProp = verifyProps?.title as { title?: Array<{ plain_text: string }> } | undefined;
        const actualTitle = titleProp?.title?.[0]?.plain_text;
        if (actualTitle && actualTitle !== params.title) {
          throw new Error(
            `Update verification failed: title is "${actualTitle}", expected "${params.title}" (NOTION_UPDATE_VERIFY_FAILED)`,
          );
        }
      }
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // ── 全文替換頁面內容（G2: CRUD 完整閉環） ──
    // Notion API 沒有 "update content" endpoint，所以用組合操作：
    // 1. 取得所有現有 blocks
    // 2. 過濾出非子頁面/子資料庫的 blocks，逐一刪除
    // 3. 用新的 Markdown 內容建立新 blocks
    // 注意：child_page 和 child_database 類型的 block 會被保留，不會被刪除
    case "notion_replace_content": {
      const pageId = params.page_id as string;
      const newContent = params.content as string;

      // Step 1: 取得現有的所有 child blocks
      const existing = (await notionFetch(
        `/blocks/${pageId}/children?page_size=${NOTION_API_BLOCK_LIMIT}`,
        token,
      )) as { results: Array<{ id: string; type: string; child_page?: { title: string }; child_database?: { title: string } }> };

      // Step 1.5: 分離子頁面/子資料庫和一般 block
      const preservedTypes = new Set(["child_page", "child_database"]);
      const blocksToDelete = existing.results.filter((b) => !preservedTypes.has(b.type));
      const preservedBlocks = existing.results.filter((b) => preservedTypes.has(b.type));

      // Step 2: 只刪除非子頁面/非子資料庫的 blocks（Notion 不支援批次刪除）
      const deletePromises = blocksToDelete.map((block) =>
        notionFetch(`/blocks/${block.id}`, token, { method: "DELETE" }).catch(() => {
          // 某些 block 可能無法刪除，跳過
        }),
      );
      await Promise.all(deletePromises);

      // Step 3: 用新的 Markdown 內容建立新 blocks（自動分批）
      const newBlocks = markdownToBlocks(newContent);
      for (let i = 0; i < newBlocks.length; i += NOTION_API_BLOCK_LIMIT) {
        const batch = newBlocks.slice(i, i + NOTION_API_BLOCK_LIMIT);
        await notionFetch(`/blocks/${pageId}/children`, token, {
          method: "PATCH",
          body: JSON.stringify({ children: batch }),
        });
      }

      // 回傳頁面資訊（含子頁面保留提示）
      const updatedPage = await notionFetch(`/pages/${pageId}`, token);
      const responseData: Record<string, unknown> = updatedPage as Record<string, unknown>;
      // 如果有保留的子頁面/子資料庫，在回傳中提示
      if (preservedBlocks.length > 0) {
        const preserved = preservedBlocks.map((b) => {
          const title = b.child_page?.title ?? b.child_database?.title ?? "untitled";
          return `${b.type}: "${title}" (${b.id})`;
        });
        responseData._preserved_children = preserved;
        responseData._note = `${preservedBlocks.length} child page(s)/database(s) were preserved (not deleted).`;
      }
      return {
        content: [{ type: "text", text: JSON.stringify(responseData, null, 2) }],
      };
    }

    // ── 尾部追加內容（不覆蓋，自動分批 100 blocks） ──
    case "notion_append_content": {
      const pageId = params.page_id as string;
      const content = params.content as string;

      // 將 Markdown 轉成 Notion blocks，分批追加（每次最多 NOTION_API_BLOCK_LIMIT 個）
      const blocks = markdownToBlocks(content);
      for (let i = 0; i < blocks.length; i += NOTION_API_BLOCK_LIMIT) {
        const batch = blocks.slice(i, i + NOTION_API_BLOCK_LIMIT);
        await notionFetch(`/blocks/${pageId}/children`, token, {
          method: "PATCH",
          body: JSON.stringify({ children: batch }),
        });
      }

      const page = await notionFetch(`/pages/${pageId}`, token);
      return {
        content: [{ type: "text", text: JSON.stringify(page, null, 2) }],
      };
    }

    // ── 移動頁面到不同父頁面 ──
    // H1 修正：PATCH /pages 不支援改 parent（parent 是 read-only）
    // 改用專用的 POST /pages/{id}/move endpoint（需 API version 2025-09-03+）
    // I1: 加 read-back 驗證，確認 parent 確實改了
    case "notion_move_page": {
      const parentType = (params.parent_type as string) ?? "page_id";
      const moveRes = await fetch(
        `${NOTION_API}/pages/${params.page_id}/move`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Notion-Version": "2025-09-03",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            parent: { [parentType]: params.new_parent_id },
          }),
        },
      );
      if (!moveRes.ok) {
        const error = await moveRes.json().catch(() => ({
          message: moveRes.statusText,
        }));
        throw new Error(
          `Notion API error (${moveRes.status}): ${(error as { message: string }).message} (NOTION_MOVE_ERROR)`,
        );
      }
      const result = await moveRes.json();
      // I1: read-back 驗證 — 確認 parent 確實變了
      const verify = await notionFetch(`/pages/${params.page_id}`, token) as Record<string, unknown>;
      const actualParent = verify.parent as Record<string, unknown> | undefined;
      const actualParentId = actualParent?.[parentType] as string | undefined;
      if (actualParentId && actualParentId !== params.new_parent_id) {
        throw new Error(
          `Move verification failed: parent is still "${actualParentId}", expected "${params.new_parent_id}" (NOTION_MOVE_VERIFY_FAILED)`,
        );
      }
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // ── 刪除（封存）頁面 ──
    // archive_page 和 delete_page 都走 Notion 的 archived: true（可復原）
    case "notion_archive_page":
    case "notion_delete_page": {
      const result = await notionFetch(`/pages/${params.page_id}`, token, {
        method: "PATCH",
        body: JSON.stringify({ archived: true }),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // ── 取消歸檔頁面（從垃圾桶復原） ──
    case "notion_unarchive_page": {
      const result = await notionFetch(`/pages/${params.page_id}`, token, {
        method: "PATCH",
        body: JSON.stringify({ archived: false }),
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

    // ── 取得區塊的子區塊（頁面內容結構）──
    // F1: 用 fetchAllBlocks 處理分頁
    case "notion_get_block_children": {
      const allBlocks = await fetchAllBlocks(params.block_id as string, token);
      const result = wrapBlockResults(allBlocks);
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

    // ── 取得評論列表（支援 page_id 或 block_id） ──
    case "notion_get_comments": {
      const blockId = (params.page_id || params.block_id) as string;
      const result = await notionFetch(
        `/comments?block_id=${blockId}`,
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

// ============================================================
// 智慧錯誤引導（B3）
// 攔截 Notion API 常見錯誤，回傳對用戶有用的提示
// ============================================================

/** 將 Notion API 錯誤轉成有用的提示 */
function notionFormatError(action: string, errorMessage: string): string | null {
  const msg = errorMessage.toLowerCase();

  // 找不到資源
  if (msg.includes("could not find") || msg.includes("not found")) {
    if (action === "get_comments") {
      return "找不到此頁面的評論。請確認：1) Notion integration 權限已勾選「Read comments」 2) 使用的是 page ID 而非 block ID";
    }
    return `找不到指定的資源。請用 search 先搜尋確認 ID 是否正確，或檢查該頁面是否已分享給 OctoDock integration。`;
  }

  // 權限不足
  if (msg.includes("unauthorized") || msg.includes("forbidden") || msg.includes("insufficient permissions")) {
    return "權限不足。請到 Notion 設定確認：1) OctoDock integration 已被加入該頁面 2) integration 的 capabilities 包含所需權限（Read/Update/Insert content, Read comments）";
  }

  // 格式錯誤
  if (msg.includes("validation_error") || msg.includes("invalid")) {
    if (action === "create_page" || action === "create_database_item") {
      return "參數格式錯誤。create_page 需要 title（必填）和 content（Markdown 格式）。如果指定 parent，請用 search 先找到正確的 page/database ID。";
    }
    return `參數格式錯誤。使用 octodock_help(app: "notion", action: "${action}") 查看正確的參數格式。`;
  }

  // Rate limit
  if (msg.includes("rate_limited") || msg.includes("rate limit")) {
    return "Notion API 速率限制（3 次/秒）。請稍後再試。";
  }

  // 不攔截的錯誤回傳 null，使用原始錯誤訊息
  return null;
}

export const notionAdapter: AppAdapter = {
  name: "notion",
  displayName: { zh: "Notion", en: "Notion" },
  icon: "notion",
  authType: "oauth2",
  authConfig,
  tools,
  actionMap, // do + help 架構：簡化 action → 內部工具對應
  getSkill, // do + help 架構：回傳精簡操作說明
  formatResponse, // G1/G3 通用框架：raw JSON → AI 友善格式（Markdown）
  formatError: notionFormatError, // B3：智慧錯誤引導
  execute,
  // Notion token 不會過期 — 不需要 refreshToken
};
