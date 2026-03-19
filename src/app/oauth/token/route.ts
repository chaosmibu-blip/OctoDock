/**
 * U24: OAuth Token Endpoint
 * POST /oauth/token — 換 auth code 成 access_token + refresh_token
 *
 * 支援兩種 grant_type：
 * - authorization_code：用 auth code 換 token
 * - refresh_token：用 refresh_token 續期
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { oauthClients, oauthCodes, oauthTokens } from "@/db/schema";
import { eq, and, gt } from "drizzle-orm";
import { nanoid } from "nanoid";
import { createHash } from "crypto";

// CORS headers for token endpoint
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** 簡易的 secret 比對（用 SHA-256 hash） */
function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export async function POST(request: NextRequest) {
  // OAuth token endpoint 使用 application/x-www-form-urlencoded
  let formData: URLSearchParams;
  try {
    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const body = await request.text();
      formData = new URLSearchParams(body);
    } else if (contentType.includes("application/json")) {
      // 部分 client 可能用 JSON
      const json = await request.json();
      formData = new URLSearchParams(json as Record<string, string>);
    } else {
      const body = await request.text();
      formData = new URLSearchParams(body);
    }
  } catch {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Could not parse request body" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const grantType = formData.get("grant_type");
  const clientId = formData.get("client_id");
  const clientSecret = formData.get("client_secret");

  // 驗證 client credentials
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "invalid_client", error_description: "client_id and client_secret are required" },
      { status: 401, headers: CORS_HEADERS },
    );
  }

  const client = await db.select().from(oauthClients).where(eq(oauthClients.id, clientId)).limit(1);
  if (client.length === 0 || client[0].secretHash !== hashSecret(clientSecret)) {
    return NextResponse.json(
      { error: "invalid_client", error_description: "Invalid client credentials" },
      { status: 401, headers: CORS_HEADERS },
    );
  }

  // ── authorization_code grant ──
  if (grantType === "authorization_code") {
    const code = formData.get("code");
    const redirectUri = formData.get("redirect_uri");

    if (!code) {
      return NextResponse.json(
        { error: "invalid_request", error_description: "code is required" },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    // 查找並驗證 auth code
    const codeRows = await db.select().from(oauthCodes).where(
      and(
        eq(oauthCodes.code, code),
        eq(oauthCodes.clientId, clientId),
        eq(oauthCodes.used, false),
        gt(oauthCodes.expiresAt, new Date()),
      ),
    ).limit(1);

    if (codeRows.length === 0) {
      return NextResponse.json(
        { error: "invalid_grant", error_description: "Invalid or expired authorization code" },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    const authCode = codeRows[0];

    // 驗證 redirect_uri
    if (redirectUri && authCode.redirectUri !== redirectUri) {
      return NextResponse.json(
        { error: "invalid_grant", error_description: "redirect_uri mismatch" },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    // 標記 code 為已使用（防止 replay）
    await db.update(oauthCodes).set({ used: true }).where(eq(oauthCodes.code, code));

    // 產生 access_token + refresh_token
    const accessToken = `oat_${nanoid(32)}`;
    const refreshToken = `ort_${nanoid(32)}`;
    const expiresIn = 3600; // 1 小時

    await db.insert(oauthTokens).values({
      accessToken,
      refreshToken,
      clientId,
      userId: authCode.userId,
      scope: authCode.scope,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
    });

    return NextResponse.json(
      {
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: expiresIn,
        refresh_token: refreshToken,
        scope: authCode.scope,
      },
      { headers: CORS_HEADERS },
    );
  }

  // ── refresh_token grant ──
  if (grantType === "refresh_token") {
    const refreshTokenValue = formData.get("refresh_token");
    if (!refreshTokenValue) {
      return NextResponse.json(
        { error: "invalid_request", error_description: "refresh_token is required" },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    // 查找 refresh token
    const tokenRows = await db.select().from(oauthTokens).where(
      and(
        eq(oauthTokens.refreshToken, refreshTokenValue),
        eq(oauthTokens.clientId, clientId),
      ),
    ).limit(1);

    if (tokenRows.length === 0) {
      return NextResponse.json(
        { error: "invalid_grant", error_description: "Invalid refresh token" },
        { status: 400, headers: CORS_HEADERS },
      );
    }

    const oldToken = tokenRows[0];

    // 產生新的 access_token（保留同一個 refresh_token）
    const newAccessToken = `oat_${nanoid(32)}`;
    const expiresIn = 3600;

    // 刪除舊的 access_token，插入新的
    await db.delete(oauthTokens).where(eq(oauthTokens.accessToken, oldToken.accessToken));
    await db.insert(oauthTokens).values({
      accessToken: newAccessToken,
      refreshToken: refreshTokenValue,
      clientId,
      userId: oldToken.userId,
      scope: oldToken.scope,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
    });

    return NextResponse.json(
      {
        access_token: newAccessToken,
        token_type: "Bearer",
        expires_in: expiresIn,
        refresh_token: refreshTokenValue,
        scope: oldToken.scope,
      },
      { headers: CORS_HEADERS },
    );
  }

  return NextResponse.json(
    { error: "unsupported_grant_type", error_description: "Only authorization_code and refresh_token are supported" },
    { status: 400, headers: CORS_HEADERS },
  );
}
