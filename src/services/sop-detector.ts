import { db } from "@/db";
import { operations } from "@/db/schema";
import { eq, and, gte } from "drizzle-orm";

// ============================================================
// SOP 自動辨識引擎（Phase 8）
// 從用戶的操作記錄中自動偵測重複的操作流程
//
// I8/J4 最終修正：偵測到重複 pattern → 靜默自動存成 SOP
// 不問、不提示、不通知。AI 不會看通知，存就存了。
// 下次 AI 做類似事時自然會從 SOP 裡找到。
// ============================================================

/** SOP 候選建議（保留介面向下相容） */
export interface SopSuggestion {
  type: "sop_candidate";
  message: string;
  pattern: string[];
  frequency: number;
}

/** 觸發偵測的最低重複次數 */
const MIN_REPEAT_COUNT = 3;

/** 分析的時間窗口（最近 14 天） */
const ANALYSIS_WINDOW_DAYS = 14;

/** 單次 session 的最大時間間隔（分鐘）— 超過這個間隔視為新 session */
const SESSION_GAP_MINUTES = 30;

/**
 * 檢查用戶是否有重複的操作模式，回傳 SOP 候選建議
 * 在每次 octodock_do 完成後呼叫，如果偵測到候選 SOP 就附在回傳裡
 *
 * @param userId 用戶 ID
 * @returns SOP 候選建議，或 null
 */
export async function detectSopCandidate(
  userId: string,
): Promise<SopSuggestion | null> {
  try {
    const since = new Date();
    since.setDate(since.getDate() - ANALYSIS_WINDOW_DAYS);

    // 取得最近的操作記錄（含 params，用於統計常用參數）
    const recentOps = await db
      .select({
        appName: operations.appName,
        action: operations.action,
        params: operations.params,
        createdAt: operations.createdAt,
      })
      .from(operations)
      .where(
        and(
          eq(operations.userId, userId),
          eq(operations.success, true),
          gte(operations.createdAt, since),
        ),
      )
      .orderBy(operations.createdAt)
      .limit(200);

    if (recentOps.length < MIN_REPEAT_COUNT * 2) return null;

    // 按 session 分組（30 分鐘間隔 = 新 session）
    const sessions = groupIntoSessions(recentOps);
    if (sessions.length < MIN_REPEAT_COUNT) return null;

    // 提取每個 session 的 app.action 序列
    const sequences = sessions.map((session) =>
      session.map((op) => `${op.appName}.${op.action}`),
    );

    // 找出重複出現的子序列
    const candidate = findRepeatingPattern(sequences);
    if (!candidate) return null;

    // 過濾太短的模式（至少 2 步）
    if (candidate.pattern.length < 2) return null;

    // P: SOP 命名 — 最終動作 + 目標物件（人話）
    // 中間步驟（search、get_page 等）是手段不是目的，不出現在名稱裡
    const VERB_MAP: Record<string, string> = {
      create_page: "建立頁面", append_content: "追加內容", replace_content: "替換內容",
      send: "寄信", create_event: "建立事件", create_task: "建立任務",
      create_issue: "建立 Issue", delete_page: "刪除頁面", create: "建立",
      update: "更新", delete: "刪除", search: "搜尋", get: "讀取",
    };
    const lastStep = candidate.pattern[candidate.pattern.length - 1];
    const [lastApp, lastAction] = lastStep.split(".");
    const verb = VERB_MAP[lastAction] ?? lastAction;
    const sopName = `${lastApp}: ${verb}`;  // 例如 "notion: 追加內容"

    // I8/J4 最終修正：靜默自動存成 SOP，不問不提示
    // U15: 存 SOP 前比對現有 SOP 的 action 序列，避免重複
    const patternKey = candidate.pattern.join(" → ");
    try {
      const { storeMemory, queryMemory, listMemory: lm } = await import("@/services/memory-engine");

      // U15: 去重 — 比對現有 SOP 的 action 序列
      const existingSops = await lm(userId, "sop");
      const candidateSequence = candidate.pattern.join(" → ");
      const isDuplicate = existingSops.some((sop) => {
        // 從 SOP 內容提取步驟序列
        const stepMatches = sop.value.match(/`octodock_do\(app:"([^"]+)", action:"([^"]+)"\)`/g);
        if (!stepMatches) return false;
        const existingSequence = stepMatches.map((m) => {
          const appMatch = m.match(/app:"([^"]+)"/);
          const actionMatch = m.match(/action:"([^"]+)"/);
          return `${appMatch?.[1]}.${actionMatch?.[1]}`;
        }).join(" → ");
        return existingSequence === candidateSequence;
      });

      if (isDuplicate) {
        // 已有相同序列的 SOP，跳過
        return null;
      }

      // V8: 檢查是否已存過同名的 SOP，有重名就加數字後綴
      let finalSopName = sopName;
      const existing = await queryMemory(userId, sopName, "sop");
      if (existing.find((r) => r.key === sopName)) {
        // 找到可用的數字後綴（例如 "notion: 追加內容 2"）
        let suffix = 2;
        while (existing.find((r) => r.key === `${sopName} ${suffix}`)) {
          suffix++;
        }
        finalSopName = `${sopName} ${suffix}`;
      }
      if (!existing.find((r) => r.key === finalSopName)) {
        // 統計每一步最常用的參數，區分固定值和動態值
        const stepParams = analyzeStepParams(recentOps, candidate.pattern);

        // 用最終 action 推斷流程描述
        const sopDescription = inferSopDescription(candidate.pattern);

        // 自動產生 SOP 內容（Markdown 格式，含參數建議）
        const sopContent = [
          `# ${finalSopName}`,
          ``,
          sopDescription,
          `自動偵測的操作流程（出現 ${candidate.count} 次）`,
          `序列：${patternKey}`,
          ``,
          `## 步驟`,
          ...candidate.pattern.map((p, i) => {
            const [app, action] = p.split(".");
            const paramHints = stepParams[i];
            if (paramHints && paramHints.length > 0) {
              const paramStr = paramHints.map((h) =>
                h.isDynamic ? `${h.key}: <${h.description}>` : `${h.key}: "${h.value}"`,
              ).join(", ");
              return `${i + 1}. \`octodock_do(app:"${app}", action:"${action}", params:{${paramStr}})\``;
            }
            return `${i + 1}. \`octodock_do(app:"${app}", action:"${action}")\``;
          }),
          ``,
          `---`,
          `*自動產生於 ${new Date().toISOString().substring(0, 10)}*`,
        ].join("\n");
        await storeMemory(userId, finalSopName, sopContent, "sop");
      }
    } catch (err) {
      console.error("Auto SOP creation failed:", err);
    }

    // 回傳 null — 不再產生 suggestion 推給 AI
    return null;
  } catch {
    return null;
  }
}

