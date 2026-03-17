/**
 * 組合技 Registry
 * 每個組合技的 prerequisites 必須引用實際存在的 adapter + action
 * 啟動時自動驗證，不合法的組合技不註冊
 */

import { loadAdapters, getAllAdapters } from "@/mcp/registry";

/* ── 類型定義 ── */

/** 組合技前置條件：指定 App 的指定 action */
export interface ComboPrerequisite {
  app: string;
  action: string;
}

/** 組合技定義 */
export interface ComboDefinition {
  id: string;
  name: { zh: string; en: string };
  description: { zh: string; en: string };
  prerequisites: ComboPrerequisite[];
}

/** 組合技 API 回傳（帶即時計算的 unlocked 狀態） */
export interface ComboResult extends ComboDefinition {
  unlocked: boolean;
}

/* ── 組合技定義清單 ── */
/* 每個 prerequisite 的 app + action 都必須在對應 adapter 的 actionMap 裡找得到 */

const COMBO_DEFINITIONS: ComboDefinition[] = [
  {
    id: "combo-email-archive",
    name: { zh: "信件摘要歸檔", en: "Email Summary Archive" },
    description: {
      zh: "搜尋 Gmail 信件、讀取內容，自動摘要後建立 Notion 頁面歸檔",
      en: "Search and read Gmail emails, summarize and archive to Notion",
    },
    prerequisites: [
      { app: "gmail", action: "search" },
      { app: "gmail", action: "read" },
      { app: "notion", action: "create_page" },
    ],
  },
  {
    id: "combo-meeting-prep",
    name: { zh: "會議準備助手", en: "Meeting Prep Assistant" },
    description: {
      zh: "查詢日曆事件，搜尋 Drive 相關文件，發送準備郵件給與會者",
      en: "Query calendar events, search Drive for related docs, send prep emails",
    },
    prerequisites: [
      { app: "google_calendar", action: "get_events" },
      { app: "google_drive", action: "search" },
      { app: "gmail", action: "send" },
    ],
  },
  {
    id: "combo-task-from-email",
    name: { zh: "信件轉待辦", en: "Email to Task" },
    description: {
      zh: "讀取 Gmail 信件，自動建立 Google Tasks 待辦事項",
      en: "Read Gmail emails and create Google Tasks items automatically",
    },
    prerequisites: [
      { app: "gmail", action: "read" },
      { app: "google_tasks", action: "create_task" },
    ],
  },
  {
    id: "combo-meeting-notes",
    name: { zh: "會議紀錄同步", en: "Meeting Notes Sync" },
    description: {
      zh: "查詢日曆事件，在 Notion 建立會議紀錄頁面，自動帶入時間與參與者",
      en: "Query calendar events and create meeting notes in Notion",
    },
    prerequisites: [
      { app: "google_calendar", action: "get_events" },
      { app: "notion", action: "create_page" },
    ],
  },
  {
    id: "combo-drive-to-notion",
    name: { zh: "Drive 文件轉 Notion", en: "Drive Doc to Notion" },
    description: {
      zh: "下載 Google Drive 文件內容，自動建立對應的 Notion 頁面",
      en: "Download Drive file content and create corresponding Notion page",
    },
    prerequisites: [
      { app: "google_drive", action: "download" },
      { app: "notion", action: "create_page" },
    ],
  },
  {
    id: "combo-spreadsheet-report",
    name: { zh: "試算表報告產生", en: "Spreadsheet Report Generator" },
    description: {
      zh: "讀取 Google Sheets 資料，在 Google Docs 建立格式化報告",
      en: "Read Sheets data and create formatted report in Google Docs",
    },
    prerequisites: [
      { app: "google_sheets", action: "read" },
      { app: "google_docs", action: "create" },
      { app: "google_docs", action: "append_text" },
    ],
  },
  {
    id: "combo-github-pr-notify",
    name: { zh: "PR 通知信", en: "PR Email Notification" },
    description: {
      zh: "查詢 GitHub PR 清單，自動發送審查提醒郵件",
      en: "List GitHub PRs and send review reminder emails",
    },
    prerequisites: [
      { app: "github", action: "list_prs" },
      { app: "gmail", action: "send" },
    ],
  },
  {
    id: "combo-youtube-to-notion",
    name: { zh: "影片筆記", en: "Video Notes" },
    description: {
      zh: "取得 YouTube 影片資訊與留言，在 Notion 建立筆記頁面",
      en: "Get YouTube video info and comments, create notes in Notion",
    },
    prerequisites: [
      { app: "youtube", action: "get_video" },
      { app: "youtube", action: "get_comments" },
      { app: "notion", action: "create_page" },
    ],
  },
  {
    id: "combo-issue-tracker",
    name: { zh: "Issue 追蹤看板", en: "Issue Tracker Board" },
    description: {
      zh: "查詢 GitHub Issues，同步到 Notion 資料庫作為追蹤看板",
      en: "Query GitHub issues and sync to Notion database as tracker",
    },
    prerequisites: [
      { app: "github", action: "list_issues" },
      { app: "notion", action: "query_database" },
      { app: "notion", action: "create_database_item" },
    ],
  },
  {
    id: "combo-daily-briefing",
    name: { zh: "每日簡報", en: "Daily Briefing" },
    description: {
      zh: "整合今日日曆事件、未完成待辦、未讀信件，產生每日簡報",
      en: "Combine today's calendar, pending tasks, and unread emails into daily briefing",
    },
    prerequisites: [
      { app: "google_calendar", action: "get_events" },
      { app: "google_tasks", action: "list_tasks" },
      { app: "gmail", action: "search" },
    ],
  },
];

/* ── 驗證與載入 ── */

/** 已驗證的組合技（啟動時填充） */
let validatedCombos: ComboDefinition[] = [];

/**
 * 載入並驗證所有組合技
 * 逐條檢查 prerequisites 裡的 {app, action} 是否存在於 adapter 的 actionMap
 * 不合法的組合技跳過不註冊
 */
export async function loadCombos(): Promise<void> {
  await loadAdapters();
  const adapters = getAllAdapters();

  /* 建立 app → actionMap keys 的快速查詢表 */
  const actionIndex = new Map<string, Set<string>>();
  for (const adapter of adapters) {
    actionIndex.set(adapter.name, new Set(Object.keys(adapter.actionMap)));
  }

  /* 驗證每個組合技 */
  const valid: ComboDefinition[] = [];
  for (const combo of COMBO_DEFINITIONS) {
    let allValid = true;
    for (const prereq of combo.prerequisites) {
      const actions = actionIndex.get(prereq.app);
      if (!actions || !actions.has(prereq.action)) {
        console.warn(
          `[Combo Registry] 跳過 "${combo.id}"：找不到 ${prereq.app}.${prereq.action}`,
        );
        allValid = false;
        break;
      }
    }
    if (allValid) {
      valid.push(combo);
    }
  }

  validatedCombos = valid;
  console.log(
    `[Combo Registry] 載入 ${valid.length}/${COMBO_DEFINITIONS.length} 個組合技`,
  );
}

/**
 * 取得所有已驗證的組合技，並根據用戶已連接的 App 計算 unlocked 狀態
 * @param connectedAppNames 用戶已連接的 App 名稱 Set
 */
export function getCombosWithStatus(connectedAppNames: Set<string>): ComboResult[] {
  return validatedCombos.map((combo) => {
    /* 所有前置條件的 App 都已連接 → unlocked */
    const requiredApps = new Set(combo.prerequisites.map((p) => p.app));
    const unlocked = [...requiredApps].every((app) => connectedAppNames.has(app));
    return { ...combo, unlocked };
  });
}
