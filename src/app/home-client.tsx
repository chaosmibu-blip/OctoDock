"use client";

import Link from "next/link";
import { useI18n, LanguageSwitcher } from "@/lib/i18n";

export function HomeClient() {
  const { t } = useI18n();

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>
      <main className="flex flex-col items-center gap-8 py-32 px-16">
        <h1 className="text-4xl font-bold tracking-tight text-black dark:text-zinc-50">
          {t("app.title")}
        </h1>
        <p className="max-w-md text-center text-lg text-zinc-600 dark:text-zinc-400">
          {t("app.tagline")}
        </p>
        <Link
          href="/api/auth/signin"
          className="flex h-12 items-center justify-center rounded-full bg-black px-8 text-white transition-colors hover:bg-gray-800 dark:bg-white dark:text-black dark:hover:bg-gray-200"
        >
          {t("common.login")}
        </Link>
      </main>
    </div>
  );
}
