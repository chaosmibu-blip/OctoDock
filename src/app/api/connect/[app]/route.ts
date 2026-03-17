import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { connectedApps } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getAdapter, getAllAdapters, loadAdapters } from "@/mcp/registry";
import { APP_URL } from "@/lib/constants";
import type { OAuthConfig, ApiKeyConfig } from "@/adapters/types";
import { encrypt } from "@/lib/crypto";
import { getOAuthClientId } from "@/lib/oauth-env";

// Google 系列 App 名稱（用於一鍵連接）
const GOOGLE_APPS = ["gmail", "google_calendar", "google_drive", "google_sheets", "google_docs", "google_tasks", "youtube"];

let adaptersLoaded = false;

async function ensureAdapters() {
  if (!adaptersLoaded) {
    await loadAdapters();
    adaptersLoaded = true;
  }
}

import { createHmac } from "crypto";

/** HMAC 簽名用的 key — 用 TOKEN_ENCRYPTION_KEY 派生，確保無法偽造 state */
function getStateKey(): string {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key) throw new Error("TOKEN_ENCRYPTION_KEY not set");
  return createHmac("sha256", key).update("oauth-state-signing").digest("hex");
}

/** 產生帶 HMAC 簽名的 OAuth state 參數（CSRF 保護 + 來源追蹤） */
function generateState(userId: string, from?: string): string {
  const payload: Record<string, unknown> = { userId, ts: Date.now(), r: Math.random().toString(36) };
  if (from) payload.from = from;
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", getStateKey()).update(data).digest("base64url");
  return `${data}.${sig}`;
}

// GET /api/connect/:app — Initiate OAuth flow or show API key form
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ app: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { app: appName } = await params;
  await ensureAdapters();

  /* 讀取來源參數（技能樹頁面傳 from=skill-tree，callback 會自動關閉新分頁） */
  const from = new URL(req.url).searchParams.get("from") ?? undefined;

  // ── Google 一鍵連接：合併所有 Google App 的 scope，一次授權 ──
  if (appName === "google_all") {
    const allScopes = new Set<string>();
    for (const gApp of GOOGLE_APPS) {
      const adapter = getAdapter(gApp);
      if (adapter?.authConfig.type === "oauth2") {
        for (const scope of (adapter.authConfig as OAuthConfig).scopes) {
          allScopes.add(scope);
        }
      }
    }

    const state = generateState(session.user.id, from);
    const clientId = getOAuthClientId("gmail"); // Google 系共用同一組
    const redirectUri = `${APP_URL}/callback/google_all`;

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("scope", [...allScopes].join(" "));
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");

    return NextResponse.redirect(authUrl.toString());
  }

  const adapter = getAdapter(appName);
  if (!adapter) {
    return NextResponse.json({ error: "Unknown app" }, { status: 404 });
  }

  if (adapter.authConfig.type === "oauth2") {
    const config = adapter.authConfig as OAuthConfig;
    const state = generateState(session.user.id, from);
    const clientId = getOAuthClientId(appName);
    const redirectUri = `${APP_URL}/callback/${appName}`;

    const authUrl = new URL(config.authorizeUrl);
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("state", state);

    if (config.scopes.length > 0) {
      authUrl.searchParams.set("scope", config.scopes.join(" "));
    }

    // 讓 adapter 自己聲明需要的額外 OAuth 參數（access_type, prompt, owner 等）
    if (config.extraParams) {
      for (const [key, value] of Object.entries(config.extraParams)) {
        authUrl.searchParams.set(key, value);
      }
    }

    return NextResponse.redirect(authUrl.toString());
  }

  // API key / Bot token — return instructions
  return NextResponse.json({
    authType: adapter.authConfig.type,
    instructions: (adapter.authConfig as ApiKeyConfig).instructions,
  });
}

// POST /api/connect/:app — Submit API key or bot token
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ app: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { app: appName } = await params;
  await ensureAdapters();

  const adapter = getAdapter(appName);
  if (!adapter) {
    return NextResponse.json({ error: "Unknown app" }, { status: 404 });
  }

  const body = await req.json();
  const token = body.token as string;

  if (!token) {
    return NextResponse.json(
      { error: "Token is required" },
      { status: 400 },
    );
  }

  await db
    .insert(connectedApps)
    .values({
      userId: session.user.id,
      appName,
      authType: adapter.authConfig.type,
      accessToken: encrypt(token),
      status: "active",
    })
    .onConflictDoUpdate({
      target: [connectedApps.userId, connectedApps.appName],
      set: {
        accessToken: encrypt(token),
        status: "active",
        updatedAt: new Date(),
      },
    });

  return NextResponse.json({ success: true });
}

// DELETE /api/connect/:app — Disconnect app
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ app: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { app: appName } = await params;

  await db
    .update(connectedApps)
    .set({ status: "revoked", updatedAt: new Date() })
    .where(
      and(
        eq(connectedApps.userId, session.user.id),
        eq(connectedApps.appName, appName),
      ),
    );

  return NextResponse.json({ success: true });
}
