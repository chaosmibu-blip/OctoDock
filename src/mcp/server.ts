import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { db } from "@/db";
import { connectedApps, operations, conversations } from "@/db/schema";
import { eq, sql, desc, and } from "drizzle-orm";
import { getAdapter, getAllAdapters } from "./registry";
import { executeWithMiddleware } from "./middleware/logger";
import { queryMemory, storeMemory } from "@/services/memory-engine";

type User = { id: string; email: string; name: string | null };

export async function createServerForUser(user: User): Promise<McpServer> {
  const server = new McpServer({ name: "agentdock", version: "1.0.0" });

  // Get user's connected apps
  const apps = await db
    .select()
    .from(connectedApps)
    .where(eq(connectedApps.userId, user.id));

  const connectedAppNames = apps
    .filter((a) => a.status === "active")
    .map((a) => a.appName);

  // Dynamically register tools from adapters
  for (const appName of connectedAppNames) {
    const adapter = getAdapter(appName);
    if (!adapter) continue;

    for (const tool of adapter.tools) {
      server.tool(tool.name, tool.description, tool.inputSchema, async (params) => {
        return executeWithMiddleware(
          user.id,
          tool.name,
          params as Record<string, unknown>,
          (p, token) => adapter.execute(tool.name, p, token),
        );
      });
    }
  }

  // Register system tools
  registerSystemTools(server, user.id);

  return server;
}

function registerSystemTools(server: McpServer, userId: string): void {
  server.tool(
    "agentdock_list_apps",
    "List all apps connected to the user's AgentDock account, including their status and available tools.",
    {},
    async () => {
      const apps = await db
        .select()
        .from(connectedApps)
        .where(eq(connectedApps.userId, userId));

      const appList = apps.map((a) => ({
        name: a.appName,
        status: a.status,
        connectedAt: a.connectedAt,
      }));

      return {
        content: [{ type: "text" as const, text: JSON.stringify(appList, null, 2) }],
      };
    },
  );

  server.tool(
    "agentdock_memory_query",
    "Query the user's cross-agent memory. Search for preferences, patterns, and context that persist across different AI agents.",
    {
      query: z.string().describe("Natural language query to search memory"),
      category: z
        .enum(["preference", "pattern", "context"])
        .optional()
        .describe("Filter by memory category"),
    },
    async (params) => {
      const results = await queryMemory(
        userId,
        params.query as string,
        params.category as string | undefined,
      );

      if (results.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No matching memories found." }],
        };
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
      };
    },
  );

  server.tool(
    "agentdock_memory_store",
    "Store a new memory entry for the user. Memories persist across different AI agents and sessions.",
    {
      key: z.string().describe("Short identifier for this memory"),
      value: z.string().describe("The memory content to store"),
      category: z
        .enum(["preference", "pattern", "context"])
        .describe("Memory category"),
      app_name: z
        .string()
        .optional()
        .describe("Associated app name, or omit for cross-app memory"),
    },
    async (params) => {
      await storeMemory(
        userId,
        params.key as string,
        params.value as string,
        params.category as string,
        params.app_name as string | undefined,
      );

      return {
        content: [{ type: "text" as const, text: "Memory stored successfully." }],
      };
    },
  );

  server.tool(
    "agentdock_discover_tools",
    "Search for additional tools that are not currently loaded. Use this when the user needs functionality beyond the currently available tools. Results are ranked by relevance and the user's historical usage patterns.",
    {
      query: z.string().describe("Describe what you want to do"),
    },
    async (params) => {
      const allAdapters = getAllAdapters();
      const query = (params.query as string).toLowerCase();

      // Get user's tool usage frequency for ranking
      const usageStats = await db
        .select({
          toolName: operations.toolName,
          count: sql<number>`count(*)::int`,
        })
        .from(operations)
        .where(
          and(
            eq(operations.userId, userId),
            eq(operations.success, true),
          ),
        )
        .groupBy(operations.toolName)
        .orderBy(desc(sql`count(*)`));

      const usageMap = new Map(usageStats.map((s) => [s.toolName, s.count]));

      const matches = allAdapters
        .flatMap((adapter) =>
          adapter.tools
            .filter(
              (t) =>
                t.name.toLowerCase().includes(query) ||
                t.description.toLowerCase().includes(query),
            )
            .map((t) => ({
              app: adapter.name,
              tool: t.name,
              description: t.description,
              usageCount: usageMap.get(t.name) ?? 0,
            })),
        )
        .sort((a, b) => b.usageCount - a.usageCount);

      if (matches.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No matching tools found. Available apps: " +
                allAdapters.map((a) => `${a.name} (${a.tools.length} tools)`).join(", "),
            },
          ],
        };
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(matches, null, 2) }],
      };
    },
  );

  server.tool(
    "agentdock_bot_conversations",
    "View recent bot conversation history for a platform (LINE or Telegram). Shows messages between external users and the auto-reply bot.",
    {
      platform: z.enum(["line", "telegram"]).describe("Bot platform"),
      platform_user_id: z
        .string()
        .optional()
        .describe("Filter by specific external user ID"),
      limit: z.number().optional().describe("Number of messages to return (default 20, max 100)"),
    },
    async (params) => {
      const conditions = [
        eq(conversations.userId, userId),
        eq(conversations.platform, params.platform as string),
      ];

      if (params.platform_user_id) {
        conditions.push(
          eq(conversations.platformUserId, params.platform_user_id as string),
        );
      }

      const results = await db
        .select({
          platform: conversations.platform,
          platformUserId: conversations.platformUserId,
          role: conversations.role,
          content: conversations.content,
          createdAt: conversations.createdAt,
        })
        .from(conversations)
        .where(and(...conditions))
        .orderBy(desc(conversations.createdAt))
        .limit(Math.min((params.limit as number) ?? 20, 100));

      results.reverse();

      if (results.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No conversation history found." }],
        };
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
      };
    },
  );
}
