import { db } from "@/db";
import { operations } from "@/db/schema";
import { getValidToken } from "@/services/token-manager";
import { analyzePatterns } from "@/mcp/pattern-analyzer";
import { runMaintenanceIfNeeded } from "@/services/memory-maintenance";
import type { ToolResult } from "@/adapters/types";

// ============================================================
// 操作中介層（Middleware）
// 所有 App 操作都經過這層，負責：
// 1. 取得有效的 OAuth token（自動刷新過期 token）
// 2. 執行實際的 API 呼叫
// 3. 非同步記錄操作日誌（不阻塞主請求）
// 這也是 OctoDock「越用越懂你」的基礎 — 所有操作都自動記錄
// ============================================================

/**
 * 帶中介層的操作執行器
 * 包裝了 token 取得、日誌記錄、錯誤處理
 *
 * @param userId 用戶 ID
 * @param appName App 名稱（明確傳入，不再從工具名稱推斷）
 * @param toolName 內部工具名稱（例如 "notion_create_page"）
 * @param params 操作參數
 * @param handler 實際的 API 呼叫函式（來自 adapter.execute）
 * @returns 工具執行結果
 */
export async function executeWithMiddleware(
  userId: string,
  appName: string,
  toolName: string,
  params: Record<string, unknown>,
  handler: (params: Record<string, unknown>, token: string) => Promise<ToolResult>,
): Promise<ToolResult> {
  const startTime = Date.now();

  try {
    // 取得有效的 OAuth token（如果過期會自動 refresh）
    const token = await getValidToken(userId, appName);

    // 執行實際的 API 呼叫
    const result = await handler(params, token);

    // 非同步記錄成功的操作日誌（不阻塞回應）
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

    // 非同步分析行為模式（不阻塞回應）
    // 從操作記錄中提煉常用操作、常用參數等模式存入記憶
    analyzePatterns(userId, appName, toolName).catch(() => {});

    // 非同步執行記憶維護（衰減 + 清理 + 偏好推斷，每用戶每小時最多一次）
    runMaintenanceIfNeeded(userId).catch(() => {});

    return result;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    // 非同步記錄失敗的操作日誌
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

    // 回傳 MCP 格式的錯誤結果
    return {
      content: [{ type: "text", text: `Error: ${errorMessage}` }],
      isError: true,
    };
  }
}
