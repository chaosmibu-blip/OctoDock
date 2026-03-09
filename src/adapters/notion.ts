import { z } from "zod";
import type {
  AppAdapter,
  OAuthConfig,
  ToolDefinition,
  ToolResult,
} from "./types";

const authConfig: OAuthConfig = {
  type: "oauth2",
  authorizeUrl: "https://api.notion.com/v1/oauth/authorize",
  tokenUrl: "https://api.notion.com/v1/oauth/token",
  scopes: [], // Notion doesn't use scopes in the traditional sense
  authMethod: "basic", // Notion uses Basic Auth for token exchange
};

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

function notionHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

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
// Tool Definitions (18 tools — full Notion API coverage)
// ============================================================

const tools: ToolDefinition[] = [
  // ── Search ──
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

  // ── Pages ──
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

  // ── Blocks ──
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

  // ── Databases ──
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

  // ── Comments ──
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

  // ── Users ──
  {
    name: "notion_get_users",
    description:
      "List all users in the Notion workspace, including their names, emails, and avatar URLs.",
    inputSchema: {},
  },
];

// Convert markdown text to Notion blocks (simplified)
function markdownToBlocks(
  markdown: string,
): Array<Record<string, unknown>> {
  return markdown.split("\n").map((line) => {
    // Headings
    if (line.startsWith("### ")) {
      return {
        object: "block",
        type: "heading_3",
        heading_3: {
          rich_text: [{ type: "text", text: { content: line.slice(4) } }],
        },
      };
    }
    if (line.startsWith("## ")) {
      return {
        object: "block",
        type: "heading_2",
        heading_2: {
          rich_text: [{ type: "text", text: { content: line.slice(3) } }],
        },
      };
    }
    if (line.startsWith("# ")) {
      return {
        object: "block",
        type: "heading_1",
        heading_1: {
          rich_text: [{ type: "text", text: { content: line.slice(2) } }],
        },
      };
    }
    // Bullet list
    if (line.startsWith("- ") || line.startsWith("* ")) {
      return {
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: {
          rich_text: [{ type: "text", text: { content: line.slice(2) } }],
        },
      };
    }
    // Numbered list
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
    // Todo
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
    // Code block marker (simplified — single line)
    if (line.startsWith("```")) {
      return {
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: [] },
      };
    }
    // Divider
    if (line === "---" || line === "***") {
      return { object: "block", type: "divider", divider: {} };
    }
    // Default: paragraph
    return {
      object: "block",
      type: "paragraph",
      paragraph: {
        rich_text: [{ type: "text", text: { content: line } }],
      },
    };
  }).filter((b) => {
    // Remove empty paragraphs from code block markers
    if (b.type === "paragraph") {
      const rt = (b.paragraph as { rich_text: Array<{ text: { content: string } }> }).rich_text;
      return rt.length > 0;
    }
    return true;
  });
}

// ============================================================
// Execute
// ============================================================

async function execute(
  toolName: string,
  params: Record<string, unknown>,
  token: string,
): Promise<ToolResult> {
  switch (toolName) {
    // ── Search ──
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

    // ── Pages ──
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

      if (params.parent_id) {
        body.parent = { [parentType]: params.parent_id };
      }

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

    case "notion_delete_page": {
      const result = await notionFetch(`/pages/${params.page_id}`, token, {
        method: "PATCH",
        body: JSON.stringify({ archived: true }),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    case "notion_get_page_property": {
      const result = await notionFetch(
        `/pages/${params.page_id}/properties/${params.property_id}`,
        token,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // ── Blocks ──
    case "notion_get_block": {
      const result = await notionFetch(`/blocks/${params.block_id}`, token);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

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

    case "notion_update_block": {
      const result = await notionFetch(`/blocks/${params.block_id}`, token, {
        method: "PATCH",
        body: JSON.stringify(params.block_data),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    case "notion_delete_block": {
      const result = await notionFetch(`/blocks/${params.block_id}`, token, {
        method: "DELETE",
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // ── Databases ──
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

    // ── Comments ──
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

    case "notion_get_comments": {
      const result = await notionFetch(
        `/comments?block_id=${params.block_id}`,
        token,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // ── Users ──
    case "notion_get_users": {
      const result = await notionFetch("/users", token);
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

export const notionAdapter: AppAdapter = {
  name: "notion",
  displayName: { zh: "Notion", en: "Notion" },
  icon: "notion",
  authType: "oauth2",
  authConfig,
  tools,
  execute,
  // Notion tokens don't expire — no refreshToken needed
};
