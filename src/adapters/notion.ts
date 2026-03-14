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

  delete_page: `## notion.delete_page
Archive a page (recoverable within 30 days).
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

  get_users: `## notion.get_users
List all workspace members.
### Parameters
  (none)
### Example
octodock_do(app:"notion", action:"get_users", params:{})`,
};

function getSkill(action?: string): string {
  // action 級別：回傳該 action 的完整參數 + 範例
  if (action && ACTION_SKILLS[action]) {
    return ACTION_SKILLS[action];
  }
  // 有 action 但找不到：提示可用的 action
  if (action) {
    return `Action "${action}" not found. Available: ${Object.keys(ACTION_SKILLS).join(", ")}`;
  }
  // app 級別：精簡清單
  return `notion actions:
  search(query, filter?) — search pages/databases
  create_page(title, content?, folder?) — create page (content in markdown)
  get_page(page) — get page content (returns markdown)
  replace_content(page_id, content) — replace entire page body (markdown)
  update_page(page_id, properties?, icon?, cover?) — update page properties only
  delete_page(page_id) — archive page
  query_database(database, filter?, sorts?) — query database
  create_database_item(database, properties, content?) — add row
  add_comment(page_id, text) — comment on page
  get_comments(block_id) — list comments
  get_users() — list workspace members
Input/output use markdown. Names auto-resolve to IDs. Use octodock_help(app:"notion", action:"ACTION") for detailed params + example.`;
}

// ============================================================
// 內部工具定義（18 個工具）
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
 * 回傳格式轉換（G1/G3 通用框架）
 * 將 Notion API 的 raw JSON 轉成 AI 友善的 Markdown
 * 讀出來的格式和寫入的格式一致，AI 可以「讀 → 改 → 寫回」
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
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

    // ── 資料庫查詢結果 ──
    case "query_database": {
      const results = data.results as Array<Record<string, unknown>> | undefined;
      if (!results || results.length === 0) return "No items found in database.";
      return `Found ${results.length} items:\n\n${summarizeSearchResults(results)}`;
    }

    // ── 建立/更新操作：精簡為 ok + url ──
    case "create_page":
    case "create_database_item":
    case "create_database":
    case "update_page":
    case "replace_content":
    case "delete_page": {
      const url = data.url as string | undefined;
      const id = data.id as string | undefined;
      return url ? `Done. ${url}` : `Done. ID: ${id}`;
    }

    // ── 其他 action 不特別轉換 ──
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

    // ── 全文替換頁面內容（G2: CRUD 完整閉環） ──
    // Notion API 沒有 "update content" endpoint，所以用組合操作：
    // 1. 取得所有現有 blocks
    // 2. 逐一刪除
    // 3. 用新的 Markdown 內容建立新 blocks
    case "notion_replace_content": {
      const pageId = params.page_id as string;
      const newContent = params.content as string;

      // Step 1: 取得現有的所有 child blocks
      const existing = (await notionFetch(
        `/blocks/${pageId}/children?page_size=100`,
        token,
      )) as { results: Array<{ id: string }> };

      // Step 2: 逐一刪除現有 blocks（Notion 不支援批次刪除）
      const deletePromises = existing.results.map((block) =>
        notionFetch(`/blocks/${block.id}`, token, { method: "DELETE" }).catch(() => {
          // 某些 block 可能無法刪除（例如子頁面），跳過
        }),
      );
      await Promise.all(deletePromises);

      // Step 3: 用新的 Markdown 內容建立新 blocks
      const newBlocks = markdownToBlocks(newContent);
      if (newBlocks.length > 0) {
        await notionFetch(`/blocks/${pageId}/children`, token, {
          method: "PATCH",
          body: JSON.stringify({ children: newBlocks }),
        });
      }

      // 回傳頁面資訊
      const updatedPage = await notionFetch(`/pages/${pageId}`, token);
      return {
        content: [{ type: "text", text: JSON.stringify(updatedPage, null, 2) }],
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
