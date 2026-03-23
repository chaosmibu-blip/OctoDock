/* 訂閱方案頁面 — 兩個 tier（Free / Pro）+ Paddle Checkout overlay */
"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { initializePaddle, type Paddle } from "@paddle/paddle-js";

/* metadata 在 layout.tsx（因為此頁面是 client component） */

/* ============================================================
 * Paddle 環境設定
 * NEXT_PUBLIC_PADDLE_CLIENT_TOKEN — Paddle client-side token（sandbox 或 production）
 * NEXT_PUBLIC_PADDLE_ENV — "sandbox" 或 "production"（預設 sandbox）
 * NEXT_PUBLIC_PADDLE_PRO_MONTHLY_PRICE_ID — Pro 月繳的 Price ID
 * NEXT_PUBLIC_PADDLE_PRO_YEARLY_PRICE_ID — Pro 年繳的 Price ID
 * ============================================================ */

export default function PricingPage() {
  /* 月繳/年繳切換 */
  const [annual, setAnnual] = useState(false);
  /* Paddle 實例 */
  const [paddle, setPaddle] = useState<Paddle | null>(null);

  /* 初始化 Paddle SDK */
  useEffect(() => {
    const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
    if (!token) return; // 未設定 token 時不初始化
    const env = (process.env.NEXT_PUBLIC_PADDLE_ENV as "sandbox" | "production") || "sandbox";
    initializePaddle({
      token,
      environment: env,
    }).then((p) => {
      if (p) setPaddle(p);
    });
  }, []);

  /* 開啟 Paddle Checkout overlay */
  const openCheckout = useCallback(() => {
    const priceId = annual
      ? process.env.NEXT_PUBLIC_PADDLE_PRO_YEARLY_PRICE_ID
      : process.env.NEXT_PUBLIC_PADDLE_PRO_MONTHLY_PRICE_ID;

    if (!paddle || !priceId) {
      // Paddle 尚未初始化或 Price ID 未設定 → 導向註冊頁
      window.location.href = "/api/auth/signin";
      return;
    }

    paddle.Checkout.open({
      items: [{ priceId, quantity: 1 }],
    });
  }, [paddle, annual]);

  return (
    <div className="min-h-screen bg-white py-16 px-4">
      <div className="max-w-4xl mx-auto">
        {/* 返回首頁 */}
        <Link href="/" className="text-sm text-gray-500 hover:text-gray-700 no-underline">
          ← Back to OctoDock
        </Link>

        <h1 className="mt-8 text-4xl font-bold text-gray-900 text-center">Pricing</h1>
        <p className="mt-3 text-center text-gray-500 max-w-xl mx-auto">
          One MCP URL. All your apps. Choose the plan that fits your workflow.
        </p>

        {/* 月繳/年繳切換 */}
        <div className="mt-8 flex items-center justify-center gap-3">
          <span className={`text-sm ${!annual ? "text-gray-900 font-medium" : "text-gray-500"}`}>
            Monthly
          </span>
          <button
            onClick={() => setAnnual(!annual)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              annual ? "bg-emerald-600" : "bg-gray-300"
            }`}
            aria-label="Toggle annual billing"
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                annual ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
          <span className={`text-sm ${annual ? "text-gray-900 font-medium" : "text-gray-500"}`}>
            Annual
          </span>
          {annual && (
            <span className="ml-1 text-xs text-emerald-600 font-medium">Save ~17%</span>
          )}
        </div>

        {/* 方案卡片 — 2 欄 */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-8 max-w-3xl mx-auto">

          {/* ── Free ── */}
          <div className="rounded-2xl border border-gray-200 p-8 flex flex-col">
            <h2 className="text-xl font-semibold text-gray-900">Free</h2>
            <p className="mt-2 text-sm text-gray-500">
              Everything you need to get started with AI-powered app integrations.
            </p>

            <div className="mt-6">
              <span className="text-4xl font-bold text-gray-900">Free</span>
            </div>

            <ul className="mt-8 space-y-3 flex-1">
              {[
                "All app connections",
                "Cross-app operations",
                "AI memory (persistent + AI-readable)",
                "1,000 MCP tool calls / month",
              ].map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm text-gray-600">
                  <svg className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  {feature}
                </li>
              ))}
            </ul>

            <Link
              href="/api/auth/signin"
              className="mt-8 block text-center py-3 px-6 rounded-lg font-medium transition-colors no-underline bg-gray-100 text-gray-900 hover:bg-gray-200"
            >
              Get Started
            </Link>
          </div>

          {/* ── Pro ── */}
          <div className="rounded-2xl border border-emerald-500 ring-2 ring-emerald-500 p-8 flex flex-col relative">
            {/* 推薦標籤 */}
            <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-emerald-500 text-white text-xs font-medium px-3 py-1 rounded-full">
              Recommended
            </span>

            <h2 className="text-xl font-semibold text-gray-900">Pro</h2>
            <p className="mt-2 text-sm text-gray-500">
              Unlimited power for professionals who need full AI automation.
            </p>

            <div className="mt-6">
              <span className="text-4xl font-bold text-gray-900">
                ${annual ? 190 : 19}
              </span>
              <span className="text-gray-500 ml-1">{annual ? "/yr" : "/mo"}</span>
            </div>

            <ul className="mt-8 space-y-3 flex-1">
              {[
                "Everything in Free",
                "Unlimited MCP tool calls",
                "Custom SOP workflows",
                "Action Chain (multi-step in one prompt)",
                "Response Compression (save tokens)",
                "Priority processing speed",
              ].map((feature) => (
                <li key={feature} className="flex items-start gap-2 text-sm text-gray-600">
                  <svg className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  {feature}
                </li>
              ))}
            </ul>

            <button
              onClick={openCheckout}
              className="mt-8 block text-center py-3 px-6 rounded-lg font-medium transition-colors bg-emerald-600 text-white hover:bg-emerald-700 cursor-pointer"
            >
              Upgrade to Pro
            </button>
          </div>

        </div>

        {/* 底部連結 */}
        <div className="mt-16 pt-8 border-t border-gray-200 flex flex-wrap gap-6 text-sm">
          <Link href="/refund" className="text-gray-500 hover:text-gray-700 transition-colors">
            Refund Policy
          </Link>
          <Link href="/terms" className="text-gray-500 hover:text-gray-700 transition-colors">
            Terms of Service
          </Link>
          <Link href="/privacy" className="text-gray-500 hover:text-gray-700 transition-colors">
            Privacy Policy
          </Link>
        </div>
      </div>
    </div>
  );
}
