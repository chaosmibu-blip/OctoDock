/* 訂閱方案頁面 — Paddle KYB 驗證用 */
"use client";

import Link from "next/link";
import { useState } from "react";

/* metadata 需要在 server component，改用 layout 或 head 處理 */
/* 因為此頁面使用 client component（月繳/年繳切換），metadata 移到 layout.tsx */

/* 方案定義 */
const plans = [
  {
    name: "Free",
    monthlyPrice: 0,
    yearlyPrice: 0,
    description: "Get started with basic AI-powered app integrations.",
    features: [
      "Connect up to 3 apps",
      "Basic MCP endpoint",
      "Session memory (current session only)",
      "Community support",
    ],
    cta: "Get Started",
    highlighted: false,
  },
  {
    name: "Pro",
    monthlyPrice: 19,
    yearlyPrice: 190,
    description: "Full power for individuals who want persistent AI memory.",
    features: [
      "Unlimited app connections",
      "Persistent cross-agent memory",
      "SOP auto-detection & workflows",
      "Pre-context & action chains",
      "Smart parameter suggestions",
      "Priority support",
    ],
    cta: "Upgrade to Pro",
    highlighted: true,
  },
  {
    name: "Team",
    monthlyPrice: 49,
    yearlyPrice: 490,
    description: "Collaborate with shared memory and team management.",
    features: [
      "Everything in Pro",
      "Multi-user team workspace",
      "Shared memory across team members",
      "Team admin & role management",
      "Shared SOPs & workflows",
      "Dedicated support",
    ],
    cta: "Start Team Plan",
    highlighted: false,
  },
];

export default function PricingPage() {
  /* 月繳/年繳切換 */
  const [annual, setAnnual] = useState(false);

  return (
    <div className="min-h-screen bg-white py-16 px-4">
      <div className="max-w-5xl mx-auto">
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

        {/* 方案卡片 */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-8">
          {plans.map((plan) => {
            const price = annual ? plan.yearlyPrice : plan.monthlyPrice;
            const period = annual ? "/yr" : "/mo";

            return (
              <div
                key={plan.name}
                className={`rounded-2xl border p-8 flex flex-col ${
                  plan.highlighted
                    ? "border-emerald-500 ring-2 ring-emerald-500 relative"
                    : "border-gray-200"
                }`}
              >
                {/* 推薦標籤 */}
                {plan.highlighted && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-emerald-500 text-white text-xs font-medium px-3 py-1 rounded-full">
                    Most Popular
                  </span>
                )}

                <h2 className="text-xl font-semibold text-gray-900">{plan.name}</h2>
                <p className="mt-2 text-sm text-gray-500">{plan.description}</p>

                {/* 價格 */}
                <div className="mt-6">
                  {price === 0 ? (
                    <span className="text-4xl font-bold text-gray-900">Free</span>
                  ) : (
                    <>
                      <span className="text-4xl font-bold text-gray-900">${price}</span>
                      <span className="text-gray-500 ml-1">{period}</span>
                    </>
                  )}
                </div>

                {/* 功能列表 */}
                <ul className="mt-8 space-y-3 flex-1">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm text-gray-600">
                      <svg
                        className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                      {feature}
                    </li>
                  ))}
                </ul>

                {/* CTA 按鈕 */}
                <a
                  href="#"
                  className={`mt-8 block text-center py-3 px-6 rounded-lg font-medium transition-colors no-underline ${
                    plan.highlighted
                      ? "bg-emerald-600 text-white hover:bg-emerald-700"
                      : "bg-gray-100 text-gray-900 hover:bg-gray-200"
                  }`}
                >
                  {plan.cta}
                </a>
              </div>
            );
          })}
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
