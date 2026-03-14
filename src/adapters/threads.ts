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
  authorizeUrl: "https://threads.net/oauth/authorize",
  tokenUrl: "https://graph.threads.net/oauth/access_token",
  scopes: [
    "threads_basic",
    "threads_content_publish",
    "threads_read_replies",
    "threads_manage_replies",
    "threads_manage_insights",
  ],
  authMethod: "post",
};

const THREADS_API = "https://graph.threads.net/v1.0";

// do + help 架構：自然語言 action → 內部工具名稱對應
const actionMap: Record<string, string> = {
  publish: "threads_publish",
  get_posts: "threads_get_posts",
  reply: "threads_reply",
  get_insights: "threads_get_insights",
  get_profile: "threads_get_profile",
};

const ACTION_SKILLS: Record<string, string> = {
  publish: `## threads.publish
Publish a text post.
### Parameters
  text: Post content (max 500 characters)
### Example
octodock_do(app:"threads", action:"publish", params:{text:"剛完成了新功能的開發 🚀 #coding"})`,

  get_posts: `## threads.get_posts
Get recent posts.
### Parameters
  limit (optional): Number of posts (default 10, max 25)
### Example
octodock_do(app:"threads", action:"get_posts", params:{limit:5})`,

  reply: `## threads.reply
Reply to a post.
### Parameters
  post_id: ID of the post to reply to
  text: Reply content
### Example
octodock_do(app:"threads", action:"reply", params:{post_id:"123456", text:"謝謝分享！"})`,

  get_insights: `## threads.get_insights
Get post engagement metrics (views, likes, replies, reposts, quotes).
### Parameters
  post_id: Post ID
### Example
octodock_do(app:"threads", action:"get_insights", params:{post_id:"123456"})`,

  get_profile: `## threads.get_profile
Get user profile info.
### Parameters
  (none)
### Example
octodock_do(app:"threads", action:"get_profile", params:{})`,
};

function getSkill(action?: string): string {
  if (action && ACTION_SKILLS[action]) return ACTION_SKILLS[action];
  if (action) return `Action "${action}" not found. Available: ${Object.keys(ACTION_SKILLS).join(", ")}`;
  return `threads actions:
  publish(text) — publish text post (max 500 chars)
  get_posts(limit?) — get recent posts
  reply(post_id, text) — reply to a post
  get_insights(post_id) — get post engagement metrics
  get_profile() — get user profile info
Use octodock_help(app:"threads", action:"ACTION") for detailed params + example.`;
}

// G1/G3 通用框架：將 raw JSON 轉為 AI 友善的可讀格式
/* eslint-disable @typescript-eslint/no-explicit-any */
function formatResponse(action: string, rawData: unknown): string {
  if (typeof rawData !== "object" || rawData === null) return String(rawData);
  const data = rawData as Record<string, unknown>;

  switch (action) {
    // 發文或回覆：只回傳貼文 ID
    case "publish":
    case "reply": {
      return `Done. Post ID: ${data.id}`;
    }
    // 取得貼文列表：精簡顯示內文摘要、ID、時間
    case "get_posts": {
      const posts = (data.data || data) as Array<Record<string, unknown>>;
      if (!Array.isArray(posts) || posts.length === 0) return "No posts found.";
      return posts
        .map(
          (p: any) =>
            `- ${p.text?.substring(0, 100)}${p.text?.length > 100 ? "..." : ""}\n  ID: ${p.id} | ${p.timestamp} | ${p.permalink || ""}`,
        )
        .join("\n");
    }
    // 取得互動數據：逐項列出指標名稱與數值
    case "get_insights": {
      const metrics = (data.data || data) as Array<Record<string, unknown>>;
      if (!Array.isArray(metrics)) return JSON.stringify(rawData);
      return metrics
        .map((m: any) => `${m.name}: ${m.values?.[0]?.value ?? "N/A"}`)
        .join("\n");
    }
    // 取得個人檔案：格式化顯示用戶名、名稱、簡介
    case "get_profile": {
      return `Username: @${data.username}\nName: ${data.name || "N/A"}\nBio: ${data.threads_biography || "N/A"}`;
    }
    default:
      return JSON.stringify(rawData, null, 2);
  }
}

async function threadsFetch(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<unknown> {
  const url = new URL(`${THREADS_API}${path}`);
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
      `Threads API error: ${(error as { error: { message: string } }).error.message} (THREADS_API_ERROR)`,
    );
  }
  return res.json();
}

