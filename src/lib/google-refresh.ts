/**
 * Google 系 adapter 共用的 token 刷新函式
 * 所有 Google 系 App（Gmail、Drive、Calendar、Sheets、Docs、Tasks、YouTube）
 * 共用相同的 OAuth credentials（GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET），
 * token 刷新邏輯完全一樣，統一在此實作避免 7 份 copy-paste。
 */

import { getOAuthClientId, getOAuthClientSecret } from "./oauth-env";
import type { TokenSet } from "../adapters/types";

/**
 * 使用 refresh_token 向 Google OAuth2 端點取得新的 access_token
 * @param refreshToken - 用戶的 refresh_token
 * @param appLabel - App 顯示名稱，用於錯誤訊息（如 "Gmail"、"Google Drive"）
 * @param errorCode - 錯誤代碼，用於錯誤訊息（如 "GMAIL_REFRESH_FAILED"）
 * @returns 新的 TokenSet（包含 access_token、refresh_token、expires_in）
 */
export async function refreshGoogleToken(
  refreshToken: string,
  appLabel: string,
  errorCode: string,
): Promise<TokenSet> {
  // 透過 oauth-env.ts 統一取得 Google OAuth credentials
  const clientId = getOAuthClientId("gmail"); // Google 系全部映射到 GOOGLE_ 前綴
  const clientSecret = getOAuthClientSecret("gmail");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });

  if (!res.ok) {
    throw new Error(`${appLabel} token refresh failed (${errorCode})`);
  }

  const data = await res.json();
  return {
    access_token: data.access_token,
    // Google 不一定回傳新的 refresh_token，沒有的話沿用原本的
    refresh_token: data.refresh_token ?? refreshToken,
    expires_in: data.expires_in,
  };
}
