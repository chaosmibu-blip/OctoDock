// ============================================================
// 事件匯流排（Event Bus）
// 接收來自 webhook / 排程 / 操作的事件 → 廣播給該用戶的所有 SSE 連線
// 記憶體管理：連線斷開時自動清理，防止記憶體洩漏
// ============================================================

import { nanoid } from "nanoid";
import type { OctoDockEvent, OctoDockEventType, SSEConnection } from "./types";

/** 用戶 ID → SSE 連線列表（一個用戶可能有多個 Channel Plugin 連線） */
const connections = new Map<string, Set<SSEConnection>>();

/**
 * 註冊一個新的 SSE 連線
 * 當 Channel Plugin 連上 /api/events/[apiKey] 時呼叫
 *
 * @param userId 用戶 ID
 * @param send 推送事件的 callback
 * @param close 關閉連線的 callback
 * @returns 連線物件（用於後續取消註冊）
 */
/** 每個用戶最多同時持有的 SSE 連線數（防止資源耗盡） */
const MAX_CONNECTIONS_PER_USER = 5;

export function registerConnection(
  userId: string,
  send: (event: OctoDockEvent) => void,
  close: () => void,
): SSEConnection {
  const conn: SSEConnection = {
    userId,
    send,
    connectedAt: new Date(),
    close,
  };

  // 取得或建立該用戶的連線集合
  if (!connections.has(userId)) {
    connections.set(userId, new Set());
  }
  const userConns = connections.get(userId)!;

  // 超過上限 → 關閉最舊的連線
  if (userConns.size >= MAX_CONNECTIONS_PER_USER) {
    const oldest = [...userConns][0];
    if (oldest) {
      oldest.close();
      userConns.delete(oldest);
      console.log(`[event-bus] 用戶 ${userId} 連線數超限，關閉最舊連線`);
    }
  }

  userConns.add(conn);

  console.log(`[event-bus] 用戶 ${userId} 新增 SSE 連線（目前 ${connections.get(userId)!.size} 個）`);
  return conn;
}

/**
 * 取消註冊 SSE 連線
 * 當連線斷開或超時時呼叫
 *
 * @param conn 要取消的連線物件
 */
export function unregisterConnection(conn: SSEConnection): void {
  const userConns = connections.get(conn.userId);
  if (userConns) {
    userConns.delete(conn);
    // 該用戶已無連線 → 清理 Map entry，防止記憶體洩漏
    if (userConns.size === 0) {
      connections.delete(conn.userId);
    }
    console.log(`[event-bus] 用戶 ${conn.userId} 移除 SSE 連線（剩 ${userConns.size} 個）`);
  }
}

/**
 * 發送事件給指定用戶的所有 SSE 連線
 * 這是整個事件推送系統的核心入口
 *
 * @param userId 目標用戶 ID
 * @param app 來源 App 名稱
 * @param eventType 事件類型
 * @param content AI 可讀的事件摘要
 * @param meta 事件 metadata
 * @param raw 原始 payload（選填）
 */
export function emitEvent(
  userId: string,
  app: string,
  eventType: OctoDockEventType,
  content: string,
  meta: Record<string, unknown> = {},
  raw?: unknown,
): void {
  const userConns = connections.get(userId);
  // 該用戶沒有活躍的 SSE 連線 → 靜默忽略（不阻塞 webhook 處理）
  if (!userConns || userConns.size === 0) return;

  const event: OctoDockEvent = {
    id: `evt_${nanoid()}`,
    app,
    event_type: eventType,
    content,
    meta,
    raw,
    timestamp: new Date().toISOString(),
  };

  // 廣播給該用戶的所有連線（先複製 Set 避免迭代中刪除）
  const snapshot = [...userConns];
  for (const conn of snapshot) {
    try {
      conn.send(event);
    } catch (err) {
      // 連線已斷 → 清理
      console.error(`[event-bus] 推送失敗，清理連線:`, err);
      unregisterConnection(conn);
    }
  }
}

/**
 * 取得目前活躍連線統計（debug / health check 用）
 */
export function getConnectionStats(): { totalUsers: number; totalConnections: number } {
  let totalConnections = 0;
  for (const conns of connections.values()) {
    totalConnections += conns.size;
  }
  return {
    totalUsers: connections.size,
    totalConnections,
  };
}