// ============================================================
// 內部工具函式
// ============================================================

interface OpRecord {
  appName: string;
  action: string;
  params: unknown;
  createdAt: Date | null;
}

/** 按時間間隔將操作分組為 sessions */
function groupIntoSessions(ops: OpRecord[]): OpRecord[][] {
  const sessions: OpRecord[][] = [];
  let currentSession: OpRecord[] = [];

  for (let i = 0; i < ops.length; i++) {
    if (i === 0) {
      currentSession.push(ops[i]);
      continue;
    }

    const prevTime = ops[i - 1].createdAt?.getTime() ?? 0;
    const currTime = ops[i].createdAt?.getTime() ?? 0;
    const gapMinutes = (currTime - prevTime) / (1000 * 60);

    if (gapMinutes > SESSION_GAP_MINUTES) {
      // 超過間隔，開啟新 session
      if (currentSession.length >= 2) {
        sessions.push(currentSession);
      }
      currentSession = [ops[i]];
    } else {
      currentSession.push(ops[i]);
    }
  }

  // 最後一個 session
  if (currentSession.length >= 2) {
    sessions.push(currentSession);
  }

  return sessions;
}

/** 找出在多個 session 中重複出現的操作子序列 */
function findRepeatingPattern(
  sequences: string[][],
): { pattern: string[]; count: number } | null {
  // 提取所有長度 >= 2 的子序列，計算出現次數
  const patternCounts = new Map<string, number>();

  for (const seq of sequences) {
    // 提取長度 2-5 的連續子序列
    const seen = new Set<string>(); // 同一個 session 不重複計數
    for (let len = 2; len <= Math.min(5, seq.length); len++) {
      for (let start = 0; start <= seq.length - len; start++) {
        const sub = seq.slice(start, start + len);
        const key = sub.join(" → ");
        if (!seen.has(key)) {
          seen.add(key);
          patternCounts.set(key, (patternCounts.get(key) ?? 0) + 1);
        }
      }
    }
  }

  // 找出出現次數 >= MIN_REPEAT_COUNT 的最長模式
  let best: { pattern: string[]; count: number } | null = null;

  for (const [key, count] of patternCounts.entries()) {
    if (count < MIN_REPEAT_COUNT) continue;
    const pattern = key.split(" → ");
    if (!best || pattern.length > best.pattern.length || (pattern.length === best.pattern.length && count > best.count)) {
      best = { pattern, count };
    }
  }

  return best;
}

