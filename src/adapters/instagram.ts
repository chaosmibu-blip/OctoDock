import { z } from "zod";
import type {
  AppAdapter,
  OAuthConfig,
  ToolDefinition,
  ToolResult,
  TokenSet,
} from "./types";

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

// Get user's Instagram Business Account ID via Facebook Pages
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
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
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
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
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
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    case "instagram_get_comments": {
      const limit = (params.limit as number) ?? 20;
      const result = await igFetch(
        `/${params.media_id}/comments?fields=id,text,username,timestamp,like_count&limit=${limit}`,
        token,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    case "instagram_get_insights": {
      const result = await igFetch(
        `/${params.media_id}/insights?metric=impressions,reach,likes,comments,shares,saved`,
        token,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
        isError: true,
      };
  }
}

// Exchange short-lived token for long-lived (60 days)
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
  refreshToken: refreshInstagramToken,
};
