/**
 * /blog/[slug] — Blog 文章頁
 * ISR 從 Notion 拉單篇文章的 Markdown 內容渲染成 HTML
 * 包含 SEO metadata、Article schema、驗證時間標記
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { marked } from "marked";
import { fetchPostBySlug, fetchPostContent, fetchPublishedPosts } from "@/lib/notion-blog";
import { BASE_URL } from "@/lib/constants";

// ISR: 1 小時重新驗證
export const revalidate = 3600;

/** Build 時預先渲染所有已發布文章 — 讓爬蟲第一次來就拿到完整 HTML */
export async function generateStaticParams() {
  const posts = await fetchPublishedPosts();
  return posts.map((post) => ({ slug: post.slug }));
}

/** 動態產生 SEO metadata */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await fetchPostBySlug(slug);
  if (!post) return { title: "文章不存在" };

  return {
    title: post.title,
    description: `${post.title} — ${post.category} | OctoDock Blog`,
    alternates: { canonical: `${BASE_URL}/blog/${slug}` },
    openGraph: {
      type: "article",
      title: post.title,
      description: `${post.title} — ${post.category}`,
      url: `${BASE_URL}/blog/${slug}`,
      siteName: "OctoDock",
      locale: post.language === "en" ? "en_US" : "zh_TW",
      publishedTime: post.publishedDate ?? undefined,
    },
    twitter: {
      card: "summary",
      title: post.title,
    },
  };
}

/** 分類標籤顏色 */
const CATEGORY_COLORS: Record<string, string> = {
  tutorial: "bg-emerald-100 text-emerald-800",
  thought: "bg-purple-100 text-purple-800",
  changelog: "bg-blue-100 text-blue-800",
  comparison: "bg-orange-100 text-orange-800",
};

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await fetchPostBySlug(slug);
  if (!post) notFound();

  // 拉取文章 Markdown 內容
  const markdown = await fetchPostContent(post.id);

  // Markdown → HTML
  const html = await marked(markdown, {
    gfm: true, // 支援 GitHub Flavored Markdown（表格、刪除線等）
    breaks: true, // 換行轉 <br>
  });

  // 取第一段文字作為 description（給 structured data 用）
  const firstParagraph = markdown
    .split("\n")
    .find((line) => line.trim() && !line.startsWith("#") && !line.startsWith("```"))
    ?.trim() ?? "";

  return (
    <>
      {/* Article schema 結構化資料 */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Article",
            headline: post.title,
            description: firstParagraph.substring(0, 200),
            datePublished: post.publishedDate,
            author: { "@type": "Organization", name: "OctoDock" },
            publisher: {
              "@type": "Organization",
              name: "OctoDock",
              logo: { "@type": "ImageObject", url: `${BASE_URL}/icon-512.png` },
            },
            mainEntityOfPage: {
              "@type": "WebPage",
              "@id": `${BASE_URL}/blog/${slug}`,
            },
          }),
        }}
      />

      {/* BreadcrumbList 結構化資料 — Google 搜尋結果顯示路徑導航 */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              {
                "@type": "ListItem",
                position: 1,
                name: "首頁",
                item: BASE_URL,
              },
              {
                "@type": "ListItem",
                position: 2,
                name: "Blog",
                item: `${BASE_URL}/blog`,
              },
              {
                "@type": "ListItem",
                position: 3,
                name: post.title,
                item: `${BASE_URL}/blog/${slug}`,
              },
            ],
          }),
        }}
      />

      <main className="max-w-3xl mx-auto px-6 py-12">
        {/* 返回列表 */}
        <Link
          href="/blog"
          className="text-sm text-gray-400 hover:text-gray-600 mb-8 inline-block"
        >
          ← 所有文章
        </Link>

        {/* 文章標頭 */}
        <header className="mb-8">
          {/* 標籤 */}
          <div className="flex flex-wrap gap-2 mb-3">
            {post.category && (
              <span
                className={`px-2 py-0.5 rounded text-xs font-medium ${
                  CATEGORY_COLORS[post.category] ?? "bg-gray-100 text-gray-600"
                }`}
              >
                {post.category}
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

          <h1 className="text-3xl font-bold text-gray-900 leading-tight">
            {post.title}
          </h1>

          {post.publishedDate && (
            <p className="text-sm text-gray-400 mt-3">
              {new Date(post.publishedDate).toLocaleDateString(
                post.language === "en" ? "en-US" : "zh-TW",
                { year: "numeric", month: "long", day: "numeric" },
              )}
            </p>
          )}
        </header>

        {/* 文章內容 */}
        <article
          className="prose prose-gray max-w-none
            prose-headings:text-gray-900 prose-headings:font-semibold
            prose-h2:text-2xl prose-h2:mt-10 prose-h2:mb-4
            prose-h3:text-xl prose-h3:mt-8 prose-h3:mb-3
            prose-p:text-gray-700 prose-p:leading-relaxed
            prose-a:text-emerald-700 prose-a:no-underline hover:prose-a:underline
            prose-code:bg-gray-100 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm
            prose-pre:bg-gray-900 prose-pre:text-gray-100
            prose-blockquote:border-emerald-500 prose-blockquote:text-gray-600
            prose-table:text-sm
            prose-img:rounded-lg prose-img:shadow-md"
          dangerouslySetInnerHTML={{ __html: html }}
        />

        {/* 驗證時間標記 */}
        {post.publishedDate && (
          <div className="mt-12 pt-6 border-t border-gray-100">
            <p className="text-xs text-gray-400 flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />
              截至{" "}
              {new Date(post.publishedDate).toLocaleDateString("zh-TW", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}{" "}
              驗證有效
            </p>
          </div>
        )}

        {/* 底部導航 */}
        <div className="mt-8 pt-8 border-t border-gray-100 flex justify-between">
          <Link href="/blog" className="text-sm text-gray-400 hover:text-gray-600">
            ← 所有文章
          </Link>
          <Link href="/" className="text-sm text-gray-400 hover:text-gray-600">
            OctoDock 首頁 →
          </Link>
        </div>
      </main>
    </>
  );
}
