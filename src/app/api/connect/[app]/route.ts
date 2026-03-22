import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { connectedApps } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getAdapter, ensureAdapters } from "@/mcp/registry";
import { APP_URL } from "@/lib/constants";
import type { OAuthConfig, ApiKeyConfig, PhoneAuthConfig } from "@/adapters/types";
import { encrypt } from "@/lib/crypto";
import { getOAuthClientId } from "@/lib/oauth-env";

// Google 系列 App 名稱（用於一鍵連接）
const GOOGLE_APPS = ["gmail", "google_calendar", "google_drive", "google_sheets", "google_docs", "google_tasks", "youtube"];

import { createHmac, randomBytes, createHash } from "crypto";

/** HMAC 簽名用的 key — 用 TOKEN_ENCRYPTION_KEY 派生，確保無法偽造 state */
function getStateKey(): string {
  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key) throw new Error("TOKEN_ENCRYPTION_KEY not set");
  return createHmac("sha256", key).update("oauth-state-signing").digest("hex");
}

/** 產生帶 HMAC 簽名的 OAuth state 參數（CSRF 保護 + 來源追蹤 + U21 PKCE code_verifier） */
function generateState(userId: string, from?: string, codeVerifier?: string): string {
  const payload: Record<string, unknown> = { userId, ts: Date.now(), r: Math.random().toString(36) };
  if (from) payload.from = from;
  if (codeVerifier) payload.cv = codeVerifier; // U21: PKCE code_verifier 嵌入 state
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
        // U21: PKCE — 如果 adapter 聲明需要 code_challenge_method，自動產生 PKCE 參數
        if (key === "code_challenge_method" && value === "S256") {
          // 產生 code_verifier（43-128 字元的隨機 base64url 字串）
          const codeVerifier = randomBytes(32).toString("base64url");
          // 計算 code_challenge = base64url(sha256(code_verifier))
          const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
          authUrl.searchParams.set("code_challenge_method", "S256");
          authUrl.searchParams.set("code_challenge", codeChallenge);
          // 把 code_verifier 加密嵌入 state 參數（不依賴 cookie，避免跨站丟失）
          // 重新產生 state，把 code_verifier 放進 payload
          const pkceState = generateState(session.user.id, from, codeVerifier);
          authUrl.searchParams.set("state", pkceState);
          continue;
        }
        authUrl.searchParams.set(key, value);
      }
    }

    return NextResponse.redirect(authUrl.toString());
  }

  // API key / Bot token / Phone auth — return instructions
  const instructions = (adapter.authConfig as ApiKeyConfig | PhoneAuthConfig).instructions;
  return NextResponse.json({
    authType: adapter.authConfig.type,
    instructions,
  });
}

// ── Phone Auth 暫存（send_code → verify 之間保留 TelegramClient） ──
// key = userId:appName, value = { client, phoneCodeHash, phone, timer }
/** TelegramClient 的最小型別（避免 import 整個 GramJS） */
interface TgClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  invoke(request: unknown): Promise<unknown>;
  session: { save(): string };
}
const phoneAuthPending = new Map<string, {
  client: TgClient;
  phoneCodeHash: string;
  phone: string;
  timer: ReturnType<typeof setTimeout>;
}>();

/** 清理暫存的 phone auth client（5 分鐘 TTL） */
function setPhoneAuthTTL(key: string) {
  const existing = phoneAuthPending.get(key);
  if (existing?.timer) clearTimeout(existing.timer);
  const timer = setTimeout(async () => {
    const entry = phoneAuthPending.get(key);
    if (entry) {
      try { await entry.client.disconnect(); } catch { /* ignore */ }
      phoneAuthPending.delete(key);
    }
  }, 5 * 60 * 1000); // 5 分鐘
  return timer;
}

