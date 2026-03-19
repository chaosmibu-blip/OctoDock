/**
 * U23: 帳號完整刪除 API（GDPR Right to Erasure）
 * DELETE /api/account — 永久刪除用戶的所有資料
 *
 * 刪除順序（用 transaction 確保原子性）：
 * 1. connectedApps — 所有已連結 App 的 token
 * 2. operations — 所有使用紀錄
 * 3. memory — 所有記憶
 * 4. schedules — 所有排程
 * 5. conversations — 所有 Bot 對話
 * 6. botConfigs — 所有 Bot 設定
 * 7. subscriptions — 訂閱記錄
 * 8. storedResults — 暫存的大回傳
 * 9. accounts — NextAuth OAuth 連結
 * 10. users — 用戶記錄本身
 */

import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import { db } from "@/db";
import {
  users,
  accounts,
  connectedApps,
  operations,
  memory,
  schedules,
  conversations,
  botConfigs,
  subscriptions,
  storedResults,
} from "@/db/schema";
import { eq } from "drizzle-orm";

export async function DELETE(request: NextRequest) {
  // 驗證用戶身份
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401 },
    );
  }

  // 確認操作：request body 需要 confirm: "DELETE"
  try {
    const body = await request.json();
    if (body.confirm !== "DELETE") {
      return NextResponse.json(
        { error: "請在 request body 中傳送 {confirm: \"DELETE\"} 以確認刪除帳號。此操作無法復原。" },
        { status: 400 },
      );
    }
  } catch {
    return NextResponse.json(
      { error: "Invalid request body. Send {confirm: \"DELETE\"} to confirm." },
      { status: 400 },
    );
  }

  const userId = session.user.id;

  try {
    // 用 transaction 確保原子性（全刪或全不刪）
    await db.transaction(async (tx) => {
      // 1. 刪除所有已連結 App 的 token
      await tx.delete(connectedApps).where(eq(connectedApps.userId, userId));

      // 2. 刪除所有使用紀錄
      await tx.delete(operations).where(eq(operations.userId, userId));

      // 3. 刪除所有記憶
      await tx.delete(memory).where(eq(memory.userId, userId));

      // 4. 刪除所有排程
      await tx.delete(schedules).where(eq(schedules.userId, userId));

      // 5. 刪除所有 Bot 對話
      await tx.delete(conversations).where(eq(conversations.userId, userId));

      // 6. 刪除所有 Bot 設定
      await tx.delete(botConfigs).where(eq(botConfigs.userId, userId));

      // 7. 刪除訂閱記錄
      await tx.delete(subscriptions).where(eq(subscriptions.userId, userId));

      // 8. 刪除暫存的大回傳（storedResults 的 userId 是 text 類型）
      await tx.delete(storedResults).where(eq(storedResults.userId, userId));

      // 9. 刪除 NextAuth OAuth 連結
      await tx.delete(accounts).where(eq(accounts.userId, userId));

      // 10. 刪除用戶記錄本身
      await tx.delete(users).where(eq(users.id, userId));
    });

    return NextResponse.json({
      ok: true,
      message: "帳號已永久刪除。所有資料（包括已連接的 App token、記憶、使用紀錄、SOP 和排程）已全部清除。",
    });
  } catch (err) {
    console.error("[account-delete] Failed to delete account:", err);
    return NextResponse.json(
      { error: "刪除帳號失敗，請稍後再試。" },
      { status: 500 },
    );
  }
}
