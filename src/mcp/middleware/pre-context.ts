import { db } from "@/db";
import { operations } from "@/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";

// ============================================================
// C1 + C4: Pre-context Middleware
// 操作前自動查目標現狀，結果放入 response.context
// C4: create_page 時從兄弟頁面標題推斷命名慣例
//
// 設計原則：
// - 查詢失敗不擋主操作（全部 try-catch）
// - timeout 2 秒，超時放棄
// - 不直接 import adapter，透過參數傳入 execute 函式
// ============================================================

/** pre-context 查詢逾時（毫秒） */
const PRE_CONTEXT_TIMEOUT_MS = 2_000;

/** pre-context 查詢規則：toolName 模式 → 需要查什麼 */
interface PreContextRule {
  pattern: RegExp;                         // toolName 的匹配規則
  paramKey: string;                        // 從 params 取哪個 key 當目標 ID
  queryType: "siblings" | "target" | "sent_today"; // 查詢類型
}

const PRE_CONTEXT_RULES: PreContextRule[] = [
  { pattern: /create_page/, paramKey: "parent_id", queryType: "siblings" },
  { pattern: /replace_content|update/, paramKey: "page_id", queryType: "target" },
  { pattern: /delete|trash/, paramKey: "page_id", queryType: "target" },
  { pattern: /send/, paramKey: "to", queryType: "sent_today" },
];

/** pre-context 查詢結果 */
export interface PreContextResult {
  existingSiblings?: Array<{ title: string; createdAt: string }>;
  currentContent?: { title: string; lastEdited: string };
  todaySentToRecipient?: number;
  targetInfo?: { title: string; createdAt: string };
  namingConvention?: { datePrefix: boolean; commonTypes: string[]; examples: string[] };
  patterns?: Array<{ name: string; count: number }>;
  crossAppContext?: Array<{ app: string; type: string; title: string; date?: string }>; // O1+U9: 跨 App 相關資源
}

/**
 * 操作前自動查詢目標現狀
 *
 * @param userId 用戶 ID
 * @param appName App 名稱
 * @param toolName 內部工具名稱
 * @param params 操作參數
 * @param executeQuery 查詢上游 API 的函式（不直接 import adapter）
 * @param token OAuth token
 */
/** 跨 App 查詢函式類型（由 server.ts 提供，避免 pre-context 直接 import adapter） */
export type CrossAppQueryFn = (app: string, toolName: string, params: Record<string, unknown>) => Promise<unknown>;

export async function getPreContext(
  userId: string,
  appName: string,
  toolName: string,
  params: Record<string, unknown>,
  executeQuery: ((toolName: string, params: Record<string, unknown>, token: string) => Promise<unknown>) | null,
  token: string | null,
  crossAppQuery?: CrossAppQueryFn | null,
): Promise<PreContextResult | null> {
  // 帶 timeout 的包裝
  try {
    const result = await Promise.race([
      doPreContext(userId, appName, toolName, params, executeQuery, token, crossAppQuery),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), PRE_CONTEXT_TIMEOUT_MS)),
    ]);
    return result;
  } catch (err) {
    console.error("Pre-context query failed:", err);
    return null;
  }
}

