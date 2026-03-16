"use client";

import Link from "next/link";
import { useI18n, LanguageSwitcher } from "@/lib/i18n";

export function HomeClient() {
  const { t } = useI18n();

  /* 痛點清單 */
  const painPoints = [
    { icon: "🔌", key: "landing.pain1" },
    { icon: "🔑", key: "landing.pain2" },
    { icon: "🤖", key: "landing.pain3" },
    { icon: "🧠", key: "landing.pain4" },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 font-sans dark:bg-black">
      {/* 語言切換 */}
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>

      {/* 主要內容：左側痛點 + 右側登入 */}
      <main className="flex flex-1 items-center justify-center px-6 py-20">
        <div className="flex w-full max-w-4xl flex-col items-center gap-16 md:flex-row md:gap-20">

          {/* 左側：痛點說明（淡入動畫） */}
          <div className="flex-1 space-y-6">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-zinc-100 animate-fadein opacity-0 [animation-delay:0.1s]">
              {t("landing.pain_title")}
            </h2>
            {painPoints.map((p, i) => (
              <div
                key={p.key}
                className="flex items-start gap-3 animate-fadein opacity-0"
                style={{ animationDelay: `${0.3 + i * 0.2}s` }}
              >
                <span className="text-2xl leading-none">{p.icon}</span>
                <p className="text-base text-gray-600 dark:text-zinc-400">{t(p.key)}</p>
              </div>
            ))}
          </div>

          {/* 右側：品牌 + 登入 */}
          <div className="flex flex-col items-center gap-6 animate-fadein opacity-0 [animation-delay:0.2s]">
            <h1 className="text-4xl font-bold tracking-tight text-black dark:text-zinc-50">
              {t("app.title")}
            </h1>
            <p className="max-w-sm text-center text-lg text-zinc-600 dark:text-zinc-400">
              {t("app.tagline")}
            </p>
            <Link
              href="/api/auth/signin"
              className="flex h-12 items-center justify-center rounded-full bg-black px-8 text-white transition-colors hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200"
            >
              {t("common.login")}
            </Link>
          </div>
        </div>
      </main>

      {/* Footer：隱私權政策 + 服務條款 */}
      <footer className="border-t border-zinc-200 py-6 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-500">
        <div className="flex items-center justify-center gap-4">
          <Link href="/privacy" className="hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors">
            {t("footer.privacy")}
          </Link>
          <span>·</span>
          <Link href="/terms" className="hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors">
            {t("footer.terms")}
          </Link>
          <span>·</span>
          <span>© 2026 OctoDock</span>
        </div>
      </footer>
    </div>
  );
}
