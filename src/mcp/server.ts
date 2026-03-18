import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { db } from "@/db";
import { connectedApps, storedResults } from "@/db/schema";
import { eq, lt, or, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getAdapter, getAllAdapters } from "./registry";
import { executeWithMiddleware, type MiddlewareOptions } from "./middleware/logger";
import { checkMcpRateLimit } from "@/lib/rate-limit";
import { getPreContext } from "./middleware/pre-context";
import { runPostCheck } from "./middleware/post-check";
import { suggestNextAction, getRecoveryHint, findCrossAppContext, getLikelyNextActions } from "./middleware/action-chain";
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
  const server = new McpServer({ name: "octodock", version: "1.0.0" });

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

  return server;
}

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
 * 從完整文字中擷取摘要：保留前 N 行 + 後 N 行，中間標示省略行數
 */
function buildSummary(text: string, headLines: number, tailLines: number): string {
  const lines = text.split("\n");
  if (lines.length <= headLines + tailLines) return text;

  const head = lines.slice(0, headLines).join("\n");
  const tail = lines.slice(-tailLines).join("\n");
  const omitted = lines.length - headLines - tailLines;

  return head + `\n\n... (${omitted} lines omitted) ...\n\n` + tail;
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
    "Execute an action on a connected app. Use octodock_help first to see available apps and actions.",
    {
      app: z.string().describe("App name (e.g. 'notion', 'gmail', 'system')"),
      action: z.string().describe("Action to perform (e.g. 'create_page', 'search')"),
      params: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Action parameters"),
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

      // 透過 actionMap 找到內部工具名稱
      const toolName = adapter.actionMap?.[action];
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

      // C6: Dry-run 模式 — 破壞性操作預覽，不實際執行
      const isDryRun = translatedParams.dryRun === true;
      const isDryRunEligible = /delete|trash|replace|update/.test(toolName);
      if (isDryRun && isDryRunEligible) {
        // 移除 dryRun 參數避免傳給上游 API
        const { dryRun: _, ...cleanParams } = translatedParams;
        try {
          const { getValidToken } = await import("@/services/token-manager");
          const dryToken = await getValidToken(userId, app);
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

      // C1+C4: 操作前自動查目標現狀（不阻塞主操作，失敗就跳過）
      let preContext: Awaited<ReturnType<typeof getPreContext>> = null;
      try {
        // 需要 token 來查上游 API，先用 getValidToken 取
        const { getValidToken } = await import("@/services/token-manager");
        const preToken = await getValidToken(userId, app).catch(() => null);
        preContext = await getPreContext(
          userId, app, toolName, translatedParams,
          preToken ? (tn, p, t) => adapter.execute(tn, p, t) : null,
          preToken,
        );
      } catch (err) {
        console.error("Pre-context failed:", err);
      }

      // 透過 middleware 執行（取 token → 呼叫 API → 記錄日誌）
      const toolResult = await executeWithMiddleware(
        userId,
        app,
        toolName,
        translatedParams,
        (p, token) => adapter.execute(toolName, p, token),
        { agentInstanceId },
      );

      // 轉換成標準化的 DoResult
      result = toolResultToDoResult(toolResult, app);

      // C1: 把 pre-context 附在 DoResult 上（只在有資料時）
      if (preContext && result.ok) {
        const contextParts: string[] = [];
        if (preContext.existingSiblings) {
          contextParts.push(`Existing siblings: ${preContext.existingSiblings.map((s) => s.title).join(", ")}`);
        }
        if (preContext.namingConvention) {
          const nc = preContext.namingConvention;
          contextParts.push(`Naming convention: ${nc.datePrefix ? "date prefix" : "no date prefix"}${nc.commonTypes.length > 0 ? `, types: ${nc.commonTypes.join(", ")}` : ""}. Examples: ${nc.examples.join(", ")}`);
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
        if (preContext.patterns && preContext.patterns.length > 0) {
          contextParts.push(`Detected patterns: ${preContext.patterns.map((p) => `${p.name}(×${p.count})`).join(", ")}`);
        }
        if (contextParts.length > 0) {
          // 合併既有的 context（session 用戶摘要），不覆蓋
          const existing = result.context ? result.context + "\n\n" : "";
          result.context = existing + "Pre-context:\n" + contextParts.join("\n");
        }
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

      // ── 智慧錯誤引導（B3 + 記憶層缺口 5）──
      // 如果操作失敗且 adapter 有 formatError，嘗試提供更有用的提示
      // 額外查記憶層，找最近成功的同類操作，提供參數範例
      if (!result.ok && result.error && adapter.formatError) {
        const betterError = adapter.formatError(action, result.error);
        if (betterError) {
          result.error = betterError;
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

      // 如果操作成功，嘗試從結果中學習 ID 對應（越用越懂你）
      if (result.ok) {
        learnFromResult(userId, app, action, params, result).catch(() => {});

        // C2+C3: 操作後基線比對 + 修正 pattern 偵測
        try {
          const postCheck = await runPostCheck(userId, app, toolName, translatedParams);
          if (postCheck?.warnings && postCheck.warnings.length > 0) {
            result.warnings = postCheck.warnings;
          }
        } catch (err) {
          console.error("Post-check failed:", err);
        }

        // ── Phase 8：SOP 自動辨識 ──
        // 非同步偵測重複操作模式，有候選 SOP 時附在 suggestions 裡
        try {
          const sopCandidate = await detectSopCandidate(userId);
          if (sopCandidate) {
            result.suggestions = [sopCandidate.message];
          }
        } catch {
          // 偵測失敗不影響主流程
        }

        // E1: 操作鏈自動補全（非同步，但需結果放進 response）
        try {
          const nextSuggestion = await suggestNextAction(userId, app, toolName);
          if (nextSuggestion) {
            result.nextSuggestion = nextSuggestion;
          }
        } catch {
          // 建議失敗不影響主流程
        }

        // E4: 跨 App 上下文連結
        try {
          const keyword = result.title ?? (translatedParams.title as string) ?? (translatedParams.subject as string);
          if (keyword) {
            const crossApp = await findCrossAppContext(userId, app, keyword);
            if (crossApp.length > 0) {
              const existing = result.context ? result.context + "\n\n" : "";
              const crossAppText = crossApp.map((c) => `- [${c.app}] ${c.action}: ${c.title} (${c.date})`).join("\n");
              result.context = existing + "Related across apps:\n" + crossAppText;
            }
          }
        } catch {
          // 跨 App 查詢失敗不影響主流程
        }

        // ── 回傳壓縮（Level 3）──
        // 超過上限的回傳存 DB，只回傳摘要 + ref ID
        if (result.data && typeof result.data === "string") {
          result.data = await compressIfNeeded(userId, app, action, result.data);
        }
      }

      // ── 記憶層：Session 偵測 + 記憶不足提醒（缺口 1、2、7）──
      try {
        const sessionState = await detectSessionState(userId, connectedAppNames);
        if (sessionState) {
          // 缺口 2：新 session 的第一次 do() 附帶用戶上下文
          const summary = await getUserSummary(userId);
          if (summary) {
            result.context = summary;
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
    "Get help about available apps and actions. Without app: list all connected apps. With app: show actions. With app+action: show detailed params and example.",
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
    async (args) => {
      const { app, action } = args as { app?: string; action?: string };

      // ── 不帶 app：列出所有已連結的 App ──
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

        // 加上 system 虛擬 App
        appList.push(`- **system** (memory, bot conversations)`);

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

        // ── Phase 4: 列出可用 SOP ──
        try {
          const sops = await listMemory(userId, "sop");
          if (sops.length > 0) {
            const sopList = sops.map((s) => `- **${s.key}**`).join("\n");
            text += `\n\n## SOPs\n\n${sopList}\n\nUse \`octodock_do(app: "system", action: "sop_get", params: {name: "..."})\` to view a SOP.`;
          }
        } catch {
          // SOP 查詢失敗不影響主流程
        }

        text += `\n\nUse \`octodock_help(app: "app_name")\` to see actions for a specific app.`;

        // E3: Action 推薦引擎 — 用戶最常用的操作
        try {
          const likely = await getLikelyNextActions(userId);
          if (likely.length > 0) {
            const likelyText = likely.map((l) =>
              `- **${l.app}.${l.action}** — ${l.reason}${l.suggestedParams ? ` (suggested params: ${JSON.stringify(l.suggestedParams)})` : ""}`
            ).join("\n");
            text += `\n\n## Likely Next Actions\n\n${likelyText}`;
          }
        } catch {
          // 推薦失敗不影響主流程
        }

        // ── 用戶記憶：自動帶入或 onboarding ──
        try {
          const allMemories = await listMemory(userId);
          if (allMemories.length > 0) {
            // 有記憶 → 自動帶入用戶摘要，AI 立刻知道用戶是誰
            const prefs = allMemories.filter((m) => m.category === "preference").slice(0, 5);
            const patterns = allMemories.filter((m) => m.category === "pattern").slice(0, 3);
            const sections: string[] = [];
            if (prefs.length > 0) {
              sections.push("### Preferences\n" + prefs.map((m) => `- ${m.key}: ${m.value}`).join("\n"));
            }
            if (patterns.length > 0) {
              sections.push("### Patterns\n" + patterns.map((m) => `- ${m.key}: ${m.value}`).join("\n"));
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
          const skillText = adapterForAction.getSkill(action);
          if (skillText) {
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
      if (adapter.getSkill) {
        return {
          content: [{ type: "text" as const, text: adapter.getSkill() }],
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
function extractDefaultSummary(rawData: unknown): Record<string, unknown> | null {
  if (typeof rawData !== "object" || rawData === null) return null;
  const obj = rawData as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  let hasData = false;

  if (typeof obj.id === "string") { summary.id = obj.id; hasData = true; }
  if (typeof obj.url === "string") { summary.url = obj.url; hasData = true; }

  // 嘗試取 title
  const title = extractTitle(obj);
  if (title) { summary.title = title; hasData = true; }

  // 嘗試取 name（非 Notion 類 App 常用）
  if (typeof obj.name === "string") { summary.name = obj.name; hasData = true; }

  return hasData ? summary : null;
}
