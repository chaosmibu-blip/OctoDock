import { z } from "zod";
import type {
  AppAdapter,
  OAuthConfig,
  ToolDefinition,
  ToolResult,
  TokenSet,
} from "./types";

// ============================================================
// OAuth 認證設定
// Instagram 透過 Facebook OAuth 進行授權
// ============================================================
const authConfig: OAuthConfig = {
  type: "oauth2",
  authorizeUrl: "https://www.facebook.com/dialog/oauth",
  tokenUrl: "https://graph.facebook.com/v21.0/oauth/access_token",
  scopes: [
    "instagram_basic",
    "instagram_content_publish",
    "instagram_manage_comments",
    "instagram_manage_insights",
    "pages_show_list",
    "pages_read_engagement",
  ],
  authMethod: "post",
};

const GRAPH_API = "https://graph.facebook.com/v21.0";

// ============================================================
// do+help 架構：actionMap / getSkill / formatResponse
// 讓 agent 能用自然語言對應工具、取得技能說明、格式化回應
// ============================================================

/** 自然語言動作 → MCP 工具名稱對應表 */
const actionMap: Record<string, string> = {
  publish: "instagram_publish",
  get_posts: "instagram_get_posts",
  reply_comment: "instagram_reply_comment",
  get_comments: "instagram_get_comments",
  get_insights: "instagram_get_insights",
};

/** 回傳 Instagram adapter 的技能說明（供 agent 理解可用操作） */
function getSkill(): string {
  return `instagram actions:
  publish(image_url, caption?) — publish photo post (requires public image URL)
  get_posts(limit?) — get recent posts with engagement stats
  reply_comment(comment_id, message) — reply to a comment
  get_comments(media_id, limit?) — get post comments
  get_insights(media_id) — get post metrics (impressions, reach, likes, etc.)
Requires Instagram Business account linked to Facebook Page.`;
}

/** 將 API 原始回應格式化為人類可讀的摘要文字 */
/* eslint-disable @typescript-eslint/no-explicit-any */
function formatResponse(action: string, rawData: unknown): string {
  if (typeof rawData !== "object" || rawData === null) return String(rawData);
  const data = rawData as Record<string, unknown>;

  switch (action) {
    // 發佈貼文 / 回覆留言：回傳 ID 即可
    case "publish":
    case "reply_comment": {
      return `Done. ID: ${data.id}`;
    }
    // 取得貼文列表：顯示摘要標題、互動數據、連結
    case "get_posts": {
      const posts = (data.data || data) as Array<Record<string, unknown>>;
      if (!Array.isArray(posts) || posts.length === 0) return "No posts found.";
      return posts
        .map(
          (p: any) =>
            `- ${p.caption?.substring(0, 80) || "(no caption)"}${p.caption?.length > 80 ? "..." : ""}\n  ID: ${p.id} | ${p.timestamp} | ❤️ ${p.like_count ?? 0} 💬 ${p.comments_count ?? 0}\n  ${p.permalink || ""}`,
        )
        .join("\n");
    }
    // 取得留言：顯示用戶名、時間、內容
    case "get_comments": {
      const comments = (data.data || data) as Array<Record<string, unknown>>;
      if (!Array.isArray(comments) || comments.length === 0)
        return "No comments.";
      return comments
        .map((c: any) => `- **@${c.username}** (${c.timestamp}): ${c.text}`)
        .join("\n");
    }
    // 取得洞察數據：顯示各指標名稱與數值
    case "get_insights": {
      const metrics = (data.data || data) as Array<Record<string, unknown>>;
      if (!Array.isArray(metrics)) return JSON.stringify(rawData);
      return metrics
        .map((m: any) => `${m.name}: ${m.values?.[0]?.value ?? "N/A"}`)
        .join("\n");
    }
    default:
      return JSON.stringify(rawData, null, 2);
  }
}

/** 封裝 Instagram Graph API 請求，自動處理 token 與錯誤 */
async function igFetch(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<unknown> {
  const url = new URL(`${GRAPH_API}${path}`);
  if (!options.method || options.method === "GET") {
    url.searchParams.set("access_token", token);
  }

  const res = await fetch(url.toString(), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers as object),
    },
  });

  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error(
      `Instagram API error: ${(error as { error: { message: string } }).error.message} (INSTAGRAM_API_ERROR)`,
    );
  }
  return res.json();
}

/** 透過 Facebook Pages 取得用戶的 Instagram 商業帳號 ID */
async function getIgAccountId(token: string): Promise<string> {
  const pages = (await igFetch("/me/accounts", token)) as {
    data: Array<{ id: string }>;
  };
  if (!pages.data?.length) {
    throw new Error("No Facebook Pages found. Instagram Business account requires a linked Facebook Page. (INSTAGRAM_NO_PAGE)");
  }

  const pageId = pages.data[0].id;
  const igAccount = (await igFetch(
    `/${pageId}?fields=instagram_business_account`,
    token,
  )) as { instagram_business_account?: { id: string } };

  if (!igAccount.instagram_business_account) {
    throw new Error("No Instagram Business account linked to Facebook Page. (INSTAGRAM_NO_BUSINESS_ACCOUNT)");
  }

  return igAccount.instagram_business_account.id;
}

