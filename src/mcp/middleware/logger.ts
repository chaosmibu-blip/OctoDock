import { db } from "@/db";
import { operations } from "@/db/schema";
import { getValidToken } from "@/services/token-manager";
import type { ToolResult } from "@/adapters/types";

function getAppFromTool(toolName: string): string {
  return toolName.split("_")[0];
}

export async function executeWithMiddleware(
  userId: string,
  toolName: string,
  params: Record<string, unknown>,
  handler: (params: Record<string, unknown>, token: string) => Promise<ToolResult>,
): Promise<ToolResult> {
  const startTime = Date.now();
  const appName = getAppFromTool(toolName);

  try {
    const token = await getValidToken(userId, appName);
    const result = await handler(params, token);

    // Async log — don't block the response
    db.insert(operations)
      .values({
        userId,
        appName,
        toolName,
        action: toolName,
        params,
        result: result as unknown as Record<string, unknown>,
        success: true,
        durationMs: Date.now() - startTime,
      })
      .catch((err) => console.error("Failed to log operation:", err));

    return result;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    // Async log failure
    db.insert(operations)
      .values({
        userId,
        appName,
        toolName,
        action: toolName,
        params,
        result: { error: errorMessage },
        success: false,
        durationMs: Date.now() - startTime,
      })
      .catch((err) => console.error("Failed to log operation:", err));

    return {
      content: [{ type: "text", text: `Error: ${errorMessage}` }],
      isError: true,
    };
  }
}
