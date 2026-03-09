"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

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

const CATEGORY_LABELS: Record<string, string> = {
  preference: "偏好",
  pattern: "模式",
  context: "脈絡",
};

export function PreferencesClient({ memories }: PreferencesProps) {
  const [filter, setFilter] = useState<string>("all");
  const router = useRouter();

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
            <h1 className="text-2xl font-bold text-gray-900">記憶</h1>
            <p className="text-gray-500 mt-1">
              你的跨 agent 記憶。這些偏好和模式會在所有 AI agent 之間共享。
            </p>
          </div>
          <Link
            href="/dashboard"
            className="px-4 py-2 text-sm border rounded hover:bg-gray-100 transition-colors"
          >
            返回主控台
          </Link>
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
              {cat === "all" ? "全部" : CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>

        {/* Memory List */}
        <div className="bg-white rounded-lg border">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              尚無記憶。隨著你使用 AgentDock，AI agent 會逐漸學習你的偏好。
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
                        {CATEGORY_LABELS[mem.category] ?? mem.category}
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
                    刪除
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
