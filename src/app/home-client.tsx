"use client";

import Link from "next/link";
import { useI18n, LanguageSwitcher } from "@/lib/i18n";

export function HomeClient() {
  const { t } = useI18n();

  /* 痛點清單（不含 icon） */
  const painPoints = [
    { key: "landing.pain1" },
    { key: "landing.pain2" },
    { key: "landing.pain3" },
    { key: "landing.pain4" },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 font-sans dark:bg-black">
      {/* 語言切換 */}
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>

      {/* 主要內容：上方品牌登入（置中）+ 下方痛點（左對齊） */}
      <main className="flex flex-1 flex-col items-center justify-center px-6 py-20">
        {/* 品牌 + 登入：置中 */}
        <div className="flex flex-col items-center gap-6 animate-fadein opacity-0 [animation-delay:0.1s] mb-16">
          <h1 className="text-5xl md:text-6xl font-bold tracking-tight text-black dark:text-zinc-50 text-glow-hero">
            {t("app.title")}
          </h1>
          <p className="max-w-md text-center text-lg text-zinc-600 dark:text-zinc-400 text-glow">
            {t("app.tagline")}
          </p>
          <Link
            href="/api/auth/signin"
            className="flex h-12 items-center justify-center rounded-full bg-black px-8 text-white transition-colors hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200"
          >
            {t("common.login")}
          </Link>
        </div>

        {/* 痛點說明：左對齊，寬度限制 */}
        <div className="w-full max-w-2xl space-y-5">
          <h2 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-zinc-100 text-glow animate-fadein opacity-0 [animation-delay:0.3s]">
            {t("landing.pain_title")}
          </h2>
          {painPoints.map((p, i) => (
            <div
              key={p.key}
              className="animate-fadein opacity-0"
              style={{ animationDelay: `${0.5 + i * 0.15}s` }}
            >
              <p className="text-base text-gray-600 dark:text-zinc-400 leading-relaxed">
                {t(p.key)}
              </p>
            </div>
          ))}
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