/** 實際的 pre-context 查詢邏輯 */
async function doPreContext(
  userId: string,
  appName: string,
  toolName: string,
  params: Record<string, unknown>,
  executeQuery: ((toolName: string, params: Record<string, unknown>, token: string) => Promise<unknown>) | null,
  token: string | null,
  crossAppQuery?: CrossAppQueryFn | null,
): Promise<PreContextResult | null> {
  const context: PreContextResult = {};
  let hasData = false;

  for (const rule of PRE_CONTEXT_RULES) {
    if (!rule.pattern.test(toolName)) continue;

    // ── 查今天寄給同一收件人幾封（從 operations 表查）──
    if (rule.queryType === "sent_today" && params[rule.paramKey]) {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const count = await db
        .select({ count: sql<number>`count(*)` })
        .from(operations)
        .where(
          and(
            eq(operations.userId, userId),
            eq(operations.appName, appName),
            eq(operations.toolName, toolName),
            eq(operations.success, true),
            gte(operations.createdAt, todayStart),
            sql`params->>'to' = ${String(params[rule.paramKey])}`,
          ),
        );
      context.todaySentToRecipient = Number(count[0]?.count ?? 0);
      hasData = true;
      continue;
    }

    // 以下查詢需要 executeQuery + token
    if (!executeQuery || !token) continue;
    const targetId = params[rule.paramKey];
    if (!targetId || typeof targetId !== "string") continue;

    // ── 查兄弟頁面（create_page 時查 parent 的子頁面）──
    if (rule.queryType === "siblings" && appName === "notion") {
      try {
        const result = await executeQuery(
          "notion_get_block_children",
          { block_id: targetId, page_size: 10 },
          token,
        ) as { content: Array<{ text: string }> };
        const text = result?.content?.[0]?.text;
        if (text) {
          const data = JSON.parse(text);
          const siblings = (data.results ?? [])
            .filter((b: Record<string, unknown>) => b.type === "child_page" || b.object === "page")
            .slice(0, 10)
            .map((b: Record<string, unknown>) => ({
              title: (b as Record<string, unknown>).child_page
                ? ((b as Record<string, { title: string }>).child_page?.title ?? "(untitled)")
                : "(untitled)",
              createdAt: (b as Record<string, string>).created_time ?? "",
            }));
          if (siblings.length > 0) {
            context.existingSiblings = siblings;
            // C4: 從兄弟頁面標題推斷命名慣例
            context.namingConvention = inferNamingConvention(siblings.map((s: { title: string }) => s.title));
            hasData = true;
          }
        }
      } catch (err) {
        console.error("Pre-context siblings query failed:", err);
      }
      continue;
    }

    // ── 查目標資訊（delete/replace 時查目標頁面基本資訊）──
    // _metadataOnly: 跳過 block 抓取，避免大頁面超過 pre-context timeout
    if (rule.queryType === "target" && appName === "notion") {
      try {
        const result = await executeQuery(
          "notion_get_page",
          { page_id: targetId, _metadataOnly: true },
          token,
        ) as { content: Array<{ text: string }> };
        const text = result?.content?.[0]?.text;
        if (text) {
          const data = JSON.parse(text);
          const page = data.page ?? data;
          const title = page.properties?.title?.title?.[0]?.plain_text
            ?? page.properties?.Name?.title?.[0]?.plain_text
            ?? "(untitled)";
          if (toolName.includes("delete") || toolName.includes("trash")) {
            context.targetInfo = { title, createdAt: page.created_time ?? "" };
          } else {
            context.currentContent = { title, lastEdited: page.last_edited_time ?? "" };
          }
          hasData = true;
        }
      } catch (err) {
        console.error("Pre-context target query failed:", err);
      }
    }
  }

  // U9/O1: 跨 App 上下文 — create_page 時從標題提取關鍵字，查 Calendar + Gmail
  if (/create_page/.test(toolName) && appName === "notion") {
    const title = params.title as string | undefined;
    if (title && title.length >= 2) {
      try {
        const { getAdapter } = await import("@/mcp/registry");
        const { getValidToken } = await import("@/services/token-manager");

        // 從標題提取可能的人名或關鍵字（簡單啟發：移除日期前綴和常見詞）
        const keyword = title
          .replace(/^\d{4}-\d{2}-\d{2}\s*/, "")
          .replace(/^(規劃|討論|交辦|筆記|會議|紀錄)[：:]\s*/, "")
          .trim();

        if (keyword.length >= 2) {
          const crossAppResults: string[] = [];

          // 查 Google Calendar 今天的相關事件
          try {
            const calAdapter = getAdapter("google_calendar");
            if (calAdapter && executeQuery) {
              const calToken = await getValidToken(userId, "google_calendar").catch(() => null);
              if (calToken) {
                const today = new Date();
                const tomorrow = new Date(today);
                tomorrow.setDate(tomorrow.getDate() + 1);
                const calResult = await calAdapter.execute(
                  "gcal_get_events",
                  { time_min: today.toISOString(), time_max: tomorrow.toISOString(), max_results: 5 },
                  calToken,
                ) as { content: Array<{ text: string }> };
                const calText = calResult?.content?.[0]?.text;
                if (calText) {
                  const calData = JSON.parse(calText);
                  const events = (calData.items ?? []) as Array<Record<string, unknown>>;
                  const related = events.filter((e) =>
                    String(e.summary ?? "").includes(keyword) ||
                    String(e.description ?? "").includes(keyword),
                  );
                  if (related.length > 0) {
                    crossAppResults.push(
                      `Calendar today: ${related.map((e) => `"${e.summary}"`).join(", ")}`,
                    );
                  }
                }
              }
            }
          } catch {
            // Calendar 查詢失敗不影響
          }

          // 查 Gmail 最近相關信件
          try {
            const gmailAdapter = getAdapter("gmail");
            if (gmailAdapter) {
              const gmailToken = await getValidToken(userId, "gmail").catch(() => null);
              if (gmailToken) {
                const searchTool = gmailAdapter.actionMap?.["search"];
                if (searchTool) {
                  const gmailResult = await gmailAdapter.execute(
                    searchTool,
                    { query: keyword, max_results: 3 },
                    gmailToken,
                  ) as { content: Array<{ text: string }> };
                  const gmailText = gmailResult?.content?.[0]?.text;
                  if (gmailText) {
                    const gmailData = JSON.parse(gmailText);
                    const messages = (gmailData.messages ?? gmailData.results ?? []) as Array<Record<string, unknown>>;
                    if (messages.length > 0) {
                      crossAppResults.push(
                        `Gmail recent: ${messages.slice(0, 2).map((m) => `"${m.subject ?? m.snippet ?? "(no subject)"}"`).join(", ")}`,
                      );
                    }
                  }
                }
              }
            }
          } catch {
            // Gmail 查詢失敗不影響
          }

          if (crossAppResults.length > 0) {
            if (!context.patterns) context.patterns = [];
            // 把跨 App 結果存入 context 的特殊欄位（利用 patterns 結構）
            for (const r of crossAppResults) {
              context.patterns.push({ name: r, count: 1 });
            }
            hasData = true;
          }
        }
      } catch {
        // 跨 App 查詢失敗不影響
      }
    }
  }

  // C3 回饋：查 memory 表有沒有相關的 detected pattern
  try {
    const { memory } = await import("@/db/schema");
    const detectedPatterns = await db
      .select({ key: memory.key, value: memory.value })
      .from(memory)
      .where(
        and(
          eq(memory.userId, userId),
          eq(memory.category, "pattern"),
          sql`value LIKE ${"%" + appName + "%"}`,
        ),
      )
      .limit(3);

    if (detectedPatterns.length > 0) {
      context.patterns = detectedPatterns.map((p) => {
        try {
          const v = JSON.parse(p.value);
          return { name: p.key, count: v.count ?? 0 };
        } catch {
          return { name: p.key, count: 0 };
        }
      });
      hasData = true;
    }
  } catch (err) {
    console.error("Pre-context pattern query failed:", err);
  }

  // O1+U9+V12: 跨 App 上下文 — 建立/搜尋/撰寫內容時，從標題/查詢詞查其他 App
  // 擴展觸發條件：create_page、create_event、send（郵件/訊息）、search 等
  // 透過 crossAppQuery 回調查詢，不直接 import adapter/token-manager
  const contextKeyword = (params.title ?? params.subject ?? params.query ?? params.summary) as string | undefined;
  if (/create|send|search|query/.test(toolName) && crossAppQuery && contextKeyword) {
    const title = contextKeyword;
    if (title && title.length > 2) {
      try {
        const crossResults: Array<{ app: string; type: string; title: string; date?: string }> = [];
        // 查 Google Calendar 今天事件
        if (appName !== "google_calendar") {
          try {
            const today = new Date().toISOString().substring(0, 10);
            const calResult = await crossAppQuery(
              "google_calendar", "gcal_get_events",
              { timeMin: `${today}T00:00:00Z`, timeMax: `${today}T23:59:59Z`, maxResults: 5 },
            ) as { content?: Array<{ text: string }> } | null;
            const calText = (calResult as Record<string, unknown>)?.content
              ? ((calResult as { content: Array<{ text: string }> }).content[0]?.text)
              : null;
            if (calText) {
              const keyword = title.substring(0, 20).toLowerCase();
              if (calText.toLowerCase().includes(keyword)) {
                crossResults.push({ app: "google_calendar", type: "event", title: `今天有「${title}」相關的行事曆事件`, date: today });
              }
            }
          } catch { /* Calendar 查詢失敗不影響 */ }
        }
        // 查 Gmail 最近信件
        if (appName !== "gmail") {
          try {
            const keyword = title.substring(0, 30);
            const gmailResult = await crossAppQuery(
              "gmail", "gmail_search", { query: keyword, max_results: 2 },
            ) as { content?: Array<{ text: string }> } | null;
            const gmailText = (gmailResult as Record<string, unknown>)?.content
              ? ((gmailResult as { content: Array<{ text: string }> }).content[0]?.text)
              : null;
            if (gmailText && !gmailText.includes("No results")) {
              crossResults.push({ app: "gmail", type: "email", title: `有「${keyword}」相關的郵件` });
            }
          } catch { /* Gmail 查詢失敗不影響 */ }
        }
        // V12: 跨 App 上下文 — 查 Notion 相關頁面
        if (appName !== "notion") {
          try {
            const keyword = title.substring(0, 30);
            const notionResult = await crossAppQuery(
              "notion", "notion_search", { query: keyword },
            ) as { content?: Array<{ text: string }> } | null;
            const notionText = (notionResult as Record<string, unknown>)?.content
              ? ((notionResult as { content: Array<{ text: string }> }).content[0]?.text)
              : null;
            if (notionText && !notionText.includes("No results")) {
              crossResults.push({ app: "notion", type: "page", title: `有「${keyword}」相關的 Notion 頁面` });
            }
          } catch { /* Notion 查詢失敗不影響 */ }
        }
        if (crossResults.length > 0) {
          context.crossAppContext = crossResults;
          hasData = true;
        }
      } catch (err) {
        console.error("Cross-app context query failed:", err);
      }
    }
  }

  return hasData ? context : null;
}

