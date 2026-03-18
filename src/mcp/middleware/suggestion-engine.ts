// ============================================================
// J4 + I8 修正版：Suggestion 智慧化引擎
//
// 核心修正：AI 完全無視 suggestions 欄位（跟人類忽略垃圾通知一樣）
// 新設計：
// 1. 重要提示插入 data 最前面（AI 在解析結果時必讀）
// 2. 分出 ai_hints（給 AI 決策）和 user_notices（要轉達使用者）
// 3. 加門檻：重複 5 次以上才推，推過一次不再推（除非次數翻倍）
// 4. suggestions 欄位降級為向下相容用
// ============================================================

/** Session 內已推送的 hint hash（避免重複） */
const sessionHints = new Map<string, Set<string>>();
/** 已推送 hint 的觸發次數（門檻翻倍邏輯） */
const hintPushedAt = new Map<string, Map<string, number>>();
/** Session 最後活動時間 */
const sessionLastSeen = new Map<string, number>();
/** Session 過期時間（30 分鐘） */
const SESSION_TTL_MS = 30 * 60 * 1000;
/** 重複模式觸發門檻（至少 5 次才推） */
const SOP_THRESHOLD = 5;

/** 跨 App 下一步提示規則 */
const CROSS_APP_HINTS: Array<{
  triggerApp: string;
  triggerAction: RegExp;
  hint: string;
  type: "ai" | "user"; // ai_hints 或 user_notices
}> = [
  {
    triggerApp: "google_calendar",
    triggerAction: /create_event/,
    hint: "剛建立了行事曆事件。要在 Notion 建立對應的會議筆記嗎？→ octodock_do(app:\"notion\", action:\"create_page\")",
    type: "user",
  },
  {
    triggerApp: "gmail",
    triggerAction: /search|read/,
    hint: "要把這封信的重點存到 Notion 嗎？→ octodock_do(app:\"notion\", action:\"create_page\")",
    type: "user",
  },
  {
    triggerApp: "notion",
    triggerAction: /create_page/,
    hint: "要建立對應的 Google Tasks 追蹤嗎？→ octodock_do(app:\"google_tasks\", action:\"create_task\")",
    type: "user",
  },
  {
    triggerApp: "github",
    triggerAction: /create_issue/,
    hint: "要在 Notion 記錄這個 Issue 的追蹤嗎？→ octodock_do(app:\"notion\", action:\"create_page\")",
    type: "user",
  },
];

/** 簡單 hash 函式 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return String(hash);
}

/** 清理過期 session */
function cleanupSessions(): void {
  const now = Date.now();
  for (const [key, lastSeen] of sessionLastSeen) {
    if (now - lastSeen > SESSION_TTL_MS) {
      sessionHints.delete(key);
      hintPushedAt.delete(key);
      sessionLastSeen.delete(key);
    }
  }
}

/** 檢查 hint 是否應該推送（門檻 + 翻倍邏輯） */
function shouldPushHint(userId: string, hintHash: string, triggerCount?: number): boolean {
  if (!hintPushedAt.has(userId)) hintPushedAt.set(userId, new Map());
  const pushed = hintPushedAt.get(userId)!;

  // 門檻：SOP 類的 hint 需要觸發次數 >= 5
  if (triggerCount !== undefined && triggerCount < SOP_THRESHOLD) return false;

  // 已推過 → 除非次數翻倍，否則不再推
  const lastCount = pushed.get(hintHash);
  if (lastCount !== undefined) {
    if (triggerCount === undefined || triggerCount < lastCount * 2) return false;
  }

  // 記錄推送時的觸發次數
  pushed.set(hintHash, triggerCount ?? 1);
  return true;
}

/** 智慧化引擎的輸出 */
export interface SmartHints {
  /** 插入 data 最前面的重要提示（AI 必讀） */
  dataPrefix?: string;
  /** 給 AI 的決策輔助 */
  ai_hints: string[];
  /** 要轉達給使用者的通知 */
  user_notices: string[];
  /** 向下相容的 suggestions（降級用） */
  suggestions: string[];
}

/**
 * 產生智慧化的 hints
 *
 * @param userId 用戶 ID
 * @param app 當前操作的 App
 * @param action 當前操作的 action
 * @param existingSuggestions 已有的 suggestions（如 SOP 建議）
 * @returns 智慧化的 hints 結構
 */
export function buildSmartHints(
  userId: string,
  app: string,
  action: string,
  existingSuggestions?: string[],
): SmartHints {
  // 定期清理過期 session
  if (Math.random() < 0.1) cleanupSessions();

  const sessionKey = userId;
  sessionLastSeen.set(sessionKey, Date.now());
  if (!sessionHints.has(sessionKey)) {
    sessionHints.set(sessionKey, new Set());
  }
  const seen = sessionHints.get(sessionKey)!;

  const result: SmartHints = {
    ai_hints: [],
    user_notices: [],
    suggestions: [],
  };

  // SOP 建議已靜默自動存，不再透過 suggestions 推送
  // existingSuggestions 在新設計下通常為空

  // 跨 App 下一步提示（唯一保留的主動推送機制）
  for (const hint of CROSS_APP_HINTS) {
    if (hint.triggerApp === app && hint.triggerAction.test(action)) {
      const hash = simpleHash(hint.hint);
      if (!seen.has(hash)) {
        seen.add(hash);
        if (hint.type === "ai") {
          result.ai_hints.push(hint.hint);
        } else {
          result.user_notices.push(hint.hint);
        }
      }
    }
  }

  // 向下相容：把所有 hints 也放進 suggestions
  result.suggestions = [...result.ai_hints, ...result.user_notices];

  return result;
}

// ── 向下相容 export（舊 API）──
export function buildSuggestions(
  userId: string,
  app: string,
  action: string,
  existingSuggestions?: string[],
): string[] {
  return buildSmartHints(userId, app, action, existingSuggestions).suggestions;
}
