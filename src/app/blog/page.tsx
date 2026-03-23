/**
 * /blog — Blog 列表頁
 * ISR 從 Notion Blog 資料庫拉 published 文章
 * 支援 Category 和 Language 篩選
 */
import type { Metadata } from "next";
import Link from "next/link";
import { fetchPublishedPosts } from "@/lib/notion-blog";
import { BASE_URL } from "@/lib/constants";

// ISR: 1 小時重新驗證
export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Blog",
  description: "MCP 教學、AI 工具串接指南、跨 App 工作流程自動化 — OctoDock Blog",
  alternates: { canonical: `${BASE_URL}/blog` },
};

/** 分類標籤的顏色對應 */
const CATEGORY_COLORS: Record<string, string> = {
  tutorial: "bg-emerald-100 text-emerald-800",
  thought: "bg-purple-100 text-purple-800",
  changelog: "bg-blue-100 text-blue-800",
  comparison: "bg-orange-100 text-orange-800",
};

/** 語言標籤顯示 */
const LANG_LABELS: Record<string, string> = {
  "zh-Hant": "繁中",
  en: "EN",
};

export default async function BlogPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; lang?: string }>;
}) {
  const params = await searchParams;
  const posts = await fetchPublishedPosts();

  // 篩選
  let filtered = posts;
  if (params.category) {
    filtered = filtered.filter((p) => p.category === params.category);
  }
  if (params.lang) {
    filtered = filtered.filter((p) => p.language === params.lang);
  }

  // 收集所有分類和語言（用於篩選器）
  const categories = [...new Set(posts.map((p) => p.category).filter(Boolean))];
  const languages = [...new Set(posts.map((p) => p.language).filter(Boolean))];

  return (
    <main className="max-w-4xl mx-auto px-6 py-12">
      {/* 頁面標題 */}
      <h1 className="text-3xl font-bold mb-2">OctoDock Blog</h1>
      <p className="text-gray-500 mb-8">
        MCP 教學、AI 工具串接指南、跨 App 工作流程自動化
      </p>

      {/* 篩選器 */}
      {(categories.length > 0 || languages.length > 0) && (
        <div className="flex flex-wrap gap-2 mb-8">
          <Link
            href="/blog"
            className={`px-3 py-1 rounded-full text-sm border transition-colors ${
              !params.category && !params.lang
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
            }`}
          >
            全部
          </Link>
          {categories.map((cat) => (
            <Link
              key={cat}
              href={`/blog?category=${cat}`}
              className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                params.category === cat
                  ? "bg-gray-900 text-white border-gray-900"
                  : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
              }`}
            >
              {cat}
            </Link>
          ))}
          <span className="text-gray-300 mx-1">|</span>
          {languages.map((lang) => (
            <Link
              key={lang}
              href={`/blog?lang=${lang}`}
              className={`px-3 py-1 rounded-full text-sm border transition-colors ${
                params.lang === lang
                  ? "bg-gray-900 text-white border-gray-900"
                  : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
              }`}
            >
              {LANG_LABELS[lang] ?? lang}
            </Link>
          ))}
        </div>
      )}

      {/* 文章列表 */}
      {filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-lg mb-2">目前沒有已發佈的文章</p>
          <p className="text-sm">文章發佈後會自動出現在這裡</p>
        </div>
      ) : (
        <div className="space-y-6">
          {filtered.map((post) => (
            <article
              key={post.id}
              className="group border border-gray-100 rounded-lg p-6 hover:border-gray-300 hover:shadow-sm transition-all"
            >
              <Link href={`/blog/${post.slug}`} className="block">
                {/* 標籤列 */}
                <div className="flex flex-wrap gap-2 mb-2">
                  {post.category && (
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium ${
                        CATEGORY_COLORS[post.category] ?? "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {post.category}
                    </span>
                  )}
                  {post.language && (
                    <span className="px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-500">
                      {LANG_LABELS[post.language] ?? post.language}
                    </span>
                  )}
                  {post.aiTool && (
                    <span className="px-2 py-0.5 rounded text-xs bg-sky-50 text-sky-700">
                      {post.aiTool}
                    </span>
                  )}
                  {post.app && (
                    <span className="px-2 py-0.5 rounded text-xs bg-amber-50 text-amber-700">
                      {post.app}
                    </span>
                  )}
                </div>

                {/* 標題 */}
                <h2 className="text-xl font-semibold text-gray-900 group-hover:text-emerald-700 transition-colors">
                  {post.title}
                </h2>

                {/* 日期 */}
                {post.publishedDate && (
                  <p className="text-sm text-gray-400 mt-2">
                    {new Date(post.publishedDate).toLocaleDateString("zh-TW", {
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </p>
                )}
              </Link>
            </article>
          ))}
        </div>
      )}

      {/* 返回首頁 */}
      <div className="mt-12 pt-8 border-t border-gray-100">
        <Link href="/" className="text-sm text-gray-400 hover:text-gray-600">
          ← 返回 OctoDock
        </Link>
      </div>
    </main>
  );
}
