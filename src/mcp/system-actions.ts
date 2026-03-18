import { db } from "@/db";
import { conversations, storedResults, operations } from "@/db/schema";
import { eq, and, desc, lt, gt, or, isNull, sql } from "drizzle-orm";
import {
  queryMemory,
  storeMemory,
  listMemory,
  deleteMemory,
  deleteMemoryByApp,
  deleteAllMemory,
  exportMemory,
} from "@/services/memory-engine";
import {
  createSchedule,
  listSchedules,
  toggleSchedule,
  deleteSchedule,
} from "@/services/scheduler";
import type { DoResult } from "@/adapters/types";

// ============================================================
// 系統操作處理器（System Actions）
// 處理 octodock_do(app: "system", ...) 的請求
// 包含記憶查詢/儲存、Bot 對話記錄等不屬於特定 App 的操作
// 作為虛擬的「system」App，讓 AI 用統一的 do 介面操作
// ============================================================

/** system App 的 action → 內部處理函式對應表 */
export const systemActionMap: Record<string, string> = {
  memory_query: "system_memory_query",
  memory_store: "system_memory_store",
  bot_conversations: "system_bot_conversations",
  // SOP 系統（Phase 4）
  sop_list: "system_sop_list",
  sop_get: "system_sop_get",
  sop_create: "system_sop_create",
  sop_update: "system_sop_update",
  sop_delete: "system_sop_delete",
  // 輕量筆記（B4）
  note: "system_note",
  // 記憶導入（onboarding：AI 把對用戶的認知傳給 OctoDock）
  import_memory: "system_import_memory",
  // 工具搜尋
  find_tool: "system_find_tool",
  // 記憶批量操作
  memory_delete_app: "system_memory_delete_app",
  memory_delete_all: "system_memory_delete_all",
  memory_delete_key: "system_memory_delete_key", // I7: 單筆記憶刪除
  memory_export: "system_memory_export",
  // 回傳壓縮：取得暫存的完整回傳
  get_stored: "system_get_stored",
  // 通用 HTTP 請求（混合模式）
  http_request: "system_http_request",
  // 排程引擎（Phase 5）
  schedule_list: "system_schedule_list",
  schedule_create: "system_schedule_create",
  schedule_toggle: "system_schedule_toggle",
  schedule_delete: "system_schedule_delete",
  // G 組：System API — AI 操作輔助層
  batch_do: "system_batch_do",         // G1: 批次執行
  resolve_name: "system_resolve_name", // G5: 名稱解析為 ID
  param_suggest: "system_param_suggest", // G6: 參數建議
  multi_search: "system_multi_search", // G7: 跨 App 搜尋
  // K 組：跨 App 資源群組 + undo
  resource_group_create: "system_resource_group_create", // K1: 建立資源群組
  resource_group_get: "system_resource_group_get",       // K1: 取得資源群組
  undo_last: "system_undo_last",                         // K2: 復原最近一次高風險操作
};

/**
 * 回傳 system 的 Skill 文字
 * AI 呼叫 octodock_help(app: "system") 時回傳
 */
export function getSystemSkill(): string {
  return `system actions:
  memory_query(query, category?) — search user memory (preference/pattern/context/sop)
  memory_store(key, value, category, app_name?) — store a memory entry
  memory_delete_app(app_name) — delete all memories for a specific app
  memory_delete_all(confirm:true) — delete ALL user memories (requires confirm:true)
  memory_export() — export all memories as structured data
  bot_conversations(platform, platform_user_id?, limit?) — view bot chat history (line/telegram)
  sop_list() — list all saved SOPs
  sop_get(name) — get a specific SOP by name
  sop_create(name, content) — create a new SOP (content in markdown)
  sop_update(name, content) — update an existing SOP
  sop_delete(name) — delete a SOP
  note(text) — quick note for cross-agent memory
  import_memory(memories) — batch import memories from AI (for onboarding)
  schedule_list() — list all scheduled tasks
  schedule_create(name, cron, action_type, action_config, timezone?) — create schedule
    action_type: "simple" (direct do call) | "sop" (run a SOP) | "ai" (natural language task)
    action_config: {app, action, params} for simple | {sop_name} for sop | {prompt} for ai
    cron: standard 5-field cron expression (min hour day month weekday)
  schedule_toggle(schedule_id, is_active) — enable/disable schedule
  schedule_delete(schedule_id) — delete schedule
  get_stored(ref, lines?) — retrieve full content of a truncated response (e.g. ref:"abc123", lines:"50-100")
  find_tool(task) — find the right app and action for a task (e.g. "send an email", "create a note")
  http_request(url, method?, headers?, body?) — make a generic HTTP request to any API (requires user's connected app token)
  batch_do(actions, mode?, on_error?) — execute multiple actions at once. actions:[{app,action,params}], mode:"sequential"|"parallel"(default), on_error:"continue"(default)|"abort"
  resolve_name(name, app?, type?) — resolve a human-readable name to an ID (e.g. "MIBU-Notes" → page ID). Searches memory first, then app APIs.
  param_suggest(app, action) — get suggested default params for an action based on user's history and patterns
  multi_search(query, apps?) — search across multiple apps at once. Returns unified format results. apps: array of app names (default: all connected)
SOPs and schedules persist across agents and sessions.`;
}

