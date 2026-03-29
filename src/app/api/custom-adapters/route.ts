/**
 * Custom Adapters API
 * GET  /api/custom-adapters — 列出當前用戶的自訂 adapter
 * POST /api/custom-adapters — 驗證 + 安裝自訂 adapter（spec + API Key → 測試 → 儲存）
 */
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { db } from "@/db";
import { customAdapters, connectedApps } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { encrypt } from "@/lib/crypto";
import { testAdapter, type CustomAdapterSpec } from "@/mcp/custom-adapter-engine";

/** 每用戶每小時安裝/測試上限（防 DDoS 跳板） */
const INSTALL_RATE_LIMIT = 10;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  // 清理過期 entry（防止記憶體無限增長）
  if (rateLimitMap.size > 1000) {
    for (const [key, val] of rateLimitMap) {
      if (now > val.resetAt) rateLimitMap.delete(key);
    }
  }
  const entry = rateLimitMap.get(userId);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + 3600_000 });
    return true;
  }
  if (entry.count >= INSTALL_RATE_LIMIT) return false;
  entry.count++;
  return true;
}

/** 驗證 adapter spec 的基本結構 */
function validateSpec(spec: Record<string, unknown>): string | null {
  if (!spec.appName || typeof spec.appName !== "string") return "missing appName";
  if (!spec.displayName || typeof spec.displayName !== "string") return "missing displayName";
  if (!spec.baseUrl || typeof spec.baseUrl !== "string") return "missing baseUrl";
  if (!Array.isArray(spec.actions) || spec.actions.length === 0) return "missing actions";
  if (!spec.actionMap || typeof spec.actionMap !== "object") return "missing actionMap";
  if (!String(spec.baseUrl).startsWith("https://")) return "baseUrl must use HTTPS";
  return null;
}

/** 清理 spec：只保留已知的安全欄位 */
function sanitizeSpec(spec: Record<string, unknown>): Record<string, unknown> {
  return {
    appName: spec.appName,
    displayName: spec.displayName,
    baseUrl: spec.baseUrl,
    auth: spec.auth,
    actionMap: spec.actionMap,
    actions: spec.actions,
    skillOverview: spec.skillOverview,
    errorHints: spec.errorHints,
  };
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db
    .select()
    .from(customAdapters)
    .where(eq(customAdapters.userId, session.user.id));

  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!checkRateLimit(session.user.id)) {
    return NextResponse.json(
      { error: "Too many installs. Please wait and try again later." },
      { status: 429 },
    );
  }

  const body = await req.json();

  // ── 從 share code 安裝 ──
  if (body.shareCode) {
    const source = await db
      .select()
      .from(customAdapters)
      .where(eq(customAdapters.shareCode, body.shareCode))
      .limit(1);

    if (source.length === 0) {
      return NextResponse.json({ error: "Share code not found" }, { status: 404 });
    }

    const sourceAdapter = source[0];
    const spec = sourceAdapter.spec as Record<string, unknown>;
    const appName = spec.appName as string;

    const existing = await db
      .select()
      .from(customAdapters)
      .where(and(eq(customAdapters.userId, session.user.id), eq(customAdapters.appName, appName)))
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json({ error: "Already installed" }, { status: 409 });
    }

    await db.insert(customAdapters).values({
      userId: session.user.id,
      appName,
      displayName: sourceAdapter.displayName,
      spec: sanitizeSpec(spec),
      installedFrom: body.shareCode,
    });

    return NextResponse.json({ success: true, appName, displayName: sourceAdapter.displayName });
  }

  // ── 自建安裝（spec + apiKey → 測試 → 儲存） ──
  const rawSpec = body.spec;
  // 去除 API Key 中的換行、空格（用戶從終端複製常帶斷行）
  const apiKey = (body.apiKey as string | undefined)?.replace(/\s+/g, "");

  if (!rawSpec) {
    return NextResponse.json({ error: "spec required" }, { status: 400 });
  }

  // 解析 spec
  let parsed: Record<string, unknown>;
  try {
    const cleaned = typeof rawSpec === "string"
      ? rawSpec.trim().replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "")
      : rawSpec;
    parsed = typeof cleaned === "string" ? JSON.parse(cleaned) : cleaned;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const validationError = validateSpec(parsed);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const appName = String(parsed.appName);
  const displayName = String(parsed.displayName);
  const sanitized = sanitizeSpec(parsed);

  // ── 有 API Key → 先測試再安裝 ──
  if (apiKey?.trim()) {
    const testResult = await testAdapter(sanitized as unknown as CustomAdapterSpec, apiKey.trim());

    if (!testResult.ok) {
      return NextResponse.json({
        error: "API test failed",
        testResult,
      }, { status: 422 });
    }

    // 測試通過 → 儲存 spec + 連接 API Key
    await db
      .insert(customAdapters)
      .values({ userId: session.user.id, appName, displayName, spec: sanitized })
      .onConflictDoUpdate({
        target: [customAdapters.userId, customAdapters.appName],
        set: { displayName, spec: sanitized, updatedAt: new Date() },
      });

    // 同時存入 connectedApps（讓 MCP server 認得這個 App 已連結）
    await db
      .insert(connectedApps)
      .values({
        userId: session.user.id,
        appName,
        authType: "api_key",
        accessToken: encrypt(apiKey.trim()),
        status: "active",
      })
      .onConflictDoUpdate({
        target: [connectedApps.userId, connectedApps.appName],
        set: {
          accessToken: encrypt(apiKey.trim()),
          status: "active",
          updatedAt: new Date(),
        },
      });

    return NextResponse.json({
      success: true,
      appName,
      displayName,
      testResult,
    });
  }

  // ── 無 API Key → 只儲存 spec，稍後再連接 ──
  await db
    .insert(customAdapters)
    .values({ userId: session.user.id, appName, displayName, spec: sanitized })
    .onConflictDoUpdate({
      target: [customAdapters.userId, customAdapters.appName],
      set: { displayName, spec: sanitized, updatedAt: new Date() },
    });

  return NextResponse.json({ success: true, appName, displayName });
}
