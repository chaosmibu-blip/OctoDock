/**
 * App 請求 / Adapter 提交 API
 * POST /api/submissions — 不需要登入，匿名提交
 * 存 DB + 寄 email 通知
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { appSubmissions } from "@/db/schema";

/* 通知 email（從環境變數讀取，不硬編碼） */
const NOTIFY_EMAIL = process.env.FEEDBACK_EMAIL || "";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { type, appName, email, reason, apiDocsUrl, authType, authDetails, adapterSpec } = body;

    /* 基本驗證 */
    if (!type || !["request", "submit"].includes(type)) {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }
    if (!appName?.trim()) {
      return NextResponse.json({ error: "App name required" }, { status: 400 });
    }
    if (!email?.trim() || !email.includes("@")) {
      return NextResponse.json({ error: "Valid email required" }, { status: 400 });
    }

    /* request 類型需要 reason */
    if (type === "request" && !reason?.trim()) {
      return NextResponse.json({ error: "Reason required for app request" }, { status: 400 });
    }

    /* submit 類型需要 adapter 規格 */
    if (type === "submit") {
      if (!adapterSpec?.trim()) {
        return NextResponse.json({ error: "Adapter spec required" }, { status: 400 });
      }

      /* 驗證 adapter spec 是合法 JSON 且有基本結構 */
      const cleaned = adapterSpec.trim().replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "");
      try {
        const parsed = JSON.parse(cleaned);
        if (!parsed.appName && !parsed.app_name) {
          return NextResponse.json({ error: "Adapter spec missing appName" }, { status: 400 });
        }
        if (!Array.isArray(parsed.actions) || parsed.actions.length === 0) {
          return NextResponse.json({ error: "Adapter spec missing actions array" }, { status: 400 });
        }
      } catch {
        return NextResponse.json({ error: "Adapter spec is not valid JSON" }, { status: 400 });
      }
    }

    /* 存入 DB */
    await db.insert(appSubmissions).values({
      type,
      appName: appName.trim(),
      email: email.trim(),
      reason: reason?.trim() || null,
      apiDocsUrl: apiDocsUrl?.trim() || null,
      authType: authType || null,
      authDetails: authDetails?.trim() || null,
      adapterSpec: adapterSpec?.trim() || null,
    });

    /* 寄 email 通知（非阻塞，失敗不影響回應） */
    const subject = type === "request"
      ? `[OctoDock App Request] ${appName}`
      : `[OctoDock Adapter Submit] ${appName}`;

    const emailBody = type === "request"
      ? `App: ${appName}\nReason: ${reason}\nEmail: ${email}`
      : `App: ${appName}\nAPI Docs: ${apiDocsUrl}\nAuth: ${authType}\nAuth Details: ${authDetails || "(none)"}\nEmail: ${email}\n\nAdapter Spec:\n${adapterSpec}`;

    fetch(`https://formsubmit.co/ajax/${NOTIFY_EMAIL}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        _subject: subject,
        message: emailBody,
      }),
    }).catch(() => { /* email 失敗不影響主流程 */ });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