/**
 * 執行系統操作
 * 根據 action 名稱分派到對應的處理邏輯
 *
 * @param userId 用戶 ID
 * @param action 操作名稱（memory_query / memory_store / bot_conversations）
 * @param params 操作參數
 * @returns 標準化的 DoResult
 */
export async function executeSystemAction(
  userId: string,
  action: string,
  params: Record<string, unknown>,
): Promise<DoResult> {
  switch (action) {
    // ── 記憶查詢：搜尋用戶的跨 agent 記憶 ──
    case "memory_query": {
      const results = await queryMemory(
        userId,
        params.query as string,
        params.category as string | undefined,
      );

      if (results.length === 0) {
        return { ok: true, data: "No matching memories found." };
      }

      // 將結果渲染成 Markdown 格式，讓 AI 更容易理解
      const md = renderMemoryAsMarkdown(results);
      return { ok: true, data: md };
    }

    // ── 記憶儲存：存入新的記憶條目 ──
    case "memory_store": {
      await storeMemory(
        userId,
        params.key as string,
        params.value as string,
        params.category as string,
        params.app_name as string | undefined,
      );
      return { ok: true, data: "Memory stored successfully." };
    }

    // ── Bot 對話記錄：查看 LINE/Telegram 的自動回覆對話 ──
    case "bot_conversations": {
      const conditions = [
        eq(conversations.userId, userId),
        eq(conversations.platform, params.platform as string),
      ];

      // 可選：篩選特定外部用戶
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

      // 倒序排列（最舊的在前面，像聊天記錄）
      results.reverse();

      if (results.length === 0) {
        return { ok: true, data: "No conversation history found." };
      }

      return { ok: true, data: results };
    }

    // ============================================================
    // SOP 系統（Phase 4）
    // SOP = Markdown 流程文件，存在 memory 表 category='sop'
    // 取代 n8n/Zapier 的拖拉流程圖，用中文寫流程文件
    // AI 透過 help 或 do 取得 SOP 內容，然後一步一步執行
    // ============================================================

    // ── SOP 列表：列出所有已儲存的 SOP ──
    case "sop_list": {
      const sops = await listMemory(userId, "sop");
      if (sops.length === 0) {
        return { ok: true, data: "No SOPs found. Create one with sop_create(name, content)." };
      }
      const list = sops.map((s) => {
        const preview = s.value.substring(0, 80).replace(/\n/g, " ");
        return `- **${s.key}**: ${preview}${s.value.length > 80 ? "..." : ""}`;
      }).join("\n");
      return { ok: true, data: `## Your SOPs\n\n${list}` };
    }

    // ── SOP 取得：取得特定 SOP 的完整內容 ──
    case "sop_get": {
      const name = params.name as string;
      const results = await queryMemory(userId, name, "sop");
      const sop = results.find((r) => r.key === name);
      if (!sop) {
        return {
          ok: false,
          error: `SOP "${name}" not found`,
          suggestions: (await listMemory(userId, "sop")).map((s) => s.key),
        };
      }
      return { ok: true, data: `# SOP: ${sop.key}\n\n${sop.value}`, title: sop.key };
    }

    // ── SOP 建立：建立新的 SOP（Markdown 格式） ──
    case "sop_create": {
      const name = params.name as string;
      const content = params.content as string;
      // 檢查是否已存在
      const existing = await queryMemory(userId, name, "sop");
      if (existing.find((r) => r.key === name)) {
        return {
          ok: false,
          error: `SOP "${name}" already exists. Use sop_update to modify it.`,
        };
      }
      await storeMemory(userId, name, content, "sop");
      return { ok: true, data: `SOP "${name}" created.`, title: name };
    }

    // ── SOP 更新：更新現有 SOP 的內容 ──
    case "sop_update": {
      const name = params.name as string;
      const content = params.content as string;
      await storeMemory(userId, name, content, "sop");
      return { ok: true, data: `SOP "${name}" updated.`, title: name };
    }

    // ── SOP 刪除 ──
    case "sop_delete": {
      const name = params.name as string;
      await deleteMemory(userId, name, "sop");
      return { ok: true, data: `SOP "${name}" deleted.` };
    }

    // ── 記憶導入（onboarding）：AI 把對用戶的認知批次傳給 OctoDock ──
    case "import_memory": {
      const memories = params.memories as Array<{
        key: string;
        value: string;
        category: string;
        app_name?: string;
      }>;

      if (!memories || !Array.isArray(memories) || memories.length === 0) {
        return { ok: false, error: "memories array is required. Each item needs: key, value, category (preference/pattern/context)" };
      }

      // 批次存入，每筆用 storeMemory 的 upsert 機制
      let imported = 0;
      for (const m of memories) {
        if (!m.key || !m.value || !m.category) continue;
        await storeMemory(userId, m.key, m.value, m.category, m.app_name);
        imported++;
      }

      // 記錄最後一次記憶導入時間（供定期更新判斷用）
      await storeMemory(userId, "_last_memory_import", new Date().toISOString(), "context");

      return {
        ok: true,
        data: `Successfully imported ${imported} memories. OctoDock will now remember these across all AI platforms.`,
      };
    }

    // ── 刪除某 App 的所有記憶 ──
    case "memory_delete_app": {
      const appName = params.app_name as string;
      if (!appName) {
        return { ok: false, error: "app_name parameter is required." };
      }
      const count = await deleteMemoryByApp(userId, appName);
      return { ok: true, data: `Deleted ${count} memories for app "${appName}".` };
    }

    // ── 刪除用戶的所有記憶（需要確認） ──
    case "memory_delete_all": {
      if (!params.confirm) {
        return { ok: false, error: "This will delete ALL your memories. Pass confirm:true to proceed." };
      }
      const count = await deleteAllMemory(userId);
      return { ok: true, data: `Deleted all ${count} memories.` };
    }

    // ── I7: 單筆記憶刪除（用 key 刪除特定記憶） ──
    case "memory_delete_key": {
      const key = params.key as string;
      if (!key) {
        return { ok: false, error: "key parameter is required. Use memory_query to find the key first." };
      }
      try {
        const { memory } = await import("@/db/schema");
        const deleted = await db.delete(memory).where(
          and(eq(memory.userId, userId), eq(memory.key, key)),
        );
        const count = deleted.rowCount ?? 0;
        if (count === 0) {
          return { ok: false, error: `No memory found with key "${key}".` };
        }
        return { ok: true, data: `Deleted memory with key "${key}".` };
      } catch (err) {
        return { ok: false, error: `Failed to delete memory: ${err instanceof Error ? err.message : "Unknown error"}` };
      }
    }

    // ── 導出用戶的所有記憶 ──
    case "memory_export": {
      const memories = await exportMemory(userId);
      if (memories.length === 0) {
        return { ok: true, data: "No memories to export." };
      }
      // 按 category 分組輸出 Markdown
      const grouped: Record<string, typeof memories> = {};
      for (const m of memories) {
        const cat = m.category;
        if (!grouped[cat]) grouped[cat] = [];
        grouped[cat].push(m);
      }
      const sections: string[] = [];
      for (const [category, items] of Object.entries(grouped)) {
        sections.push(`## ${category}\n` + items.map((m) => {
          const app = m.appName ? ` (${m.appName})` : "";
          return `- **${m.key}**${app}: ${m.value}`;
        }).join("\n"));
      }
      return { ok: true, data: `# Memory Export (${memories.length} entries)\n\n${sections.join("\n\n")}` };
    }

    // ── 輕量筆記（B4）：快速留筆記給未來的自己或其他 agent ──
    case "note": {
      const text = params.text as string;
      const timestamp = new Date().toISOString().substring(0, 16);
      await storeMemory(userId, `note:${timestamp}`, text, "context");
      return { ok: true, data: "Note saved." };
    }

    // ── 工具搜尋（語意搜尋）：不用知道 App 名稱就能找到工具 ──
    case "find_tool": {
      const task = (params.task as string).toLowerCase();

      // 從所有已載入的 adapter 中搜尋匹配的 action
      const { getAllAdapters } = await import("@/mcp/registry");
      const allAdapters = getAllAdapters();
      const matches: Array<{ app: string; action: string; description: string; score: number }> = [];

      for (const adapter of allAdapters) {
        for (const tool of adapter.tools) {
          const desc = tool.description.toLowerCase();
          const name = tool.name.toLowerCase();

          // 簡單的關鍵字匹配計分
          let score = 0;
          const words = task.split(/\s+/);
          for (const word of words) {
            if (word.length < 2) continue;
            if (desc.includes(word)) score += 2;
            if (name.includes(word)) score += 3;
          }

          // 常見意圖對應
          const intentMap: Record<string, string[]> = {
            "email": ["gmail"],
            "信": ["gmail"],
            "郵件": ["gmail"],
            "行程": ["calendar", "event"],
            "會議": ["calendar", "event"],
            "日曆": ["calendar"],
            "檔案": ["drive", "file"],
            "文件": ["docs", "drive", "notion"],
            "筆記": ["notion", "docs"],
            "頁面": ["notion", "page"],
            "試算表": ["sheets", "spreadsheet"],
            "表格": ["sheets", "spreadsheet"],
            "待辦": ["tasks", "todo"],
            "任務": ["tasks", "todo"],
            "影片": ["youtube", "video"],
            "訊息": ["line", "telegram", "message"],
            "貼文": ["threads", "instagram", "publish"],
            "程式碼": ["github", "code"],
            "issue": ["github"],
            "pr": ["github", "pull"],
          };

          for (const [keyword, targets] of Object.entries(intentMap)) {
            if (task.includes(keyword)) {
              for (const target of targets) {
                if (name.includes(target) || desc.includes(target)) {
                  score += 5;
                }
              }
            }
          }

          if (score > 0) {
            // 找到 simplified action name
            const actionName = adapter.actionMap
              ? Object.entries(adapter.actionMap).find(([_, v]) => v === tool.name)?.[0] || tool.name
              : tool.name;
            matches.push({ app: adapter.name, action: actionName, description: tool.description, score });
          }
        }
      }

      if (matches.length === 0) {
        return { ok: true, data: `No matching tools found for "${params.task}". Try octodock_help() to see all available apps.` };
      }

      // I6: 按分數排序，只取前 3 個（減少 AI 選擇困難）
      matches.sort((a, b) => b.score - a.score);
      const top = matches.slice(0, 3);
      const result = top.map(m =>
        `- **${m.app}.${m.action}** — ${m.description}`
      ).join("\n");

      return { ok: true, data: `Found ${matches.length} matching tools:\n\n${result}\n\nUse octodock_do(app:"APP", action:"ACTION", params:{...}) to execute.` };
    }

    // ============================================================
    // 回傳壓縮：取得暫存的完整回傳內容
    // AI 收到 truncated response 時，用 ref ID 取回完整內容
    // 支援行範圍查詢（lines:"50-100"），避免一次拉太多
    // ============================================================
    case "get_stored": {
      const ref = params.ref as string;
      if (!ref) {
        return { ok: false, error: "ref parameter is required." };
      }

      // 查詢時檢查過期時間，避免回傳已過期的資料
      const rows = await db
        .select()
        .from(storedResults)
        .where(and(
          eq(storedResults.id, ref),
          eq(storedResults.userId, userId),
          or(
            isNull(storedResults.expiresAt),
            gt(storedResults.expiresAt, new Date()),
          ),
        ))
        .limit(1);

      if (rows.length === 0) {
        return { ok: false, error: "Stored result not found or expired." };
      }

      const content = rows[0].content;
      const linesParam = params.lines as string | undefined;

      // 沒指定行範圍 → 回傳全部
      if (!linesParam) {
        return { ok: true, data: content };
      }

      // 解析行範圍，支援多範圍語法（如 "1-50,200-250"）
      const allLines = content.split("\n");
      const ranges = linesParam.split(",").map((r) => r.trim());
      const segments: string[] = [];
      const rangeLabels: string[] = [];

      for (const range of ranges) {
        const [startStr, endStr] = range.split("-");
        const start = startStr ? parseInt(startStr) - 1 : 0;
        const end = endStr ? parseInt(endStr) : allLines.length;
        const s = Math.max(0, start);
        const e = Math.min(end, allLines.length);
        segments.push(allLines.slice(s, e).join("\n"));
        rangeLabels.push(`${s + 1}-${e}`);
      }

      return {
        ok: true,
        data:
          segments.join("\n\n...\n\n") +
          `\n\n(showing lines ${rangeLabels.join(", ")} of ${allLines.length} total)`,
      };
    }

    // ============================================================
    // 排程引擎（Phase 5）
    // 讓用戶設定定時任務，OctoDock 在時間到時自動執行
    // ============================================================

    // ── 通用 HTTP 請求（混合模式）──
    // 讓 AI 可以呼叫未預定義的 API endpoint
    // 用於長尾需求：核心功能用預定義 action，邊緣功能用 http_request
    case "http_request": {
      const url = params.url as string;
      const method = (params.method as string) || "GET";
      const headers = (params.headers as Record<string, string>) || {};
      const body = params.body as string | undefined;

      // 安全檢查：只允許 HTTPS
      if (!url.startsWith("https://")) {
        return { ok: false, error: "Only HTTPS URLs are allowed for security." };
      }

      // 安全檢查：解析 hostname 後阻擋內網 IP 和危險 URL
      let hostname: string;
      try {
        hostname = new URL(url).hostname.toLowerCase();
      } catch {
        return { ok: false, error: "Invalid URL format." };
      }

      // 阻擋 localhost 和各種別名
      const blockedHostnames = ["localhost", "0.0.0.0", "[::1]", "[::0]"];
      if (blockedHostnames.includes(hostname) || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
        return { ok: false, error: "Internal/private URLs are not allowed." };
      }

      // 阻擋 IP 位址（阻止所有直接 IP 存取，包括 IPv4/IPv6/decimal/octal/hex 等繞過方式）
      // 只允許域名，不允許 IP
      const ipPatterns = /^(\d{1,3}\.){3}\d{1,3}$|^\[.*\]$|^\d{9,10}$/;
      if (ipPatterns.test(hostname)) {
        return { ok: false, error: "Direct IP access is not allowed. Use a domain name." };
      }

      // 阻擋 metadata service（雲端環境的 SSRF 常見目標）
      if (hostname === "metadata.google.internal" || hostname.startsWith("169.254.")) {
        return { ok: false, error: "Cloud metadata service access is not allowed." };
      }

      try {
        const res = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json", ...headers },
          body: method !== "GET" && body ? body : undefined,
        });

        const contentType = res.headers.get("content-type") || "";
        let data: string;
        if (contentType.includes("json")) {
          const json = await res.json();
          data = JSON.stringify(json, null, 2);
        } else {
          data = await res.text();
        }

        // 截斷過長的回傳
        if (data.length > 5000) {
          data = data.substring(0, 5000) + "\n\n... (truncated, total " + data.length + " chars)";
        }

        return {
          ok: res.ok,
          data: res.ok ? data : undefined,
          error: res.ok ? undefined : `HTTP ${res.status}: ${data.substring(0, 200)}`,
        };
      } catch (err) {
        return { ok: false, error: `Request failed: ${err instanceof Error ? err.message : "Unknown error"}` };
      }
    }

    // ── 排程列表 ──
    case "schedule_list": {
      const items = await listSchedules(userId);
      if (items.length === 0) {
        return { ok: true, data: "No schedules found. Create one with schedule_create." };
      }
      const list = items.map((s) => {
        const status = s.isActive ? "✅" : "⏸️";
        const config = s.actionConfig as Record<string, unknown>;
        let desc = "";
        if (s.actionType === "simple") desc = `do(${config.app}/${config.action})`;
        else if (s.actionType === "sop") desc = `SOP: ${config.sop_name}`;
        else if (s.actionType === "ai") desc = `AI: ${String(config.prompt).substring(0, 50)}`;
        const lastRun = s.lastRunAt ? ` | last: ${new Date(s.lastRunAt).toLocaleString()}` : "";
        const nextRun = s.nextRunAt ? ` | next: ${new Date(s.nextRunAt).toLocaleString()}` : "";
        return `${status} **${s.name}** (${s.cronExpression}) — ${desc}\n  ID: ${s.id}${lastRun}${nextRun}`;
      }).join("\n");
      return { ok: true, data: `## Your Schedules\n\n${list}` };
    }

    // ── 建立排程 ──
    case "schedule_create": {
      const id = await createSchedule(
        userId,
        params.name as string,
        params.cron as string,
        params.action_type as string,
        params.action_config as Record<string, unknown>,
        params.timezone as string | undefined,
      );
      return { ok: true, data: `Schedule "${params.name}" created. ID: ${id}` };
    }

    // ── 啟用/停用排程 ──
    case "schedule_toggle": {
      await toggleSchedule(
        userId,
        params.schedule_id as string,
        params.is_active as boolean,
      );
      const status = params.is_active ? "enabled" : "disabled";
      return { ok: true, data: `Schedule ${status}.` };
    }

    // ── 刪除排程 ──
    case "schedule_delete": {
      await deleteSchedule(userId, params.schedule_id as string);
      return { ok: true, data: "Schedule deleted." };
    }

    // ============================================================
    // G 組：System API — AI 操作輔助層
    // ============================================================

    // ── G1: batch_do — 批次執行多個 action ──
    case "batch_do": {
      const actions = params.actions as Array<{ app: string; action: string; params?: Record<string, unknown> }>;
      if (!actions || !Array.isArray(actions) || actions.length === 0) {
        return { ok: false, error: "actions array is required. Each item: {app, action, params?}" };
      }
      // 安全：禁止遞迴 batch
      if (actions.some((a) => a.app === "system" && a.action === "batch_do")) {
        return { ok: false, error: "Recursive batch_do is not allowed." };
      }
      const maxBatch = 20; // 批次上限
      if (actions.length > maxBatch) {
        return { ok: false, error: `Maximum ${maxBatch} actions per batch.` };
      }

      const mode = (params.mode as string) ?? "parallel";
      const onError = (params.on_error as string) ?? "continue";

      // 取得 executeDoAction 函式（避免循環 import，動態取得）
      const { getAdapter } = await import("@/mcp/registry");
      const { executeWithMiddleware } = await import("@/mcp/middleware/logger");
      const { getValidToken } = await import("@/services/token-manager");

      const executeSingle = async (a: { app: string; action: string; params?: Record<string, unknown> }): Promise<DoResult> => {
        // system action 遞迴呼叫
        if (a.app === "system") {
          return executeSystemAction(userId, a.action, a.params ?? {});
        }
        const adapter = getAdapter(a.app);
        if (!adapter) return { ok: false, error: `Adapter "${a.app}" not found` };
        const toolName = adapter.actionMap?.[a.action];
        if (!toolName) return { ok: false, error: `Unknown action "${a.action}" for ${a.app}` };
        try {
          const token = await getValidToken(userId, a.app);
          const result = await adapter.execute(toolName, a.params ?? {}, token);
          return { ok: !result.isError, data: result.content[0]?.text };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : "Unknown error" };
        }
      };

      const results: DoResult[] = [];

      if (mode === "sequential") {
        for (const a of actions) {
          const r = await executeSingle(a);
          results.push(r);
          if (!r.ok && onError === "abort") {
            return { ok: false, data: results, error: `Aborted at step ${results.length}: ${r.error}` };
          }
        }
      } else {
        // parallel
        const promises = actions.map((a) => executeSingle(a));
        const settled = await Promise.allSettled(promises);
        for (const s of settled) {
          if (s.status === "fulfilled") results.push(s.value);
          else results.push({ ok: false, error: s.reason?.message ?? "Unknown error" });
        }
      }

      const successCount = results.filter((r) => r.ok).length;
      return {
        ok: successCount === results.length,
        data: { results, summary: `${successCount}/${results.length} succeeded` },
      };
    }

    // ── G5: resolve_name — 名稱解析為 ID ──
    case "resolve_name": {
      const name = params.name as string;
      if (!name) return { ok: false, error: "name parameter is required." };
      const targetApp = params.app as string | undefined;
      const entityType = (params.type as string) ?? "page";

      const { resolveIdentifier, learnIdentifier } = await import("@/services/memory-engine");
      const { getAdapter, getAllAdapters } = await import("@/mcp/registry");
      const { getValidToken } = await import("@/services/token-manager");

      // 1. 先查 memory
      if (targetApp) {
        const resolved = await resolveIdentifier(userId, name, targetApp);
        if (resolved) {
          return { ok: true, data: { id: resolved.id, source: "memory", app: targetApp } };
        }
      }

      // 2. 打 search API
      const appsToSearch = targetApp ? [targetApp] : getAllAdapters().map((a) => a.name);
      const candidates: Array<{ app: string; id: string; title: string; type: string }> = [];

      for (const appName of appsToSearch) {
        const adapter = getAdapter(appName);
        if (!adapter) continue;
        // 找 search action
        const searchTool = adapter.actionMap?.["search"];
        if (!searchTool) continue;

        try {
          const token = await getValidToken(userId, appName);
          const result = await adapter.execute(searchTool, { query: name, filter: entityType }, token);
          const text = result.content[0]?.text;
          if (!text) continue;
          const data = JSON.parse(text);
          const items = (data.results ?? data.files ?? data.messages ?? []) as Array<Record<string, unknown>>;

          for (const item of items.slice(0, 5)) {
            const itemId = item.id as string;
            if (!itemId) continue;
            // 嘗試取標題
            const props = item.properties as Record<string, unknown> | undefined;
            const title =
              (props?.title as { title?: Array<{ plain_text: string }> })?.title?.[0]?.plain_text ??
              (props?.Name as { title?: Array<{ plain_text: string }> })?.title?.[0]?.plain_text ??
              (item.name as string) ?? (item.subject as string) ?? "(untitled)";

            if (title.toLowerCase().includes(name.toLowerCase())) {
              candidates.push({ app: appName, id: itemId, title, type: (item.object as string) ?? entityType });
            }
          }
        } catch {
          // search 失敗不影響其他 App
        }
      }

      if (candidates.length === 0) {
        return { ok: false, error: `Could not resolve "${name}" to an ID.` };
      }

      // 精確匹配或唯一候選
      if (candidates.length === 1) {
        const c = candidates[0];
        // 自動學習
        learnIdentifier(userId, c.app, name, c.id, c.type).catch(() => {});
        return { ok: true, data: { id: c.id, app: c.app, title: c.title, source: "search" } };
      }

      // 多個候選 → 回傳列表讓 AI 選
      return {
        ok: true,
        data: {
          ambiguous: true,
          candidates: candidates.map((c) => ({ app: c.app, id: c.id, title: c.title })),
          note: `Found ${candidates.length} candidates for "${name}". Pick one and call resolve_name again with the specific app.`,
        },
      };
    }

    // ── G6: param_suggest — 根據記憶和歷史建議參數 ──
    case "param_suggest": {
      const app = params.app as string;
      const action = params.action as string;
      if (!app || !action) return { ok: false, error: "app and action parameters are required." };

      const { queryMemory: qm } = await import("@/services/memory-engine");
      const { operations } = await import("@/db/schema");
      const { getAdapter } = await import("@/mcp/registry");
      const adapter = getAdapter(app);
      const toolName = adapter?.actionMap?.[action];

      const suggested: Record<string, unknown> = {};

      // 1. 從 memory 找 pattern（default_parent、frequent_actions 等）
      try {
        const patterns = await qm(userId, `${app} ${action}`, "pattern");
        for (const p of patterns) {
          if (p.key === "default_parent" && p.appName === app) {
            suggested.parent_id = p.value;
          }
          if (p.key.startsWith("default_") && p.appName === app) {
            const paramName = p.key.replace("default_", "");
            suggested[paramName] = p.value;
          }
        }
      } catch {
        // 記憶查詢失敗不影響
      }

      // 2. 從 operations 表找最近成功的同 action params
      if (toolName) {
        try {
          const lastOp = await db
            .select({ params: operations.params })
            .from(operations)
            .where(
              and(
                eq(operations.userId, userId),
                eq(operations.appName, app),
                eq(operations.toolName, toolName),
                eq(operations.success, true),
              ),
            )
            .orderBy(desc(operations.createdAt))
            .limit(1);

          if (lastOp.length > 0 && lastOp[0].params) {
            const lastParams = lastOp[0].params as Record<string, unknown>;
            // 只建議 ID 類參數（parent_id、database_id 等），不建議內容
            for (const [k, v] of Object.entries(lastParams)) {
              if (k.endsWith("_id") && typeof v === "string" && !(k in suggested)) {
                suggested[k] = v;
              }
            }
          }
        } catch {
          // 查詢失敗不影響
        }
      }

      if (Object.keys(suggested).length === 0) {
        return { ok: true, data: `No parameter suggestions for ${app}.${action} yet. Use it a few times first.` };
      }

      return { ok: true, data: { app, action, suggestedParams: suggested } };
    }

    // ── G7: multi_search — 跨 App 搜尋 ──
    case "multi_search": {
      const query = params.query as string;
      if (!query) return { ok: false, error: "query parameter is required." };

      const targetApps = params.apps as string[] | undefined;
      const { getAdapter, getAllAdapters } = await import("@/mcp/registry");
      const { getValidToken } = await import("@/services/token-manager");

      // 決定要搜哪些 App
      const { connectedApps: caTable } = await import("@/db/schema");
      const connected = await db.select({ appName: caTable.appName })
        .from(caTable)
        .where(and(eq(caTable.userId, userId), eq(caTable.status, "active")));
      const connectedNames = connected.map((c) => c.appName);
      const appsToSearch = targetApps
        ? targetApps.filter((a) => connectedNames.includes(a))
        : connectedNames;

      // 並行搜尋，每個 App 設 5 秒 timeout
      const SEARCH_TIMEOUT_MS = 5_000;
      const results: Array<{ app: string; type: string; title: string; url?: string; snippet?: string; updated_at?: string }> = [];

      const searchPromises = appsToSearch.map(async (appName) => {
        const adapter = getAdapter(appName);
        if (!adapter) return;
        const searchTool = adapter.actionMap?.["search"];
        if (!searchTool) return;

        try {
          const token = await getValidToken(userId, appName);
          const result = await Promise.race([
            adapter.execute(searchTool, { query, max_results: 5 }, token),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), SEARCH_TIMEOUT_MS)),
          ]);
          if (!result) return; // timeout

          const text = result.content[0]?.text;
          if (!text) return;
          const data = JSON.parse(text);

          // 統一格式化
          const items = (data.results ?? data.files ?? data.messages ?? data.items ?? []) as Array<Record<string, unknown>>;
          for (const item of items.slice(0, 5)) {
            const props = item.properties as Record<string, unknown> | undefined;
            const title =
              (props?.title as { title?: Array<{ plain_text: string }> })?.title?.[0]?.plain_text ??
              (props?.Name as { title?: Array<{ plain_text: string }> })?.title?.[0]?.plain_text ??
              (item.name as string) ?? (item.subject as string) ?? (item.snippet as string) ?? "(untitled)";
            results.push({
              app: appName,
              type: (item.object as string) ?? (item.mimeType as string) ?? "item",
              title,
              url: (item.url as string) ?? (item.webViewLink as string) ?? (item.permalink as string),
              snippet: (item.snippet as string)?.substring(0, 100),
              updated_at: (item.last_edited_time as string) ?? (item.modifiedTime as string) ?? (item.date as string),
            });
          }
        } catch {
          // 搜尋失敗不影響其他 App
        }
      });

      await Promise.allSettled(searchPromises);

      if (results.length === 0) {
        return { ok: true, data: `No results found for "${query}" across ${appsToSearch.length} apps.` };
      }

      return {
        ok: true,
        data: {
          query,
          totalResults: results.length,
          searchedApps: appsToSearch,
          results,
        },
      };
    }

    // ── K1: 跨 App 資源群組 — 建立 ──
    case "resource_group_create": {
      const name = params.name as string;
      const resources = params.resources as Array<{ app: string; id: string; label?: string }>;
      if (!name) return { ok: false, error: "name parameter is required." };
      if (!resources || !Array.isArray(resources) || resources.length === 0) {
        return { ok: false, error: "resources array is required. Each item: {app, id, label?}" };
      }
      const key = `resource_group:${name}`;
      await storeMemory(userId, key, JSON.stringify(resources), "context");
      return { ok: true, data: `Resource group "${name}" created with ${resources.length} resources.` };
    }

    // ── K1: 跨 App 資源群組 — 取得 ──
    case "resource_group_get": {
      const name = params.name as string;
      if (!name) {
        // 不帶 name → 列出所有資源群組
        const allGroups = await queryMemory(userId, "resource_group:", "context");
        if (allGroups.length === 0) {
          return { ok: true, data: "No resource groups defined yet." };
        }
        const list = allGroups.map((g) => {
          const groupName = g.key.replace("resource_group:", "");
          try {
            const resources = JSON.parse(g.value) as Array<{ app: string; id: string; label?: string }>;
            return `- **${groupName}**: ${resources.map((r) => `${r.app}:${r.label ?? r.id}`).join(", ")}`;
          } catch {
            return `- **${groupName}**`;
          }
        });
        return { ok: true, data: `Resource groups:\n\n${list.join("\n")}` };
      }
      // 帶 name → 取得特定群組
      const key = `resource_group:${name}`;
      const results = await queryMemory(userId, key, "context");
      const match = results.find((r) => r.key === key);
      if (!match) {
        return { ok: false, error: `Resource group "${name}" not found.` };
      }
      try {
        const resources = JSON.parse(match.value);
        return { ok: true, data: { name, resources } };
      } catch {
        return { ok: true, data: { name, resources: match.value } };
      }
    }

    // ── K2: undo_last — 復原最近一次高風險操作 ──
    case "undo_last": {
      const targetApp = (params.app as string) ?? "notion";
      const { memory } = await import("@/db/schema");

      // 從 memory 找最近的 undo 快照
      const snapshots = await db.select({ key: memory.key, value: memory.value })
        .from(memory)
        .where(
          and(
            eq(memory.userId, userId),
            eq(memory.category, "context"),
            sql`key LIKE ${"undo:" + targetApp + ":%"}`,
          ),
        )
        .orderBy(desc(memory.createdAt))
        .limit(1);

      if (snapshots.length === 0) {
        return { ok: false, error: `No undo snapshot found for "${targetApp}". Only replace_content and delete_page operations create snapshots.` };
      }

      const snapshot = snapshots[0];
      try {
        const data = JSON.parse(snapshot.value) as {
          action: string;
          pageId: string;
          title?: string;
          content?: string;
          parentId?: string;
        };

        const { getAdapter } = await import("@/mcp/registry");
        const { getValidToken } = await import("@/services/token-manager");
        const adapter = getAdapter(targetApp);
        if (!adapter) return { ok: false, error: `Adapter "${targetApp}" not found.` };
        const token = await getValidToken(userId, targetApp);

        // 根據快照類型執行反向操作
        if (data.action === "replace_content" && data.content) {
          // 反向操作：用快照的 content 取代目前內容
          await adapter.execute(
            adapter.actionMap?.["replace_content"] ?? `${targetApp}_replace_content`,
            { page_id: data.pageId, content: data.content },
            token,
          );
          // 刪除已用的快照
          await db.delete(memory).where(
            and(eq(memory.userId, userId), eq(memory.key, snapshot.key)),
          );
          return { ok: true, data: `Undo successful. Restored content of "${data.title ?? data.pageId}".` };
        }

        if (data.action === "delete_page" && data.parentId) {
          // 反向操作：重新建立頁面（無法完全復原，但至少建回標題和 parent）
          const createTool = adapter.actionMap?.["create_page"] ?? `${targetApp}_create_page`;
          const result = await adapter.execute(
            createTool,
            { title: data.title ?? "Restored page", parent_id: data.parentId, content: data.content ?? "" },
            token,
          );
          await db.delete(memory).where(
            and(eq(memory.userId, userId), eq(memory.key, snapshot.key)),
          );
          const text = result.content[0]?.text;
          return { ok: true, data: `Undo successful. Re-created "${data.title ?? "page"}" under original parent.\n${text ?? ""}` };
        }

        return { ok: false, error: `Unsupported undo action: ${data.action}` };
      } catch (err) {
        return { ok: false, error: `Undo failed: ${err instanceof Error ? err.message : "Unknown error"}` };
      }
    }

    // ── 未知操作 ──
    default:
      return {
        ok: false,
        error: `Unknown system action: ${action}`,
        suggestions: Object.keys(systemActionMap),
      };
  }
}

// ============================================================
// 記憶 Markdown 渲染器
// 將 DB 記憶條目渲染成 AI 友善的 Markdown 格式
// MD 比 JSON 省 30-40% tokens，AI 理解更快
// ============================================================

interface MemoryForRender {
  key: string;
  value: string;
  category: string;
  appName: string | null;
}

/** 將記憶陣列渲染成分類好的 Markdown 文字 */
function renderMemoryAsMarkdown(memories: MemoryForRender[]): string {
  // 按 category 分組
  const grouped: Record<string, MemoryForRender[]> = {};
  for (const m of memories) {
    const cat = m.category;
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(m);
  }

  // 渲染成 Markdown
  const sections: string[] = [];
  for (const [category, items] of Object.entries(grouped)) {
    sections.push(`### ${category}`);
    for (const item of items) {
      const app = item.appName ? ` (${item.appName})` : "";
      sections.push(`- **${item.key}**${app}: ${item.value}`);
    }
  }

  return `## Memory Results\n\n${sections.join("\n")}`;
}
