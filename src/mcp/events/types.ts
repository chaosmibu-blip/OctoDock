// ============================================================
// 事件型別定義
// OctoDock 事件推送系統的核心型別
// 所有從 webhook / 排程 / 操作產生的事件都遵循此格式
// ============================================================

/** OctoDock 事件型別 */
export type OctoDockEventType =
  | "message"            // TG / LINE / Discord 訊息
  | "pr_opened"          // GitHub PR
  | "pr_merged"          // GitHub PR merged
  | "issue_opened"       // GitHub Issue
  | "push"               // GitHub push
  | "email_received"     // Gmail 新信
  | "page_updated"       // Notion 頁面更新
  | "calendar_event"     // Google Calendar 事件提醒
  | "schedule_triggered" // OctoDock 排程觸發
  | "app_event";         // 通用 App 事件（fallback）

/** OctoDock 統一事件格式 */
export interface OctoDockEvent {
  /** 事件唯一 ID（evt_ + nanoid） */
  id: string;
  /** 來源 App 名稱（與 adapter 名稱一致） */
  app: string;
  /** 事件類型 */
  event_type: OctoDockEventType;
  /** AI 可讀的事件摘要文字 */
  content: string;
  /** 事件相關 metadata，欄位因 app/event_type 而異 */
  meta: Record<string, unknown>;
  /** 原始 API payload（debug 用，選填） */
  raw?: unknown;
  /** 事件產生時間 */
  timestamp: string;
}

/** SSE 連線資訊 */
export interface SSEConnection {
  /** 用戶 ID */
  userId: string;
  /** 推送事件的 callback */
  send: (event: OctoDockEvent) => void;
  /** 連線建立時間 */
  connectedAt: Date;
  /** 關閉連線的 callback */
  close: () => void;
}
