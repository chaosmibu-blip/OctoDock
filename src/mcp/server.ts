import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { db } from "@/db";
import { connectedApps, storedResults, operations as opsTable } from "@/db/schema";
import { eq, lt, or, isNull, and, gte, desc, ne, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getAdapter, getAllAdapters } from "./registry";
import { executeWithMiddleware, logOperation } from "./middleware/logger";
// checkMcpRateLimit 已移除 — OctoDock 是執行者不是守衛
import { getPreContext } from "./middleware/pre-context";
import { runPostCheck } from "./middleware/post-check";
import { suggestNextAction, getRecoveryHint, findCrossAppContext, getLikelyNextActions } from "./middleware/action-chain";
import { getErrorHint } from "./error-hints";
import { cleanHiddenChars, convertTimestamps } from "./response-formatter";
import { MAX_RESPONSE_CHARS, TRUNCATED_HEAD_CHARS, TRUNCATED_TAIL_CHARS, MCP_SCHEMA_VERSION } from "@/lib/constants";
import { checkParams } from "./middleware/param-guard";
import { learnFromError } from "./middleware/error-learner";
import { checkUsageLimit, incrementUsage } from "./middleware/usage-limit";
import { learnIdentifier, resolveIdentifier, listMemory, queryMemory } from "@/services/memory-engine";
import { detectWorkflowCandidate } from "@/services/workflow-detector";
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
import { cleanExpiredData } from "@/services/db-cleanup";
import { resolveSession, buildSessionGuide } from "@/mcp/session";
import type { DoResult } from "@/adapters/types";

// ============================================================
// MCP Server 核心
// OctoDock 的 MCP server 只暴露 2 個工具：
//   octodock_do   — 做事（自動驗證、攔截、載入上下文）
//   octodock_help — 問路（碰到困難時取得指引）
//
// 必經路徑機制：名稱驗證、intent 偏差偵測、response 偏差優先、session 首次載入
// 不管連了幾個 App，AI 端永遠只看到 2 個工具（~300 tokens）
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

/** A2: 同義詞表 — 用於模糊匹配未知 action（雙向對應） */
const ACTION_SYNONYMS: [string, string][] = [
  ["complete", "close"],
  ["remove", "delete"],
  ["list", "get"],
  ["create", "add"],
  ["find", "search"],
  ["read", "get"],
  ["send", "post"],
  ["edit", "update"],
];

/**
 * A2: 模糊匹配未知 action — substring + 同義詞替換
 * 找到最可能的正確 action，找不到回傳 null
 */
function findFuzzyActionMatch(unknown: string, available: string[]): string | null {
  const u = unknown.toLowerCase();

  // 1. Substring 匹配：未知 action 包含某個可用 action，或反過來
  for (const avail of available) {
    const a = avail.toLowerCase();
    if (u.includes(a) || a.includes(u)) {
      return avail;
    }
  }

  // 2. 同義詞替換：把 unknown 裡的動詞換成同義詞，再查 actionMap
  // 拆出動詞部分（假設是底線分隔的第一段，例如 "complete_task" → "complete"）
  const parts = u.split("_");
  const verb = parts[0];
  const rest = parts.slice(1).join("_"); // 例如 "task"

  for (const [syn1, syn2] of ACTION_SYNONYMS) {
    let replacedVerb: string | null = null;
    if (verb === syn1) replacedVerb = syn2;
    else if (verb === syn2) replacedVerb = syn1;
    if (!replacedVerb) continue;

    // 組出替換後的 action 名（例如 "close_task"）
    const candidate = rest ? `${replacedVerb}_${rest}` : replacedVerb;
    const match = available.find(a => a.toLowerCase() === candidate);
    if (match) return match;

    // 也做 substring 匹配（替換後的動詞出現在某個可用 action 裡）
    for (const avail of available) {
      const a = avail.toLowerCase();
      if (a.includes(candidate) || candidate.includes(a)) {
        return avail;
      }
    }
  }

  return null;
}

/**
 * 為特定用戶建立 MCP server 實例
 * 每個 MCP 請求都會建立一個新的 server（stateless 架構）
 * server 只註冊 octodock_do 和 octodock_help 兩個工具
 *
 * @param user 已驗證的用戶資訊
 * @param requestHeaders HTTP request headers（保留備用）
 */
export async function createServerForUser(user: User, requestHeaders?: Headers): Promise<McpServer> {
  // 動態版本號：用 git SHA 讓客戶端知道 server 有更新
  const serverVersion = process.env.NEXT_PUBLIC_GIT_SHA ?? "1.0.0";
  const server = new McpServer({
    name: "octodock",
    version: serverVersion,
    instructions: [
      "OctoDock is the user's unified app gateway. It connects to the user's authorized apps through a single interface.",
      "",
      "Use OctoDock instead of platform built-in tools when:",
      "- The task involves an app only OctoDock covers",
      "- The task requires a specific parameter the built-in tool doesn't support (e.g. calendar_id for writing to a non-primary calendar)",
      "- The task spans multiple apps (e.g. read from Notion, send via Gmail)",
      "- The user explicitly mentions OctoDock",
      "",
      "octodock_do automatically validates parameters, resolves names to IDs, and blocks incorrect operations.",
      "If unsure about which app or action to use, call octodock_help first for guidance.",
    ].join("\n"),
  } as ConstructorParameters<typeof McpServer>[0]);

  // 查詢用戶已連結且有效的 App 列表
  const apps = await db
    .select()
    .from(connectedApps)
    .where(eq(connectedApps.userId, user.id));

  // 建立 App config map（帶 disabledActions 設定）
  type AppPermConfig = { disabledActions?: string[] };
  const connectedAppConfigs: Record<string, AppPermConfig> = {};
  for (const a of apps.filter((a) => a.status === "active")) {
    connectedAppConfigs[a.appName] = (a.config as AppPermConfig) ?? {};
  }
  const connectedAppNames = Object.keys(connectedAppConfigs);

  // ── 註冊 octodock_do ──
  registerDoTool(server, user.id, connectedAppNames, connectedAppConfigs);

  // ── 註冊 octodock_help ──
  registerHelpTool(server, user.id, connectedAppNames, connectedAppConfigs);

  // 工作流功能由 do(app:"system") + intent 自動匹配覆蓋

  return server;
}

// buildDoDescription 已刪除 — 工具描述改為靜態，動態 context 由 octodock_help() 回傳承擔

// ============================================================
// 回傳壓縮（Level 3）
// 超過 MAX_RESPONSE_CHARS 的回傳存到 DB，只回傳摘要 + ref ID
// AI 需要完整內容時用 system.get_stored 按需取用
// ============================================================