const tools: ToolDefinition[] = [
  {
    name: "threads_publish",
    description:
      "Publish a new post to user's Threads account. Supports text-only posts. Returns the published post ID.",
    inputSchema: {
      text: z.string().describe("Post content text (max 500 characters)"),
    },
  },
  {
    name: "threads_get_posts",
    description:
      "Get recent posts from user's Threads account. Returns a list of posts with text, timestamp, and engagement metrics.",
    inputSchema: {
      limit: z
        .number()
        .optional()
        .describe("Number of posts to retrieve (default 10, max 25)"),
    },
  },
  {
    name: "threads_reply",
    description:
      "Reply to an existing Threads post. The reply will appear as a comment on the original post.",
    inputSchema: {
      post_id: z.string().describe("ID of the post to reply to"),
      text: z.string().describe("Reply content text"),
    },
  },
  {
    name: "threads_get_insights",
    description:
      "Get engagement insights for a specific Threads post. Returns views, likes, replies, reposts, and quotes counts.",
    inputSchema: {
      post_id: z.string().describe("ID of the post to get insights for"),
    },
  },
  {
    name: "threads_get_profile",
    description:
      "Get user's Threads profile information including username, bio, and follower counts.",
    inputSchema: {},
  },
];

async function execute(
  toolName: string,
  params: Record<string, unknown>,
  token: string,
): Promise<ToolResult> {
  switch (toolName) {
    case "threads_publish": {
      // Step 1: Create media container
      const container = (await threadsFetch("/me/threads", token, {
        method: "POST",
        body: JSON.stringify({
          media_type: "TEXT",
          text: params.text,
          access_token: token,
        }),
      })) as { id: string };

      // Step 2: Publish the container
      const result = await threadsFetch("/me/threads_publish", token, {
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

    case "threads_get_posts": {
      const limit = Math.min((params.limit as number) ?? 10, 25);
      const result = await threadsFetch(
        `/me/threads?fields=id,text,timestamp,media_type,permalink&limit=${limit}`,
        token,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    case "threads_reply": {
      // Step 1: Create reply container
      const container = (await threadsFetch("/me/threads", token, {
        method: "POST",
        body: JSON.stringify({
          media_type: "TEXT",
          text: params.text,
          reply_to_id: params.post_id,
          access_token: token,
        }),
      })) as { id: string };

      // Step 2: Publish
      const result = await threadsFetch("/me/threads_publish", token, {
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

    case "threads_get_insights": {
      const result = await threadsFetch(
        `/${params.post_id}/insights?metric=views,likes,replies,reposts,quotes`,
        token,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    case "threads_get_profile": {
      const result = await threadsFetch(
        "/me?fields=id,username,name,threads_profile_picture_url,threads_biography",
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

// Meta short-lived → long-lived token exchange, then periodic refresh
async function exchangeForLongLivedToken(shortLivedToken: string): Promise<TokenSet> {
  const res = await fetch(
    `https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=${process.env.META_OAUTH_CLIENT_SECRET}&access_token=${shortLivedToken}`,
    { method: "GET" },
  );
  if (!res.ok) throw new Error("Failed to exchange for long-lived token (THREADS_TOKEN_EXCHANGE_FAILED)");
  const data = await res.json();
  return {
    access_token: data.access_token,
    expires_in: data.expires_in, // ~60 days
  };
}

async function refreshThreadsToken(currentToken: string): Promise<TokenSet> {
  const res = await fetch(
    `https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${currentToken}`,
    { method: "GET" },
  );
  if (!res.ok) throw new Error("Threads token refresh failed (THREADS_REFRESH_FAILED)");
  const data = await res.json();
  return {
    access_token: data.access_token,
    expires_in: data.expires_in,
  };
}

export const threadsAdapter: AppAdapter = {
  name: "threads",
  displayName: { zh: "Threads", en: "Threads" },
  icon: "threads",
  authType: "oauth2",
  authConfig,
  tools,
  execute,
  refreshToken: refreshThreadsToken,
  actionMap, // do + help 架構：簡化 action → 內部工具對應
  getSkill, // do + help 架構：回傳精簡操作說明
  formatResponse, // G1/G3 通用框架：raw JSON → AI 友善格式
};

// Exported for use in OAuth callback to exchange short→long-lived token
export { exchangeForLongLivedToken as threadsExchangeLongLived };
