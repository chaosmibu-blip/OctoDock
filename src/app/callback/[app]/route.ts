import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { connectedApps } from "@/db/schema";
import { getAdapter, ensureAdapters } from "@/mcp/registry";
import { encrypt } from "@/lib/crypto";
import { APP_URL } from "@/lib/constants";
import type { OAuthConfig, TokenSet } from "@/adapters/types";
import { getOAuthClientId, getOAuthClientSecret } from "@/lib/oauth-env";

// Google 系列 App 名稱（用於一鍵連接 callback）
const GOOGLE_APPS = ["gmail", "google_calendar", "google_drive", "google_sheets", "google_docs", "google_tasks", "youtube"];

import { createHmac, timingSafeEqual } from "crypto";

/** HMAC 簽名用的 key — 跟 connect route 用同一個派生邏輯 */
function getStateKey(): string {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key) throw new Error("TOKEN_ENCRYPTION_KEY not set");
  return createHmac("sha256", key).update("oauth-state-signing").digest("hex");
}

/** 驗證帶 HMAC 簽名的 OAuth state 參數，防止 CSRF 偽造 */
function verifyState(state: string | null): { userId: string; from?: string } | null {
  if (!state) return null;
  try {
    /* state 格式：base64url(payload).base64url(hmac) */
    const dotIndex = state.lastIndexOf('.');
    if (dotIndex === -1) return null;

    const data = state.slice(0, dotIndex);
    const sig = state.slice(dotIndex + 1);

    /* 驗證 HMAC 簽名（timing-safe 防止 timing attack） */
    const expectedSig = createHmac("sha256", getStateKey()).update(data).digest("base64url");
    const sigBuf = Buffer.from(sig, "base64url");
    const expectedBuf = Buffer.from(expectedSig, "base64url");
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }

    const decoded = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    /* 檢查過期（15 分鐘） */
    if (Date.now() - decoded.ts > 15 * 60 * 1000) return null;
    return { userId: decoded.userId, from: decoded.from };
  } catch {
    return null;
  }
}

// Exchange authorization code for tokens (spec section 7)
async function exchangeCode(
  config: OAuthConfig,
  code: string,
  appName: string,
) {
  const redirectUri = `${APP_URL}/callback/${appName}`;

  if (config.authMethod === "basic") {
    // Notion uses Basic Auth + JSON body
    const clientId = getOAuthClientId(appName);
    const clientSecret = getOAuthClientSecret(appName);

    const response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
      }),
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
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: getOAuthClientId(appName),
    client_secret: getOAuthClientSecret(appName),
  });

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
            status: "active",
          })
          .onConflictDoUpdate({
            target: [connectedApps.userId, connectedApps.appName],
            set: {
              accessToken: encrypt(tokens.access_token),
              refreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : undefined,
              tokenExpiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : undefined,
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

  const adapter = getAdapter(appName);
  if (!adapter || adapter.authConfig.type !== "oauth2") {
    return NextResponse.redirect(
      new URL("/dashboard?error=invalid_app", APP_URL),
    );
  }

  try {
    let tokens = await exchangeCode(
      adapter.authConfig as OAuthConfig,
      code!,
      appName,
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
