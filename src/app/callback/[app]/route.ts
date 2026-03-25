import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { connectedApps } from "@/db/schema";
import { getAdapter, ensureAdapters } from "@/mcp/registry";
import { encrypt } from "@/lib/crypto";
import { APP_URL } from "@/lib/constants";
import type { OAuthConfig, TokenSet } from "@/adapters/types";
import { getOAuthClientId, getOAuthClientSecret } from "@/lib/oauth-env";
import { fetchAppUser } from "@/lib/fetch-app-user";

// Google 系列 App 名稱（用於一鍵連接 callback）
const GOOGLE_APPS = ["gmail", "google_calendar", "google_drive", "google_sheets", "google_docs", "google_tasks", "youtube"];

// Microsoft 系列 App 名稱（用於一鍵連接 callback）
const MICROSOFT_APPS = ["microsoft_excel", "microsoft_word", "microsoft_powerpoint"];

import { createHmac, timingSafeEqual } from "crypto";

/** HMAC 簽名用的 key — 跟 connect route 用同一個派生邏輯 */
function getStateKey(): string {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key) throw new Error("TOKEN_ENCRYPTION_KEY not set");
  return createHmac("sha256", key).update("oauth-state-signing").digest("hex");
}

/** 驗證帶 HMAC 簽名的 OAuth state 參數，防止 CSRF 偽造 */
function verifyState(state: string | null): { userId: string; from?: string; codeVerifier?: string } | null {
  if (!state) return null;
  try {
    /* state 格式：base64url(payload).base64url(hmac) */
    const dotIndex = state.lastIndexOf('.');
    if (dotIndex === -1) return null;

    const data = state.substring(0, dotIndex);
    const sig = state.substring(dotIndex + 1);
    const key = getStateKey();

    const expectedSig = createHmac("sha256", key).update(data).digest("base64url");
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);

    if (sigBuf.length !== expectedBuf.length) return null;
    if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

    const decoded = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    /* 檢查過期（15 分鐘） */
    if (Date.now() - decoded.ts > 15 * 60 * 1000) return null;
    // U21: 提取 PKCE code_verifier（如果有的話）
    return { userId: decoded.userId, from: decoded.from, codeVerifier: decoded.cv };
  } catch {
    return null;
  }
}