// POST /api/connect/:app — Submit API key, bot token, or phone auth steps
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

  // ── phone_auth 多步驟認證 ──
  if (adapter.authConfig.type === "phone_auth") {
    const step = body.step as string;
    const pendingKey = `${session.user.id}:${appName}`;

    // 步驟 1：發送驗證碼
    if (step === "send_code") {
      const phone = body.phone as string;
      if (!phone) {
        return NextResponse.json({ error: "Phone number required" }, { status: 400 });
      }

      try {
        const { TelegramClient } = await import("telegram");
        const { StringSession } = await import("telegram/sessions");
        const { Api } = await import("telegram");
        const apiId = parseInt(process.env.TG_API_ID || "", 10);
        const apiHash = process.env.TG_API_HASH || "";
        if (!apiId || !apiHash) {
          return NextResponse.json({ error: "TG_API_ID / TG_API_HASH not configured" }, { status: 500 });
        }

        /* 清理之前的暫存 client（如果有） */
        const old = phoneAuthPending.get(pendingKey);
        if (old) {
          try { await old.client.disconnect(); } catch { /* ignore */ }
          clearTimeout(old.timer);
          phoneAuthPending.delete(pendingKey);
        }

        const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
          connectionRetries: 3,
        }) as unknown as TgClient;
        await client.connect();

        const sendCodeResult = await client.invoke(new Api.auth.SendCode({
          phoneNumber: phone,
          apiId,
          apiHash,
          settings: new Api.CodeSettings({}),
        }));
        const result = sendCodeResult as { phoneCodeHash: string };

        const timer = setPhoneAuthTTL(pendingKey);
        phoneAuthPending.set(pendingKey, {
          client,
          phoneCodeHash: result.phoneCodeHash,
          phone,
          timer,
        });

        return NextResponse.json({ step: "code_sent", phoneCodeHash: result.phoneCodeHash });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("PHONE_NUMBER_INVALID")) {
          return NextResponse.json({ error: "手機號碼格式錯誤，請包含國碼（如 +886912345678）" }, { status: 400 });
        }
        if (msg.includes("PHONE_NUMBER_FLOOD")) {
          return NextResponse.json({ error: "此號碼發送驗證碼太頻繁，請稍後再試" }, { status: 429 });
        }
        return NextResponse.json({ error: msg }, { status: 500 });
      }
    }

    // 步驟 2：驗證碼
    if (step === "verify") {
      const code = body.code as string;
      const pending = phoneAuthPending.get(pendingKey);
      if (!pending) {
        return NextResponse.json({ error: "No pending auth. Please send code again." }, { status: 400 });
      }

      try {
        const { Api } = await import("telegram");
        const client = pending.client;

        await client.invoke(new Api.auth.SignIn({
          phoneNumber: pending.phone,
          phoneCodeHash: pending.phoneCodeHash,
          phoneCode: code,
        }));

        /* 登入成功 → 儲存 StringSession */
        const sessionString = client.session.save();
        clearTimeout(pending.timer);
        phoneAuthPending.delete(pendingKey);
        try { await client.disconnect(); } catch { /* ignore */ }

        await db
          .insert(connectedApps)
          .values({
            userId: session.user.id,
            appName,
            authType: "phone_auth",
            accessToken: encrypt(sessionString),
            status: "active",
          })
          .onConflictDoUpdate({
            target: [connectedApps.userId, connectedApps.appName],
            set: {
              accessToken: encrypt(sessionString),
              status: "active",
              updatedAt: new Date(),
            },
          });

        return NextResponse.json({ success: true });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        /* 需要 2FA 密碼 */
        if (msg.includes("SESSION_PASSWORD_NEEDED")) {
          return NextResponse.json({ step: "need_2fa" });
        }
        if (msg.includes("PHONE_CODE_INVALID") || msg.includes("PHONE_CODE_EXPIRED")) {
          return NextResponse.json({ error: "驗證碼錯誤或已過期，請重新發送" }, { status: 400 });
        }
        return NextResponse.json({ error: msg }, { status: 500 });
      }
    }

    // 步驟 3：2FA 密碼
    if (step === "2fa") {
      const password = body.password as string;
      const pending = phoneAuthPending.get(pendingKey);
      if (!pending) {
        return NextResponse.json({ error: "No pending auth. Please start over." }, { status: 400 });
      }

      try {
        const client = pending.client;
        /* GramJS 的 checkPassword 需要用 computeCheck */
        const { Api } = await import("telegram");
        const { computeCheck } = await import("telegram/Password");
        const passwordInfo = await client.invoke(new Api.account.GetPassword()) as import("telegram/tl/api").Api.account.Password;
        const passwordCheck = await computeCheck(passwordInfo, password);
        await client.invoke(new Api.auth.CheckPassword({ password: passwordCheck as unknown as import("telegram/tl/api").Api.TypeInputCheckPasswordSRP }));

        /* 2FA 驗證成功 → 儲存 StringSession */
        const sessionString = client.session.save();
        clearTimeout(pending.timer);
        phoneAuthPending.delete(pendingKey);
        try { await client.disconnect(); } catch { /* ignore */ }

        await db
          .insert(connectedApps)
          .values({
            userId: session.user.id,
            appName,
            authType: "phone_auth",
            accessToken: encrypt(sessionString),
            status: "active",
          })
          .onConflictDoUpdate({
            target: [connectedApps.userId, connectedApps.appName],
            set: {
              accessToken: encrypt(sessionString),
              status: "active",
              updatedAt: new Date(),
            },
          });

        return NextResponse.json({ success: true });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("PASSWORD_HASH_INVALID")) {
          return NextResponse.json({ error: "2FA 密碼錯誤" }, { status: 400 });
        }
        return NextResponse.json({ error: msg }, { status: 500 });
      }
    }

    return NextResponse.json({ error: "Invalid step" }, { status: 400 });
  }

  // ── API key / Bot token ──
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