// ============================================================
// MCP 工具定義
// 每個工具對應一個 Instagram API 操作
// ============================================================
const tools: ToolDefinition[] = [
  {
    name: "instagram_publish",
    description:
      "Publish a new post to user's Instagram Business account. Requires an image URL. Returns the published media ID.",
    inputSchema: {
      image_url: z.string().describe("Public URL of the image to post"),
      caption: z.string().optional().describe("Post caption text"),
    },
  },
  {
    name: "instagram_get_posts",
    description:
      "Get recent posts from user's Instagram Business account. Returns posts with captions, timestamps, and media URLs.",
    inputSchema: {
      limit: z
        .number()
        .optional()
        .describe("Number of posts to retrieve (default 10, max 25)"),
    },
  },
  {
    name: "instagram_reply_comment",
    description:
      "Reply to a comment on user's Instagram post.",
    inputSchema: {
      comment_id: z.string().describe("ID of the comment to reply to"),
      message: z.string().describe("Reply text"),
    },
  },
  {
    name: "instagram_get_comments",
    description:
      "Get comments on a specific Instagram post. Returns comment text, usernames, and timestamps.",
    inputSchema: {
      media_id: z.string().describe("ID of the Instagram media/post"),
      limit: z
        .number()
        .optional()
        .describe("Number of comments to retrieve (default 20)"),
    },
  },
  {
    name: "instagram_get_insights",
    description:
      "Get engagement insights for a specific Instagram post. Returns impressions, reach, likes, comments, shares, and saves.",
    inputSchema: {
      media_id: z.string().describe("ID of the Instagram media/post"),
    },
  },
];

// ============================================================
// 工具執行邏輯
// 根據工具名稱分派到對應的 API 操作
// ============================================================
async function execute(
  toolName: string,
  params: Record<string, unknown>,
  token: string,
): Promise<ToolResult> {
  switch (toolName) {
    case "instagram_publish": {
      const igId = await getIgAccountId(token);

      // Step 1: Create media container
      const container = (await igFetch(`/${igId}/media`, token, {
        method: "POST",
        body: JSON.stringify({
          image_url: params.image_url,
          caption: params.caption ?? "",
          access_token: token,
        }),
      })) as { id: string };

      // Step 2: Publish
      const result = await igFetch(`/${igId}/media_publish`, token, {
        method: "POST",
        body: JSON.stringify({
          creation_id: container.id,
          access_token: token,
        }),
      });

      return {
        content: [{ type: "text", text: formatResponse("publish", result) }],
      };
    }

    case "instagram_get_posts": {
      const igId = await getIgAccountId(token);
      const limit = Math.min((params.limit as number) ?? 10, 25);
      const result = await igFetch(
        `/${igId}/media?fields=id,caption,timestamp,media_type,media_url,permalink,like_count,comments_count&limit=${limit}`,
        token,
      );
      return {
        content: [{ type: "text", text: formatResponse("get_posts", result) }],
      };
    }

    case "instagram_reply_comment": {
      const result = await igFetch(`/${params.comment_id}/replies`, token, {
        method: "POST",
        body: JSON.stringify({
          message: params.message,
          access_token: token,
        }),
      });
      return {
        content: [{ type: "text", text: formatResponse("reply_comment", result) }],
      };
    }

    case "instagram_get_comments": {
      const limit = (params.limit as number) ?? 20;
      const result = await igFetch(
        `/${params.media_id}/comments?fields=id,text,username,timestamp,like_count&limit=${limit}`,
        token,
      );
      return {
        content: [{ type: "text", text: formatResponse("get_comments", result) }],
      };
    }

    case "instagram_get_insights": {
      const result = await igFetch(
        `/${params.media_id}/insights?metric=impressions,reach,likes,comments,shares,saved`,
        token,
      );
      return {
        content: [{ type: "text", text: formatResponse("get_insights", result) }],
      };
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
        isError: true,
      };
  }
}

// ============================================================
// Token 管理
// Instagram 短期 token 轉換為長期 token（60 天有效）
// ============================================================
export async function instagramExchangeLongLived(shortLivedToken: string): Promise<TokenSet> {
  const res = await fetch(
    `${GRAPH_API}/oauth/access_token?grant_type=fb_exchange_token&client_id=${process.env.META_OAUTH_CLIENT_ID}&client_secret=${process.env.META_OAUTH_CLIENT_SECRET}&fb_exchange_token=${shortLivedToken}`,
    { method: "GET" },
  );
  if (!res.ok) throw new Error("Failed to exchange for long-lived token (INSTAGRAM_TOKEN_EXCHANGE_FAILED)");
  const data = await res.json();
  return {
    access_token: data.access_token,
    expires_in: data.expires_in,
  };
}

/** 刷新 Instagram 長期 token（到期前重新交換） */
async function refreshInstagramToken(currentToken: string): Promise<TokenSet> {
  const res = await fetch(
    `${GRAPH_API}/oauth/access_token?grant_type=fb_exchange_token&client_id=${process.env.META_OAUTH_CLIENT_ID}&client_secret=${process.env.META_OAUTH_CLIENT_SECRET}&fb_exchange_token=${currentToken}`,
    { method: "GET" },
  );
  if (!res.ok) throw new Error("Instagram token refresh failed (INSTAGRAM_REFRESH_FAILED)");
  const data = await res.json();
  return {
    access_token: data.access_token,
    expires_in: data.expires_in,
  };
}

export const instagramAdapter: AppAdapter = {
  name: "instagram",
  displayName: { zh: "Instagram", en: "Instagram" },
  icon: "instagram",
  authType: "oauth2",
  authConfig,
  tools,
  execute,
  actionMap,
  getSkill,
  formatResponse,
  refreshToken: refreshInstagramToken,
};
