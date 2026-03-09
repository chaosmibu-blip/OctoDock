import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { connectedApps } from "@/db/schema";
import { getAdapter } from "@/mcp/registry";
import { encrypt } from "@/lib/crypto";
import { APP_URL } from "@/lib/constants";
import type { OAuthConfig, TokenSet } from "@/adapters/types";
import { getOAuthClientId, getOAuthClientSecret } from "@/lib/oauth-env";

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

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };

  if (config.authMethod === "basic") {
    // Notion uses Basic Auth
    const clientId = getOAuthClientId(appName);
    const clientSecret = getOAuthClientSecret(appName);
    headers["Authorization"] =
      `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  } else {
    // Google/Meta use POST body
    body.set("client_id", getOAuthClientId(appName));
    body.set("client_secret", getOAuthClientSecret(appName));
  }

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers,
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
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const userId = verifyState(state);
  if (!userId) {
    return NextResponse.redirect(
      new URL("/dashboard?error=invalid_state", APP_URL),
    );
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
