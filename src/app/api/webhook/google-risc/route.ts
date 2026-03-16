import { NextRequest, NextResponse } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { db } from "@/db";
import { connectedApps } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";

// ============================================================
// Google RISC（跨帳戶防護）Webhook
// 接收 Google 帳號安全事件（被盜、token 撤銷、帳號停用等）
// 文件：https://developers.google.com/identity/protocols/risc
// ============================================================

// Google RISC 的 JWKS URI（用於驗證 JWT 簽名）
const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);

// Google 登入的 Client ID（用於驗證 JWT 的 audience）
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;

// 支援的事件類型前綴
const EVENT_PREFIX = "https://schemas.openid.net/secevent/risc/event-type/";

// Google 系列 App 名稱
const GOOGLE_APPS = ["gmail", "google_calendar", "google_drive", "google_sheets", "google_docs", "google_tasks", "youtube"];

/**
 * POST /api/webhook/google-risc
 * Google 推送安全事件到這個 endpoint
 * 每個事件是一個 JWT（Security Event Token）
 */
export async function POST(request: NextRequest) {
  try {
    // 讀取 request body（JWT 字串）
    const body = await request.text();
    if (!body) {
      return NextResponse.json({ error: "Empty body" }, { status: 400 });
    }

    // 驗證 JWT 簽名 + 發行者 + 受眾
    const { payload } = await jwtVerify(body, GOOGLE_JWKS, {
      issuer: "https://accounts.google.com/",
      audience: GOOGLE_CLIENT_ID,
    });

    // 解析事件
    const events = payload.events as Record<string, { subject?: { sub?: string }; reason?: string }> | undefined;
    if (!events) {
      console.log("[RISC] No events in token");
      return NextResponse.json({ ok: true });
    }

    // 處理每個事件
    for (const [eventType, eventData] of Object.entries(events)) {
      const type = eventType.replace(EVENT_PREFIX, "");
      const googleSub = eventData.subject?.sub;

      console.log(`[RISC] Event: ${type}, sub: ${googleSub}, reason: ${eventData.reason ?? "N/A"}`);

      if (!googleSub) continue;

      // 從 accounts 表找到 OctoDock 用戶（Google sub → userId）
      const userId = await findUserByGoogleSub(googleSub);
      if (!userId) {
        console.log(`[RISC] User not found for Google sub: ${googleSub}`);
        continue;
      }

      // 根據事件類型做對應動作
      switch (type) {
        case "sessions-revoked":
        case "tokens-revoked":
        case "token-revoked":
          // Token 被撤銷：標記所有 Google App 為 expired
          await markGoogleAppsExpired(userId);
          console.log(`[RISC] Marked Google apps as expired for user: ${userId}`);
          break;

        case "account-disabled":
          // 帳號被停用：標記所有 Google App 為 expired
          await markGoogleAppsExpired(userId);
          console.log(`[RISC] Account disabled, marked Google apps expired for user: ${userId}`);
          break;

        case "account-enabled":
          // 帳號恢復：不自動啟用，需用戶重新連結
          console.log(`[RISC] Account re-enabled for user: ${userId}. User needs to reconnect.`);
          break;

        case "account-credential-change-required":
          // 可疑活動：標記 expired，要求重新授權
          await markGoogleAppsExpired(userId);
          console.log(`[RISC] Credential change required for user: ${userId}`);
          break;

        case "verification":
          // Google 的測試事件，直接回 200
          console.log("[RISC] Verification event received");
          break;

        default:
          console.log(`[RISC] Unknown event type: ${type}`);
      }
    }

    // Google 要求回傳 200，不然會重試
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[RISC] Error processing event:", error);
    // 即使處理失敗也回 200，避免 Google 無限重試
    // 真正的驗證失敗（簽名錯誤等）會在 jwtVerify 丟出
    return NextResponse.json({ ok: true });
  }
}

/**
 * 從 accounts 表（NextAuth）找到 Google sub 對應的 OctoDock userId
 * Google 登入時 NextAuth 會把 providerAccountId = Google sub 存在 accounts 表
 */
async function findUserByGoogleSub(googleSub: string): Promise<string | null> {
  try {
    // NextAuth 的 accounts 表：provider = "google", providerAccountId = googleSub
    const result = await db.execute(
      sql`SELECT user_id FROM accounts WHERE provider = 'google' AND provider_account_id = ${googleSub} LIMIT 1`,
    );
    const rows = result.rows as Array<{ user_id: string }>;
    return rows[0]?.user_id ?? null;
  } catch {
    return null;
  }
}

/**
 * 將用戶的所有 Google App 標記為 expired
 * 用戶下次操作時會被提示重新連結
 */
async function markGoogleAppsExpired(userId: string): Promise<void> {
  for (const appName of GOOGLE_APPS) {
    await db
      .update(connectedApps)
      .set({ status: "expired", updatedAt: new Date() })
      .where(
        and(
          eq(connectedApps.userId, userId),
          eq(connectedApps.appName, appName),
        ),
      );
  }
}