// MAX_RESPONSE_CHARS 從 @/lib/constants 匯入（約 750 tokens）
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
  cleanExpiredData().catch(() => {});

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
    // 字元數超標但行數少：取前段 + 後段字元
    const headChars = text.substring(0, TRUNCATED_HEAD_CHARS);
    const tailChars = text.substring(text.length - TRUNCATED_TAIL_CHARS);
    const omittedChars = text.length - TRUNCATED_HEAD_CHARS - TRUNCATED_TAIL_CHARS;
    return `[Metadata] Total: ${text.length} chars, ${lines.length} lines (dense/minified content)\n\n` +
      headChars + `\n\n... (${omittedChars} chars omitted) ...\n\n` + tailChars;
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
// Session 首次使用追蹤
// 追蹤每個用戶在當前 server 實例中操作過的 App
// 首次 do 某 App 時，自動附上記憶上下文
// ============================================================
const usedAppsThisSession = new Map<string, Set<string>>();

// ============================================================
// Response 序列化 — 偏差優先排序
// AI 最先讀到的內容決定它下一步做什麼
// 第一層：偏差/問題 → 第二層：操作結果 → 第三層：OctoDock 元資訊
// ============================================================

/**
 * 將 DoResult 序列化為 JSON，控制欄位順序讓 AI 優先看到問題
 * 替代所有 JSON.stringify(result)，確保偏差資訊排在最前面
 */