// Exchange authorization code for tokens (spec section 7)
// U21: codeVerifier — PKCE 用的 code_verifier（Canva 等 App 需要）
async function exchangeCode(
  config: OAuthConfig,
  code: string,
  appName: string,
  codeVerifier?: string,
) {
  const redirectUri = `${APP_URL}/callback/${appName}`;

  if (config.authMethod === "basic") {
    // Notion / Canva uses Basic Auth
    // Canva requires application/x-www-form-urlencoded (rejects JSON)
    // Notion accepts both, so form-urlencoded works for all Basic Auth apps
    const clientId = getOAuthClientId(appName);
    const clientSecret = getOAuthClientSecret(appName);

    // 組裝 body：基本欄位 + PKCE code_verifier（如有）
    const bodyParams: Record<string, string> = {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    };
    // U21: PKCE — 如果有 code_verifier 就加入
    if (codeVerifier) bodyParams.code_verifier = codeVerifier;

    const response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams(bodyParams).toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(
        `Token exchange failed for ${appName}: ${response.status} ${error}`,
      );
    }

    return response.json();
  }

  // Google/Meta use form-urlencoded + POST body credentials
  const bodyParams: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: getOAuthClientId(appName),
    client_secret: getOAuthClientSecret(appName),
  };
  // U21: PKCE — 如果有 code_verifier 就加入
  if (codeVerifier) bodyParams.code_verifier = codeVerifier;

  const body = new URLSearchParams(bodyParams);

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json", // GitHub 需要這個才會回傳 JSON
    },
    body: body.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(
      `Token exchange failed for ${appName}: ${response.status} ${error}`,
    );
  }

  return response.json();
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ app: string }> },
) {
  const { app: appName } = await params;
  await ensureAdapters();
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const stateData = verifyState(state);
  if (!stateData) {
    return NextResponse.redirect(
      new URL("/dashboard?error=invalid_state", APP_URL),
    );
  }
  const userId = stateData.userId;
  const fromSkillTree = stateData.from === "skill-tree";

  // ── Google 一鍵連接：一組 token 寫入 7 筆 connectedApps ──
  if (appName === "google_all") {
    try {
      // 手動做 token exchange（不走 exchangeCode，因為 appName="google_all" 不在 oauth-env 映射裡）
      const redirectUri = `${APP_URL}/callback/google_all`;
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code: code!,
        redirect_uri: redirectUri,
        client_id: getOAuthClientId("gmail"),       // Google 系共用 gmail 的 credentials
        client_secret: getOAuthClientSecret("gmail"),
      });
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      if (!tokenRes.ok) {
        const err = await tokenRes.text();
        throw new Error(`Token exchange failed for google_all: ${tokenRes.status} ${err}`);
      }
      const tokens = await tokenRes.json();

      // 查 Google 用戶身份（所有 Google App 共用同一個身份）
      const googleUser = await fetchAppUser("gmail", tokens.access_token);

      // 同一組 token 寫入 7 個 Google App
      for (const gApp of GOOGLE_APPS) {
        const adapter = getAdapter(gApp);
        if (!adapter) continue;
        await db
          .insert(connectedApps)
          .values({
            userId,
            appName: gApp,
            authType: "oauth2",
            accessToken: encrypt(tokens.access_token),
            refreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
            tokenExpiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
            scopes: (adapter.authConfig as OAuthConfig).scopes,
            appUserId: googleUser?.appUserId ?? null,
            appUserName: googleUser?.appUserName ?? null,
            status: "active",
          })
          .onConflictDoUpdate({
            target: [connectedApps.userId, connectedApps.appName],
            set: {
              accessToken: encrypt(tokens.access_token),
              refreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : undefined,
              tokenExpiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : undefined,
              appUserId: googleUser?.appUserId ?? undefined,
              appUserName: googleUser?.appUserName ?? undefined,
              status: "active",
              updatedAt: new Date(),
            },
          });
      }

      if (fromSkillTree) {
        return new NextResponse(
          `<!DOCTYPE html><html><head><title>連接成功</title></head><body>
          <p style="font-family:sans-serif;text-align:center;margin-top:40vh">
            ✅ Google 全系列連接成功，此視窗即將關閉…
          </p>
          <script>window.close();</script>
          </body></html>`,
          { headers: { "Content-Type": "text/html" } },
        );
      }
      return NextResponse.redirect(
        new URL("/dashboard?connected=google_all", APP_URL),
      );
    } catch (error) {
      console.error("Google All OAuth callback error:", error);
      if (fromSkillTree) {
        return new NextResponse(
          `<!DOCTYPE html><html><head><title>連接失敗</title></head><body>
          <p style="font-family:sans-serif;text-align:center;margin-top:40vh;color:#e24b4a">
            ❌ Google 連接失敗，請關閉此視窗後重試。
          </p>
          </body></html>`,
          { headers: { "Content-Type": "text/html" } },
        );
      }
      return NextResponse.redirect(
        new URL("/dashboard?error=oauth_failed&app=google_all", APP_URL),
      );
    }
  }

  // ── Microsoft 一鍵連接 callback ──
  if (appName === "microsoft_all") {
    try {
      const redirectUri = `${APP_URL}/callback/microsoft_all`;
      const body = new URLSearchParams({
        grant_type: "authorization_code",
        code: code!,
        redirect_uri: redirectUri,
        client_id: getOAuthClientId("microsoft_excel"),
        client_secret: getOAuthClientSecret("microsoft_excel"),
        scope: "offline_access Files.ReadWrite User.Read",
      });
      const tokenRes = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      if (!tokenRes.ok) {
        const err = await tokenRes.text();
        throw new Error(`Token exchange failed for microsoft_all: ${tokenRes.status} ${err}`);
      }
      const tokens = await tokenRes.json();

      // 查 Microsoft 用戶身份（所有 Microsoft App 共用同一個身份）
      const msUser = await fetchAppUser("microsoft_excel", tokens.access_token);

      // 同一組 token 寫入 3 個 Microsoft App
      for (const msApp of MICROSOFT_APPS) {
        const msAdapter = getAdapter(msApp);
        if (!msAdapter) continue;
        await db
          .insert(connectedApps)
          .values({
            userId,
            appName: msApp,
            authType: "oauth2",
            accessToken: encrypt(tokens.access_token),
            refreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
            tokenExpiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
            scopes: (msAdapter.authConfig as OAuthConfig).scopes,
            appUserId: msUser?.appUserId ?? null,
            appUserName: msUser?.appUserName ?? null,
            status: "active",
          })
          .onConflictDoUpdate({
            target: [connectedApps.userId, connectedApps.appName],
            set: {
              accessToken: encrypt(tokens.access_token),
              refreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : undefined,
              tokenExpiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : undefined,
              appUserId: msUser?.appUserId ?? undefined,
              appUserName: msUser?.appUserName ?? undefined,
              status: "active",
              updatedAt: new Date(),
            },
          });
      }

      if (fromSkillTree) {
        return new NextResponse(
          `<!DOCTYPE html><html><head><title>連接成功</title></head><body>
          <p style="font-family:sans-serif;text-align:center;margin-top:40vh">
            ✅ Microsoft Office 全系列連接成功，此視窗即將關閉…
          </p>
          <script>window.close();</script>
          </body></html>`,
          { headers: { "Content-Type": "text/html" } },
        );
      }
      return NextResponse.redirect(
        new URL("/dashboard?connected=microsoft_all", APP_URL),
      );
    } catch (error) {
      console.error("Microsoft All OAuth callback error:", error);
      if (fromSkillTree) {
        return new NextResponse(
          `<!DOCTYPE html><html><head><title>連接失敗</title></head><body>
          <p style="font-family:sans-serif;text-align:center;margin-top:40vh;color:#e24b4a">
            ❌ Microsoft 連接失敗，請關閉此視窗後重試。
          </p>
          </body></html>`,
          { headers: { "Content-Type": "text/html" } },
        );
      }
      return NextResponse.redirect(
        new URL("/dashboard?error=oauth_failed&app=microsoft_all", APP_URL),
      );
    }
  }

  const adapter = getAdapter(appName);
  if (!adapter || adapter.authConfig.type !== "oauth2") {
    return NextResponse.redirect(
      new URL("/dashboard?error=invalid_app", APP_URL),
    );
  }

  try {
    // U21: 從 verified state 提取 PKCE code_verifier（如果有的話）
    let tokens = await exchangeCode(
      adapter.authConfig as OAuthConfig,
      code!,
      appName,
      stateData.codeVerifier,
    );

    // Meta apps: exchange short-lived token for long-lived token (60 days)
    if (appName === "threads" || appName === "instagram") {
      const exchangeFn = appName === "threads"
        ? (await import("@/adapters/threads")).threadsExchangeLongLived
        : (await import("@/adapters/instagram")).instagramExchangeLongLived;
      const longLived: TokenSet = await exchangeFn(tokens.access_token);
      tokens = {
        access_token: longLived.access_token,
        expires_in: longLived.expires_in,
      };
    }

    // 查用戶在此 App 的身份
    const appUser = await fetchAppUser(appName, tokens.access_token);

    await db
      .insert(connectedApps)
      .values({
        userId,
        appName,
        authType: "oauth2",
        accessToken: encrypt(tokens.access_token),
        refreshToken: tokens.refresh_token
          ? encrypt(tokens.refresh_token)
          : null,
        tokenExpiresAt: tokens.expires_in
          ? new Date(Date.now() + tokens.expires_in * 1000)
          : null,
        scopes: adapter.authConfig.scopes,
        appUserId: appUser?.appUserId ?? null,
        appUserName: appUser?.appUserName ?? null,
        status: "active",
      })
      .onConflictDoUpdate({
        target: [connectedApps.userId, connectedApps.appName],
        set: {
          accessToken: encrypt(tokens.access_token),
          refreshToken: tokens.refresh_token
            ? encrypt(tokens.refresh_token)
            : undefined,
          tokenExpiresAt: tokens.expires_in
            ? new Date(Date.now() + tokens.expires_in * 1000)
            : undefined,
          appUserId: appUser?.appUserId ?? undefined,
          appUserName: appUser?.appUserName ?? undefined,
          status: "active",
          updatedAt: new Date(),
        },
      });

    if (fromSkillTree) {
      return new NextResponse(
        `<!DOCTYPE html><html><head><title>連接成功</title></head><body>
        <p style="font-family:sans-serif;text-align:center;margin-top:40vh">
          ✅ ${appName} 連接成功，此視窗即將關閉…
        </p>
        <script>window.close();</script>
        </body></html>`,
        { headers: { "Content-Type": "text/html" } },
      );
    }

    return NextResponse.redirect(
      new URL(`/dashboard?connected=${appName}`, APP_URL),
    );
  } catch (error) {
    console.error(`OAuth callback error for ${appName}:`, error);

    if (fromSkillTree) {
      return new NextResponse(
        `<!DOCTYPE html><html><head><title>連接失敗</title></head><body>
        <p style="font-family:sans-serif;text-align:center;margin-top:40vh;color:#e24b4a">
          ❌ ${appName} 連接失敗，請關閉此視窗後重試。
        </p>
        </body></html>`,
        { headers: { "Content-Type": "text/html" } },
      );
    }

    return NextResponse.redirect(
      new URL(`/dashboard?error=oauth_failed&app=${appName}`, APP_URL),
    );
  }
}
