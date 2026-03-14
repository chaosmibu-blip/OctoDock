"use client";

import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

export type Locale = "zh-TW" | "en";

interface I18nContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string) => string;
}

const translations: Record<Locale, Record<string, string>> = {
  "zh-TW": {
    // Common
    "app.title": "OctoDock",
    "app.tagline": "一個 MCP URL，讓任何 AI agent 都能用你所有的 App。",
    "common.copy": "複製",
    "common.copied": "已複製！",
    "common.save": "儲存設定",
    "common.saving": "儲存中...",
    "common.saved": "已儲存",
    "common.save_failed": "儲存失敗",
    "common.delete": "刪除",
    "common.back": "返回主控台",
    "common.loading": "載入中...",
    "common.login": "使用 Google 登入",

    // Dashboard
    "dashboard.mcp_url": "MCP URL",
    "dashboard.mcp_desc": "複製此 URL，貼到你的 AI agent 的 MCP 設定中。",
    "dashboard.apps": "應用程式",
    "dashboard.connected": "已連結",
    "dashboard.connect": "連結",
    "dashboard.disconnect": "中斷連結",
    "dashboard.view_tools": "查看工具清單",
    "dashboard.hide_tools": "收起工具清單",
    "dashboard.tool_count": "個工具，AI agent 可透過 MCP 使用：",
    "dashboard.no_tools": "尚未建立工具（此 App 的 Adapter 尚未實作）",

    // Nav
    "nav.bots": "Bot 設定",
    "nav.memory": "記憶",

    // Apps
    "app.notion.desc": "搜尋、建立、更新頁面和資料庫",
    "app.gmail.desc": "搜尋、讀取、寄送和草擬郵件",
    "app.google_calendar.desc": "查看行程、建立活動、檢查空閒時段",
    "app.google_drive.desc": "搜尋檔案、上傳、下載和分享",
    "app.google_sheets.desc": "讀取、寫入和管理試算表",
    "app.google_tasks.desc": "管理待辦事項、建立和完成任務",
    "app.google_docs.desc": "建立、讀取和編輯文件",
    "app.youtube.desc": "搜尋影片、查看播放清單和留言",
    "app.threads.desc": "發布貼文、回覆和查看洞察",
    "app.instagram.desc": "發布照片、管理留言和查看洞察",
    "app.line.desc": "發送訊息、廣播和管理追蹤者",
    "app.telegram.desc": "發送訊息、照片和管理 Bot Webhook",

    // Bots
    "bots.title": "Bot 自動回覆設定",
    "bots.empty": "尚未連結任何 Bot。",
    "bots.empty_hint": "請先在主控台連結 LINE 或 Telegram Bot。",
    "bots.persona": "Bot 人設（System Prompt）",
    "bots.persona_placeholder": "你是一個友善的客服助手，用繁體中文回覆...",
    "bots.llm_provider": "LLM 提供商",
    "bots.llm_api_key": "LLM API Key",
    "bots.api_key_set": "已設定（輸入新值可覆蓋）",
    "bots.api_key_placeholder": "輸入 API Key 以啟用自動回覆",
    "bots.api_key_note": "API Key 會加密儲存，費用由您的帳號承擔。",
    "bots.active": "啟用中",
    "bots.inactive": "已停用",

    // Memory/Preferences
    "memory.title": "記憶",
    "memory.desc": "你的跨 agent 記憶。這些偏好和模式會在所有 AI agent 之間共享。",
    "memory.empty": "尚無記憶。隨著你使用 OctoDock，AI agent 會逐漸學習你的偏好。",
    "memory.all": "全部",
    "memory.preference": "偏好",
    "memory.pattern": "模式",
    "memory.context": "脈絡",

    // Tool descriptions (user-facing)
    "tool.notion_search": "搜尋工作區中的頁面和資料庫",
    "tool.notion_get_page": "取得指定頁面的完整內容",
    "tool.notion_create_page": "建立新頁面（可指定父頁面或資料庫）",
    "tool.notion_update_page": "更新頁面的屬性、圖示或封面",
    "tool.notion_delete_page": "將頁面移到垃圾桶（30 天內可還原）",
    "tool.notion_get_page_property": "取得頁面的單一屬性值",
    "tool.notion_get_block": "取得單一區塊的內容",
    "tool.notion_get_block_children": "取得頁面或區塊的所有子區塊",
    "tool.notion_append_blocks": "在頁面或區塊末端新增內容",
    "tool.notion_update_block": "更新區塊的內容",
    "tool.notion_delete_block": "刪除指定區塊",
    "tool.notion_query_database": "查詢資料庫（支援篩選和排序）",
    "tool.notion_create_database_item": "在資料庫中建立新項目",
    "tool.notion_create_database": "建立新資料庫並定義欄位",
    "tool.notion_update_database": "更新資料庫的標題、描述或欄位",
    "tool.notion_create_comment": "在頁面或討論串中新增留言",
    "tool.notion_get_comments": "取得頁面或區塊的留言列表",
    "tool.notion_get_users": "列出工作區所有用戶",
    "tool.gmail_search": "搜尋 Gmail 信箱中的郵件",
    "tool.gmail_read": "讀取指定郵件的完整內容",
    "tool.gmail_send": "從用戶的 Gmail 寄送新郵件",
    "tool.gmail_reply": "回覆現有的郵件對話",
    "tool.gmail_draft": "建立郵件草稿（稍後可在 Gmail 檢視並寄出）",
  },
  en: {
    // Common
    "app.title": "OctoDock",
    "app.tagline": "One MCP URL to let any AI agent use all your apps.",
    "common.copy": "Copy",
    "common.copied": "Copied!",
    "common.save": "Save",
    "common.saving": "Saving...",
    "common.saved": "Saved",
    "common.save_failed": "Save failed",
    "common.delete": "Delete",
    "common.back": "Back to Dashboard",
    "common.loading": "Loading...",
    "common.login": "Sign in with Google",

    // Dashboard
    "dashboard.mcp_url": "MCP URL",
    "dashboard.mcp_desc": "Copy this URL and paste it into your AI agent's MCP settings.",
    "dashboard.apps": "Apps",
    "dashboard.connected": "Connected",
    "dashboard.connect": "Connect",
    "dashboard.disconnect": "Disconnect",
    "dashboard.view_tools": "View tools",
    "dashboard.hide_tools": "Hide tools",
    "dashboard.tool_count": " tools available to AI agents via MCP:",
    "dashboard.no_tools": "No tools yet (Adapter not implemented)",

    // Nav
    "nav.bots": "Bots",
    "nav.memory": "Memory",

    // Apps
    "app.notion.desc": "Search, create, and update pages and databases",
    "app.gmail.desc": "Search, read, send, and draft emails",
    "app.google_calendar.desc": "View events, create appointments, check availability",
    "app.google_drive.desc": "Search, upload, download, and share files",
    "app.google_sheets.desc": "Read, write, and manage spreadsheets",
    "app.google_tasks.desc": "Manage to-do lists, create and complete tasks",
    "app.google_docs.desc": "Create, read, and edit documents",
    "app.youtube.desc": "Search videos, view playlists and comments",
    "app.threads.desc": "Publish posts, reply, and view insights",
    "app.instagram.desc": "Publish photos, manage comments, and view insights",
    "app.line.desc": "Send messages, broadcast, and manage followers",
    "app.telegram.desc": "Send messages, photos, and manage Bot webhooks",

    // Bots
    "bots.title": "Bot Auto-Reply Settings",
    "bots.empty": "No bots connected yet.",
    "bots.empty_hint": "Connect a LINE or Telegram Bot from the Dashboard first.",
    "bots.persona": "Bot Persona (System Prompt)",
    "bots.persona_placeholder": "You are a friendly customer service assistant...",
    "bots.llm_provider": "LLM Provider",
    "bots.llm_api_key": "LLM API Key",
    "bots.api_key_set": "Set (enter new value to override)",
    "bots.api_key_placeholder": "Enter API Key to enable auto-reply",
    "bots.api_key_note": "API Key is stored encrypted. Costs are billed to your account.",
    "bots.active": "Active",
    "bots.inactive": "Inactive",

    // Memory/Preferences
    "memory.title": "Memory",
    "memory.desc": "Your cross-agent memory. These preferences and patterns are shared across all AI agents.",
    "memory.empty": "No memories yet. As you use OctoDock, AI agents will learn your preferences.",
    "memory.all": "All",
    "memory.preference": "Preference",
    "memory.pattern": "Pattern",
    "memory.context": "Context",

    // Tool descriptions (user-facing)
    "tool.notion_search": "Search pages and databases in your workspace",
    "tool.notion_get_page": "Get the full content of a specific page",
    "tool.notion_create_page": "Create a new page (under a page or database)",
    "tool.notion_update_page": "Update page properties, icon, or cover",
    "tool.notion_delete_page": "Move a page to trash (recoverable within 30 days)",
    "tool.notion_get_page_property": "Get a single property value from a page",
    "tool.notion_get_block": "Get the content of a single block",
    "tool.notion_get_block_children": "Get all child blocks of a page or block",
    "tool.notion_append_blocks": "Append new content blocks to a page or block",
    "tool.notion_update_block": "Update the content of a block",
    "tool.notion_delete_block": "Delete a specific block",
    "tool.notion_query_database": "Query a database with filters and sorts",
    "tool.notion_create_database_item": "Create a new item in a database",
    "tool.notion_create_database": "Create a new database with column definitions",
    "tool.notion_update_database": "Update database title, description, or columns",
    "tool.notion_create_comment": "Add a comment to a page or discussion thread",
    "tool.notion_get_comments": "List all comments on a page or block",
    "tool.notion_get_users": "List all users in the workspace",
    "tool.gmail_search": "Search emails in your Gmail inbox",
    "tool.gmail_read": "Read the full content of a specific email",
    "tool.gmail_send": "Send a new email from your Gmail account",
    "tool.gmail_reply": "Reply to an existing email thread",
    "tool.gmail_draft": "Create a draft email for later review and sending",
  },
};

const I18nContext = createContext<I18nContextType | null>(null);

function getInitialLocale(): Locale {
  if (typeof window !== "undefined") {
    const saved = localStorage.getItem("octodock-locale");
    if (saved === "zh-TW" || saved === "en") return saved;
  }
  return "zh-TW";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
    localStorage.setItem("octodock-locale", newLocale);
  }, []);

  const t = useCallback(
    (key: string) => translations[locale][key] ?? key,
    [locale],
  );

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}

export function LanguageSwitcher() {
  const { locale, setLocale } = useI18n();
  return (
    <button
      onClick={() => setLocale(locale === "zh-TW" ? "en" : "zh-TW")}
      className="px-3 py-1.5 text-xs border rounded-full hover:bg-gray-100 transition-colors"
      title={locale === "zh-TW" ? "Switch to English" : "切換至繁體中文"}
    >
      {locale === "zh-TW" ? "EN" : "繁中"}
    </button>
  );
}
