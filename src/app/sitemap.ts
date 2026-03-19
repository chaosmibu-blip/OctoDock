import type { MetadataRoute } from "next";
import { fetchPublishedPosts } from "@/lib/notion-blog";

/**
 * 自動產生 sitemap.xml
 * Next.js 會在 /sitemap.xml 路徑提供
 * 動態包含所有已發佈的 Blog 文章
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = "https://octo-dock.com";

  // 靜態頁面
  const staticPages: MetadataRoute.Sitemap = [
    // 首頁（Landing page）— 最高優先
    { url: base, lastModified: new Date(), changeFrequency: "weekly", priority: 1.0 },
    // Blog 列表頁
    { url: `${base}/blog`, lastModified: new Date(), changeFrequency: "daily", priority: 0.9 },
    // 文件頁（給開發者和 AI 爬蟲）
    { url: `${base}/docs`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.8 },
    // AI 可讀格式（讓搜尋引擎索引）
    { url: `${base}/llms.txt`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.6 },
    // 隱私權政策
    { url: `${base}/privacy`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.3 },
    // 服務條款
    { url: `${base}/terms`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.3 },
  ];

  // 動態拉取已發佈的 Blog 文章
  let blogPages: MetadataRoute.Sitemap = [];
  try {
    const posts = await fetchPublishedPosts();
    blogPages = posts
      .filter((p) => p.slug) // 確保有 slug
      .map((post) => ({
        url: `${base}/blog/${post.slug}`,
        lastModified: post.publishedDate ? new Date(post.publishedDate) : new Date(),
        changeFrequency: "monthly" as const,
        priority: 0.7,
      }));
  } catch {
    // Blog 拉取失敗不影響靜態頁面的 sitemap
  }

  return [...staticPages, ...blogPages];
  // 注意：dashboard、bots、preferences 是登入後才能用的頁面，不需要被搜尋引擎索引
}