function serializeDoResult(result: DoResult, sessionSeq?: number | null): string {
  const ordered: Record<string, unknown> = {};

  // ── 第一層（AI 最先看到）：偏差和問題 ──
  ordered.ok = result.ok;
  if (result.error !== undefined) ordered.error = result.error;
  if (result.errorCode) ordered.errorCode = result.errorCode;
  if (result.warnings?.length) ordered.warnings = result.warnings;
  if (result.candidates?.length) ordered.candidates = result.candidates;
  if (result.frequentFailure) ordered.frequentFailure = result.frequentFailure;
  if (result.retryable !== undefined) ordered.retryable = result.retryable;
  if (result.retryAfterMs) ordered.retryAfterMs = result.retryAfterMs;
  if (result.recoveryHint) ordered.recoveryHint = result.recoveryHint;
  if (result.affectedResources?.length) ordered.affectedResources = result.affectedResources;

  // ── 第二層：操作結果 ──
  if (result.data !== undefined) ordered.data = result.data;
  if (result.url) ordered.url = result.url;
  if (result.title) ordered.title = result.title;
  if (result.summary) ordered.summary = result.summary;

  // ── 第三層（AI 最後看到）：OctoDock 元資訊 ──
  if (result.context) ordered.context = result.context;
  if (result.nextSuggestion) ordered.nextSuggestion = result.nextSuggestion;

  // ── Session 引導 ──
  if (sessionSeq) {
    ordered.session = buildSessionGuide(sessionSeq);
  }

  return JSON.stringify(ordered);
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
  connectedAppConfigs: Record<string, { disabledActions?: string[] }>,
): void {
  server.tool(
    "octodock_do",
    `Execute actions across all user's connected apps. Handles authentication, parameter validation, name-to-ID resolution, and error recovery automatically. Required: \`intent\` — describe what you're trying to accomplish so OctoDock can validate your approach and suggest matching workflows. [schema:${MCP_SCHEMA_VERSION}]`,
    {
      app: z.string().describe("App name (e.g. 'notion', 'gmail', 'system')"),
      action: z.string().describe("Action to perform (e.g. 'create_page', 'search')"),
      params: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Action parameters"),
      intent: z.string().describe(
        "Briefly describe your goal (e.g. 'Add a work task to Work project'). Required for validation, memory lookup, and error recovery.",
      ),
    },
    // U26d: Safety annotations for Claude Connectors Directory
    {
      destructiveHint: true,
      readOnlyHint: false,
    },
    async (args) => {
      const { app, action, params = {}, intent = "" } = args as {
        app: string;
        action: string;
        params: Record<string, unknown>;
        intent: string;
      };

      // ── Schema 快取過期偵測 ──
      // intent 是必填欄位，如果 client 沒傳代表用的是舊版快取 schema
      const schemaMaybeStale = !intent;

      let result: DoResult;
      const startTime = Date.now();

      // ── 通用 Session 機制 ──
      // 解析 intent 尾部的 +N，找到或建立 session
      const sessionInfo = intent ? await resolveSession(userId, intent).catch(() => null) : null;
      const cleanIntent = sessionInfo?.cleanIntent ?? intent;

      // ── 事件圖譜：因果偵測 ──
      // 因果的本質：「這筆操作用了前面某筆操作的結果」
      // 判斷方式：當前 params 裡有沒有引用前面操作 result 中的 ID
      // 不限時間——上午產生的 ID 晚上用，仍然是因果
      let _parentOperationId: string | null = null;
      try {
        // 查用戶最近幾筆操作的 result（不只看上一筆，因為因果可能跨好幾步）
        const recentOps = await db
          .select({ id: opsTable.id, result: opsTable.result })
          .from(opsTable)
          .where(eq(opsTable.userId, userId))
          .orderBy(desc(opsTable.createdAt))
          .limit(10);

        const paramsStr = JSON.stringify(params);
        const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

        // 從最近的開始找，找到第一筆有因果關係的就停
        for (const prev of recentOps) {
          const resultStr = JSON.stringify(prev.result ?? {});
          const resultIds = resultStr.match(uuidPattern) ?? [];
          for (const id of resultIds) {
            if (paramsStr.includes(id)) {
              _parentOperationId = prev.id;
              break;
            }
          }
          if (_parentOperationId) break;
        }
      } catch {
        // 因果偵測失敗不影響主流程
      }

      // ── 單一出口：統一記錄 + 回傳 ──
      // 所有 return 都經過 exitDo，確保每條路徑都寫入 operations 表
      // executeWithMiddleware 內部已自行記錄，用 _alreadyLogged 避免重複
      let _alreadyLogged = false;
      function exitDo(
        r: DoResult,
        opts?: { toolName?: string; skipLog?: boolean },
      ) {
        if (!opts?.skipLog && !_alreadyLogged) {
          logOperation({
            userId,
            appName: app ?? "system",
            toolName: opts?.toolName ?? "unknown",
            action,
            params,
            intent: cleanIntent,
            result: { ok: r.ok, error: r.error, summary: r.summary, code: r.errorCode },
            success: r.ok,
            durationMs: Date.now() - startTime,
            parentOperationId: _parentOperationId,
            sessionSeq: sessionInfo?.sessionSeq ?? undefined,
            sessionId: sessionInfo?.sessionId ?? undefined,
          });
        }
        return {
          content: [{ type: "text" as const, text: serializeDoResult(r, sessionInfo?.sessionSeq ?? null) }],
        };
      }

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
        return exitDo(result, { toolName: `system_${action}` });
      }

      // ── App 操作 ──

      // 用量限制檢查（Free 用戶每月 1,000 次）
      const usageLimitError = await checkUsageLimit(userId);
      if (usageLimitError) {
        result = { ok: false, error: usageLimitError };
        return exitDo(result);
      }

      // 檢查 App 是否已連結
      if (!connectedAppNames.includes(app)) {
        result = {
          ok: false,
          error: `App "${app}" is not connected (APP_NOT_CONNECTED)`,
          suggestions: connectedAppNames,
        };
        return exitDo(result);
      }

      // 取得 Adapter
      const adapter = getAdapter(app);
      if (!adapter) {
        result = {
          ok: false,
          error: `Adapter for "${app}" not found (ADAPTER_NOT_FOUND)`,
        };
        return exitDo(result);
      }

      // A: Action alias 機制 — AI 猜的名字自動對應正確 action（ACTION_ALIASES 定義在 module scope）
      const resolvedAction = adapter.actionMap?.[action] ? action : (ACTION_ALIASES[action] ?? action);

      // 透過 actionMap 找到內部工具名稱
      const toolName = adapter.actionMap?.[resolvedAction];
      if (!toolName) {
        // actionMap 裡找不到 → 嘗試模糊匹配，再回傳可用的 action 列表
        const availableActions = adapter.actionMap
          ? Object.keys(adapter.actionMap)
          : adapter.tools.map((t) => t.name);

        // 模糊匹配：找最可能的正確 action
        const fuzzyMatch = findFuzzyActionMatch(resolvedAction, availableActions);

        const errorMsg = fuzzyMatch
          ? `Unknown action "${action}" for ${app}. Did you mean "${fuzzyMatch}"?`
          : `Unknown action "${action}" for ${app}`;
        result = {
          ok: false,
          error: errorMsg,
          suggestions: fuzzyMatch ? [fuzzyMatch, ...availableActions.filter(a => a !== fuzzyMatch)] : availableActions,
        };
        return exitDo(result, { toolName: `unknown_${action}` });
      }

      // ── 權限檢查：用戶是否停用了此 action ──
      const appConfig = connectedAppConfigs[app];
      if (appConfig?.disabledActions?.includes(resolvedAction)) {
        result = {
          ok: false,
          error: `Action "${resolvedAction}" is disabled for ${app}. The user turned it off in Dashboard settings. (ACTION_DISABLED)`,
          errorCode: "ACTION_DISABLED",
        };
        return exitDo(result, { toolName });
      }

      // B3: MCP rate limit 已移除 — OctoDock 是執行者不是守衛
      // App API 的 rate limit 由 OctoDock 內部控速處理（bulk operation、retry），AI 不需要碰到
      // 保留免費用戶月度配額（商業模型），在 usage-limit middleware 中處理

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

      // ── 必經路徑：全域名稱→ID 驗證 ──
      // 掃描 adapter.nameParamMap 宣告的名稱參數，精確匹配才放行
      // 需要 token 做 API 驗證 → 提前取一次（後面 pre-context / execute 會共用）
      let earlyToken: string | null = null;
      if (adapter.nameParamMap || adapter.preValidate) {
        try {
          const { getValidToken: gvt } = await import("@/services/token-manager");
          earlyToken = await gvt(userId, app);
        } catch {
          earlyToken = null;
        }
      }

      const nameValidation = await validateAndResolveNames(
        userId, app, translatedParams, adapter, earlyToken,
      );
      if (nameValidation.blocked && nameValidation.blockResult) {
        result = nameValidation.blockResult;
        return exitDo(result, { toolName });
      }
      // 把驗證過的參數寫回（名稱已替換成 ID）
      Object.assign(translatedParams, nameValidation.resolvedParams);
      // 收集驗證警告
      const nameWarnings = nameValidation.warnings;

      // ── 必經路徑：Per-App 專屬攔截 ──
      // 超出名稱驗證範圍的 App-specific 檢查（DB schema、用戶規則等）
      if (adapter.preValidate && earlyToken) {
        try {
          const preValResult = await adapter.preValidate(action, translatedParams, earlyToken);
          if (preValResult) {
            result = preValResult;
            return exitDo(result, { toolName });
          }
        } catch {
          // preValidate 出錯不攔截，繼續執行
        }
      }

      // J3: 參數防呆 — 在執行前攔截明顯錯誤的參數
      const guardResult = checkParams(app, toolName, translatedParams);
      if (guardResult?.blocked) {
        result = { ok: false, error: guardResult.error };
        return exitDo(result, { toolName });
      }
      // J3: 非攔截的警告，暫存到 guardWarnings，等 result 初始化後再合併
      const guardWarnings = guardResult?.warnings;

      // G5: suppress_suggestions — 讓 AI 或用戶控制是否回傳 nextSuggestion
      const suppressSuggestions = translatedParams.suppress_suggestions === true;
      if (suppressSuggestions) {
        delete translatedParams.suppress_suggestions;
      }

      // ── 工作流 intent 匹配 ──
      // 用 intent 語意搜尋匹配的工作流，讓 AI 知道以前做過類似的多步驟流程
      let matchedWorkflow: string | null = null;
      if (cleanIntent) {
        try {
          const wfMemories = await queryMemory(userId, cleanIntent, "workflow", undefined, 1);
          if (wfMemories.length > 0) {
            matchedWorkflow = wfMemories[0].value;
          }
        } catch {
          // 工作流查詢失敗不影響主流程
        }
      }

      // C6: Dry-run 模式 — 破壞性操作預覽，不實際執行
      const isDryRun = translatedParams.dryRun === true;
      const isDryRunEligible = /delete|trash|replace|update/.test(toolName);
      if (isDryRun && isDryRunEligible) {
        // 移除 dryRun 參數避免傳給上游 API
        const { dryRun: _dryRun, ...cleanParams } = translatedParams;
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
        } catch {
          result = {
            ok: true,
            data: { dryRun: true, wouldAffect: null, note: "Could not preview target" },
          };
        }
        return exitDo(result, { toolName });
      }
      // 非 dry-run 時移除 dryRun 參數（如果 AI 誤傳了）
      if ("dryRun" in translatedParams) {
        delete translatedParams.dryRun;
      }

      // 取 token 一次，pre-context 和 executeWithMiddleware 共用
      // 如果前面名稱驗證已經取過 token，直接複用
      let token = earlyToken;
      if (!token) {
        const { getValidToken } = await import("@/services/token-manager");
        token = await getValidToken(userId, app).catch(() => null);
      }

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

      // ── AI 對話注入：converse action 需要跨 App 的 userId 和 token 取得函式 ──
      if (resolvedAction === "converse" && /^(openai|anthropic|google_gemini)$/.test(app)) {
        translatedParams._userId = userId;
        translatedParams._getToken = async (targetApp: string) => {
          const { getValidToken } = await import("@/services/token-manager");
          return getValidToken(userId, targetApp);
        };
      }

      // 透過 middleware 執行（取 token → 呼叫 API → 記錄日誌）
      const toolResult = await executeWithMiddleware(
        userId,
        app,
        toolName,
        translatedParams,
        (p, t) => adapter.execute(toolName, p, t),
        { prefetchedToken: token, intent: cleanIntent, sessionSeq: sessionInfo?.sessionSeq, sessionId: sessionInfo?.sessionId },
      );
      // executeWithMiddleware 內部已記錄，標記避免出口函式重複記錄
      _alreadyLogged = true;

      // 轉換成標準化的 DoResult
      result = toolResultToDoResult(toolResult, app);

      // J3: 合併 param-guard 的警告到 result
      if (guardWarnings && guardWarnings.length > 0) {
        if (!result.warnings) result.warnings = [];
        result.warnings.push(...guardWarnings);
      }
      // 合併名稱驗證的警告
      if (nameWarnings.length > 0) {
        if (!result.warnings) result.warnings = [];
        result.warnings.push(...nameWarnings);
      }
      // 合併 preValidate 產生的警告（例如 Notion DB 欄位大小寫修正）
      const preValWarnings = translatedParams._preValidateWarnings as string[] | undefined;
      if (preValWarnings?.length) {
        if (!result.warnings) result.warnings = [];
        result.warnings.push(...preValWarnings);
        delete translatedParams._preValidateWarnings;
      }

      // C1: pre-context — 停用 context 欄位，實測 AI 不使用這些資訊
      // context 欄位增加回傳 token 但不改變 AI 行為，完全移除
      // 保留破壞性操作的 warnings（G2、G3），這些 AI 會看
      if (preContext && result.ok) {
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

      // P3: 自動套用的偏好參數 — 改放 warnings 而非 context，確保 AI 看到可覆蓋提示
      if (result.ok && appliedPrefs.length > 0) {
        if (!result.warnings) result.warnings = [];
        for (const p of appliedPrefs) {
          const displayKey = p.key.replace(/_id$/, "").replace(/_/g, " ");
          result.warnings.push(`Auto-filled ${displayKey}: ${p.value}. Override by specifying ${p.key} explicitly.`);
        }
      }

      // C5: 操作結果帶結構化摘要 — 只在寫入/破壞性操作時附加
      // 讀取操作（get、search、list）的 data 已包含完整資訊，summary 是多餘的
      const isWriteAction = /create|update|delete|archive|trash|send|reply|draft|append|replace|move|rename|share|copy|publish/.test(action);
      if (result.ok && result.data && isWriteAction) {
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
      // ── P4: 成功回傳帶決策 context ──
      if (result.ok) {
        try {
          // intent 優先作為記憶查詢關鍵字（更精準），fallback 到 title/action
          const keyword = cleanIntent || result.title || (translatedParams.title as string) || (translatedParams.subject as string) || action;
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

      // ── 必經路徑：錯誤歸因 — OctoDock 的問題 vs AI 呼叫錯誤 ──
      // OctoDock/API 問題：TOKEN_EXPIRED, SERVICE_UNAVAILABLE, RATE_LIMITED, NETWORK_ERROR
      // AI 呼叫錯誤：INVALID_PARAMS, NOT_FOUND, PERMISSION_DENIED
      if (!result.ok && result.errorCode) {
        const octodockErrors = ["TOKEN_EXPIRED", "SERVICE_UNAVAILABLE", "RATE_LIMITED", "NETWORK_ERROR", "UPSTREAM_ERROR"];
        if (octodockErrors.includes(result.errorCode)) {
          // OctoDock/API 端問題 → 告訴 AI 不是它的錯
          result.error = `[OctoDock/API issue] ${result.error}\nThis is not a parameter error — OctoDock is handling it.`;
        } else {
          // AI 呼叫錯誤 → 附上 intent 幫助修正
          if (cleanIntent) {
            result.error = `${result.error}\n\n[Your intent] "${cleanIntent}" — check if your parameters match this intent.`;
          }
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

        // E2: recoveryHint — 查上次成功的同類操作參數，輔助 AI 修正
        try {
          const hint = await getRecoveryHint(userId, app, toolName);
          if (hint) result.recoveryHint = hint;
        } catch {}

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

      // ── 錯誤引導：提示 AI 用 octodock_help 查正確語法 ──
      if (!result.ok && app !== "system") {
        result.error = (result.error ?? "") +
          `\n\n→ For correct parameters: octodock_do(app:"system", action:"find_tool", params:{task:"${action} in ${app}"})`;
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
            const failMsg = `⚠️ 此操作近 24 小時內失敗 ${failCount} 次。建議先用 octodock_help(app:"${app}", action:"${action}") 確認參數格式，或用 search 確認正確 ID。`;
            result.frequentFailure = {
              count: failCount,
              since: twentyFourHoursAgo.toISOString(),
              suggestion: failMsg,
            };
            // 同時放進 warnings，確保 AI 一定看到（warnings 在回傳第一層）
            if (!result.warnings) result.warnings = [];
            result.warnings.unshift(failMsg);
          }
        } catch {
          // 查詢失敗不影響錯誤回傳
        }
      }

      // 如果操作成功，嘗試從結果中學習 ID 對應（越用越懂你）
      if (result.ok) {
        learnFromResult(userId, app, action, params, result).catch(() => {});
        // 用量計數（非同步，不阻塞回應）
        incrementUsage(userId).catch(() => {});

        // 並行執行 post-success 的 DB 查詢（C2、workflow、E1、E4），避免串行拖慢回應
        const keyword = result.title ?? (translatedParams.title as string) ?? (translatedParams.subject as string);
        const [postCheckResult, , nextSuggestionResult, crossAppResult] = await Promise.allSettled([
          runPostCheck(userId, app, toolName, translatedParams),
          detectWorkflowCandidate(userId),
          suggestNextAction(userId, app, toolName),
          keyword ? findCrossAppContext(userId, app, keyword) : Promise.resolve([]),
        ]);

        // C2+C3: 操作後基線比對結果 — 高頻/重複 warning 已停用，只保留未來的破壞性操作 warning
        if (postCheckResult.status === "fulfilled" && postCheckResult.value?.warnings?.length) {
          if (!result.warnings) result.warnings = [];
          result.warnings.push(...postCheckResult.value.warnings);
        }
        // 工作流自動辨識：偵測重複操作模式，靜默存成工作流
        // detectWorkflowCandidate 直接自動存並回傳 null
        // E1: 操作鏈建議（G5: suppress_suggestions 時跳過）
        if (!suppressSuggestions && nextSuggestionResult.status === "fulfilled" && nextSuggestionResult.value) {
          result.nextSuggestion = nextSuggestionResult.value;
        }
        // E4: 跨 App 關聯 context
        if (crossAppResult.status === "fulfilled" && Array.isArray(crossAppResult.value) && crossAppResult.value.length > 0) {
          const existing = result.context ? result.context + "\n\n" : "";
          const crossAppText = (crossAppResult.value as Array<{ app: string; action: string; title: string; date: string }>).map((c) => `- [${c.app}] ${c.action}: ${c.title} (${c.date})`).join("\n");
          result.context = existing + "Related across apps:\n" + crossAppText;
        }

        // ── Transfer 提示：讀取大量內容時自動提示 server-side 搬移 ──
        // 偵測條件：(1) 讀取類操作 (2) 回傳內容 > 1000 字 (3) intent 提到其他 App
        if (result.ok && result.data && app !== "system") {
          const dataStr = typeof result.data === "string" ? result.data : JSON.stringify(result.data);
          const isReadAction = /^(get|read|search|download|list|query|fetch)/.test(action);
          if (isReadAction && dataStr.length > 1000) {
            // 檢查 intent 是否暗示要搬到其他 App
            const intentLower = (cleanIntent ?? "").toLowerCase();
            const transferPatterns = /搬|移|複製|copy|transfer|寫入|寫進|貼到|放到|存到|匯入|import|paste|move|送到|傳到|轉到/;
            const otherAppMentioned = connectedAppNames.some(
              (name) => name !== app && intentLower.includes(name.replace(/_/g, " ")),
            );

            if (transferPatterns.test(intentLower) || otherAppMentioned) {
              // intent 明確提到跨 App 搬移 → 強提示
              if (!result.warnings) result.warnings = [];
              result.warnings.unshift(
                `💡 偵測到你要把內容搬到其他 App。用 system.transfer 可以 server-side 直接搬移（${dataStr.length} 字），不需要重新生成內容。` +
                `\n用法：octodock_do(app:"system", action:"transfer", intent:"...", params:{` +
                `from:{app:"${app}", action:"${action}", params:{${Object.keys(translatedParams).map(k => `${k}:"..."`).join(", ")}}}, ` +
                `to:{app:"目標App", action:"寫入action", params:{必要參數}}})`,
              );
            } else if (dataStr.length > 2000) {
              // 內容很長但 intent 沒提到搬移 → 輕提示，放 context 不放 warning
              const existing = result.context ? result.context + "\n\n" : "";
              result.context = existing +
                `💡 如果要把此內容（${dataStr.length} 字）寫入其他 App，可用 system.transfer 做 server-side 搬移，避免重新生成。`;
            }
          }
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

      // ── 記憶層：Session 偵測（缺口 1、2、7）──
      // context 欄位已移除，user summary 改在 octodock_help() 中回傳
      // suggestions 已證實 AI 不看，整個區塊簡化
      // 保留 session 偵測以觸發記憶維護，但不再附加到 result
      try {
        await detectSessionState(userId, connectedAppNames);
      } catch {
        // Session 偵測失敗不影響主流程
      }

      // 清除已廢棄的 suggestions 欄位
      delete result.suggestions;

      // ── 必經路徑：Session 首次使用自動載入 ──
      // AI 第一次 do 某 App 時，自動附上該 App 的記憶上下文
      // AI 不需要先呼叫 help，第一次 do 就拿到結構、偏好、模式
      if (result.ok && app !== "system") {
        const userApps = usedAppsThisSession.get(userId) ?? new Set<string>();
        if (!userApps.has(app)) {
          userApps.add(app);
          usedAppsThisSession.set(userId, userApps);
          try {
            // 查 App 的結構記憶（專案清單、資料夾、行事曆等）
            const appStructure = await queryMemory(userId, `structure:${app}`, "context", app, 3);
            // 查 App 的偏好（預設專案、預設日曆等）
            const appPrefs = await queryMemory(userId, app, "preference", app, 3);
            const contextLines: string[] = [];
            for (const m of appStructure) {
              contextLines.push(`📂 ${m.key}: ${m.value}`);
            }
            for (const m of appPrefs) {
              contextLines.push(`⚙️ ${m.key}: ${m.value}`);
            }
            if (contextLines.length > 0) {
              const existing = result.context ? result.context + "\n\n" : "";
              result.context = existing + `[First use this session] ${app} context:\n${contextLines.join("\n")}`;
            }
          } catch {
            // 記憶查詢失敗不影響主流程
          }
        }
      }

      // ── 工作流匹配結果附在 context ──
      // 不限成功或失敗都給 AI 看，讓 AI 知道以前做過哪些類似的多步驟流程
      if (matchedWorkflow) {
        const existing = result.context ? result.context + "\n\n" : "";
        result.context = existing + `⚡ Matching workflow found:\n${matchedWorkflow}`;
      }

      // ── 必經路徑：意圖偏差偵測 ──
      // 比對 intent 和實際結果，偵測 AI 可能遺漏的步驟
      if (cleanIntent && result.ok) {
        const intentLower = cleanIntent.toLowerCase();
        // 偵測 intent 提到的關鍵概念是否有對應的參數
        // 例如 intent 提到 "project" 但 params 沒帶 project 相關參數
        const intentKeywords = [
          { pattern: /project|專案/, params: ["project_id", "project_name", "project"] },
          { pattern: /label|標籤/, params: ["label", "labels", "label_id"] },
          { pattern: /calendar|行事曆|日曆/, params: ["calendar_id", "calendar_name", "calendar"] },
          { pattern: /folder|資料夾/, params: ["folder", "parent_id", "folder_id"] },
          { pattern: /database|資料庫/, params: ["database_id", "database"] },
        ];
        const actionLower = action.toLowerCase();
        for (const { pattern, params: relatedParams } of intentKeywords) {
          if (pattern.test(intentLower)) {
            // 如果 action 名稱本身就包含該關鍵字概念，不需要警告
            // 例如 create_folder 的 intent 提到「資料夾」是正常的，不算遺漏參數
            const conceptWords = pattern.source.split("|").filter(w => /^[a-z]+$/.test(w));
            const actionMatchesConcept = conceptWords.some(w => actionLower.includes(w));
            if (actionMatchesConcept) continue;

            const hasParam = relatedParams.some(p => translatedParams[p] !== undefined);
            if (!hasParam) {
              if (!result.warnings) result.warnings = [];
              result.warnings.push(
                `Your intent mentions "${pattern.source.split("|")[0]}" but no corresponding parameter was provided. Verify the result matches your intent.`,
              );
              break; // 只提醒一次
            }
          }
        }
      }

      // ── Schema 快取過期提示 ──
      // 如果偵測到 client 可能用舊版 schema（沒傳 intent），附帶提示讓 AI 告知用戶
      if (schemaMaybeStale && !result.ok) {
        if (!result.warnings) result.warnings = [];
        result.warnings.push(
          `⚠️ MCP tool cache may be outdated (expected schema:${MCP_SCHEMA_VERSION}). ` +
          `Tell the user: "MCP 工具快取可能過期，請在 AI 工具設定中斷開 OctoDock 連線，等待約 30 秒後重新連線，即可取得最新版本。"`,
        );
      }

      return exitDo(result, { toolName });
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
  connectedAppConfigs: Record<string, { disabledActions?: string[] }>,
): void {
  server.tool(
    "octodock_help",
    `Get guidance when unsure about which app to use, what action to take, or how to fill parameters. Describe your \`difficulty\` and receive: matching workflows with exact call sequences, relevant user memory, parameter examples from past operations, and recommended approaches. Use this before octodock_do when you need direction. [schema:${MCP_SCHEMA_VERSION}]`,
    {
      app: z
        .string()
        .optional()
        .describe("App name to get actions for (omit to list all apps)"),
      action: z
        .string()
        .optional()
        .describe("Action name to get detailed params and example (requires app)"),
      difficulty: z.string().describe(
        "Describe what you're stuck on (e.g. 'Not sure which calendar to use'). Required for targeted guidance.",
      ),
    },
    // U26d: Safety annotations
    {
      destructiveHint: false,
      readOnlyHint: true,
    },
    async (args) => {
      const { app, action, difficulty = "" } = args as { app?: string; action?: string; difficulty: string };
      const helpStartTime = Date.now();

      // ── 單一出口：統一記錄 + 回傳 ──
      // 所有 return 都經過 exitHelp，確保每條路徑都寫入 operations 表
      function exitHelp(text: string, opts?: { action?: string; success?: boolean }) {
        logOperation({
          userId,
          appName: app ?? "system",
          toolName: "octodock_help",
          action: opts?.action ?? action ?? "list",
          params: { app, action, difficulty },
          difficulty,
          result: { ok: opts?.success !== false, summary: text.substring(0, 200) },
          success: opts?.success !== false,
          durationMs: Date.now() - helpStartTime,
        });
        return { content: [{ type: "text" as const, text }] };
      }

      // ── P2: 不帶 app：用戶 context 載入 + App 列表 ──
      // 這是 AI 在每個對話開頭 MUST call 的入口，回傳完整用戶上下文
      if (!app) {
        const appList: string[] = [];

        /* 每個 App 的一行自然語言描述（不列 action，節省 context） */
        const APP_DESCRIPTIONS: Record<string, string> = {
          notion: "Notes, databases, and wiki pages",
          gmail: "Read, send, and manage emails",
          google_calendar: "Events, schedules, and reminders",
          google_drive: "Files, folders, and sharing",
          google_sheets: "Spreadsheets and data",
          google_docs: "Documents and collaborative editing",
          google_tasks: "To-do lists and task management",
          youtube: "Videos, channels, and comments",
          github: "Repos, issues, PRs, and code",
          line: "Messages and broadcasts",
          telegram: "Bot messages, groups, and webhooks",
          telegram_user: "Your Telegram account: chat history, search, channels",
          discord: "Messages, channels, and server management",
          slack: "Messages, channels, and workspace",
          threads: "Posts and replies on Threads",
          instagram: "Posts, comments, and insights",
          canva: "Designs, exports, and assets",
          gamma: "AI presentations and documents",
          microsoft_excel: "Spreadsheets: cells, tables, charts, formulas",
          microsoft_word: "Create and read Word documents",
          microsoft_powerpoint: "Create and read presentations",
          todoist: "Tasks and projects",
        };

        // 列出已連結的 App，用自然語言描述
        for (const appName of connectedAppNames) {
          const adapter = getAdapter(appName);
          if (adapter) {
            const desc = APP_DESCRIPTIONS[appName] || `${Object.keys(adapter.actionMap || {}).length} actions`;
            appList.push(`- **${appName}** — ${desc}`);
          }
        }

        // 加上 system 虛擬 App
        appList.push(`- **system** — Memory, PDF tools, QR code, image processing, charts, file conversion, batch operations`);

        // 列出未連結但可用的 App
        const allAdapters = getAllAdapters();
        const disconnected = allAdapters
          .filter((a) => !connectedAppNames.includes(a.name))
          .map((a) => a.name);

        // 版本資訊（build time 注入的 git SHA + 日期）
        const version = process.env.NEXT_PUBLIC_GIT_SHA ?? "dev";
        const buildDate = process.env.NEXT_PUBLIC_BUILD_TIME ?? "unknown";
        let text = `**OctoDock** v:${version} (${buildDate}) schema:${MCP_SCHEMA_VERSION}\n\n## Connected Apps\n\n${appList.join("\n")}`;
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

        // ── 列出已儲存的工作流 ──
        try {
          const workflows = await listMemory(userId, "workflow");
          if (workflows.length > 0) {
            const wfList = workflows.map((s) => `- **${s.key}**`).join("\n");
            text += `\n\n## Saved Workflows\n\n${wfList}\n\nUse \`octodock_do(app:"system", action:"workflow_get", params:{name:"..."})\` to view.`;
          }
        } catch {
          // 工作流查詢失敗不影響主流程
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

        // P5: 使用順序提示
        text += `\n\n---\n**Unsure? → octodock_help(difficulty:"...") | Ready? → octodock_do(intent:"...")**`;

        // ── 必經路徑：difficulty 驅動的精準指引 ──
        // 用 difficulty 做語意搜尋，從記憶、操作歷史、工作流中拼湊答案
        if (difficulty) {
          try {
            const guidanceParts: string[] = [];

            // 搜尋相關工作流
            const wfResults = await queryMemory(userId, difficulty, "workflow", undefined, 2);
            if (wfResults.length > 0) {
              guidanceParts.push("**Matching workflows:**\n" + wfResults.map(s => `- ${s.key}: ${s.value}`).join("\n"));
            }

            // 搜尋相關記憶（偏好 + 上下文）
            const memResults = await queryMemory(userId, difficulty, undefined, undefined, 3);
            const relevantMem = memResults.filter(m => m.category !== "workflow"); // 工作流已單獨處理
            if (relevantMem.length > 0) {
              guidanceParts.push("**Relevant memory:**\n" + relevantMem.map(m => `- [${m.category}] ${m.key}: ${m.value}`).join("\n"));
            }

            // 搜尋操作歷史中相關的成功案例
            try {
              const { operations: opsTable } = await import("@/db/schema");
              const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
              const recentOps = await db
                .select({
                  appName: opsTable.appName,
                  action: opsTable.action,
                  params: opsTable.params,
                })
                .from(opsTable)
                .where(and(
                  eq(opsTable.userId, userId),
                  eq(opsTable.success, true),
                  gte(opsTable.createdAt, thirtyDaysAgo),
                ))
                .orderBy(desc(opsTable.createdAt))
                .limit(5);
              if (recentOps.length > 0) {
                const opsText = recentOps.map(o => `- ${o.appName}.${o.action}`).join("\n");
                guidanceParts.push("**Recent successful operations:**\n" + opsText);
              }
            } catch {
              // 操作歷史查詢失敗不影響
            }

            if (guidanceParts.length > 0) {
              text += `\n\n## Guidance for: "${difficulty}"\n\n${guidanceParts.join("\n\n")}`;
            } else {
              text += `\n\n## No matching guidance found for: "${difficulty}"\nTry calling octodock_help with a specific app name for available actions.`;
            }
          } catch {
            // difficulty 查詢失敗不影響主流程
          }
        }

        return exitHelp(text);
      }

      // ── 帶 app + action：回傳特定 action 的詳細參數和範例（B2 help 分層）──
      if (app && action) {
        const adapterForAction = getAdapter(app);
        if (!adapterForAction) {
          return exitHelp(`App "${app}" not found.`, { success: false });
        }

        // 權限檢查：如果 action 被停用，提示用戶
        if (connectedAppConfigs[app]?.disabledActions?.includes(action)) {
          return exitHelp(`⛔ Action "${action}" for ${app} is disabled by the user in Dashboard settings. It cannot be executed.`);
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

            return exitHelp(skillText);
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
          return exitHelp(`Action "${action}" not found in ${app}. Available: ${available}`, { success: false });
        }

        const params = Object.entries(toolDef.inputSchema)
          .map(([name, schema]) => {
            const desc = (schema as { description?: string }).description || "";
            const isOptional = (schema as { isOptional?: () => boolean }).isOptional?.() ? " (optional)" : "";
            return `  ${name}${isOptional}: ${desc}`;
          })
          .join("\n");

        const detail = `## ${app}.${action}\n\n${toolDef.description}\n\n### Parameters\n${params || "  (none)"}`;

        return exitHelp(detail);
      }

      // ── 帶 app：回傳該 App 的 Skill ──

      // system 虛擬 App
      if (app === "system") {
        return exitHelp(getSystemSkill());
      }

      // 一般 App
      const adapter = getAdapter(app);
      if (!adapter) {
        return exitHelp(`App "${app}" not found. Available apps: ${connectedAppNames.join(", ")}, system`, { success: false });
      }

      // 優先用 getSkill()（精簡版）
      // U5: 頻率排序 — 從 operations 表統計使用次數，常用的排前面
      // I9: 對破壞性 action 加 ⚠️ destructive 標記
      // Context 壓縮：超過 1500 字元只回傳 action 名稱清單 + 提示用 help(app, action) 查詳情
      if (adapter.getSkill) {
        let skillText = adapter.getSkill() ?? "";
        if (!skillText) return exitHelp(`No help available for ${app}.`, { success: false });

        /* Context 壓縮：action 太多時只回傳精簡清單，避免爆 context */
        const MAX_SKILL_LENGTH = 1500;
        if (skillText.length > MAX_SKILL_LENGTH) {
          const actionNames = Object.keys(adapter.actionMap || {});
          const compactList = actionNames.map(a => `\`${a}\``).join(", ");
          skillText = `**${app}** — ${actionNames.length} actions available:\n${compactList}\n\nUse \`octodock_help(app:"${app}", action:"ACTION_NAME")\` to see details and examples for a specific action.`;
        }

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

        // 權限標記：列出被用戶停用的 action
        const disabled = connectedAppConfigs[app]?.disabledActions ?? [];
        if (disabled.length > 0) {
          skillText += `\n\n⛔ **Disabled by user**: ${disabled.map(a => `~~${a}~~`).join(", ")}`;
        }

        return exitHelp(skillText);
      }

      // Fallback：從 actionMap 或 tools 列表產生 skill
      const actions = adapter.actionMap
        ? Object.keys(adapter.actionMap).join(", ")
        : adapter.tools.map((t) => `${t.name}: ${t.description}`).join("\n");

      return exitHelp(`${app} actions: ${actions}`);
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
    // 同時搜 preference 和 pattern 兩個類別
    // pattern-analyzer 把 default_parent:notion 存在 "pattern" 類別
    // 用戶手動存的偏好在 "preference" 類別
    const [prefs, patterns] = await Promise.all([
      queryMemory(userId, `${app} ${action} default`, "preference", app, 5),
      queryMemory(userId, `default ${app}`, "pattern", app, 5),
    ]);
    const allMatches = [...prefs, ...patterns];

    for (const pref of allMatches) {
      // 偏好 key 格式：「default:calendar_id」「default_parent:notion」「default_calendar_id」
      // 從 key 中提取參數名稱
      const match = pref.key.match(/^default[_:](.+?)(?::.*)?$/);
      if (match) {
        let paramKey = match[1];
        // default_parent:notion → paramKey = "parent"，要映射到 "parent_id"
        if (paramKey === "parent" && app === "notion") paramKey = "parent_id";
        if (paramKey === "calendar" && app === "google_calendar") paramKey = "calendar_id";
        if (paramKey === "database" && app === "notion") paramKey = "database_id";

        // 只在用戶沒有明確傳入該參數（也沒有 alias 版本）時才補入
        const aliases = AUTOFILL_ALIASES[paramKey] ?? [paramKey];
        const alreadyProvided = aliases.some((a) => a in params);
        if (!alreadyProvided) {
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

/** 自動補參數時，檢查這些 alias 是否已由用戶傳入 */
const AUTOFILL_ALIASES: Record<string, string[]> = {
  parent_id: ["parent_id", "folder", "parent"],
  database_id: ["database_id", "database"],
  calendar_id: ["calendar_id", "calendar"],
};

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
// 全域名稱→ID 驗證（必經路徑機制 Phase 1）
// 掃描 params 中的名稱參數，透過 memory + adapter API 驗證
// 只有精確匹配才放行，模糊匹配和找不到都攔住
// ============================================================

/** validateAndResolveNames 的結果 */
interface NameValidationOutcome {
  /** 是否被攔截（不應執行） */
  blocked: boolean;
  /** 攔截時的 DoResult（回傳給 AI） */
  blockResult?: DoResult;
  /** 未攔截時的修正後參數 */
  resolvedParams: Record<string, unknown>;
  /** 驗證過程中產生的警告 */
  warnings: string[];
}

/**
 * 全域名稱→ID 驗證
 * 掃描 params，找出 adapter.nameParamMap 中宣告的名稱參數
 * 對每個名稱：先查 memory → memory 沒有則呼叫 adapter.validateNameParam → 結果分三級
 *
 * @param userId 用戶 ID
 * @param appName App 名稱
 * @param params 已經過 translateSimplifiedParams 和 applyPreferences 的參數
 * @param adapter 對應的 AppAdapter
 * @param token 有效的 access token（可能為 null）
 */
async function validateAndResolveNames(
  userId: string,
  appName: string,
  params: Record<string, unknown>,
  adapter: { nameParamMap?: Record<string, string>; validateNameParam?: (k: string, v: string, t: string) => Promise<import("@/adapters/types").NameValidationResult | null> },
  token: string | null,
): Promise<NameValidationOutcome> {
  const nameMap = adapter.nameParamMap;
  // 如果 adapter 沒有宣告 nameParamMap，直接放行
  if (!nameMap) return { blocked: false, resolvedParams: params, warnings: [] };

  const resolved = { ...params };
  const warnings: string[] = [];

  for (const [paramKey, entityType] of Object.entries(nameMap)) {
    const value = resolved[paramKey];
    // 跳過不存在、非字串、已經是 ID 格式的參數
    if (value === undefined || typeof value !== "string") continue;
    // 跳過明顯是 ID 的值（UUID 或純數字）
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) continue;
    if (/^\d+$/.test(value)) continue;

    // ── 第一步：查 memory ──
    const memoryResult = await resolveIdentifier(userId, value, appName);
    if (memoryResult) {
      // memory 命中 — 視為 certain（精確匹配）
      resolved[paramKey] = memoryResult.id;
      // 自動學習（增加信心分數）
      learnIdentifier(userId, appName, value, memoryResult.id, entityType).catch(() => {});
      continue;
    }

    // ── 第二步：memory 沒有 → 呼叫 adapter.validateNameParam 走 API ──
    if (!adapter.validateNameParam || !token) {
      // adapter 沒實作 validateNameParam 或沒有 token → 無法驗證，放行（保持現有行為）
      continue;
    }

    try {
      const validation = await adapter.validateNameParam(paramKey, value, token);
      if (!validation) continue; // adapter 說「這個參數我不處理」

      switch (validation.confidence) {
        case "certain":
          // 精確匹配 → 靜默替換
          resolved[paramKey] = validation.resolvedId!;
          // 自動學習
          learnIdentifier(userId, appName, value, validation.resolvedId!, entityType).catch(() => {});
          break;

        case "partial":
          // 模糊匹配 → 攔截，不執行
          return {
            blocked: true,
            blockResult: {
              ok: false,
              error: `「${value}」不是精確匹配。找到相似的「${validation.resolvedName}」，但名稱不完全一致。請確認要使用哪一個。`,
              candidates: validation.candidates?.map(c => ({ title: c.name, id: c.id })),
            },
            resolvedParams: resolved,
            warnings,
          };

        case "not_found":
          // 找不到 → 攔截，不執行
          return {
            blocked: true,
            blockResult: {
              ok: false,
              error: `${appName} 找不到「${value}」(${entityType})。`,
              candidates: validation.candidates?.map(c => ({ title: c.name, id: c.id })),
            },
            resolvedParams: resolved,
            warnings,
          };
      }
    } catch {
      // validateNameParam 出錯 → 不攔截，保持現有行為
      continue;
    }
  }

  return { blocked: false, resolvedParams: resolved, warnings };
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
  _params: Record<string, unknown>,
  result: DoResult,
): Promise<void> {
  if (!result.data || typeof result.data !== "object") return;

  // ── 架構層統一學習：透過 adapter 的 extractEntities 提取可學習的實體 ──
  // 每個 adapter 自行定義「從哪些 action 的回傳中提取什麼實體」
  // 架構層只負責呼叫 learnIdentifier，不需要知道各 App 的資料結構
  const adapter = (await import("@/mcp/registry")).getAdapter(appName);
  if (adapter?.extractEntities) {
    const entities = adapter.extractEntities(action, result.data);
    for (const entity of entities) {
      if (entity.name && entity.id) {
        learnIdentifier(userId, appName, entity.name, entity.id, entity.type).catch(() => {});
      }
    }
  }

  // ── 通用 fallback：從 DoResult.title + data.id 學習（所有 App 適用）──
  const data = result.data as Record<string, unknown>;
  const id = data.id as string | undefined;
  if (id && result.title) {
    learnIdentifier(userId, appName, result.title, id, "resource").catch(() => {});
  }

  // ── 必經路徑：結構快照 ──
  // list_* 類操作成功後，存一份完整的 App 結構清單到 memory
  // Phase 1 名稱驗證可以先查快照，不用每次打 API
  if (action.startsWith("list_") && adapter?.extractEntities) {
    const entities = adapter.extractEntities(action, result.data);
    if (entities.length > 0) {
      // 從 action 推斷實體類型（list_projects → project、list_labels → label）
      const entityType = entities[0].type || action.replace("list_", "").replace(/s$/, "");
      const snapshot = entities.map(e => ({ name: e.name, id: e.id }));
      // 非同步存到 memory，不阻塞回應
      const { storeMemory } = await import("@/services/memory-engine");
      storeMemory(
        userId,
        "context",
        appName,
        `structure:${appName}:${entityType}`,
        JSON.stringify(snapshot),
      ).catch(() => {});
    }
  }
}

// extractTitleFromItem 已移至各 adapter 的 extractEntities 實作

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

// 工作流功能由 do(app:"system", action:"workflow_list/workflow_get") + intent 自動匹配覆蓋
