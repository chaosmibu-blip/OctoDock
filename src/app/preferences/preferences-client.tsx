"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useI18n, LanguageSwitcher } from "@/lib/i18n";

interface Memory {
  key: string;
  value: string;
  category: string;
  appName: string | null;
  confidence: number | null;
}

interface PreferencesProps {
  memories: Memory[];
}

const CATEGORY_KEYS: Record<string, string> = {
  preference: "memory.preference",
  pattern: "memory.pattern",
  context: "memory.context",
};

export function PreferencesClient({ memories }: PreferencesProps) {
  const [filter, setFilter] = useState<string>("all");
  const router = useRouter();
  const { t } = useI18n();

  const filtered =
    filter === "all"
      ? memories
      : memories.filter((m) => m.category === filter);

  const deleteMemory = useCallback(
    async (key: string, category: string) => {
      await fetch("/api/memory", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, category }),
      });
      router.refresh();
    },
    [router],
  );

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-3xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{t("memory.title")}</h1>
            <p className="text-gray-500 mt-1">{t("memory.desc")}</p>
          </div>
          <div className="flex gap-2 items-center">
            <LanguageSwitcher />
            <Link
              href="/dashboard"
              className="px-4 py-2 text-sm border rounded hover:bg-gray-100 transition-colors"
            >
              {t("common.back")}
            </Link>
          </div>
        </div>

        {/* Filter */}
        <div className="flex gap-2">
          {["all", "preference", "pattern", "context"].map((cat) => (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              className={`px-3 py-1 text-sm rounded-full transition-colors ${
                filter === cat
                  ? "bg-black text-white"
                  : "bg-gray-200 text-gray-700 hover:bg-gray-300"
              }`}
            >
              {cat === "all" ? t("memory.all") : t(CATEGORY_KEYS[cat])}
            </button>
          ))}
        </div>

        {/* Memory List */}
        <div className="bg-white rounded-lg border">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              {t("memory.empty")}
            </div>
          ) : (
            <div className="divide-y">
              {filtered.map((mem) => (
                <div
                  key={`${mem.category}-${mem.key}`}
                  className="p-4 flex items-start justify-between gap-4"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                        {t(CATEGORY_KEYS[mem.category]) ?? mem.category}
                      </span>
                      {mem.appName && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">
                          {mem.appName}
                        </span>
                      )}
                      {mem.confidence !== null && (
                        <span className="text-xs text-gray-400">
                          {Math.round(mem.confidence * 100)}%
                        </span>
                      )}
                    </div>
                    <p className="font-medium text-gray-900 text-sm">
                      {mem.key}
                    </p>
                    <p className="text-sm text-gray-600 mt-0.5">{mem.value}</p>
                  </div>
                  <button
                    onClick={() => deleteMemory(mem.key, mem.category)}
                    className="text-xs text-red-500 hover:text-red-700 whitespace-nowrap"
                  >
                    {t("common.delete")}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
