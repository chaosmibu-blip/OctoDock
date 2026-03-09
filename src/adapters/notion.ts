import { z } from "zod";
import type {
  AppAdapter,
  OAuthConfig,
  ToolDefinition,
  ToolResult,
  TokenSet,
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

const tools: ToolDefinition[] = [
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
        .describe(
          "Parent page or database ID. Use notion_search first if unsure.",
        ),
    },
  },
  {
    name: "notion_update_page",
    description:
      "Update properties of an existing Notion page. Use notion_get_page first to see current properties.",
    inputSchema: {
      page_id: z.string().describe("Notion page ID to update"),
      properties: z
        .record(z.string(), z.unknown())
        .describe("Properties to update in Notion API format"),
    },
  },
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
    },
  },
];

// Convert markdown text to Notion blocks (simplified)
function markdownToBlocks(
  markdown: string,
): Array<Record<string, unknown>> {
  return markdown.split("\n").map((line) => ({
    object: "block",
    type: "paragraph",
    paragraph: {
      rich_text: [{ type: "text", text: { content: line } }],
    },
  }));
}

async function execute(
  toolName: string,
  params: Record<string, unknown>,
  token: string,
): Promise<ToolResult> {
  switch (toolName) {
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

    case "notion_get_page": {
      const [page, blocks] = await Promise.all([
        notionFetch(`/pages/${params.page_id}`, token),
        notionFetch(`/blocks/${params.page_id}/children?page_size=100`, token),
      ]);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ page, blocks }, null, 2),
          },
        ],
      };
    }

    case "notion_create_page": {
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
        // Try as page first; Notion API will tell us if it's a database
        body.parent = { page_id: params.parent_id };
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
      const result = await notionFetch(`/pages/${params.page_id}`, token, {
        method: "PATCH",
        body: JSON.stringify({ properties: params.properties }),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

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
      const result = await notionFetch("/pages", token, {
        method: "POST",
        body: JSON.stringify({
          parent: { database_id: params.database_id },
          properties: params.properties,
        }),
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
