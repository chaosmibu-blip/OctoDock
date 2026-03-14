import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { db } from "@/db";
import { connectedApps } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getAdapter, getAllAdapters } from "./registry";
import { executeWithMiddleware } from "./middleware/logger";
import { learnIdentifier, resolveIdentifier } from "@/services/memory-engine";
import {
  systemActionMap,
  getSystemSkill,
  executeSystemAction,
} from "./system-actions";
import type { DoResult } from "@/adapters/types";

// ============================================================
// MCP Server 核心
// AgentDock 的 MCP server 只暴露 2 個工具：
//   agentdock_do   — 所有操作（不分讀寫、不分 App）
//   agentdock_help — 取得操作說明（Skill）
//
// 這樣 AI 的 context window 只佔 ~300 tokens（vs 原本 50-80K）
// 不管連了幾個 App，AI 端永遠只看到 2 個工具
// ============================================================

type User = { id: string; email: string; name: string | null };

/**
 * 為特定用戶建立 MCP server 實例
 * 每個 MCP 請求都會建立一個新的 server（stateless 架構）
 * server 只註冊 agentdock_do 和 agentdock_help 兩個工具
 */
export async function createServerForUser(user: User): Promise<McpServer> {
  const server = new McpServer({ name: "agentdock", version: "1.0.0" });

  // 查詢用戶已連結且有效的 App 列表
  const apps = await db
    .select()
    .from(connectedApps)
    .where(eq(connectedApps.userId, user.id));

  const connectedAppNames = apps
    .filter((a) => a.status === "active")
    .map((a) => a.appName);

  // ── 註冊 agentdock_do ──
  registerDoTool(server, user.id, connectedAppNames);

  // ── 註冊 agentdock_help ──
  registerHelpTool(server, user.id, connectedAppNames);

  return server;
}

// ============================================================
// agentdock_do — 所有操作的統一入口
// AI 不需要知道每個 App 有哪些工具，只要說：
//   do(app: "notion", action: "create_page", params: { title: "..." })
// AgentDock 內部會：
//   1. 找到對應的 Adapter
//   2. 透過 actionMap 對應到內部工具名稱
//   3. 呼叫 executeWithMiddleware 執行
//   4. 回傳標準化的 DoResult
// ============================================================

function registerDoTool(
  server: McpServer,
  userId: string,
  connectedAppNames: string[],
): void {
  server.tool(
    "agentdock_do",
    "Execute an action on a connected app. Use agentdock_help first to see available apps and actions.",
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

      // ── 參數格式轉換：簡化參數 → API 原始格式 ──
      // 掃描 params 中的簡化欄位（folder、page、database 等），
      // 查記憶解析成實際 ID，讓 AI 不用知道 Notion 的 parent_id 格式
      const translatedParams = await translateSimplifiedParams(
        userId,
        app,
        action,
        params,
      );

      // 透過 middleware 執行（取 token → 呼叫 API → 記錄日誌）
      const toolResult = await executeWithMiddleware(
        userId,
        app,
        toolName,
        translatedParams,
        (p, token) => adapter.execute(toolName, p, token),
      );

      // 轉換成標準化的 DoResult
      result = toolResultToDoResult(toolResult, app);

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

      // 如果操作成功，嘗試從結果中學習 ID 對應（越用越懂你）
      if (result.ok) {
        learnFromResult(userId, app, action, params, result).catch(() => {
          // 學習失敗不影響主流程
        });
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
      };
    },
  );
}

// ============================================================
// agentdock_help — 操作說明（Skill）入口
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
    "agentdock_help",
    "Get help about available apps and actions. Without app parameter: list all connected apps. With app parameter: show available actions for that app.",
    {
      app: z
        .string()
        .optional()
        .describe("App name to get detailed actions for (omit to list all apps)"),
    },
    async (args) => {
      const { app } = args as { app?: string };

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

        let text = `## Connected Apps\n\n${appList.join("\n")}`;
        if (disconnected.length > 0) {
          text += `\n\n## Available (not connected)\n\n${disconnected.join(", ")}`;
        }
        text += `\n\nUse \`agentdock_help(app: "app_name")\` to see actions for a specific app.`;

        return {
          content: [{ type: "text" as const, text }],
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

      // 優先用 getSkill()（精簡版），沒有的話就列出 actionMap
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
// AI 傳簡化參數（名字、代稱），AgentDock 自動解析成 API 原始格式
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
      // 解析成功：用 ID 替換名稱，並轉換欄位名
      translated[config.apiField] = resolved.id;
      if (alias !== config.apiField) {
        delete translated[alias];
      }
    } else {
      // 解析失敗：只做欄位名轉換，保留原始名稱值
      // API 會回傳錯誤，agentdock_do 的 suggestions 會引導 AI
      if (alias !== config.apiField) {
        translated[config.apiField] = value;
        delete translated[alias];
      }
    }
  }

  // 特殊處理：如果有 folder 且沒有 parent_type，自動補上
  if (translated.parent_id && !translated.parent_type) {
    translated.parent_type = "page_id";
  }

  return translated;
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
  toolResult: { content: Array<{ type: string; text: string }>; isError?: boolean },
  appName: string,
): DoResult {
  // 錯誤情況
  if (toolResult.isError) {
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
// 下次 AI 用名稱操作時，AgentDock 就能自動解析
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
