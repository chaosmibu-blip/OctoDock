import type { MetadataRoute } from "next";

// 自動產生 robots.txt，告訴搜尋引擎哪些頁面可以爬
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // 登入後的頁面不讓搜尋引擎爬
        disallow: ["/dashboard", "/bots", "/preferences", "/api/", "/mcp/", "/callback/"],
      },
    ],
    sitemap: "https://octo-dock.com/sitemap.xml",
  };
}