/**
 * C4: 從兄弟頁面標題推斷命名慣例
 * 檢查是否有日期前綴、常見類型詞等模式
 */
function inferNamingConvention(titles: string[]): {
  datePrefix: boolean;
  commonTypes: string[];
  examples: string[];
} | undefined {
  if (titles.length < 2) return undefined;

  // 檢查是否超過 70% 標題以日期開頭
  const datePattern = /^\d{4}-\d{2}-\d{2}/;
  const dateCount = titles.filter((t) => datePattern.test(t)).length;
  const datePrefix = dateCount / titles.length >= 0.7;

  // 從標題中提取冒號前的類型詞
  const typeWords = new Map<string, number>();
  for (const title of titles) {
    const colonIdx = title.indexOf("：") !== -1 ? title.indexOf("：") : title.indexOf(":");
    if (colonIdx > 0 && colonIdx < 20) {
      // 去掉日期前綴後取類型詞
      const typeWord = title.slice(0, colonIdx).replace(/^\d{4}-\d{2}-\d{2}\s*/, "").trim();
      if (typeWord) {
        typeWords.set(typeWord, (typeWords.get(typeWord) ?? 0) + 1);
      }
    }
  }

  // 取出現超過 1 次的類型詞
  const commonTypes = [...typeWords.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => word);

  if (!datePrefix && commonTypes.length === 0) return undefined;

  return {
    datePrefix,
    commonTypes,
    examples: titles.slice(0, 3),
  };
}
