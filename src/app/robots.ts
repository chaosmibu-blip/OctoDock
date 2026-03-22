import type { MetadataRoute } from "next";

/**
 * 自動產生 robots.txt
 * 允許所有搜尋引擎和 AI 爬蟲，只擋登入後頁面和 API 端點
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        /* 登入後的頁面 + API 端點不讓搜尋引擎爬 */
        disallow: [
          "/dashboard",
          "/bots",
          "/preferences",
          "/skill-tree",
          "/schedules",
          "/api/",
          "/mcp/",
          "/callback/",
          "/oauth/",
        ],
      },
      /* 歡迎 AI 爬蟲，明確允許 llms.txt */
      { userAgent: "GPTBot", allow: ["/", "/llms.txt", "/llms-full.txt", "/docs", "/.well-known/"] },
      { userAgent: "Claude-Web", allow: ["/", "/llms.txt", "/llms-full.txt"] },
      { userAgent: "Anthropic-AI", allow: "/" },
      { userAgent: "Google-Extended", allow: "/" },
      { userAgent: "PerplexityBot", allow: "/" },
      { userAgent: "YouBot", allow: "/" },
    ],
    sitemap: "https://octo-dock.com/sitemap.xml",
  };
}
