/**
 * U24: OAuth Authorize API
 * POST /api/oauth/authorize — 產生 auth code 並回傳 redirect URL
 *
 * 這是 authorize 頁面「同意」按鈕點擊後呼叫的 API
 * 用 server session 驗證用戶身份，產生 auth code，回傳 redirect URL
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { oauthClients, oauthCodes } from "@/db/schema";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

export async function POST(request: NextRequest) {
  // 驗證用戶身份
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json(
      { error: "unauthorized", error_description: "Not logged in" },
      { status: 401 },
    );
  }

  const body = await request.json();
  const { client_id, redirect_uri, scope = "mcp", state } = body;

  // 驗證 client_id
  if (!client_id) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "client_id is required" },
      { status: 400 },
    );
  }

  const clients = await db.select().from(oauthClients).where(eq(oauthClients.id, client_id)).limit(1);
  if (clients.length === 0) {
    return NextResponse.json(
      { error: "invalid_client", error_description: "Unknown client_id" },
      { status: 400 },
    );
  }

  const client = clients[0];

  // 驗證 redirect_uri
  if (!redirect_uri || !client.redirectUris.includes(redirect_uri)) {
    return NextResponse.json(
      { error: "invalid_request", error_description: "Invalid redirect_uri" },
      { status: 400 },
    );
  }

  // 產生 auth code（10 分鐘有效）
  const code = nanoid(32);
  await db.insert(oauthCodes).values({
    code,
    clientId: client_id,
    userId: session.user.id,
    redirectUri: redirect_uri,
    scope,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 分鐘
  });

  // 組裝 redirect URL
  const url = new URL(redirect_uri);
  url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);

  return NextResponse.json({ redirect_url: url.toString() });
}
