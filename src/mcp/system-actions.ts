import { db } from "@/db";
import { conversations, storedResults } from "@/db/schema";
import { eq, and, desc, gt, or, isNull, sql } from "drizzle-orm";
import {
  queryMemory,
  storeMemory,
  listMemory,
  deleteMemory,
  deleteMemoryByApp,
  deleteAllMemory,
  exportMemory,
} from "@/services/memory-engine";
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
  // G 組：System API — AI 操作輔助層
  batch_do: "system_batch_do",         // G1: 批次執行
  resolve_name: "system_resolve_name", // G5: 名稱解析為 ID
  param_suggest: "system_param_suggest", // G6: 參數建議
  multi_search: "system_multi_search", // G7: 跨 App 搜尋
  // K 組：跨 App 資源群組 + undo
  resource_group_create: "system_resource_group_create", // K1: 建立資源群組
  resource_group_get: "system_resource_group_get",       // K1: 取得資源群組
  undo_last: "system_undo_last",                         // K2: 復原最近一次高風險操作

  // PDF 工具（OctoDock 自有功能，不依賴外部 API）
  read_pdf: "system_read_pdf",           // 讀取 PDF 文字內容
  create_pdf: "system_create_pdf",       // 從文字/Markdown 建立 PDF
  merge_pdf: "system_merge_pdf",         // 合併多個 PDF
  pdf_info: "system_pdf_info",           // 取得 PDF 基本資訊（頁數等）

  // 文件轉換工具
  docx_to_markdown: "system_docx_to_markdown",   // DOCX → Markdown
  docx_to_html: "system_docx_to_html",           // DOCX → HTML

  // 檔案生成工具（生成後自動上傳到已連接的雲端）
  create_qr: "system_create_qr",             // QR Code 生成
  process_image: "system_process_image",     // 圖片處理（resize/compress/convert/watermark）
  create_chart: "system_create_chart",       // 圖表生成 PNG
  svg_to_png: "system_svg_to_png",           // SVG 轉 PNG
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
  memory_delete_key(key) — delete a single memory entry by key
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
  get_stored(ref, lines?) — retrieve full content of a truncated response (e.g. ref:"abc123", lines:"50-100")
  find_tool(task) — find the right app and action for a task (e.g. "send an email", "create a note")
  http_request(url, method?, headers?, body?) — make a generic HTTP request to any API (requires user's connected app token)
  batch_do(actions, mode?, on_error?) — execute multiple actions at once. actions:[{app,action,params}], mode:"sequential"|"parallel"(default), on_error:"continue"(default)|"abort"
  resolve_name(name, app?, type?) — resolve a human-readable name to an ID (e.g. "MIBU-Notes" → page ID). Searches memory first, then app APIs.
  param_suggest(app, action) — get suggested default params for an action based on user's history and patterns
  multi_search(query, apps?) — search across multiple apps at once. Returns unified format results. apps: array of app names (default: all connected)
## PDF Tools
  read_pdf(url) — extract text from a PDF (URL or base64)
  create_pdf(title, content) — create a PDF from text/Markdown. Auto-uploads to cloud.
  merge_pdf(urls) — merge multiple PDFs into one. Auto-uploads to cloud.
  pdf_info(url) — get PDF metadata (page count, title, author)
## Document Conversion
  docx_to_markdown(url) — convert a .docx file (URL) to Markdown text
  docx_to_html(url) — convert a .docx file (URL) to HTML
## File Generation (auto-uploads to connected Google Drive / OneDrive)
  create_qr(text, size?) — generate a QR Code PNG
  process_image(url, operations) — process image: resize/compress/convert/watermark. operations:[{type:"resize",width:800},{type:"compress",quality:80}]
  create_chart(type, labels, datasets, title?) — generate chart PNG. type: "bar"|"line"|"pie"|"doughnut"|"radar"
  svg_to_png(svg, width?, height?) — convert SVG code to PNG image
SOPs persist across agents and sessions.`;
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
          // G: 中英文意圖關鍵字對應表（擴充中文覆蓋）
          const intentMap: Record<string, string[]> = {
            // 英文
            "email": ["gmail"],
            "calendar": ["calendar", "event"],
            "schedule": ["calendar", "event"],
            "spreadsheet": ["sheets"],
            "presentation": ["canva", "gamma"],
            "issue": ["github"],
            "pr": ["github", "pull"],
            "pull request": ["github", "pull"],
            "design": ["canva"],
            // 中文 — 信件
            "信": ["gmail"],
            "信件": ["gmail"],
            "郵件": ["gmail"],
            "草稿": ["gmail", "draft"],
            "寄信": ["gmail", "send"],
            "收件": ["gmail", "search"],
            // 中文 — 行事曆
            "行程": ["calendar", "event"],
            "會議": ["calendar", "event"],
            "日曆": ["calendar"],
            "行事曆": ["calendar"],
            "活動": ["calendar", "event"],
            "排程": ["calendar", "event"],
            // 中文 — 檔案
            "檔案": ["drive", "file"],
            "文件": ["docs", "drive", "notion"],
            "筆記": ["notion", "docs"],
            "頁面": ["notion", "page"],
            "資料庫": ["notion", "database"],
            // 中文 — 試算表
            "試算表": ["sheets", "spreadsheet"],
            "表格": ["sheets", "spreadsheet"],
            "工作表": ["sheets"],
            // 中文 — 待辦
            "待辦": ["tasks", "todo", "todoist"],
            "任務": ["tasks", "todo", "todoist"],
            "清單": ["tasks", "list"],
            // 中文 — 影音
            "影片": ["youtube", "video"],
            "字幕": ["youtube", "transcript"],
            "頻道": ["youtube", "channel"],
            // 中文 — 通訊
            "訊息": ["line", "telegram", "message"],
            "聊天": ["line", "telegram", "discord"],
            // 中文 — 社群
            "貼文": ["threads", "instagram", "publish"],
            "發文": ["threads", "instagram", "publish"],
            // 中文 — 開發
            "程式碼": ["github", "code"],
            "程式": ["github", "code"],
            "倉庫": ["github", "repo"],
            // 中文 — 設計
            "設計": ["canva", "design"],
            "簡報": ["canva", "gamma", "presentation"],
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
              ? Object.entries(adapter.actionMap).find(([, v]) => v === tool.name)?.[0] || tool.name
              : tool.name;
            matches.push({ app: adapter.name, action: actionName, description: tool.description, score });
          }
        }
      }

      // U10: 也搜尋 system actions（undo_last、batch_do、sop_list 等）
      const SYSTEM_ACTION_DESCS: Record<string, string> = {
        memory_query: "Search user memories and preferences",
        memory_store: "Store a memory or preference",
        memory_delete_key: "Delete a specific memory by key",
        memory_delete_app: "Delete all memories for an app",
        memory_export: "Export all user memories",
        import_memory: "Import memories from AI conversation",
        batch_do: "Execute multiple actions in parallel or sequence",
        resolve_name: "Resolve a human name to an ID across apps",
        param_suggest: "Get suggested params based on history",
        multi_search: "Search across multiple apps at once",
        find_tool: "Find the right tool for a task",
        undo_last: "Undo the last destructive operation (replace_content, delete_page)",
        resource_group_create: "Create a cross-app resource group",
        resource_group_get: "Get or list resource groups",
        sop_list: "List saved SOPs",
        sop_create: "Create a new SOP workflow",
        sop_get: "Get SOP details",
        note: "Quick note to memory",
      };
      for (const [actionName, desc] of Object.entries(SYSTEM_ACTION_DESCS)) {
        const descLower = desc.toLowerCase();
        let score = 0;
        const words = task.split(/\s+/);
        for (const word of words) {
          if (word.length < 2) continue;
          if (descLower.includes(word)) score += 2;
          if (actionName.includes(word)) score += 3;
        }
        if (score > 0) {
          matches.push({ app: "system", action: actionName, description: desc, score });
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

      return { ok: true, data: `Top ${top.length} of ${matches.length} matching tools:\n\n${result}\n\nUse octodock_do(app:"APP", action:"ACTION", params:{...}) to execute.` };
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

    // ── 通用 HTTP 請求（混合模式）──
    // 讓 AI 可以呼叫未預定義的 API endpoint
    // 用於長尾需求：核心功能用預定義 action，邊緣功能用 http_request
    // V7: 自動偵測 URL 所屬的 App，帶上用戶的 OAuth token
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

      // V7: 根據 URL hostname 自動偵測所屬 App，帶上用戶的 OAuth token
      // 只有在用戶沒有手動帶 Authorization header 時才自動帶
      if (!headers.Authorization && !headers.authorization) {
        const DOMAIN_APP_MAP: Record<string, string> = {
          "api.notion.com": "notion",
          "www.googleapis.com": "google", // Google 系需進一步比對 path
          "gmail.googleapis.com": "gmail",
          "sheets.googleapis.com": "google_sheets",
          "docs.googleapis.com": "google_docs",
          "api.github.com": "github",
          "api.line.me": "line",
          "api.telegram.org": "telegram",
          "discord.com": "discord",
          "slack.com": "slack",
          "graph.threads.net": "threads",
          "graph.instagram.com": "instagram",
          "graph.facebook.com": "instagram", // Meta Graph API
          "api.canva.com": "canva",
        };

        let detectedApp = DOMAIN_APP_MAP[hostname];

        // Google 系 API：www.googleapis.com 需根據 path 判斷
        if (hostname === "www.googleapis.com") {
          const path = new URL(url).pathname;
          if (path.startsWith("/calendar")) detectedApp = "google_calendar";
          else if (path.startsWith("/drive")) detectedApp = "google_drive";
          else if (path.startsWith("/gmail")) detectedApp = "gmail";
          else if (path.startsWith("/youtube")) detectedApp = "youtube";
          else if (path.startsWith("/tasks")) detectedApp = "google_tasks";
        }

        if (detectedApp) {
          try {
            const { getValidToken } = await import("@/services/token-manager");
            const token = await getValidToken(userId, detectedApp);
            if (token) {
              headers.Authorization = `Bearer ${token}`;
            }
          } catch {
            // token 取得失敗不阻塞，繼續裸請求
          }
        }
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

      // U13: batch_do 走完整 middleware 管線（包含 formatter、rate limit、logging），不直接呼叫 adapter.execute
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
          const actionParams = { ...(a.params ?? {}) };

          // 走 param-guard（參數防呆 + camelCase → snake_case 轉換）
          const { checkParams } = await import("@/mcp/middleware/param-guard");
          const guardResult = checkParams(a.app, toolName, actionParams);
          if (guardResult?.blocked) {
            return { ok: false, error: guardResult.error };
          }

          const token = await getValidToken(userId, a.app);
          // 透過 middleware 執行（記錄日誌、取 token 等）
          const toolResult = await executeWithMiddleware(
            userId,
            a.app,
            toolName,
            actionParams,
            (p, t) => adapter.execute(toolName, p, t),
            { prefetchedToken: token },
          );
          // 轉成 DoResult
          const result: DoResult = toolResult.isError
            ? { ok: false, error: toolResult.content[0]?.text ?? "Unknown error" }
            : { ok: true, data: (() => { try { return JSON.parse(toolResult.content[0]?.text ?? ""); } catch { return toolResult.content[0]?.text; } })() };

          // 套用 error-hints（智慧錯誤引導）
          if (!result.ok && result.error && adapter.formatError) {
            const betterError = adapter.formatError(a.action, result.error);
            if (betterError) result.error = betterError;
          }

          // 套用 formatResponse
          if (result.ok && result.data && adapter.formatResponse) {
            try {
              result.data = adapter.formatResponse(a.action, result.data);
            } catch {
              // 格式轉換失敗保留原始 data
            }
          }
          // 附帶 param-guard 的 warnings
          if (guardResult?.warnings) {
            result.warnings = guardResult.warnings;
          }
          return result;
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

      // E: partial_success — 部分成功時 ok:true + partial:true，不要回 ok:false
      const successCount = results.filter((r) => r.ok).length;
      const allSucceeded = successCount === results.length;
      const anySucceeded = successCount > 0;
      return {
        ok: anySucceeded,
        data: {
          results,
          summary: `${successCount}/${results.length} succeeded`,
          ...(anySucceeded && !allSucceeded ? { partial: true } : {}),
        },
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
      const { getAdapter } = await import("@/mcp/registry");
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
      // F: 記錄搜尋失敗的 App
      const failedApps: Array<{ app: string; error: string }> = [];

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
        } catch (err) {
          // F: 搜尋失敗記錄到 failedApps，不靜默吞掉
          failedApps.push({ app: appName, error: err instanceof Error ? err.message : "Unknown error" });
        }
      });

      await Promise.allSettled(searchPromises);

      if (results.length === 0) {
        const failInfo = failedApps.length > 0
          ? ` (${failedApps.length} app(s) failed: ${failedApps.map((f) => `${f.app}: ${f.error}`).join("; ")})`
          : "";
        return { ok: true, data: `No results found for "${query}" across ${appsToSearch.length} apps.${failInfo}` };
      }

      return {
        ok: true,
        data: {
          query,
          totalResults: results.length,
          searchedApps: appsToSearch,
          ...(failedApps.length > 0 ? { failedApps } : {}),
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

    // ── PDF 工具（OctoDock 自有功能） ──

    case "read_pdf": {
      /* 從 URL 下載 PDF 並提取文字內容 */
      const url = params.url as string;
      if (!url) return { ok: false, error: "url is required" };

      try {
        let pdfBuffer: Buffer;
        if (url.startsWith("data:") || url.startsWith("base64:")) {
          /* base64 編碼的 PDF */
          const b64 = url.replace(/^(data:[^;]+;base64,|base64:)/, "");
          pdfBuffer = Buffer.from(b64, "base64");
        } else {
          /* 從 URL 下載 */
          const res = await fetch(url);
          if (!res.ok) return { ok: false, error: `Failed to download PDF: ${res.status}` };
          pdfBuffer = Buffer.from(await res.arrayBuffer());
        }

        const pdfParse = (await import("pdf-parse")).default;
        const parsed = await pdfParse(pdfBuffer);
        return {
          ok: true,
          data: parsed.text,
          summary: {
            pages: parsed.numpages,
            characters: parsed.text.length,
            title: parsed.info?.Title || null,
            author: parsed.info?.Author || null,
          },
        };
      } catch (err) {
        return { ok: false, error: `PDF 讀取失敗: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    case "create_pdf": {
      /* 從文字/Markdown 建立 PDF，回傳 base64 */
      const title = (params.title as string) || "Document";
      const content = params.content as string;
      if (!content) return { ok: false, error: "content is required" };

      try {
        const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
        const doc = await PDFDocument.create();
        const font = await doc.embedFont(StandardFonts.Helvetica);
        const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

        /* 設定頁面參數 */
        const pageWidth = 595; // A4
        const pageHeight = 842;
        const margin = 50;
        const lineHeight = 16;
        const maxWidth = pageWidth - margin * 2;

        let page = doc.addPage([pageWidth, pageHeight]);
        let y = pageHeight - margin;

        /* 標題 */
        page.drawText(title, { x: margin, y, font: boldFont, size: 20, color: rgb(0.1, 0.1, 0.1) });
        y -= 35;

        /* 內容逐行寫入，自動換頁 */
        const lines = content.split("\n");
        for (const line of lines) {
          const isHeading = line.startsWith("# ") || line.startsWith("## ") || line.startsWith("### ");
          const currentFont = isHeading ? boldFont : font;
          const fontSize = isHeading ? (line.startsWith("### ") ? 13 : line.startsWith("## ") ? 15 : 17) : 11;
          const text = line.replace(/^#{1,3}\s/, "").replace(/\*\*/g, ""); // 移除 Markdown 標記

          /* 簡易自動換行 */
          const words = text.split(" ");
          let currentLine = "";
          for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;
            const testWidth = currentFont.widthOfTextAtSize(testLine, fontSize);
            if (testWidth > maxWidth && currentLine) {
              if (y < margin + lineHeight) {
                page = doc.addPage([pageWidth, pageHeight]);
                y = pageHeight - margin;
              }
              page.drawText(currentLine, { x: margin, y, font: currentFont, size: fontSize, color: rgb(0.15, 0.15, 0.15) });
              y -= lineHeight;
              currentLine = word;
            } else {
              currentLine = testLine;
            }
          }
          /* 寫入最後一行 */
          if (currentLine || text === "") {
            if (y < margin + lineHeight) {
              page = doc.addPage([pageWidth, pageHeight]);
              y = pageHeight - margin;
            }
            if (currentLine) {
              page.drawText(currentLine, { x: margin, y, font: currentFont, size: fontSize, color: rgb(0.15, 0.15, 0.15) });
            }
            y -= isHeading ? lineHeight * 1.5 : lineHeight;
          }
        }

        const pdfBytes = await doc.save();
        const pdfBuffer = Buffer.from(pdfBytes);
        /* 自動上傳到雲端 */
        const { saveToCloud } = await import("@/services/cloud-storage");
        const cloudResult = await saveToCloud(pdfBuffer, `${title}.pdf`, "application/pdf", userId);
        return {
          ok: true,
          data: cloudResult.saved
            ? `PDF created: **${cloudResult.fileName}**\nURL: ${cloudResult.url}`
            : cloudResult.base64,
          url: cloudResult.url,
          summary: {
            pages: doc.getPageCount(),
            size: pdfBytes.length,
            title,
            storage: cloudResult.storage,
          },
        };
      } catch (err) {
        return { ok: false, error: `PDF 建立失敗: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    case "merge_pdf": {
      /* 合併多個 PDF（從 URL 列表下載後合併） */
      const urls = params.urls as string[];
      if (!urls || !Array.isArray(urls) || urls.length < 2) {
        return { ok: false, error: "urls array with at least 2 PDF URLs is required" };
      }

      try {
        const { PDFDocument } = await import("pdf-lib");
        const mergedDoc = await PDFDocument.create();

        for (const url of urls) {
          const res = await fetch(url);
          if (!res.ok) return { ok: false, error: `Failed to download: ${url} (${res.status})` };
          const buffer = await res.arrayBuffer();
          const srcDoc = await PDFDocument.load(buffer);
          const pages = await mergedDoc.copyPages(srcDoc, srcDoc.getPageIndices());
          for (const page of pages) {
            mergedDoc.addPage(page);
          }
        }

        const pdfBytes = await mergedDoc.save();
        const pdfBuffer = Buffer.from(pdfBytes);
        /* 自動上傳到雲端 */
        const { saveToCloud: saveToCloud2 } = await import("@/services/cloud-storage");
        const cloudResult = await saveToCloud2(pdfBuffer, `merged_${Date.now()}.pdf`, "application/pdf", userId);
        return {
          ok: true,
          data: cloudResult.saved
            ? `PDF merged: **${cloudResult.fileName}** (${mergedDoc.getPageCount()} pages)\nURL: ${cloudResult.url}`
            : cloudResult.base64,
          url: cloudResult.url,
          summary: {
            pages: mergedDoc.getPageCount(),
            size: pdfBytes.length,
            mergedFrom: urls.length,
            storage: cloudResult.storage,
          },
        };
      } catch (err) {
        return { ok: false, error: `PDF 合併失敗: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    case "pdf_info": {
      /* 取得 PDF 基本資訊（頁數、標題、作者等） */
      const url = params.url as string;
      if (!url) return { ok: false, error: "url is required" };

      try {
        const res = await fetch(url);
        if (!res.ok) return { ok: false, error: `Failed to download PDF: ${res.status}` };
        const buffer = Buffer.from(await res.arrayBuffer());

        const pdfParse = (await import("pdf-parse")).default;
        const parsed = await pdfParse(buffer);
        return {
          ok: true,
          data: {
            pages: parsed.numpages,
            title: parsed.info?.Title || null,
            author: parsed.info?.Author || null,
            creator: parsed.info?.Creator || null,
            producer: parsed.info?.Producer || null,
            creationDate: parsed.info?.CreationDate || null,
            characters: parsed.text.length,
          },
        };
      } catch (err) {
        return { ok: false, error: `PDF 資訊讀取失敗: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    // ── QR Code 生成 ──
    case "create_qr": {
      const text = params.text as string;
      if (!text) return { ok: false, error: "text is required" };
      const size = (params.size as number) || 300;

      try {
        const QRCode = (await import("qrcode")).default;
        const pngBuffer = await QRCode.toBuffer(text, {
          width: size,
          margin: 2,
          color: { dark: "#000000", light: "#FFFFFF" },
        });

        const { saveToCloud } = await import("@/services/cloud-storage");
        const cloudResult = await saveToCloud(
          pngBuffer,
          `qr_${Date.now()}.png`,
          "image/png",
          userId,
        );

        return {
          ok: true,
          data: cloudResult.saved
            ? `QR Code created!\nContent: ${text}\nURL: ${cloudResult.url}`
            : cloudResult.base64,
          url: cloudResult.url,
          summary: { text, size, storage: cloudResult.storage },
        };
      } catch (err) {
        return { ok: false, error: `QR Code 生成失敗: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    // ── 圖片處理（resize / compress / convert / watermark） ──
    case "process_image": {
      const url = params.url as string;
      const ops = params.operations as Array<{
        type: "resize" | "compress" | "convert" | "watermark";
        width?: number;
        height?: number;
        quality?: number;
        format?: string;
        text?: string;
      }>;
      if (!url) return { ok: false, error: "url is required" };
      if (!ops || !Array.isArray(ops) || ops.length === 0) {
        return { ok: false, error: "operations array is required. Example: [{type:\"resize\",width:800}]" };
      }

      try {
        /* 下載原圖 */
        const res = await fetch(url);
        if (!res.ok) return { ok: false, error: `Failed to download image: ${res.status}` };
        const imageBuffer = Buffer.from(await res.arrayBuffer());

        const sharp = (await import("sharp")).default;
        let pipeline = sharp(imageBuffer);
        let outputFormat = "png";

        /* 依序套用操作 */
        for (const op of ops) {
          switch (op.type) {
            case "resize":
              pipeline = pipeline.resize(op.width || undefined, op.height || undefined, { fit: "inside" });
              break;
            case "compress":
              pipeline = pipeline.png({ quality: op.quality || 80 });
              break;
            case "convert":
              outputFormat = op.format || "png";
              if (outputFormat === "jpg" || outputFormat === "jpeg") {
                pipeline = pipeline.jpeg({ quality: op.quality || 85 });
                outputFormat = "jpeg";
              } else if (outputFormat === "webp") {
                pipeline = pipeline.webp({ quality: op.quality || 85 });
              } else {
                pipeline = pipeline.png();
              }
              break;
            case "watermark":
              if (op.text) {
                /* 用 SVG 疊加浮水印文字 */
                const meta = await sharp(imageBuffer).metadata();
                const w = meta.width || 800;
                const h = meta.height || 600;
                const svgWatermark = `<svg width="${w}" height="${h}">
                  <text x="50%" y="50%" font-size="48" fill="rgba(0,0,0,0.15)"
                    text-anchor="middle" dominant-baseline="middle"
                    transform="rotate(-30 ${w / 2} ${h / 2})">${op.text}</text>
                </svg>`;
                pipeline = pipeline.composite([{ input: Buffer.from(svgWatermark), blend: "over" }]);
              }
              break;
          }
        }

        const resultBuffer = await pipeline.toBuffer();
        const mimeType = outputFormat === "jpeg" ? "image/jpeg" : outputFormat === "webp" ? "image/webp" : "image/png";
        const ext = outputFormat === "jpeg" ? "jpg" : outputFormat;

        const { saveToCloud } = await import("@/services/cloud-storage");
        const cloudResult = await saveToCloud(
          resultBuffer,
          `processed_${Date.now()}.${ext}`,
          mimeType,
          userId,
        );

        return {
          ok: true,
          data: cloudResult.saved
            ? `Image processed! (${ops.map(o => o.type).join(" → ")})\nURL: ${cloudResult.url}`
            : cloudResult.base64,
          url: cloudResult.url,
          summary: {
            operations: ops.map(o => o.type),
            originalSize: imageBuffer.length,
            resultSize: resultBuffer.length,
            storage: cloudResult.storage,
          },
        };
      } catch (err) {
        return { ok: false, error: `圖片處理失敗: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    // ── 圖表生成 PNG ──
    case "create_chart": {
      const chartType = (params.type as string) || "bar";
      const labels = params.labels as string[];
      const datasets = params.datasets as Array<{ label: string; data: number[]; color?: string }>;
      const chartTitle = params.title as string | undefined;

      if (!labels || !datasets) {
        return { ok: false, error: "labels and datasets are required. Example: labels:[\"A\",\"B\"], datasets:[{label:\"Sales\",data:[10,20]}]" };
      }

      try {
        const { ChartJSNodeCanvas } = await import("chartjs-node-canvas");
        const width = (params.width as number) || 800;
        const height = (params.height as number) || 500;
        const chartCanvas = new ChartJSNodeCanvas({ width, height, backgroundColour: "white" });

        /* 預設顏色 */
        const defaultColors = [
          "rgba(54,162,235,0.7)", "rgba(255,99,132,0.7)", "rgba(75,192,192,0.7)",
          "rgba(255,206,86,0.7)", "rgba(153,102,255,0.7)", "rgba(255,159,64,0.7)",
        ];

        const chartConfig = {
          type: chartType as "bar" | "line" | "pie" | "doughnut" | "radar",
          data: {
            labels,
            datasets: datasets.map((ds, i) => ({
              label: ds.label,
              data: ds.data,
              backgroundColor: ds.color || defaultColors[i % defaultColors.length],
              borderColor: (ds.color || defaultColors[i % defaultColors.length]).replace("0.7", "1"),
              borderWidth: 2,
            })),
          },
          options: {
            responsive: false,
            plugins: {
              title: chartTitle ? { display: true, text: chartTitle, font: { size: 18 } } : undefined,
              legend: { display: datasets.length > 1 },
            },
          },
        };

        const chartBuffer = await chartCanvas.renderToBuffer(chartConfig as Parameters<typeof chartCanvas.renderToBuffer>[0]);

        const { saveToCloud } = await import("@/services/cloud-storage");
        const cloudResult = await saveToCloud(
          chartBuffer,
          `chart_${chartType}_${Date.now()}.png`,
          "image/png",
          userId,
        );

        return {
          ok: true,
          data: cloudResult.saved
            ? `Chart created! (${chartType}${chartTitle ? `: ${chartTitle}` : ""})\nURL: ${cloudResult.url}`
            : cloudResult.base64,
          url: cloudResult.url,
          summary: {
            type: chartType,
            title: chartTitle,
            dataPoints: labels.length,
            datasets: datasets.length,
            storage: cloudResult.storage,
          },
        };
      } catch (err) {
        return { ok: false, error: `圖表生成失敗: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    // ── SVG → PNG 轉換 ──
    case "svg_to_png": {
      const svg = params.svg as string;
      if (!svg) return { ok: false, error: "svg (SVG code string) is required" };

      try {
        const sharp = (await import("sharp")).default;
        const width = (params.width as number) || undefined;
        const height = (params.height as number) || undefined;

        let pipeline = sharp(Buffer.from(svg));
        if (width || height) {
          pipeline = pipeline.resize(width, height);
        }
        const pngBuffer = await pipeline.png().toBuffer();

        const { saveToCloud } = await import("@/services/cloud-storage");
        const cloudResult = await saveToCloud(
          pngBuffer,
          `svg_${Date.now()}.png`,
          "image/png",
          userId,
        );

        return {
          ok: true,
          data: cloudResult.saved
            ? `SVG converted to PNG!\nURL: ${cloudResult.url}`
            : cloudResult.base64,
          url: cloudResult.url,
          summary: { size: pngBuffer.length, storage: cloudResult.storage },
        };
      } catch (err) {
        return { ok: false, error: `SVG → PNG 轉換失敗: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    // ── DOCX → Markdown ──
    case "docx_to_markdown": {
      const url = params.url as string;
      if (!url) return { ok: false, error: "url (DOCX file URL) is required" };

      try {
        const res = await fetch(url);
        if (!res.ok) return { ok: false, error: `Failed to download DOCX: ${res.status}` };
        const buffer = Buffer.from(await res.arrayBuffer());

        const mammoth = await import("mammoth");
        /* 先轉 HTML，再簡易轉 Markdown */
        const htmlResult = await mammoth.convertToHtml({ buffer });
        const html = htmlResult.value;

        /* 簡易 HTML → Markdown 轉換 */
        const md = html
          .replace(/<h1[^>]*>(.*?)<\/h1>/gi, "# $1\n")
          .replace(/<h2[^>]*>(.*?)<\/h2>/gi, "## $1\n")
          .replace(/<h3[^>]*>(.*?)<\/h3>/gi, "### $1\n")
          .replace(/<h4[^>]*>(.*?)<\/h4>/gi, "#### $1\n")
          .replace(/<strong>(.*?)<\/strong>/gi, "**$1**")
          .replace(/<b>(.*?)<\/b>/gi, "**$1**")
          .replace(/<em>(.*?)<\/em>/gi, "*$1*")
          .replace(/<i>(.*?)<\/i>/gi, "*$1*")
          .replace(/<li>(.*?)<\/li>/gi, "- $1\n")
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<p>(.*?)<\/p>/gi, "$1\n\n")
          .replace(/<[^>]+>/g, "") // 移除剩餘的 HTML 標籤
          .replace(/\n{3,}/g, "\n\n") // 壓縮多餘換行
          .trim();

        return {
          ok: true,
          data: md,
          summary: {
            characters: md.length,
            warnings: htmlResult.messages.length > 0
              ? htmlResult.messages.map((m: { message: string }) => m.message).slice(0, 3)
              : undefined,
          },
        };
      } catch (err) {
        return { ok: false, error: `DOCX → Markdown 轉換失敗: ${err instanceof Error ? err.message : String(err)}` };
      }
    }

    // ── DOCX → HTML ──
    case "docx_to_html": {
      const url = params.url as string;
      if (!url) return { ok: false, error: "url (DOCX file URL) is required" };

      try {
        const res = await fetch(url);
        if (!res.ok) return { ok: false, error: `Failed to download DOCX: ${res.status}` };
        const buffer = Buffer.from(await res.arrayBuffer());

        const mammoth = await import("mammoth");
        const result = await mammoth.convertToHtml({ buffer });

        return {
          ok: true,
          data: result.value,
          summary: {
            characters: result.value.length,
            warnings: result.messages.length > 0
              ? result.messages.map((m: { message: string }) => m.message).slice(0, 3)
              : undefined,
          },
        };
      } catch (err) {
        return { ok: false, error: `DOCX → HTML 轉換失敗: ${err instanceof Error ? err.message : String(err)}` };
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
