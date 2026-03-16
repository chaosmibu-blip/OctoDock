import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { connectedApps } from "@/db/schema";
import { getAdapter, loadAdapters } from "@/mcp/registry";

let adaptersLoaded = false;
async function ensureAdapters() {
  if (!adaptersLoaded) { await loadAdapters(); adaptersLoaded = true; }
}
import { encrypt } from "@/lib/crypto";
import { APP_URL } from "@/lib/constants";
import type { OAuthConfig, TokenSet } from "@/adapters/types";
import { getOAuthClientId, getOAuthClientSecret } from "@/lib/oauth-env";

// Google 系列 App 名稱（用於一鍵連接 callback）
const GOOGLE_APPS = ["gmail", "google_calendar", "google_drive", "google_sheets", "google_docs", "google_tasks", "youtube"];

// Verify and decode OAuth state parameter
function verifyState(state: string | null): string | null {
  if (!state) return null;
  try {
    const decoded = JSON.parse(
      Buffer.from(state, "base64url").toString("utf8"),
    );
    // Check expiry (15 minutes)
    if (Date.now() - decoded.ts > 15 * 60 * 1000) return null;
    return decoded.userId;
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

  const userId = verifyState(state);
  if (!userId) {
    return NextResponse.redirect(
      new URL("/dashboard?error=invalid_state", APP_URL),
    );
  }

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

      return NextResponse.redirect(
        new URL("/dashboard?connected=google_all", APP_URL),
      );
    } catch (error) {
      console.error("Google All OAuth callback error:", error);
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

    return NextResponse.redirect(
      new URL(`/dashboard?connected=${appName}`, APP_URL),
    );
  } catch (error) {
    console.error(`OAuth callback error for ${appName}:`, error);
    return NextResponse.redirect(
      new URL(`/dashboard?error=oauth_failed&app=${appName}`, APP_URL),
    );
  }
}
