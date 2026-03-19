import { db } from "@/db";
import { operations } from "@/db/schema";
import { getValidToken } from "@/services/token-manager";
import { analyzePatterns } from "@/mcp/pattern-analyzer";
import { runMaintenanceIfNeeded } from "@/services/memory-maintenance";
import { type ToolResult, extractNotionTitle } from "@/adapters/types";
import { classifyError, type OctoDockError } from "@/mcp/error-types";
import {
  checkCircuitBreaker,
  recordSuccess,
  recordFailure,
} from "@/mcp/middleware/circuit-breaker";

// ============================================================
// 操作中介層（Middleware）
// 所有 App 操作都經過這層，負責：
// 1. 取得有效的 OAuth token（自動刷新過期 token）
// 2. 執行實際的 API 呼叫
// 3. 非同步記錄操作日誌（不阻塞主請求）
// 這也是 OctoDock「越用越懂你」的基礎 — 所有操作都自動記錄
// ============================================================

/** 操作執行器的額外選項（A1：傳遞 agent 實例資訊） */
export interface MiddlewareOptions {
  agentInstanceId?: string | null; // 從 HTTP header 提取的 Agent 實例 ID
  prefetchedToken?: string | null; // 預取的 token，避免重複呼叫 getValidToken
}

/**
 * 帶中介層的操作執行器
 * 包裝了 token 取得、日誌記錄、錯誤處理
 *
 * @param userId 用戶 ID
 * @param appName App 名稱（明確傳入，不再從工具名稱推斷）
 * @param toolName 內部工具名稱（例如 "notion_create_page"）
 * @param params 操作參數
 * @param handler 實際的 API 呼叫函式（來自 adapter.execute）
 * @param options 額外選項（agentInstanceId 等）
 * @returns 工具執行結果
 */
export async function executeWithMiddleware(
  userId: string,
  appName: string,
  toolName: string,
  params: Record<string, unknown>,
  handler: (params: Record<string, unknown>, token: string) => Promise<ToolResult>,
  options?: MiddlewareOptions,
): Promise<ToolResult> {
  const startTime = Date.now();

  // B4: 檢查 circuit breaker 狀態
  const cbCheck = checkCircuitBreaker(appName);
  if (cbCheck) {
    return {
      content: [{ type: "text", text: `Error: ${appName} service is temporarily unavailable. Retry in ${Math.ceil(cbCheck.retryAfterMs / 1000)}s. (SERVICE_UNAVAILABLE)` }],
      isError: true,
      _classifiedError: {
        code: "SERVICE_UNAVAILABLE",
        message: `${appName} service is temporarily unavailable due to repeated failures.`,
        retryable: true,
        retryAfterMs: cbCheck.retryAfterMs,
        app: appName,
        action: toolName,
      },
    };
  }

  try {
    // 取得有效的 OAuth token（優先用預取的，避免重複 DB 查詢）
    const token = options?.prefetchedToken ?? await getValidToken(userId, appName);

    // 執行實際的 API 呼叫
    const result = await handler(params, token);

    // 非同步記錄成功的操作日誌（不阻塞回應）
    // A2: result 只存摘要，不存完整 API 回傳（節省 DB 空間）
    const resultSummary = buildResultSummary(true, result);
    logOperation({
      userId,
      appName,
      toolName,
      action: toolName,
      params,
      result: resultSummary,
      agentInstanceId: options?.agentInstanceId ?? null,
      success: true,
      durationMs: Date.now() - startTime,
    });

    // B4: 操作成功，記錄 circuit breaker 成功
    recordSuccess(appName);

    // 非同步分析行為模式（不阻塞回應）
    // 從操作記錄中提煉常用操作、常用參數等模式存入記憶
    analyzePatterns(userId, appName, toolName).catch(() => {});

    // 非同步執行記憶維護（衰減 + 清理 + 偏好推斷，每用戶每小時最多一次）
    runMaintenanceIfNeeded(userId).catch(() => {});

    return result;
  } catch (error) {
    // B1: 用 classifyError 產生結構化錯誤
    const classified = classifyError(error, appName, toolName);

    // B4: 只有 5xx / timeout / network 錯誤才計入 circuit breaker
    // 用 classified.code 判斷，不重新 parse error message
    if (classified.code === "NETWORK_ERROR" || classified.code === "UPSTREAM_ERROR") {
      recordFailure(appName);
    }

    // 非同步記錄失敗的操作日誌（存結構化錯誤）
    logOperation({
      userId,
      appName,
      toolName,
      action: toolName,
      params,
      result: {
        ok: false,
        error: classified.message,
        code: classified.code,
        retryable: classified.retryable,
      },
      agentInstanceId: options?.agentInstanceId ?? null,
      success: false,
      durationMs: Date.now() - startTime,
    });

    // 回傳 MCP 格式的錯誤結果（帶結構化錯誤資訊）
    return {
      content: [{ type: "text", text: `Error: ${classified.message}` }],
      isError: true,
      _classifiedError: classified, // B1: 供 server.ts 的 toolResultToDoResult 使用
    };
  }
}

/**
 * 非同步寫入 operations 記錄（不阻塞主請求）
 * 如果 agent_instance_id 欄位不存在（migration 尚未跑完），自動降級重試
 */
function logOperation(values: Record<string, unknown>) {
  db.insert(operations)
    .values(values)
    .catch((err) => {
      // 若因 agent_instance_id 欄位不存在而失敗，去掉該欄位重試
      if (String(err).includes("agent_instance_id")) {
        const { agentInstanceId, ...rest } = values;
        db.insert(operations)
          .values(rest)
          .catch((retryErr) => console.error("Failed to log operation (retry):", retryErr));
      } else {
        console.error("Failed to log operation:", err);
      }
    });
}

/**
 * A2: 從 ToolResult 建立精簡摘要，只存關鍵資訊到 operations 表
 * 避免把完整 API 回傳（如整頁 Notion 內容）存進 DB
 */
function buildResultSummary(
  ok: boolean,
  toolResult: ToolResult,
): Record<string, unknown> {
  const text = toolResult.content?.[0]?.text;
  if (!text) return { ok };

  try {
    const data = JSON.parse(text);
    return {
      ok,
      title: extractNotionTitle(data) ?? data.title?.[0]?.plain_text ?? undefined,
      url: typeof data.url === "string" ? data.url : undefined,
    };
  } catch {
    // 不是 JSON，回傳純文字截斷
    return { ok, preview: text.slice(0, 200) };
  }
}
