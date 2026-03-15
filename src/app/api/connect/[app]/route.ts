import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { connectedApps } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getAdapter, loadAdapters } from "@/mcp/registry";
import { APP_URL } from "@/lib/constants";
import type { OAuthConfig, ApiKeyConfig } from "@/adapters/types";
import { encrypt } from "@/lib/crypto";
import { getOAuthClientId } from "@/lib/oauth-env";

let adaptersLoaded = false;

async function ensureAdapters() {
  if (!adaptersLoaded) {
    await loadAdapters();
    adaptersLoaded = true;
  }
}

// Generate OAuth state parameter (CSRF protection)
function generateState(userId: string): string {
  const payload = { userId, ts: Date.now(), r: Math.random().toString(36) };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

// GET /api/connect/:app — Initiate OAuth flow or show API key form
export async function GET(
  _req: NextRequest,
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

  if (adapter.authConfig.type === "oauth2") {
    const config = adapter.authConfig as OAuthConfig;
    const state = generateState(session.user.id);
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

    // Google 系全部需要 offline access 才能拿到 refresh token
    const googleApps = ["gmail", "google_calendar", "google_drive", "google_sheets", "google_docs", "google_tasks", "youtube"];
    if (googleApps.includes(appName)) {
      authUrl.searchParams.set("access_type", "offline");
      authUrl.searchParams.set("prompt", "consent");
    }

    // Notion-specific: owner=user
    if (appName === "notion") {
      authUrl.searchParams.set("owner", "user");
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
