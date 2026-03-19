import type { MetadataRoute } from "next";

// 自動產生 sitemap.xml，Next.js 會在 /sitemap.xml 路徑提供
export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://octo-dock.com";

  return [
    // 首頁（Landing page）— 最高優先
    { url: base, lastModified: new Date(), changeFrequency: "weekly", priority: 1.0 },
    // 文件頁（給開發者和 AI 爬蟲）
    { url: `${base}/docs`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.8 },
    // AI 可讀格式（讓搜尋引擎索引）
    { url: `${base}/llms.txt`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.6 },
    // 隱私權政策
    { url: `${base}/privacy`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.3 },
    // 服務條款
    { url: `${base}/terms`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.3 },
  ];
  // 注意：dashboard、bots、preferences 是登入後才能用的頁面，不需要被搜尋引擎索引
}
