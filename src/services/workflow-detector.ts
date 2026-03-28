import { db } from "@/db";
import { operations } from "@/db/schema";
import { eq, and, gte, desc } from "drizzle-orm";

// ============================================================
// 工作流自動辨識引擎
// 從用戶的操作記錄中偵測多步驟操作序列，自動存成工作流
// 不依賴 session 概念 — OctoDock 是無狀態的，只看操作序列
// ============================================================

/** 工作流候選建議 */
export interface WorkflowSuggestion {
  type: "workflow_candidate";
  message: string;
  pattern: string[];
  frequency: number;
}

/** 分析的時間窗口（最近 14 天） */
const ANALYSIS_WINDOW_DAYS = 14;

/** 候選序列的最小步數 */
const MIN_STEPS = 2;

/** 候選序列的最大步數 */
const MAX_STEPS = 5;

/**
 * 偵測用戶最近的操作是否構成多步驟工作流
 * 每次 octodock_do 完成後呼叫
 *
 * 邏輯：取最近的操作序列，從中提取 2-5 步的連續子序列
 * 找到最長的子序列，如果還沒存過就存成 workflow
 *
 * @param userId 用戶 ID
 * @returns null（靜默存，不推建議給 AI）
 */
export async function detectWorkflowCandidate(
  userId: string,
): Promise<WorkflowSuggestion | null> {
  try {
    const since = new Date();
    since.setDate(since.getDate() - ANALYSIS_WINDOW_DAYS);

    // 取最近的操作記錄（按時間倒序，取最新的一批）
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
      .orderBy(desc(operations.createdAt))
      .limit(50);

    if (recentOps.length < MIN_STEPS) return null;

    // 反轉為時間正序（舊→新），方便提取連續序列
    recentOps.reverse();

    // 轉成 app.action 序列
    const sequence = recentOps.map((op) => `${op.appName}.${op.action}`);

    // 從序列尾端（最新的操作）開始，取最長的 2-5 步子序列
    // 跳過全部操作都相同的序列（如連續 5 次 search），因為那不是有意義的工作流
    let candidate: { pattern: string[]; count: number } | null = null;

    for (let len = Math.min(MAX_STEPS, sequence.length); len >= MIN_STEPS; len--) {
      const sub = sequence.slice(sequence.length - len);
      // 跳過全是同一個操作的序列（例如連續 5 次 search 不是有意義的工作流）
      if (new Set(sub).size === 1) continue;
      candidate = { pattern: sub, count: 1 };
      break;
    }

    if (!candidate) return null;

    // ── 命名 ──
    const VERB_MAP: Record<string, string> = {
      create_page: "建立頁面", append_content: "追加內容", replace_content: "替換內容",
      send: "寄信", create_event: "建立事件", create_task: "建立任務",
      create_issue: "建立 Issue", delete_page: "刪除頁面", create: "建立",
      update: "更新", delete: "刪除", search: "搜尋", get: "讀取",
      get_page: "讀取頁面", get_file: "讀取檔案", insert_text: "寫入文字",
      append_text: "追加文字", send_message: "發送訊息", search_code: "搜尋程式碼",
    };
    const firstStep = candidate.pattern[0];
    const lastStep = candidate.pattern[candidate.pattern.length - 1];
    const [firstApp, firstAction] = firstStep.split(".");
    const [lastApp, lastAction] = lastStep.split(".");
    const firstVerb = VERB_MAP[firstAction] ?? firstAction;
    const lastVerb = VERB_MAP[lastAction] ?? lastAction;
    const workflowName = firstApp === lastApp
      ? `${firstApp}: ${firstVerb} → ${lastVerb}`
      : `${firstApp} ${firstVerb} → ${lastApp} ${lastVerb}`;

    // ── 存 workflow（去重 + 防重名） ──
    const patternKey = candidate.pattern.join(" → ");
    try {
      const { storeMemory, queryMemory, listMemory: lm } = await import("@/services/memory-engine");

      // 去重：比對現有 workflow 的 action 序列
      const existingWorkflows = await lm(userId, "workflow");
      const candidateSequence = candidate.pattern.join(" → ");
      const isDuplicate = existingWorkflows.some((wf) => {
        const stepMatches = wf.value.match(/`octodock_do\(app:"([^"]+)", action:"([^"]+)"\)`/g);
        if (!stepMatches) return false;
        const existingSequence = stepMatches.map((m) => {
          const appMatch = m.match(/app:"([^"]+)"/);
          const actionMatch = m.match(/action:"([^"]+)"/);
          return `${appMatch?.[1]}.${actionMatch?.[1]}`;
        }).join(" → ");
        return existingSequence === candidateSequence;
      });

      if (isDuplicate) return null;

      // 防重名：有重名就加數字後綴
      let finalWorkflowName = workflowName;
      const existing = await queryMemory(userId, workflowName, "workflow");
      if (existing.find((r) => r.key === workflowName)) {
        let suffix = 2;
        while (existing.find((r) => r.key === `${workflowName} ${suffix}`)) {
          suffix++;
        }
        finalWorkflowName = `${workflowName} ${suffix}`;
      }

      if (!existing.find((r) => r.key === finalWorkflowName)) {
        // 統計每一步最常用的參數
        const stepParams = analyzeStepParams(recentOps, candidate.pattern);
        const workflowDescription = inferWorkflowDescription(candidate.pattern);

        const workflowContent = [
          `# ${finalWorkflowName}`,
          ``,
          workflowDescription,
          `自動偵測的操作流程`,
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
        await storeMemory(userId, finalWorkflowName, workflowContent, "workflow");
      }
    } catch (err) {
      console.error("Auto workflow creation failed:", err);
    }

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

/** 參數提示：固定值 or 動態值 */
interface ParamHint {
  key: string;       // 參數名稱
  value: string;     // 最常見的值（固定值）或空字串（動態值）
  isDynamic: boolean; // true = 每次不同（如 title），false = 固定值（如 repo）
  description: string; // 動態值的描述（如「每次不同」）
}

/** 不該出現在 workflow 參數提示裡的大型內容欄位 */
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
        if (CONTENT_FIELDS.has(key)) continue; // 跳過大型內容欄位
        const strVal = typeof val === "string" ? val : JSON.stringify(val);
        if (strVal.length > 100) continue; // 跳過值太長的（超過 100 字元視為內容）
        if (!paramValues.has(key)) paramValues.set(key, new Map());
        const counts = paramValues.get(key)!;
        counts.set(strVal, (counts.get(strVal) ?? 0) + 1);
      }
    }

    // 判斷每個參數是固定值還是動態值
    const hints: ParamHint[] = [];
    for (const [key, counts] of paramValues.entries()) {
      const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
      let topValue = "";
      let topCount = 0;
      for (const [val, cnt] of counts.entries()) {
        if (cnt > topCount) { topValue = val; topCount = cnt; }
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
 * 從 pattern 推斷 workflow 描述（一句話說明流程目的）
 * 根據首尾動作推斷：search → create_page = 「搜尋後建立頁面」
 */
function inferWorkflowDescription(pattern: string[]): string {
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

  return `${firstDesc}後${lastDesc}的操作流程${crossApp}`;
}
