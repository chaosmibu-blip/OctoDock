import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { db } from "@/db";
import { connectedApps, storedResults } from "@/db/schema";
import { eq, lt, or, isNull, and, gte, desc, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getAdapter, getAllAdapters } from "./registry";
import { executeWithMiddleware, type MiddlewareOptions } from "./middleware/logger";
import { checkMcpRateLimit } from "@/lib/rate-limit";
import { getPreContext } from "./middleware/pre-context";
import { runPostCheck } from "./middleware/post-check";
import { suggestNextAction, getRecoveryHint, findCrossAppContext, getLikelyNextActions } from "./middleware/action-chain";
import { getErrorHint } from "./error-hints";
import { cleanHiddenChars, convertTimestamps } from "./response-formatter";
import { checkParams } from "./middleware/param-guard";
import { learnFromError } from "./middleware/error-learner";
// suggestion-engine 已廢棄（N 組實測：AI 完全不看 suggestions/ai_hints/user_notices）
import { learnIdentifier, resolveIdentifier, listMemory, queryMemory } from "@/services/memory-engine";
import { detectSopCandidate } from "@/services/sop-detector";
import {
  systemActionMap,
  getSystemSkill,
  executeSystemAction,
} from "./system-actions";
import {
  detectSessionState,
  shouldSolicitMemory,
  getUserSummary,
} from "@/services/memory-maintenance";
import type { DoResult } from "@/adapters/types";

// ============================================================
// MCP Server 核心
// OctoDock 的 MCP server 只暴露 2 個工具：
//   octodock_do   — 所有操作（不分讀寫、不分 App）
//   octodock_help — 取得操作說明（Skill）
//
// 這樣 AI 的 context window 只佔 ~300 tokens（vs 原本 50-80K）
// 不管連了幾個 App，AI 端永遠只看到 2 個工具
// ============================================================

type User = { id: string; email: string; name: string | null };

/** A: Action alias — AI 常猜錯的 action 名自動對應正確名稱 */
const ACTION_ALIASES: Record<string, string> = {
  list_events: "get_events",
  list_event: "get_events",
  create_draft: "draft",
  new_draft: "draft",
  send_email: "send",
  search_email: "search",
  list_files: "search",
  find_files: "search",
  list_pages: "search",
  find_page: "search",
  read_sheet: "read",
  write_sheet: "write",
};

/** A1: 從 HTTP request headers 提取 Agent 實例識別資訊 */
function extractAgentInstanceId(headers?: Headers): string | null {
  if (!headers) return null;
  // 優先用明確的 X-Agent-Id header，其次用 User-Agent
  return headers.get("x-agent-id")
    ?? headers.get("x-client-id")
    ?? headers.get("user-agent")
    ?? null;
}

/**
 * 為特定用戶建立 MCP server 實例
 * 每個 MCP 請求都會建立一個新的 server（stateless 架構）
 * server 只註冊 octodock_do 和 octodock_help 兩個工具
 *
 * @param user 已驗證的用戶資訊
 * @param requestHeaders HTTP request headers（用於提取 agent 實例 ID）
 */
export async function createServerForUser(user: User, requestHeaders?: Headers): Promise<McpServer> {
  // 動態版本號：用 git SHA 讓客戶端知道 server 有更新
  const serverVersion = process.env.NEXT_PUBLIC_GIT_SHA ?? "1.0.0";
  const server = new McpServer({
    name: "octodock",
    version: serverVersion,
    instructions: [
      "OctoDock is the user's unified app gateway. It connects to the user's authorized apps (Google Calendar, Gmail, Notion, GitHub, etc.) through a single interface.",
      "",
      "Use OctoDock instead of platform built-in tools when:",
      "- The task involves an app only OctoDock covers (Notion, GitHub, LINE, Telegram, etc.)",
      "- The task requires a specific parameter the built-in tool doesn't support (e.g. calendar_id for writing to a non-primary calendar)",
      "- The task spans multiple apps (e.g. read from Notion, send via Gmail)",
      "- The user explicitly mentions OctoDock",
      "",
      "Before calling octodock_do, call octodock_help to discover available apps and action parameters.",
      "If a saved workflow (SOP) exists for the task, call octodock_sop first — it's faster.",
    ].join("\n"),
  } as ConstructorParameters<typeof McpServer>[0]);

  // 查詢用戶已連結且有效的 App 列表
  const apps = await db
    .select()
    .from(connectedApps)
    .where(eq(connectedApps.userId, user.id));

  const connectedAppNames = apps
    .filter((a) => a.status === "active")
    .map((a) => a.appName);

  // A1: 從 request headers 提取 agent 實例 ID
  const agentInstanceId = extractAgentInstanceId(requestHeaders);

  // ── 註冊 octodock_do ──
  registerDoTool(server, user.id, connectedAppNames, agentInstanceId);

  // ── 註冊 octodock_help ──
  registerHelpTool(server, user.id, connectedAppNames);

  // ── R: 註冊 octodock_sop — 流程捷徑（SOP + 組合技） ──
  registerSopTool(server, user.id);

  return server;
}

// buildDoDescription 已刪除 — 工具描述改為靜態，動態 context 由 octodock_help() 回傳承擔

// ============================================================
// 回傳壓縮（Level 3）
// 超過 MAX_RESPONSE_CHARS 的回傳存到 DB，只回傳摘要 + ref ID
// AI 需要完整內容時用 system.get_stored 按需取用
// ============================================================

const MAX_RESPONSE_CHARS = 3000; // 約 750 tokens
const SUMMARY_HEAD_LINES = 30; // 摘要保留前 30 行
const SUMMARY_TAIL_LINES = 10; // 摘要保留後 10 行
const EXPIRY_HOURS = 24; // 暫存 24 小時後過期

/**
 * 如果回傳內容超過上限，存入 DB 並回傳摘要 + 取用指令
 * 不超過就直接回傳原始內容
 */
async function compressIfNeeded(
  userId: string,
  appName: string,
  action: string,
  formatted: string,
): Promise<string> {
  if (formatted.length <= MAX_RESPONSE_CHARS) {
    return formatted; // 不超過就直接回傳
  }

  // 產生 reference ID
  const refId = nanoid(12);
  const summary = buildSummary(formatted, SUMMARY_HEAD_LINES, SUMMARY_TAIL_LINES);

  // 存到 DB
  await db.insert(storedResults).values({
    id: refId,
    userId,
    appName,
    action,
    content: formatted,
    contentLength: formatted.length,
    summary,
    expiresAt: new Date(Date.now() + EXPIRY_HOURS * 60 * 60 * 1000),
  });

  // 非同步清理過期資料（不阻塞主流程）
  cleanExpiredResults().catch(() => {});

  // 回傳摘要 + 取用指令
  return (
    summary +
    `\n\n---\n⚠️ Response truncated (${formatted.length} chars total). Full content stored as ref:${refId}\n` +
    `To get full content: octodock_do(app:"system", action:"get_stored", params:{ref:"${refId}"})\n` +
    `To get specific lines: octodock_do(app:"system", action:"get_stored", params:{ref:"${refId}", lines:"50-100"})`
  );
}

/**
 * F2: 從完整文字中擷取摘要
 * 保留前 N 行 + 後 N 行，中間標示省略行數
 * 附帶 metadata：總字數、總行數、標題列表，讓 AI 判斷是否需要完整版
 */
