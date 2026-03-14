import { db } from "@/db";
import { conversations } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { queryMemory, storeMemory } from "@/services/memory-engine";
import type { DoResult } from "@/adapters/types";

// ============================================================
// 系統操作處理器（System Actions）
// 處理 agentdock_do(app: "system", ...) 的請求
// 包含記憶查詢/儲存、Bot 對話記錄等不屬於特定 App 的操作
// 作為虛擬的「system」App，讓 AI 用統一的 do 介面操作
// ============================================================

/** system App 的 action → 內部處理函式對應表 */
export const systemActionMap: Record<string, string> = {
  memory_query: "system_memory_query",
  memory_store: "system_memory_store",
  bot_conversations: "system_bot_conversations",
};

/**
 * 回傳 system 的 Skill 文字
 * AI 呼叫 agentdock_help(app: "system") 時回傳
 */
export function getSystemSkill(): string {
  return `system actions:
  memory_query(query, category?) — search user memory (preference/pattern/context/sop)
  memory_store(key, value, category, app_name?) — store a memory entry
  bot_conversations(platform, platform_user_id?, limit?) — view bot chat history (line/telegram)`;
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
