import { db } from "@/db";
import { conversations } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import {
  queryMemory,
  storeMemory,
  listMemory,
  deleteMemory,
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
  // 排程引擎（Phase 5）
  schedule_list: "system_schedule_list",
  schedule_create: "system_schedule_create",
  schedule_toggle: "system_schedule_toggle",
  schedule_delete: "system_schedule_delete",
};

/**
 * 回傳 system 的 Skill 文字
 * AI 呼叫 octodock_help(app: "system") 時回傳
 */
export function getSystemSkill(): string {
  return `system actions:
  memory_query(query, category?) — search user memory (preference/pattern/context/sop)
  memory_store(key, value, category, app_name?) — store a memory entry
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
  find_tool(task) — find the right app and action for a task (e.g. "send an email", "create a note")
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

      return {
        ok: true,
        data: `Successfully imported ${imported} memories. OctoDock will now remember these across all AI platforms.`,
      };
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

      // 按分數排序，取前 5 個
      matches.sort((a, b) => b.score - a.score);
      const top = matches.slice(0, 5);
      const result = top.map(m =>
        `- **${m.app}.${m.action}** — ${m.description}`
      ).join("\n");

      return { ok: true, data: `Found ${matches.length} matching tools:\n\n${result}\n\nUse octodock_do(app:"APP", action:"ACTION", params:{...}) to execute.` };
    }

    // ============================================================
    // 排程引擎（Phase 5）
    // 讓用戶設定定時任務，OctoDock 在時間到時自動執行
    // ============================================================

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
