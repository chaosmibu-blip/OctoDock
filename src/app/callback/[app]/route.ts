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

    const data = state.substring(0, dotIndex);
    const sig = state.substring(dotIndex + 1);
    const key = getStateKey();

    const expectedSig = createHmac("sha256", key).update(data).digest("base64url");
    const sigBuf = Buffer.from(sig);
    const expectedBuf = Buffer.from(expectedSig);

    if (sigBuf.length !== expectedBuf.length) return null;
    if (!timingSafeEqual(sigBuf, expectedBuf)) return null;

    const payload = JSON.parse(Buffer.from(data, "base64url").toString());
    /* 檢查 15 分鐘有效期 */
    if (Date.now() - payload.ts > 15 * 60 * 1000) return null;
    return { userId: payload.userId, from: payload.from };
  } catch {
    return null;
  }
}

// Exchange authorization code for tokens (spec section 7)
// codeVerifier: PKCE 用的 code_verifier（Canva 等 App 需要）
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
    if (codeVerifier) {
      bodyParams.code_verifier = codeVerifier;
    }

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
  if (codeVerifier) {
    bodyParams.code_verifier = codeVerifier;
  }
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