// ============================================================
// 參數分析 — 從操作歷史統計每一步的常用參數
// ============================================================

/** 參數提示：固定值 or 動態值 */
interface ParamHint {
  key: string; // 參數名稱
  value: string; // 最常見的值（固定值）或空字串（動態值）
  isDynamic: boolean; // true = 每次不同（如 title），false = 固定值（如 repo）
  description: string; // 動態值的描述（如「每次不同的標題」）
}

/** 不該出現在 SOP 參數提示裡的大型內容欄位 */
const CONTENT_FIELDS = new Set([
  "content", "text", "body", "description", "message",
  "markdown", "html", "raw", "data", "payload", "children",
  "blocks", "rich_text", "caption",
]);

/**
 * 分析 pattern 中每一步最常用的參數
 * 從操作歷史裡找出匹配步驟的所有操作，統計參數值頻率
 * 固定值（> 70% 相同）直接填入，動態值（每次不同）標記為 <動態>
 */
function analyzeStepParams(
  allOps: OpRecord[],
  pattern: string[],
): ParamHint[][] {
  return pattern.map((step) => {
    const [app, action] = step.split(".");
    // 找出所有匹配這一步的操作
    const matchingOps = allOps.filter(
      (op) => op.appName === app && op.action === action && op.params,
    );
    if (matchingOps.length < 2) return [];

    // 統計每個參數 key 的值分佈
    const paramValues = new Map<string, Map<string, number>>();
    for (const op of matchingOps) {
      const params = op.params as Record<string, unknown> | null;
      if (!params) continue;
      for (const [key, val] of Object.entries(params)) {
        // 跳過大型內容欄位
        if (CONTENT_FIELDS.has(key)) continue;
        // 跳過值太長的（超過 100 字元視為內容）
        const strVal = typeof val === "string" ? val : JSON.stringify(val);
        if (strVal.length > 100) continue;

        if (!paramValues.has(key)) paramValues.set(key, new Map());
        const counts = paramValues.get(key)!;
        counts.set(strVal, (counts.get(strVal) ?? 0) + 1);
      }
    }

    // 判斷每個參數是固定值還是動態值
    const hints: ParamHint[] = [];
    for (const [key, counts] of paramValues.entries()) {
      const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
      // 找出最常見的值
      let topValue = "";
      let topCount = 0;
      for (const [val, cnt] of counts.entries()) {
        if (cnt > topCount) {
          topValue = val;
          topCount = cnt;
        }
      }

      const ratio = topCount / total;
      if (ratio >= 0.7) {
        // 固定值：> 70% 的操作用同一個值
        hints.push({ key, value: topValue, isDynamic: false, description: "" });
      } else if (counts.size >= 3) {
        // 動態值：有 3 種以上不同的值
        hints.push({ key, value: "", isDynamic: true, description: `每次不同` });
      }
    }

    // 固定值排前面，最多回傳 5 個參數提示
    hints.sort((a, b) => (a.isDynamic ? 1 : 0) - (b.isDynamic ? 1 : 0));
    return hints.slice(0, 5);
  });
}

/**
 * 從 pattern 推斷 SOP 描述（一句話說明流程目的）
 * 根據首尾動作推斷：search → create_page = 「搜尋後建立頁面」
 */
function inferSopDescription(pattern: string[]): string {
  if (pattern.length < 2) return "";

  const DESC_MAP: Record<string, string> = {
    search: "搜尋", get_page: "讀取頁面", get_file: "讀取檔案",
    create_page: "建立頁面", append_content: "追加內容", replace_content: "替換內容",
    send: "寄信", send_message: "發送訊息", create_event: "建立事件",
    create_task: "建立任務", create_issue: "建立 Issue",
    search_code: "搜尋程式碼", get_content: "讀取內容",
  };

  const firstAction = pattern[0].split(".")[1];
  const lastAction = pattern[pattern.length - 1].split(".")[1];
  const firstDesc = DESC_MAP[firstAction] ?? firstAction;
  const lastDesc = DESC_MAP[lastAction] ?? lastAction;

  // 跨 App 流程額外標注
  const apps = new Set(pattern.map((p) => p.split(".")[0]));
  const crossApp = apps.size > 1 ? `（跨 ${[...apps].join("+")}）` : "";

  return `${firstDesc}後${lastDesc}的標準流程${crossApp}`;
}