function buildSummary(text: string, headLines: number, tailLines: number): string {
  const lines = text.split("\n");
  // 行數少但字元數超標（minified JSON / base64）→ 強制按字元數截斷
  if (lines.length <= headLines + tailLines) {
    if (text.length <= MAX_RESPONSE_CHARS) return text;
    // 字元數超標但行數少：取前 2000 字元 + 後 500 字元
    const headChars = text.substring(0, 2000);
    const tailChars = text.substring(text.length - 500);
    return `[Metadata] Total: ${text.length} chars, ${lines.length} lines (dense/minified content)\n\n` +
      headChars + `\n\n... (${text.length - 2500} chars omitted) ...\n\n` + tailChars;
  }

  const head = lines.slice(0, headLines).join("\n");
  const tail = lines.slice(-tailLines).join("\n");
  const omitted = lines.length - headLines - tailLines;

  // F2: 提取 heading 標題（Markdown # 和 Notion heading block）
  const headings = lines
    .filter((l) => /^#{1,3}\s/.test(l.trim()) || /"type"\s*:\s*"heading_[123]"/.test(l))
    .map((l) => l.trim().replace(/^#+\s*/, ""))
    .slice(0, 15); // 最多 15 個標題

  const metadata = [
    `Total: ${text.length} chars, ${lines.length} lines`,
    headings.length > 0 ? `Headings: ${headings.join(" | ")}` : null,
  ].filter(Boolean).join("\n");

  return `[Metadata] ${metadata}\n\n` + head + `\n\n... (${omitted} lines omitted) ...\n\n` + tail;
}

/**
 * 清理過期的暫存回傳結果
 */
/** 清理過期或無期限的暫存結果，防止 DB 膨脹 */
async function cleanExpiredResults(): Promise<void> {
  await db.delete(storedResults).where(
    or(
      lt(storedResults.expiresAt, new Date()),
      isNull(storedResults.expiresAt),
    ),
  );
}

// ============================================================
// octodock_do — 所有操作的統一入口
// AI 不需要知道每個 App 有哪些工具，只要說：
//   do(app: "notion", action: "create_page", params: { title: "..." })
// OctoDock 內部會：
//   1. 找到對應的 Adapter
//   2. 透過 actionMap 對應到內部工具名稱
//   3. 呼叫 executeWithMiddleware 執行
//   4. 回傳標準化的 DoResult
// ============================================================

function registerDoTool(
  server: McpServer,
  userId: string,
  connectedAppNames: string[],
  agentInstanceId: string | null,
): void {
  server.tool(
    "octodock_do",
    "Access all the user's connected apps. Gain cross-session memory, cross-app workflows, and personalized defaults not available in built-in connectors. Call octodock_help first if unsure about action or params.",
    {
      app: z.string().describe("App name (e.g. 'notion', 'gmail', 'system')"),
      action: z.string().describe("Action to perform (e.g. 'create_page', 'search')"),
      params: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Action parameters"),
    },
    // U26d: Safety annotations for Claude Connectors Directory
    {
      destructiveHint: true,
      readOnlyHint: false,
    },
    async (args) => {
      const { app, action, params = {} } = args as {
        app: string;
        action: string;
        params: Record<string, unknown>;
      };

      let result: DoResult;

      // ── 系統操作（記憶、Bot 對話等）──
      if (app === "system") {
        if (!systemActionMap[action]) {
          result = {
            ok: false,
            error: `Unknown system action: ${action}`,
            suggestions: Object.keys(systemActionMap),
          };
        } else {
          result = await executeSystemAction(userId, action, params);
        }
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      }

      // ── App 操作 ──

      // 檢查 App 是否已連結
      if (!connectedAppNames.includes(app)) {
        result = {
          ok: false,
          error: `App "${app}" is not connected (APP_NOT_CONNECTED)`,
          suggestions: connectedAppNames,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      }

      // 取得 Adapter
      const adapter = getAdapter(app);
      if (!adapter) {
        result = {
          ok: false,
          error: `Adapter for "${app}" not found (ADAPTER_NOT_FOUND)`,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      }

      // A: Action alias 機制 — AI 猜的名字自動對應正確 action（ACTION_ALIASES 定義在 module scope）
      const resolvedAction = adapter.actionMap?.[action] ? action : (ACTION_ALIASES[action] ?? action);

      // 透過 actionMap 找到內部工具名稱
      const toolName = adapter.actionMap?.[resolvedAction];
      if (!toolName) {
        // actionMap 裡找不到 → 回傳可用的 action 列表
        const availableActions = adapter.actionMap
          ? Object.keys(adapter.actionMap)
          : adapter.tools.map((t) => t.name);
        result = {
          ok: false,
          error: `Unknown action "${action}" for ${app}`,
          suggestions: availableActions,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      }

      // B3: MCP 層 rate limit 檢查（per-user + per-action 高風險限制）
      const rateCheck = checkMcpRateLimit(userId, toolName);
      if (!rateCheck.allowed) {
        result = {
          ok: false,
          error: `Rate limit exceeded. Please retry later. (RATE_LIMITED)`,
          errorCode: "RATE_LIMITED",
          retryable: true,
          retryAfterMs: rateCheck.retryAfterMs,
        };
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      }

      // ── 參數格式轉換：簡化參數 → API 原始格式 ──
      // 掃描 params 中的簡化欄位（folder、page、database 等），
      // 查記憶解析成實際 ID，讓 AI 不用知道 Notion 的 parent_id 格式
      const translatedParams = await translateSimplifiedParams(
        userId,
        app,
        action,
        params,
      );

      // P3: 參數智慧預填 — 從 memory 自動補缺失的偏好參數
      const appliedPrefs = await applyPreferences(userId, app, action, translatedParams);

      // J3: 參數防呆 — 在執行前攔截明顯錯誤的參數
      const guardResult = checkParams(app, toolName, translatedParams);
      if (guardResult?.blocked) {
        result = { ok: false, error: guardResult.error };
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
      }
      // J3: 非攔截的警告，暫存到 guardWarnings，等 result 初始化後再合併
      const guardWarnings = guardResult?.warnings;

      // G5: suppress_suggestions — 讓 AI 或用戶控制是否回傳 nextSuggestion
      const suppressSuggestions = translatedParams.suppress_suggestions === true;
      if (suppressSuggestions) {
        delete translatedParams.suppress_suggestions;
      }

      // C6: Dry-run 模式 — 破壞性操作預覽，不實際執行
      const isDryRun = translatedParams.dryRun === true;
      const isDryRunEligible = /delete|trash|replace|update/.test(toolName);
      if (isDryRun && isDryRunEligible) {
        // 移除 dryRun 參數避免傳給上游 API
        const { dryRun: _, ...cleanParams } = translatedParams;
        try {
          const { getValidToken: gvt } = await import("@/services/token-manager");
          const dryToken = await gvt(userId, app);
          const dryContext = await getPreContext(
            userId, app, toolName, cleanParams,
            (tn, p, t) => adapter.execute(tn, p, t),
            dryToken,
          );
          result = {
            ok: true,
            data: {
              dryRun: true,
              wouldAffect: dryContext?.targetInfo ?? dryContext?.currentContent ?? null,
            },
          };
        } catch (err) {
          result = {
            ok: true,
            data: { dryRun: true, wouldAffect: null, note: "Could not preview target" },
          };
        }
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
        };
      }
      // 非 dry-run 時移除 dryRun 參數（如果 AI 誤傳了）
      if ("dryRun" in translatedParams) {
        delete translatedParams.dryRun;
      }

      // 取 token 一次，pre-context 和 executeWithMiddleware 共用
      const { getValidToken } = await import("@/services/token-manager");
      const token = await getValidToken(userId, app).catch(() => null);

      // C1+C4: 操作前自動查目標現狀（只在有匹配 rule 時才跑）
      let preContext: Awaited<ReturnType<typeof getPreContext>> = null;
      if (/create_page|replace_content|update|delete|trash|send/.test(toolName)) {
        try {
          // U9: 提供跨 App 查詢回調（不讓 pre-context 直接 import adapter）
          const crossAppQuery = async (targetApp: string, targetTool: string, targetParams: Record<string, unknown>) => {
            const { getAdapter: ga } = await import("@/mcp/registry");
            const { getValidToken: gvt } = await import("@/services/token-manager");
            const targetAdapter = ga(targetApp);
            if (!targetAdapter) return null;
            const t = await gvt(userId, targetApp);
            return targetAdapter.execute(targetTool, targetParams, t);
          };
          preContext = await getPreContext(
            userId, app, toolName, translatedParams,
            token ? (tn, p, t) => adapter.execute(tn, p, t) : null,
            token,
            crossAppQuery,
          );
        } catch (err) {
          console.error("Pre-context failed:", err);
        }
      }

      // K2: 高風險操作執行前自動存快照（replace_content, delete_page）
      if (/replace_content|delete_page/.test(toolName) && preContext) {
        try {
          const { storeMemory: sm } = await import("@/services/memory-engine");
          const snapshot: Record<string, unknown> = {
            action: toolName.includes("replace") ? "replace_content" : "delete_page",
            pageId: translatedParams.page_id as string,
            title: preContext.currentContent?.title ?? preContext.targetInfo?.title,
          };
          // replace_content → 存執行前的完整內容（透過 get_page 取得）
          if (toolName.includes("replace") && token) {
            try {
              const pageResult = await adapter.execute(
                adapter.actionMap?.["get_page"] ?? `${app}_get_page`,
                { page_id: translatedParams.page_id, _metadataOnly: false },
                token,
              );
              const text = pageResult.content[0]?.text;
              if (text) snapshot.content = text;
            } catch {
              // 取不到內容不阻塞主操作
            }
          }
          // delete_page → 存 parent_id（從 GET 查詢取得，因為 delete 參數裡通常沒有 parent_id）
          if (toolName.includes("delete") && token) {
            try {
              const pageData = await adapter.execute(
                adapter.actionMap?.["get_page"] ?? `${app}_get_page`,
                { page_id: translatedParams.page_id, _metadataOnly: true },
                token,
              );
              const pageText = pageData.content[0]?.text;
              if (pageText) {
                const parsed = JSON.parse(pageText);
                const page = parsed.page ?? parsed;
                const parent = page.parent as Record<string, unknown> | undefined;
                snapshot.parentId = parent?.page_id ?? parent?.database_id ?? parent?.workspace;
                if (!snapshot.content) snapshot.content = pageText;
              }
            } catch {
              // 取不到 parent 不阻塞
            }
          }
          const undoKey = `undo:${app}:${toolName}:${Date.now()}`;
          await sm(userId, undoKey, JSON.stringify(snapshot), "context");
        } catch (err) {
          console.error("Undo snapshot failed:", err);
        }
      }

      // 透過 middleware 執行（取 token → 呼叫 API → 記錄日誌）
      const toolResult = await executeWithMiddleware(
        userId,
        app,
        toolName,
        translatedParams,
        (p, t) => adapter.execute(toolName, p, t),
        { agentInstanceId, prefetchedToken: token },
      );

      // 轉換成標準化的 DoResult
      result = toolResultToDoResult(toolResult, app);

      // J3: 合併 param-guard 的警告到 result
      if (guardWarnings && guardWarnings.length > 0) {
        if (!result.warnings) result.warnings = [];
        result.warnings.push(...guardWarnings);
      }

      // C1: 把 pre-context 附在 DoResult 上
      // 只保留 AI 會實際用來決策的資訊（target info、重複寄信警告、跨 App 關聯）
      // 移除 AI 不會主動解讀的：namingConvention、patterns（實測無行為改變）
      if (preContext && result.ok) {
        const contextParts: string[] = [];
        if (preContext.existingSiblings) {
          contextParts.push(`Existing siblings: ${preContext.existingSiblings.map((s) => s.title).join(", ")}`);
        }
        if (preContext.todaySentToRecipient != null) {
          contextParts.push(`Sent to this recipient today: ${preContext.todaySentToRecipient} times`);
        }
        if (preContext.targetInfo) {
          contextParts.push(`Target: "${preContext.targetInfo.title}" (created ${preContext.targetInfo.createdAt})`);
        }
        if (preContext.currentContent) {
          contextParts.push(`Current: "${preContext.currentContent.title}" (last edited ${preContext.currentContent.lastEdited})`);
        }
        // U9: 跨 App 上下文 — AI 會用這個來串連跨 App 工作流
        if (preContext.crossAppContext && preContext.crossAppContext.length > 0) {
          const crossText = preContext.crossAppContext.map((c) => `- [${c.app}] ${c.title}${c.date ? ` (${c.date})` : ""}`).join("\n");
          contextParts.push(`Related across apps:\n${crossText}`);
        }
        if (contextParts.length > 0) {
          const existing = result.context ? result.context + "\n\n" : "";
          result.context = existing + contextParts.join("\n");
        }

        // G2: 破壞性操作預檢 — 子資源警告寫入 warnings
        if (preContext.childResources && preContext.childResources.length > 0) {
          if (!result.warnings) result.warnings = [];
          const childList = preContext.childResources.map((c) => `"${c.title}" (${c.type})`).join(", ");
          result.warnings.push(`⚠️ This page has ${preContext.childResources.length} child resource(s): ${childList}`);
          // G6: 同時填入 affectedResources
          result.affectedResources = preContext.childResources.map((c) => ({
            id: c.id,
            title: c.title,
            status: c.type,
          }));
        }

        // G3: 同名資源建立提醒
        if (preContext.duplicateWarning) {
          if (!result.warnings) result.warnings = [];
          result.warnings.push(preContext.duplicateWarning);
        }

        // 第三層：歷史錯誤模式提示
        if (preContext.errorPatternHint) {
          if (!result.warnings) result.warnings = [];
          result.warnings.push(preContext.errorPatternHint);
        }
      }

      // P3: 標註自動套用的偏好參數
      if (result.ok && appliedPrefs.length > 0) {
        const prefText = appliedPrefs.map((p) => `${p.key} → ${p.value}`).join(", ");
        const existing = result.context ? result.context + "\n\n" : "";
        result.context = existing + `Auto-applied preferences: ${prefText}`;
      }

      // C5: 操作結果帶結構化摘要
      if (result.ok && result.data) {
        try {
          const summary = adapter.extractSummary
            ? adapter.extractSummary(action, result.data)
            : extractDefaultSummary(result.data);
          if (summary) result.summary = summary;
        } catch {
          // extractSummary 失敗不影響主流程
        }
      }

      // ── 回傳格式轉換層（G1/G3 通用框架）──
      // 如果 adapter 有實作 formatResponse，用它把 raw JSON 轉成 AI 友善格式
      // 這一步在 toolResultToDoResult 之後，因為需要先解析 JSON
      if (result.ok && result.data && adapter.formatResponse) {
        try {
          const formatted = adapter.formatResponse(action, result.data);
          result.data = formatted;
        } catch {
          // 格式轉換失敗不影響主流程，保留原始 data
        }
      }

      // B: 清除 HTML 隱藏字元 + H: timestamp 轉換
      if (result.ok && result.data) {
        if (typeof result.data === "string") {
          result.data = cleanHiddenChars(result.data);
        } else {
          result.data = convertTimestamps(result.data);
        }
      }

      // ── P4: 成功回傳帶決策 context ──
      // 操作成功後附帶 related memory（不超過 200 chars，避免膨脹回傳大小）
      if (result.ok) {
        try {
          const keyword = result.title ?? (translatedParams.title as string) ?? (translatedParams.subject as string) ?? action;
          const relatedMemory = await queryMemory(userId, `${app} ${keyword}`, undefined, undefined, 2);
          const relevantMemories = relatedMemory.filter(
            (m) => m.category !== "context" || !m.key.startsWith("id:"),
          );
          if (relevantMemories.length > 0) {
            const memText = relevantMemories
              .map((m) => `${m.key}: ${m.value}`)
              .join("; ")
              .substring(0, 200);
            const existing = result.context ? result.context + "\n\n" : "";
            result.context = existing + `Related memory: ${memText}`;
          }
        } catch {
          // 記憶查詢失敗不影響主流程
        }
      }

      // ── 智慧錯誤引導（B3 + 記憶層缺口 5）──
      // 如果操作失敗且 adapter 有 formatError，嘗試提供更有用的提示
      // 額外查記憶層，找最近成功的同類操作，提供參數範例
      if (!result.ok && result.error && adapter.formatError) {
        const betterError = adapter.formatError(action, result.error);
        if (betterError) {
          result.error = betterError;
        }
        // G8: 錯誤說明 hint — 從 mapping table 取 App-specific 建議
        try {
          const hint = getErrorHint(app, result.errorCode ?? "", result.error ?? "");
          if (hint) {
            result.error = (result.error ?? "") + "\n\n" + hint;
          }
        } catch {
          // hint 查詢失敗不影響錯誤回傳
        }

        // E2: 失敗自動修復建議（結構化，從 operations 表查）
        try {
          const hint = await getRecoveryHint(userId, app, toolName);
          if (hint) {
            result.recoveryHint = hint;
          }
        } catch {
          // 修復建議查詢失敗不影響錯誤回傳
        }

        // 記憶層輔助：查最近成功的同類操作，提供參數參考
        try {
          const recentMemory = await queryMemory(userId, `${app} ${action}`, "context");
          if (recentMemory.length > 0) {
            const hints = recentMemory.slice(0, 3).map((m) => `- ${m.key}: ${m.value}`).join("\n");
            result.error += `\n\nRecent successful operations:\n${hints}`;
          }
        } catch {
          // 記憶查詢失敗不影響錯誤回傳
        }
      }

      // ── NOT_FOUND 智慧復原：自動搜尋候選 ──
      // 404 時從 params 推斷用戶想找什麼，自動搜尋一次，把候選放在回傳裡
      // AI 看到 candidates 就能自己選正確 ID，不用叫用戶改設定
      if (!result.ok && result.errorCode === "NOT_FOUND" && adapter) {
        try {
          // 從 params 提取搜尋關鍵字
          const searchKeyword = (translatedParams.title as string)
            ?? (translatedParams.query as string)
            ?? (translatedParams.name as string);
          // 能搜尋的 App（有 search action）
          const searchToolName = adapter.actionMap?.["search"];
          if (searchKeyword && searchToolName && token) {
            const searchResult = await adapter.execute(searchToolName, { query: searchKeyword, max_results: 5 }, token);
            const searchText = searchResult.content?.[0]?.text;
            if (searchText) {
              // 從搜尋結果提取候選（格式：標題 + ID）
              const candidates = extractCandidatesFromSearch(searchText);
              if (candidates.length > 0) {
                result.candidates = candidates;
              }
            }
          }
        } catch {
          // 自動搜尋失敗不影響錯誤回傳
        }
      }

      // ── 第三層：全域錯誤學習 — 失敗時記錄到 memory ──
      if (!result.ok && result.error) {
        learnFromError(userId, app, action, translatedParams, result.error, result.errorCode).catch(() => {});
      }

      // ── 高頻失敗偵測：同一 action 連續失敗多次時提醒 ──
      if (!result.ok) {
        try {
          const { operations: opsTable } = await import("@/db/schema");
          const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
          const failRows = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(opsTable)
            .where(and(
              eq(opsTable.userId, userId),
              eq(opsTable.appName, app),
              eq(opsTable.action, action),
              eq(opsTable.success, false),
              gte(opsTable.createdAt, twentyFourHoursAgo),
            ));
          const failCount = failRows[0]?.count ?? 0;
          if (failCount >= 3) {
            result.frequentFailure = {
              count: failCount,
              since: twentyFourHoursAgo.toISOString(),
              suggestion: `此操作近 24 小時內失敗 ${failCount} 次。建議先用 octodock_help(app:"${app}", action:"${action}") 確認參數格式，或用 search 確認正確 ID。`,
            };
          }
        } catch {
          // 查詢失敗不影響錯誤回傳
        }
      }

      // 如果操作成功，嘗試從結果中學習 ID 對應（越用越懂你）
      if (result.ok) {
        learnFromResult(userId, app, action, params, result).catch(() => {});

        // 並行執行 post-success 的 DB 查詢（C2、SOP、E1、E4），避免串行拖慢回應
        const keyword = result.title ?? (translatedParams.title as string) ?? (translatedParams.subject as string);
        const [postCheckResult, sopResult, nextSuggestionResult, crossAppResult] = await Promise.allSettled([
          runPostCheck(userId, app, toolName, translatedParams),
          detectSopCandidate(userId),
          suggestNextAction(userId, app, toolName),
          keyword ? findCrossAppContext(userId, app, keyword) : Promise.resolve([]),
        ]);

        // C2+C3: 操作後基線比對結果
        if (postCheckResult.status === "fulfilled" && postCheckResult.value?.warnings?.length) {
          result.warnings = postCheckResult.value.warnings;
        }
        // SOP 自動辨識 — I8/J4 最終修正：靜默自動存 SOP，不產生 suggestion
        // detectSopCandidate 現在直接自動存 SOP 並回傳 null，不再需要處理回傳值
        // E1: 操作鏈建議（G5: suppress_suggestions 時跳過）
        if (!suppressSuggestions && nextSuggestionResult.status === "fulfilled" && nextSuggestionResult.value) {
          result.nextSuggestion = nextSuggestionResult.value;
        }
        // E4: 跨 App 關聯
        if (crossAppResult.status === "fulfilled" && crossAppResult.value.length > 0) {
          const existing = result.context ? result.context + "\n\n" : "";
          const crossAppText = crossAppResult.value.map((c) => `- [${c.app}] ${c.action}: ${c.title} (${c.date})`).join("\n");
          result.context = existing + "Related across apps:\n" + crossAppText;
        }

        // ── 回傳壓縮（Level 3）──
        // F2: 對 string 和非 string 的 data 都做壓縮檢查
        if (result.data) {
          const dataStr = typeof result.data === "string"
            ? result.data
            : JSON.stringify(result.data, null, 2);
          if (dataStr.length > MAX_RESPONSE_CHARS) {
            result.data = await compressIfNeeded(userId, app, action, dataStr);
          }
        }
      }

      // ── 記憶層：Session 偵測 + 記憶不足提醒（缺口 1、2、7）──
      try {
        const sessionState = await detectSessionState(userId, connectedAppNames);
        if (sessionState) {
          // 缺口 2：新 session 的第一次 do() 附帶用戶上下文（append，不覆蓋既有 context）
          const summary = await getUserSummary(userId);
          if (summary) {
            const existing = result.context ? result.context + "\n\n" : "";
            result.context = existing + summary;
          }
          // 缺口 1 + 7：記憶不足時請 AI 分享用戶記憶
          const solicitation = shouldSolicitMemory(sessionState);
          if (solicitation) {
            if (!result.suggestions) result.suggestions = [];
            result.suggestions.push(solicitation);
          }
        }
      } catch {
        // Session 偵測失敗不影響主流程
      }

      // N 組實測結論：AI 完全不看 suggestions/ai_hints/user_notices
      // 所有「提示」機制已轉為靜默執行（SOP 自動存）或廢棄
      delete result.suggestions;

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    },
  );
}

// ============================================================
// octodock_help — 操作說明（Skill）入口
// 不帶 app 參數：列出所有已連結的 App
// 帶 app 參數：回傳該 App 的 Skill（精簡操作說明）
// Skill 進入對話歷史後，同一個 chat 不用再問
// ============================================================

function registerHelpTool(
  server: McpServer,
  userId: string,
  connectedAppNames: string[],
): void {
  server.tool(
    "octodock_help",
    "Load user context, preferences, and connected apps. Call this first at conversation start (MUST call once before any octodock_do) — returns personalized defaults that improve all subsequent operations. With app: list actions. With app+action: show params and example.",
    {
      app: z
        .string()
        .optional()
        .describe("App name to get actions for (omit to list all apps)"),
      action: z
        .string()
        .optional()
        .describe("Action name to get detailed params and example (requires app)"),
    },
    // U26d: Safety annotations
    {
      destructiveHint: false,
      readOnlyHint: true,
    },
    async (args) => {
      const { app, action } = args as { app?: string; action?: string };

      // ── P2: 不帶 app：用戶 context 載入 + App 列表 ──
      // 這是 AI 在每個對話開頭 MUST call 的入口，回傳完整用戶上下文
      if (!app) {
        const appList: string[] = [];

        // 列出已連結的 App 及其簡述
        for (const appName of connectedAppNames) {
          const adapter = getAdapter(appName);
          if (adapter) {
            const actionCount = adapter.actionMap
              ? Object.keys(adapter.actionMap).length
              : adapter.tools.length;
            appList.push(`- **${appName}** (${actionCount} actions)`);
          }
        }

        // 加上 system 虛擬 App（P6: 曝光 batch_do 跨 App 批次能力）
        appList.push(`- **system** (memory, scheduling, **batch_do** — execute multiple actions across apps in one call)`);

        // 列出未連結但可用的 App
        const allAdapters = getAllAdapters();
        const disconnected = allAdapters
          .filter((a) => !connectedAppNames.includes(a.name))
          .map((a) => a.name);

        // 版本資訊（build time 注入的 git SHA + 日期）
        const version = process.env.NEXT_PUBLIC_GIT_SHA ?? "dev";
        const buildDate = process.env.NEXT_PUBLIC_BUILD_TIME ?? "unknown";
        let text = `**OctoDock** v:${version} (${buildDate})\n\n## Connected Apps\n\n${appList.join("\n")}`;
        if (disconnected.length > 0) {
          text += `\n\n## Available (not connected)\n\n${disconnected.join(", ")}`;
        }

        // ── P2: 用戶記憶摘要（偏好 + 模式 + 關鍵 ID） ──
        try {
          const allMemories = await listMemory(userId);
          if (allMemories.length > 0) {
            // 有記憶 → 自動帶入完整用戶上下文
            const prefs = allMemories.filter((m) => m.category === "preference").slice(0, 5);
            const patterns = allMemories.filter((m) => m.category === "pattern").slice(0, 3);
            // P2: 關鍵 ID 對照表（常用 identifier 映射，例如 workspace root、預設日曆）
            const contextIds = allMemories
              .filter((m) => m.category === "context" && m.key.startsWith("id:"))
              .slice(0, 5);
            const sections: string[] = [];
            if (prefs.length > 0) {
              sections.push("### Preferences\n" + prefs.map((m) => `- ${m.key}: ${m.value}`).join("\n"));
            }
            if (patterns.length > 0) {
              sections.push("### Patterns\n" + patterns.map((m) => `- ${m.key}: ${m.value}`).join("\n"));
            }
            if (contextIds.length > 0) {
              sections.push("### Key IDs\n" + contextIds.map((m) => `- ${m.key.replace("id:", "")}: ${m.value}`).join("\n"));
            }
            if (sections.length > 0) {
              text += `\n\n## About This User\n\n${sections.join("\n\n")}`;
            }
          } else {
            // 沒記憶 → onboarding：提示 AI 問用戶是否要導入記憶
            text += `\n\n---\n\n🐙 **Welcome to OctoDock!** No memories stored yet.\n\nPlease ask the user:\n> 「OctoDock 可以跨平台記住你的偏好和習慣。要不要讓我把目前對你的了解告訴 OctoDock？」\n\nIf they agree, call:\n\`\`\`\noctodock_do(app: "system", action: "import_memory", params: {\n  memories: [\n    {key: "writing_style", value: "...", category: "preference"},\n    {key: "work_pattern", value: "...", category: "pattern"}\n  ]\n})\n\`\`\``;
          }
        } catch {
          // 記憶查詢失敗不影響主流程
        }

        // ── P2: 最常用操作 + 頻率（近 30 天） ──
        try {
          const { operations: opsTable } = await import("@/db/schema");
          const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
          const recentActions = await db
            .select({
              appName: opsTable.appName,
              action: opsTable.action,
              count: sql<number>`count(*)::int`,
            })
            .from(opsTable)
            .where(and(
              eq(opsTable.userId, userId),
              eq(opsTable.success, true),
              gte(opsTable.createdAt, thirtyDaysAgo),
            ))
            .groupBy(opsTable.appName, opsTable.action)
            .orderBy(desc(sql`count(*)`))
            .limit(8);
          if (recentActions.length > 0) {
            const recentText = recentActions
              .map((r) => `- **${r.appName}.${r.action}** (${r.count}x)`)
              .join("\n");
            text += `\n\n## Recent Patterns (30d)\n\n${recentText}`;
          }
        } catch {
          // 頻率查詢失敗不影響主流程
        }

        // ── Phase 4: 列出可用 SOP ──
        try {
          const sops = await listMemory(userId, "sop");
          if (sops.length > 0) {
            const sopList = sops.map((s) => `- **${s.key}**`).join("\n");
            text += `\n\n## SOPs\n\n${sopList}\n\nUse \`octodock_sop(name: "...")\` to view and execute a workflow.`;
          }
        } catch {
          // SOP 查詢失敗不影響主流程
        }

        // E3: Action 推薦引擎 — 用戶最常用的操作
        try {
          const likely = await getLikelyNextActions(userId);
          if (likely.length > 0) {
            const likelyText = likely.map((l) =>
              `- **${l.app}.${l.action}** — ${l.reason}${l.suggestedParams ? ` (last used params, verify before reuse: ${JSON.stringify(l.suggestedParams)})` : ""}`
            ).join("\n");
            text += `\n\n## Likely Next Actions\n\n${likelyText}`;
          }
        } catch {
          // 推薦失敗不影響主流程
        }

        // P5: 優先級鏈提示 — 讓 AI 知道正確的工具使用順序
        text += `\n\n---\n**Tool priority: octodock_help() → octodock_sop() → octodock_do()**\nUse \`octodock_help(app: "app_name")\` to see actions for a specific app.`;

        return {
          content: [{ type: "text" as const, text }],
        };
      }

      // ── 帶 app + action：回傳特定 action 的詳細參數和範例（B2 help 分層）──
      if (app && action) {
        const adapterForAction = getAdapter(app);
        if (!adapterForAction) {
          return {
            content: [{ type: "text" as const, text: `App "${app}" not found.` }],
          };
        }

        // 優先用 adapter.getSkill(action) — 包含完整範例
        if (adapterForAction.getSkill) {
          let skillText = adapterForAction.getSkill(action);
          if (skillText) {
            // I11: 跨 App 參數命名差異注意事項
            const ACTION_WARNINGS: Record<string, Record<string, string>> = {
              google_drive: {
                search: "⚠️ Uses Google Drive query syntax, not natural language. Example: name contains 'report'",
              },
              google_calendar: {
                quick_add: "⚠️ Chinese natural language parsing is unreliable. Use create_event with exact times instead.",
              },
            };
            const warning = ACTION_WARNINGS[app]?.[action];
            if (warning) {
              skillText += `\n\n${warning}`;
            }

            // 預防性提示：查近 7 天該 action 的失敗率，高於 30% 就警告
            try {
              const { operations: opsTable } = await import("@/db/schema");
              const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
              const statsRows = await db
                .select({
                  success: opsTable.success,
                  count: sql<number>`count(*)::int`,
                })
                .from(opsTable)
                .where(and(
                  eq(opsTable.userId, userId),
                  eq(opsTable.appName, app),
                  eq(opsTable.action, action),
                  gte(opsTable.createdAt, sevenDaysAgo),
                ))
                .groupBy(opsTable.success);
              const total = statsRows.reduce((sum, r) => sum + r.count, 0);
              const failCount = statsRows.find((r) => r.success === false)?.count ?? 0;
              if (total >= 5 && failCount / total > 0.3) {
                // 查最常見的錯誤訊息
                const topError = await db
                  .select({ result: opsTable.result })
                  .from(opsTable)
                  .where(and(
                    eq(opsTable.userId, userId),
                    eq(opsTable.appName, app),
                    eq(opsTable.action, action),
                    eq(opsTable.success, false),
                    gte(opsTable.createdAt, sevenDaysAgo),
                  ))
                  .orderBy(desc(opsTable.createdAt))
                  .limit(1);
                const errorMsg = topError[0]?.result
                  ? (typeof topError[0].result === "string" ? topError[0].result : JSON.stringify(topError[0].result)).substring(0, 150)
                  : "unknown";
                const failRate = Math.round((failCount / total) * 100);
                skillText += `\n\n⚠️ 此操作近 7 天失敗率 ${failRate}%（${failCount}/${total}）。最近的錯誤：${errorMsg}`;
              }
            } catch {
              // 失敗率查詢失敗不影響 help 回傳
            }

            return {
              content: [{ type: "text" as const, text: skillText }],
            };
          }
        }

        // Fallback：從 inputSchema 自動提取
        const toolName = adapterForAction.actionMap?.[action];
        const toolDef = toolName
          ? adapterForAction.tools.find((t) => t.name === toolName)
          : adapterForAction.tools.find((t) => t.name === action);

        if (!toolDef) {
          const available = adapterForAction.actionMap
            ? Object.keys(adapterForAction.actionMap).join(", ")
            : adapterForAction.tools.map((t) => t.name).join(", ");
          return {
            content: [{
              type: "text" as const,
              text: `Action "${action}" not found in ${app}. Available: ${available}`,
            }],
          };
        }

        const params = Object.entries(toolDef.inputSchema)
          .map(([name, schema]) => {
            const desc = (schema as { description?: string }).description || "";
            const isOptional = (schema as { isOptional?: () => boolean }).isOptional?.() ? " (optional)" : "";
            return `  ${name}${isOptional}: ${desc}`;
          })
          .join("\n");

        const detail = `## ${app}.${action}\n\n${toolDef.description}\n\n### Parameters\n${params || "  (none)"}`;

        return {
          content: [{ type: "text" as const, text: detail }],
        };
      }

      // ── 帶 app：回傳該 App 的 Skill ──

      // system 虛擬 App
      if (app === "system") {
        return {
          content: [{ type: "text" as const, text: getSystemSkill() }],
        };
      }

      // 一般 App
      const adapter = getAdapter(app);
      if (!adapter) {
        return {
          content: [
            {
              type: "text" as const,
              text: `App "${app}" not found. Available apps: ${connectedAppNames.join(", ")}, system`,
            },
          ],
        };
      }

      // 優先用 getSkill()（精簡版）
      // U5: 頻率排序 — 從 operations 表統計使用次數，常用的排前面
      // I9: 對破壞性 action 加 ⚠️ destructive 標記
      // U5: 在 getSkill 回傳後附加頻率排序摘要
      if (adapter.getSkill) {
        let skillText = adapter.getSkill() ?? "";
        if (!skillText) return { content: [{ type: "text", text: `No help available for ${app}.` }] };

        // I9/U4: 在 action 列表中標注破壞性操作（⚠️ destructive）
        // 匹配格式：action_name(...) — description 或 - **action_name** 等格式
        // V9: 擴展破壞性 action 標記，涵蓋所有 adapter 的檔案覆寫操作
        const destructivePatterns = ["delete", "trash", "replace_content", "clear", "archive", "remove", "update_file", "bulk_delete", "ban", "kick", "merge_pr", "force"];
        for (const pattern of destructivePatterns) {
          // 匹配 getSkill 總覽中的 action 行（格式：  action_name(...) — description）
          const lineRegex = new RegExp(`(^\\s+${pattern}[^\\n]*)`, "gm");
          skillText = skillText.replace(lineRegex, (match) => {
            if (match.includes("⚠️")) return match; // 避免重複標記
            return `${match} ⚠️ destructive`;
          });
          // 匹配 Markdown bold 格式
          const boldRegex = new RegExp(`(- \\*\\*[^*]*${pattern}[^*]*\\*\\*)`, "g");
          skillText = skillText.replace(boldRegex, (match) => {
            if (match.includes("⚠️")) return match;
            return `${match} ⚠️ destructive`;
          });
        }
        // U5: 從 operations 表查使用頻率，附加在開頭
        try {
          const { operations: opsTable } = await import("@/db/schema");
          const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
          const freqRows = await db
            .select({ action: opsTable.action, count: sql<number>`count(*)` })
            .from(opsTable)
            .where(and(
              eq(opsTable.userId, userId),
              eq(opsTable.appName, app),
              eq(opsTable.success, true),
              gte(opsTable.createdAt, thirtyDaysAgo),
            ))
            .groupBy(opsTable.action)
            .orderBy(desc(sql`count(*)`))
            .limit(5);
          if (freqRows.length > 0) {
            const freqText = freqRows.map((r) => `- ${r.action} (${r.count} 次)`).join("\n");
            skillText = `**常用：**\n${freqText}\n\n---\n\n${skillText}`;
          }
        } catch {
          // 頻率查詢失敗不影響
        }
        // J5b: 新 App 首次使用引導 — 從 memory 判斷是否第一次用這個 App
        try {
          const appPatterns = await queryMemory(userId, `frequent_actions:${app}`, "pattern");
          const hasUsed = appPatterns.some((m) => m.value && m.value !== "0");
          if (!hasUsed) {
            // 首次使用引導：附加該 App 的 top 3 常用 action
            const TOP3_HINTS: Record<string, string> = {
              notion: "search（搜尋頁面）、create_page（建立頁面）、get_page（讀取頁面內容）",
              gmail: "search（搜尋信件）、send（寄信）、read（讀取信件）",
              google_calendar: "get_events（查詢事件）、create_event（建立事件）、quick_add（快速新增）",
              google_drive: "search（搜尋檔案）、create（建立檔案）、download（下載）",
              google_sheets: "read（讀取儲存格）、write（寫入儲存格）、append（追加資料列）",
              google_tasks: "list_tasks（工作項目列表）、create_task（建立工作項目）、complete_task（完成工作項目）",
              google_docs: "get（讀取文件）、create（建立文件）、append_text（追加文字）",
              youtube: "search（搜尋影片）、get_video（取得影片資訊）、get_comments（取得留言）",
              github: "list_repos（Repo 列表）、search_code（搜尋程式碼）、create_issue（建立 Issue）",
              line: "send_text（發送文字）、broadcast（廣播訊息）、get_profile（取得用戶資料）",
              telegram: "send_message（發送訊息）、send_photo（發送照片）、get_updates（取得更新）",
              telegram_user: "get_dialogs（對話列表）、get_history（聊天記錄）、search_messages（搜尋訊息）",
              discord: "send_message（發送訊息）、get_messages（訊息列表）、create_channel（建立頻道）",
              threads: "publish（發佈貼文）、get_posts（取得貼文）、reply（回覆貼文）",
              instagram: "publish（發佈貼文）、get_posts（取得貼文）、get_comments（取得留言）",
              canva: "list_designs（設計列表）、create_design（建立設計）、export_design（匯出設計）",
              slack: "send_message（發送訊息）、list_channels（頻道列表）、get_messages（訊息歷史）",
              microsoft_excel: "read_range（讀取儲存格）、write_range（寫入儲存格）、list_worksheets（工作表列表）",
              microsoft_word: "create_document（建立文件）、read_document（讀取文件）、export_pdf（匯出 PDF）",
              microsoft_powerpoint: "create_presentation（建立簡報）、read_presentation（讀取簡報）、export_pdf（匯出 PDF）",
            };
            const hint = TOP3_HINTS[app];
            if (hint) {
              skillText += `\n\n💡 第一次使用 ${adapter.displayName?.zh ?? app}？常用操作：${hint}`;
            }
          }
        } catch {
          // 記憶查詢失敗不影響
        }
        return {
          content: [{ type: "text" as const, text: skillText }],
        };
      }

      // Fallback：從 actionMap 或 tools 列表產生 skill
      const actions = adapter.actionMap
        ? Object.keys(adapter.actionMap).join(", ")
        : adapter.tools.map((t) => `${t.name}: ${t.description}`).join("\n");

      return {
        content: [
          { type: "text" as const, text: `${app} actions: ${actions}` },
        ],
      };
    },
  );
}

// ============================================================
// P3: 參數智慧預填
// 從 memory engine 查 category=preference 的記錄
// 匹配 app + action 後自動補入缺失的參數（不覆蓋用戶明確傳入的）
// ============================================================

/** 記錄被自動套用的偏好（供回傳時標註） */
interface AppliedPref {
  key: string;   // 參數名稱
  value: string;  // 套用的值
}

/**
 * P3: 從記憶中查偏好，自動補入缺失的參數
 * 例如：用戶沒帶 calendar_id → 自動從 memory 補上「家庭日曆」
 * 不覆蓋用戶明確傳入的參數
 */
async function applyPreferences(
  userId: string,
  app: string,
  action: string,
  params: Record<string, unknown>,
): Promise<AppliedPref[]> {
  const applied: AppliedPref[] = [];
  try {
    // 查詢與 app + action 相關的偏好記憶
    const prefs = await queryMemory(userId, `${app} ${action} default`, "preference", app, 5);
    for (const pref of prefs) {
      // 偏好 key 格式：「default:calendar_id」或「default_calendar_id」
      // 從 key 中提取參數名稱
      const match = pref.key.match(/^default[_:](.+)$/);
      if (match) {
        const paramKey = match[1];
        // 只在用戶沒有明確傳入該參數時才補入
        if (!(paramKey in params)) {
          params[paramKey] = pref.value;
          applied.push({ key: paramKey, value: pref.value });
        }
      }
    }
  } catch {
    // 偏好查詢失敗不影響主流程
  }
  return applied;
}

// ============================================================
// 參數格式轉換層（Phase 1.3）
// AI 傳簡化參數（名字、代稱），OctoDock 自動解析成 API 原始格式
// 例如：{ folder: "會議" } → { parent_id: "317a9617...", parent_type: "page_id" }
// 這是讓 AI 不用知道 Notion API 細節的關鍵
// ============================================================

/**
 * Notion 的簡化參數名稱 → API 參數名稱的對應規則
 * key: AI 傳入的簡化欄位名稱
 * value: { apiField: API 需要的欄位名, entityType: 記憶中的實體類型 }
 */
const NOTION_PARAM_ALIASES: Record<string, { apiField: string; entityType: string }> = {
  folder: { apiField: "parent_id", entityType: "page" },
  parent: { apiField: "parent_id", entityType: "page" },
  page: { apiField: "page_id", entityType: "page" },
  database: { apiField: "database_id", entityType: "database" },
  block: { apiField: "block_id", entityType: "block" },
};

/** UUID v4 格式正規表達式（含有無連字號兩種格式） */
const UUID_REGEX = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/**
 * 將 AI 傳入的簡化參數轉換成 App API 需要的原始格式
 *
 * 處理邏輯：
 * 1. 掃描 params 中的簡化欄位名（folder、page、database 等）
 * 2. 如果值不是 UUID，嘗試從記憶中解析名稱 → ID
 * 3. 將簡化欄位名轉成 API 欄位名（folder → parent_id）
 * 4. 解析失敗時保留原始值（讓 API 回傳有意義的錯誤）
 *
 * @param userId 用戶 ID
 * @param appName App 名稱
 * @param action 操作名稱
 * @param params AI 傳入的原始參數
 * @returns 轉換後的參數（可直接傳給 adapter.execute）
 */
async function translateSimplifiedParams(
  userId: string,
  appName: string,
  action: string,
  params: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  // 目前只有 Notion 需要轉換（未來其他 App 再擴充）
  if (appName !== "notion") return params;

  const translated = { ...params };

  for (const [alias, config] of Object.entries(NOTION_PARAM_ALIASES)) {
    const value = translated[alias];

    // 沒有這個欄位，跳過
    if (value === undefined) continue;
    // 不是字串，跳過
    if (typeof value !== "string") continue;

    // 如果已經是 UUID 格式，只做欄位名轉換（alias → apiField）
    if (UUID_REGEX.test(value)) {
      if (alias !== config.apiField) {
        translated[config.apiField] = value;
        delete translated[alias];
      }
      continue;
    }

    // 不是 UUID → 嘗試從記憶中解析名稱
    const resolved = await resolveIdentifier(userId, value, appName);
    if (resolved) {
      // 記憶命中：用 ID 替換名稱
      translated[config.apiField] = resolved.id;
      if (alias !== config.apiField) {
        delete translated[alias];
      }
    } else {
      // 記憶沒有 → fallback: 用 Notion search 查找
      const searchResult = await searchForId(userId, appName, value, config.entityType);
      if (searchResult) {
        translated[config.apiField] = searchResult;
        if (alias !== config.apiField) {
          delete translated[alias];
        }
        // 學習這個對應，下次不用再搜
        learnIdentifier(userId, appName, value, searchResult, config.entityType).catch(() => {});
      } else {
        // 搜尋也找不到：保留原值，讓 API 回傳錯誤
        if (alias !== config.apiField) {
          translated[config.apiField] = value;
          delete translated[alias];
        }
      }
    }
  }

  // ── 第二輪：檢查 API 欄位名本身是否包含非 UUID 值 ──
  // 解決 AI 直接傳 {page_id: "會議紀錄"} 而不是 {page: "會議紀錄"} 的情況
  const apiFieldsToCheck = ["page_id", "parent_id", "database_id", "block_id"];
  for (const field of apiFieldsToCheck) {
    const value = translated[field];
    if (typeof value !== "string") continue;
    if (UUID_REGEX.test(value)) continue; // 已經是 UUID，不用解析

    // 判斷 entity type
    const entityType = field.includes("database") ? "database" : "page";

    // 嘗試記憶解析
    const resolved = await resolveIdentifier(userId, value, appName);
    if (resolved) {
      translated[field] = resolved.id;
    } else {
      // fallback search
      const searchResult = await searchForId(userId, appName, value, entityType);
      if (searchResult) {
        translated[field] = searchResult;
        learnIdentifier(userId, appName, value, searchResult, entityType).catch(() => {});
      }
    }
  }

  // 特殊處理：如果有 folder 且沒有 parent_type，自動補上
  if (translated.parent_id && !translated.parent_type) {
    translated.parent_type = "page_id";
  }

  return translated;
}

/**
 * 名稱解析的 fallback：用 Notion search 查找名稱對應的 ID
 * 當記憶裡找不到時，自動搜尋 Notion 嘗試匹配
 */
async function searchForId(
  userId: string,
  appName: string,
  name: string,
  entityType: string,
): Promise<string | null> {
  if (appName !== "notion") return null;

  const adapter = getAdapter(appName);
  if (!adapter) return null;

  try {
    // 用 adapter 的 execute 呼叫 notion_search
    const token = await (await import("@/services/token-manager")).getValidToken(userId, appName);
    const searchResult = await adapter.execute("notion_search", {
      query: name,
      filter: entityType === "database" ? "database" : "page",
    }, token);

    // 解析搜尋結果
    const text = searchResult.content[0]?.text;
    if (!text) return null;
    const data = JSON.parse(text);
    const results = data.results as Array<Record<string, unknown>> | undefined;
    if (!results || results.length === 0) return null;

    // 找最匹配的結果（標題包含搜尋名稱）
    for (const item of results) {
      const props = item.properties as Record<string, unknown> | undefined;
      if (!props) continue;

      // 檢查 title 屬性
      const titleProp = props.title as { title?: Array<{ plain_text: string }> } | undefined;
      const title = titleProp?.title?.[0]?.plain_text;
      if (title && title.includes(name)) {
        return item.id as string;
      }

      // 檢查 Name 屬性
      const nameProp = props.Name as { title?: Array<{ plain_text: string }> } | undefined;
      const itemName = nameProp?.title?.[0]?.plain_text;
      if (itemName && itemName.includes(name)) {
        return item.id as string;
      }
    }

    // 沒有精確匹配，用第一個結果
    if (results.length === 1) {
      return results[0].id as string;
    }

    return null;
  } catch {
    return null;
  }
}

// ============================================================
// 工具結果轉換
// 將內部的 ToolResult（MCP 格式）轉成標準化的 DoResult
// 精簡回傳內容，減少 AI 需要處理的 token 數量
// ============================================================

/**
 * 將 ToolResult 轉成 DoResult
 * 解析 JSON、提取關鍵欄位（url、title）、移除冗餘資料
 */
function toolResultToDoResult(
  toolResult: { content: Array<{ type: string; text: string }>; isError?: boolean; _classifiedError?: import("@/mcp/error-types").OctoDockError },
  appName: string,
): DoResult {
  // B1: 錯誤情況 — 優先用結構化錯誤
  if (toolResult.isError) {
    const classified = toolResult._classifiedError;
    if (classified) {
      return {
        ok: false,
        error: classified.message,
        errorCode: classified.code,
        retryable: classified.retryable,
        retryAfterMs: classified.retryAfterMs,
      };
    }
    const errorText = toolResult.content[0]?.text ?? "Unknown error";
    return { ok: false, error: errorText };
  }

  // 嘗試解析 JSON 結果
  const rawText = toolResult.content[0]?.text ?? "";
  try {
    const data = JSON.parse(rawText);

    // 嘗試提取 Notion 頁面 URL 和標題
    const url = extractUrl(data, appName);
    const title = extractTitle(data);

    return { ok: true, data, url, title };
  } catch {
    // 不是 JSON，直接當文字回傳
    return { ok: true, data: rawText };
  }
}

/** 從 API 回應中提取資源 URL */
function extractUrl(data: unknown, appName: string): string | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const obj = data as Record<string, unknown>;

  // Notion：頁面有 url 欄位
  if (appName === "notion") {
    if (typeof obj.url === "string") return obj.url;
    // get_page 回傳 { page, blocks } 結構
    const page = obj.page as Record<string, unknown> | undefined;
    if (page && typeof page.url === "string") return page.url;
  }

  return undefined;
}

/** 從 API 回應中提取資源標題 */
function extractTitle(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const obj = data as Record<string, unknown>;

  // 直接在 data 上找 properties.title
  const title = extractTitleFromProps(obj);
  if (title) return title;

  // get_page 回傳 { page, blocks } 結構：從 page 子物件找
  const page = obj.page as Record<string, unknown> | undefined;
  if (page) return extractTitleFromProps(page);

  return undefined;
}

/** 從 Notion 物件的 properties 中提取標題文字 */
function extractTitleFromProps(obj: Record<string, unknown>): string | undefined {
  const props = obj.properties as Record<string, unknown> | undefined;
  if (!props) return undefined;

  // 標準的 title 屬性
  if (props.title) {
    const titleProp = props.title as { title?: Array<{ plain_text: string }> };
    if (titleProp.title?.[0]?.plain_text) {
      return titleProp.title[0].plain_text;
    }
  }

  // 資料庫項目常用 Name 欄位
  if (props.Name) {
    const nameProp = props.Name as { title?: Array<{ plain_text: string }> };
    if (nameProp.title?.[0]?.plain_text) {
      return nameProp.title[0].plain_text;
    }
  }

  return undefined;
}

// ============================================================
// 自動學習機制（越用越懂你）
// 從成功的操作結果中提取 名稱 → ID 對應，存入記憶
// 下次 AI 用名稱操作時，OctoDock 就能自動解析
// ============================================================

/**
 * 從操作結果中學習 ID 對應
 * 例如：建立了一個叫 "會議紀錄" 的頁面 → 記住 page:會議紀錄 = page_id
 */
async function learnFromResult(
  userId: string,
  appName: string,
  action: string,
  params: Record<string, unknown>,
  result: DoResult,
): Promise<void> {
  // 只有 Notion 目前需要學習（未來其他 App 再擴充）
  if (appName !== "notion") return;
  if (!result.data || typeof result.data !== "object") return;

  const data = result.data as Record<string, unknown>;

  // ── 單一資源操作：學習 title → id ──
  const id = data.id as string | undefined;
  if (id && result.title) {
    const entityType = (data.object as string) === "database" ? "database" : "page";
    await learnIdentifier(userId, appName, result.title, id, entityType);
  }

  // ── 搜尋 / 資料庫查詢：從結果列表中批次學習 ──
  const results = data.results as Array<Record<string, unknown>> | undefined;
  if (results && Array.isArray(results)) {
    // 最多學習前 10 筆，避免大量寫入
    const toLearn = results.slice(0, 10);
    for (const item of toLearn) {
      const itemId = item.id as string | undefined;
      if (!itemId) continue;

      const itemTitle = extractTitleFromItem(item);
      if (!itemTitle) continue;

      const entityType = (item.object as string) === "database" ? "database" : "page";
      // 非同步學習，不阻塞主流程
      learnIdentifier(userId, appName, itemTitle, itemId, entityType).catch(() => {});
    }
  }
}

/**
 * 從 Notion API 的搜尋結果項目中提取標題
 * Notion 的標題可能在不同位置，取決於物件類型
 */
function extractTitleFromItem(item: Record<string, unknown>): string | undefined {
  const props = item.properties as Record<string, unknown> | undefined;
  if (!props) return undefined;

  // 嘗試從 title 屬性取得（頁面）
  if (props.title) {
    const titleProp = props.title as { title?: Array<{ plain_text: string }> };
    if (titleProp.title?.[0]?.plain_text) {
      return titleProp.title[0].plain_text;
    }
  }

  // 嘗試從 Name 屬性取得（資料庫項目常用 Name 欄位）
  if (props.Name) {
    const nameProp = props.Name as { title?: Array<{ plain_text: string }> };
    if (nameProp.title?.[0]?.plain_text) {
      return nameProp.title[0].plain_text;
    }
  }

  // 嘗試從資料庫的 title 陣列取得
  const titleArr = item.title as Array<{ plain_text: string }> | undefined;
  if (titleArr?.[0]?.plain_text) {
    return titleArr[0].plain_text;
  }

  return undefined;
}

/**
 * C5: 通用 fallback — 從 rawResult 嘗試提取 id、title/name、url
 * adapter 沒實作 extractSummary 時使用
 */
/**
 * NOT_FOUND 智慧復原：從搜尋結果文字中提取候選（title + id）
 * 支援格式：Notion 的 "**Title** (page) id:xxx"、Drive 的 "- Name (...) id:xxx"
 */
function extractCandidatesFromSearch(searchText: string): Array<{ title: string; id: string }> {
  const candidates: Array<{ title: string; id: string }> = [];
  // 匹配 "**title** ... id:xxx" 或 "- title ... id:xxx"
  const idPattern = /(?:\*\*(.+?)\*\*|^-\s+(.+?))\s.*?id:(\S+)/gm;
  let match;
  while ((match = idPattern.exec(searchText)) !== null && candidates.length < 5) {
    const title = (match[1] ?? match[2] ?? "").trim();
    const id = match[3].trim();
    if (title && id) {
      candidates.push({ title, id });
    }
  }
  return candidates;
}

function extractDefaultSummary(rawData: unknown): Record<string, unknown> | null {
  // U12: 統一 summary 提取 — 支援物件和 JSON 字串
  let obj: Record<string, unknown>;
  if (typeof rawData === "object" && rawData !== null) {
    obj = rawData as Record<string, unknown>;
  } else if (typeof rawData === "string") {
    // formatResponse 後的 data 是字串，嘗試 JSON.parse
    try { obj = JSON.parse(rawData); } catch { return null; }
    if (typeof obj !== "object" || obj === null) return null;
  } else {
    return null;
  }

  const summary: Record<string, unknown> = {};
  let hasData = false;

  // 從多層結構中找 id（支援 { page: { id } } 和 { id } 兩種格式）
  const id = obj.id ?? (obj.page as Record<string, unknown>)?.id
    ?? (obj.design as Record<string, unknown>)?.id
    ?? (obj.result as Record<string, unknown>)?.id;
  if (typeof id === "string") { summary.id = id; hasData = true; }

  // 找 url
  const url = obj.url ?? (obj.page as Record<string, unknown>)?.url
    ?? obj.webViewLink ?? obj.html_url
    ?? (obj.urls as Record<string, unknown>)?.edit_url;
  if (typeof url === "string") { summary.url = url; hasData = true; }

  // 找 title
  const title = extractTitle(obj)
    ?? (typeof obj.subject === "string" ? obj.subject : undefined)
    ?? (typeof obj.summary === "string" ? obj.summary : undefined);
  if (title) { summary.title = title; hasData = true; }

  // 嘗試取 name（非 Notion 類 App 常用）
  if (typeof obj.name === "string") { summary.name = obj.name; hasData = true; }

  // G1: 寫入型 action 帶 parent 資訊（讓 AI 知道資源建在哪裡）
  const parentObj = obj.parent as Record<string, unknown> | undefined;
  if (parentObj) {
    const parentType = parentObj.type as string | undefined;
    const parentId = parentObj.page_id ?? parentObj.database_id ?? parentObj.workspace;
    if (parentType && parentId) {
      summary.parent_type = parentType;
      summary.parent_id = parentId;
      hasData = true;
    }
  }

  return hasData ? summary : null;
}

// ============================================================
// R: octodock_sop — 流程捷徑（SOP + 組合技）
// AI 在執行前先查 sop，有匹配的就直接用（更快）
// 分層揭露：無參數列 top 5、帶 category 列該 App、帶 name 執行
// ============================================================

function registerSopTool(
  server: McpServer,
  userId: string,
): void {
  server.tool(
    "octodock_sop",
    "Load and run the user's proven workflows to complete tasks faster and better. Frequent multi-step operations are saved here — run them directly instead of calling octodock_do step by step. No args: list top workflows. With name: show full steps.",
    {
      category: z.string().optional().describe("Filter by app name (e.g. 'notion', 'gmail')"),
      name: z.string().optional().describe("Execute a specific SOP by name"),
    },
    // U26d: Safety annotations
    {
      destructiveHint: false,
      readOnlyHint: true,
    },
    async (args) => {
      const { category, name } = args as { category?: string; name?: string };

      // 帶 name → 顯示完整步驟定義
      if (name) {
        const results = await queryMemory(userId, name, "sop");
        const match = results.find((r) => r.key === name);
        if (!match) {
          return { content: [{ type: "text" as const, text: `SOP "${name}" not found. Use octodock_sop() to list available workflows.` }] };
        }
        return { content: [{ type: "text" as const, text: match.value }] };
      }

      // 取所有 SOP
      const allSops = await listMemory(userId);
      let sops = allSops.filter((m) => m.category === "sop");

      // 帶 category → 過濾該 App 相關的
      if (category) {
        sops = sops.filter((s) => s.key.includes(category) || s.value.includes(category));
      }

      if (sops.length === 0) {
        const msg = category
          ? `No workflows found for "${category}". Use OctoDock more — workflows are auto-generated from repeated usage patterns.`
          : "No workflows saved yet. Use OctoDock more — workflows are auto-generated from repeated usage patterns.";
        return { content: [{ type: "text" as const, text: msg }] };
      }

      // V11: 依最近 7 天使用頻率排序，只顯示 top 5
      // 從 operations 表查 SOP 相關操作頻率，有使用紀錄的排前面
      let top = sops;
      try {
        const { operations: opsTable } = await import("@/db/schema");
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const freqRows = await db
          .select({ action: opsTable.action, count: sql<number>`count(*)::int` })
          .from(opsTable)
          .where(and(
            eq(opsTable.userId, userId),
            eq(opsTable.appName, "system"),
            eq(opsTable.success, true),
            gte(opsTable.createdAt, sevenDaysAgo),
          ))
          .groupBy(opsTable.action)
          .orderBy(desc(sql`count(*)`));
        // 建立 SOP key → 使用次數的映射
        const freqMap = new Map<string, number>();
        for (const r of freqRows) {
          freqMap.set(r.action, r.count);
        }
        // 依使用次數降冪排序（沒用過的排最後，按建立時間）
        top = [...sops].sort((a, b) => {
          const aFreq = freqMap.get(a.key) ?? 0;
          const bFreq = freqMap.get(b.key) ?? 0;
          return bFreq - aFreq;
        });
      } catch {
        // 頻率查詢失敗不影響，保持原順序
      }
      top = top.slice(0, 5);
      const list = top.map((s) => {
        // 從 SOP 內容提取摘要（第一行標題或前 80 字元）
        const firstLine = s.value.split("\n").find((l) => l.trim().length > 0) ?? s.key;
        const summary = firstLine.replace(/^#\s*/, "").substring(0, 80);
        return `- **${s.key}** — ${summary}`;
      }).join("\n");

      const moreText = sops.length > 5 ? `\n\n(${sops.length - 5} more — use octodock_sop(category:"app_name") to filter)` : "";

      return {
        content: [{
          type: "text" as const,
          text: `## Saved Workflows\n\n${list}${moreText}\n\nUse octodock_sop(name:"...") to see full steps and execute.`,
        }],
      };
    },
  );
}
