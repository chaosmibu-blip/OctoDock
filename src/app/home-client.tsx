"use client";

import Link from "next/link";
import Image from "next/image";
import { useI18n, LanguageSwitcher } from "@/lib/i18n";

/* Landing Page 預覽用的 App 卡片資料 */
const PREVIEW_CONNECTED = [
  { name: "Notion", actions: 19 },
  { name: "Gmail", actions: 13 },
  { name: "Google Calendar", actions: 11 },
];
const PREVIEW_AVAILABLE = [
  { name: "Google Drive" },
  { name: "YouTube" },
  { name: "GitHub" },
];

export function HomeClient() {
  const { t } = useI18n();

  /* 賣點清單 */
  const sellPoints = [
    { key: "landing.sell1" },
    { key: "landing.sell2" },
    { key: "landing.sell3" },
    { key: "landing.sell4" },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-[#faf9f6] font-sans">
      {/* 語言切換 */}
      <div className="absolute top-4 right-4 z-10">
        <LanguageSwitcher />
      </div>

      {/* 主要內容：左文案 + 右 Dashboard 預覽 */}
      <main className="flex flex-1 items-center justify-center px-6 py-16 md:py-20">
        <div className="flex w-full max-w-6xl flex-col gap-12 lg:flex-row lg:items-center lg:gap-16">

          {/* ── 左側：文案區 ── */}
          <div className="flex-1 space-y-6 animate-fadein opacity-0 [animation-delay:0.1s]">
            {/* 標語 */}
            <p className="text-sm font-semibold text-[#1D9E75] tracking-wide">
              {t("landing.kicker")}
            </p>
            {/* 大標題 */}
            <h1 className="text-3xl md:text-4xl lg:text-[42px] font-bold leading-tight text-gray-900">
              {t("landing.headline")}
            </h1>
            {/* 副標題 */}
            <p className="text-lg text-gray-500 leading-relaxed">
              {t("app.tagline")}
            </p>
            {/* 賣點列表 */}
            <ul className="space-y-3 pt-2">
              {sellPoints.map((p, i) => (
                <li
                  key={p.key}
                  className="flex items-start gap-3 animate-fadein opacity-0"
                  style={{ animationDelay: `${0.3 + i * 0.12}s` }}
                >
                  <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#1D9E75]" />
                  <span className="text-[15px] text-gray-600 leading-relaxed">{t(p.key)}</span>
                </li>
              ))}
            </ul>
            {/* CTA 按鈕 */}
            <div className="pt-4 animate-fadein opacity-0 [animation-delay:0.8s]">
              <Link
                href="/api/auth/signin"
                className="inline-flex h-12 items-center justify-center rounded-lg bg-black px-8 text-white text-sm font-medium transition-colors hover:bg-gray-800"
              >
                {t("common.login")}
              </Link>
            </div>
          </div>

          {/* ── 右側：Dashboard 縮小預覽 ── */}
          <div className="flex-1 animate-fadein opacity-0 [animation-delay:0.3s] hidden md:block">
            <div className="origin-top-right scale-[0.92] rounded-2xl border border-gray-200 bg-white p-5 shadow-lg">
              {/* Nav 預覽 */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Image src="/icon-192.png" alt="OctoDock" width={24} height={24} className="rounded" />
                  <span className="font-bold text-sm text-gray-900">OctoDock</span>
                </div>
                <div className="flex gap-2 text-[10px] text-gray-400">
                  <span className="border rounded px-2 py-0.5">EN</span>
                  <span className="border rounded px-2 py-0.5">記憶</span>
                  <span className="border border-red-200 text-red-400 rounded px-2 py-0.5">登出</span>
                </div>
              </div>
              {/* MCP URL 預覽 */}
              <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 mb-4">
                <span className="text-[10px] text-gray-400 font-medium shrink-0">MCP URL</span>
                <code className="flex-1 text-[10px] font-mono text-gray-500 bg-[#F1EFE8] rounded px-2 py-1 truncate">
                  https://octo-dock.com/mcp/sk-••••••
                </code>
                <span className="text-[10px] bg-black text-white rounded px-2 py-1 shrink-0">複製</span>
              </div>
              {/* 引導區塊預覽 */}
              <div className="rounded-lg bg-[#E1F5EE] p-3 mb-4">
                <p className="text-[10px] text-[#085041] font-medium">✅ 設定完成！複製以下文字，貼到你的 AI 對話中：</p>
                <div className="flex items-center gap-2 mt-1.5">
                  <code className="flex-1 text-[10px] text-[#085041] bg-white/60 rounded px-2 py-1">試試 OctoDock</code>
                  <span className="text-[10px] bg-[#0F6E56] text-white rounded px-2 py-1">一鍵複製</span>
                </div>
              </div>
              {/* 已連結 App 預覽 */}
              <p className="text-[11px] font-semibold text-gray-700 mb-2">已連結 — 3 個應用程式</p>
              <div className="grid grid-cols-3 gap-2 mb-4">
                {PREVIEW_CONNECTED.map((app) => (
                  <div key={app.name} className="rounded-lg border border-gray-200 p-2.5">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[11px] font-medium text-gray-900">{app.name}</span>
                      <span className="text-[9px] bg-[#E1F5EE] text-[#1D9E75] rounded px-1.5 py-0.5">{app.actions}</span>
                    </div>
                    <p className="text-[9px] text-gray-400 leading-tight">搜尋、建立、更新</p>
                    <p className="text-[9px] text-[#B4B2A9] mt-1 cursor-pointer hover:text-[#E24B4A] transition-colors">中斷連結</p>
                  </div>
                ))}
              </div>
              {/* 可連結 App 預覽 */}
              <p className="text-[11px] font-semibold text-gray-700 mb-2">可連結</p>
              <div className="grid grid-cols-3 gap-2">
                {PREVIEW_AVAILABLE.map((app) => (
                  <div key={app.name} className="rounded-lg border border-dashed border-gray-300 p-2.5">
                    <span className="text-[11px] text-gray-400">{app.name}</span>
                    <div className="mt-1.5">
                      <span className="text-[9px] bg-black text-white rounded px-2 py-0.5">連接</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 py-6 text-center text-sm text-gray-400">
        <div className="flex items-center justify-center gap-4">
          <Link href="/privacy" className="hover:text-gray-600 transition-colors">
            {t("footer.privacy")}
          </Link>
          <span>·</span>
          <Link href="/terms" className="hover:text-gray-600 transition-colors">
            {t("footer.terms")}
          </Link>
          <span>·</span>
          <span>© 2026 OctoDock</span>
        </div>
      </footer>
    </div>
  );
}
