/**
 * YouTube Adapter
 * 提供 YouTube 影片搜尋、播放清單管理、留言查看、頻道資訊功能
 * YouTube Data API v3 — 每日配額 10,000 單位
 */
import { z } from "zod";
import type {
  AppAdapter,
  OAuthConfig,
  ToolDefinition,
  ToolResult,
  TokenSet,
} from "./types";

// ── OAuth 設定 ─────────────────────────────────────────────
const authConfig: OAuthConfig = {
  type: "oauth2",
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  scopes: [
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/youtube.force-ssl",
  ],
  authMethod: "post",
};

// ── API 基礎設定 ───────────────────────────────────────────
const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";

// ── 輔助函式：YouTube API 請求封裝 ─────────────────────────
async function ytFetch(
  path: string,
  token: string,
  options: RequestInit = {},
): Promise<unknown> {
  const separator = path.includes("?") ? "&" : "?";
  const url = `${YOUTUBE_API}${path}${separator}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers as object),
    },
  });
  if (!res.ok) {
    const error = await res
      .json()
      .catch(() => ({ error: { message: res.statusText } }));
    const msg =
      (error as { error: { message: string } }).error?.message ??
      res.statusText;
    throw new Error(`YouTube API error: ${msg} (YOUTUBE_API_ERROR)`);
  }
  return res.json();
}

// ── 輔助函式：數字格式化（萬/億）────────────────────────────
function fmtCount(n: string | number): string {
  const num = typeof n === "string" ? parseInt(n, 10) : n;
  if (isNaN(num)) return "0";
  if (num >= 1_0000_0000) return `${(num / 1_0000_0000).toFixed(1)}億`;
  if (num >= 1_0000) return `${(num / 1_0000).toFixed(1)}萬`;
  return num.toLocaleString();
}

// ── do+help 架構：動作對照表 ──────────────────────────────
const actionMap: Record<string, string> = {
  search: "youtube_search",
  get_video: "youtube_get_video",
  list_playlists: "youtube_list_playlists",
  list_playlist_items: "youtube_list_playlist_items",
  add_to_playlist: "youtube_add_to_playlist",
  get_comments: "youtube_get_comments",
  get_channel: "youtube_get_channel",
};

// ── do+help 架構：技能描述（供 agent 理解可用操作）────────
const ACTION_SKILLS: Record<string, string> = {
  search: `## youtube.search
Search YouTube videos by keyword. Costs 100 quota units per call (daily limit: 10,000 units).
### Parameters
  query: Search keywords
  max_results (optional): Max results (default 10, max 50)
### Example
octodock_do(app:"youtube", action:"search", params:{query:"TypeScript tutorial"})
octodock_do(app:"youtube", action:"search", params:{query:"lo-fi beats", max_results:5})`,

  get_video: `## youtube.get_video
Get video details including title, description, view count, likes, and comments count. Costs 1 quota unit.
### Parameters
  video_id: YouTube video ID (the part after v= in URL)
### Example
octodock_do(app:"youtube", action:"get_video", params:{video_id:"dQw4w9WgXcQ"})`,

  list_playlists: `## youtube.list_playlists
List the authenticated user's playlists. Costs 1 quota unit.
### Parameters
  max_results (optional): Max results (default 25, max 50)
### Example
octodock_do(app:"youtube", action:"list_playlists", params:{})`,

  list_playlist_items: `## youtube.list_playlist_items
List videos in a specific playlist. Costs 1 quota unit.
### Parameters
  playlist_id: YouTube playlist ID
  max_results (optional): Max results (default 25, max 50)
### Example
octodock_do(app:"youtube", action:"list_playlist_items", params:{playlist_id:"PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf"})`,

  add_to_playlist: `## youtube.add_to_playlist
Add a video to a playlist. Costs 50 quota units. Requires youtube.force-ssl scope.
### Parameters
  playlist_id: Target playlist ID
  video_id: Video ID to add
### Example
octodock_do(app:"youtube", action:"add_to_playlist", params:{playlist_id:"PLrAXtmErZgOe...", video_id:"dQw4w9WgXcQ"})`,

  get_comments: `## youtube.get_comments
Get top-level comments on a video. Costs 1 quota unit.
### Parameters
  video_id: YouTube video ID
  max_results (optional): Max results (default 20, max 100)
### Example
octodock_do(app:"youtube", action:"get_comments", params:{video_id:"dQw4w9WgXcQ"})`,

  get_channel: `## youtube.get_channel
Get the authenticated user's channel info (name, subscribers, video count). Costs 1 quota unit.
### Parameters
  (none)
### Example
octodock_do(app:"youtube", action:"get_channel", params:{})`,
};

function getSkill(action?: string): string {
  if (action && ACTION_SKILLS[action]) return ACTION_SKILLS[action];
  if (action)
    return `Action "${action}" not found. Available: ${Object.keys(ACTION_SKILLS).join(", ")}`;
  return `youtube actions:
  search(query, max_results?) — search videos (⚠️ 100 quota units per call)
  get_video(video_id) — get video details + stats (1 unit)
  list_playlists(max_results?) — list your playlists (1 unit)
  list_playlist_items(playlist_id, max_results?) — list videos in playlist (1 unit)
  add_to_playlist(playlist_id, video_id) — add video to playlist (50 units)
  get_comments(video_id, max_results?) — get video comments (1 unit)
  get_channel() — get your channel info (1 unit)
⚠️ YouTube Data API daily quota: 10,000 units. search costs 100 units — use sparingly.
Use octodock_help(app:"youtube", action:"ACTION") for detailed params + example.`;
}

// ── do+help 架構：格式化回應 ──────────────────────────────
/* eslint-disable @typescript-eslint/no-explicit-any */
function formatResponse(action: string, rawData: unknown): string {
  if (typeof rawData !== "object" || rawData === null) return String(rawData);

  switch (action) {
    // 搜尋結果：影片清單
    case "search": {
      const data = rawData as { items?: any[] };
      const items = data.items;
      if (!items?.length) return "找不到相關影片。";
      return items
        .map((item: any) => {
          const s = item.snippet;
          const videoId = item.id?.videoId ?? "";
          return `- **${s.title}** by ${s.channelTitle} | https://youtu.be/${videoId}`;
        })
        .join("\n");
    }

    // 影片詳情：含統計數據
    case "get_video": {
      const data = rawData as { items?: any[] };
      const items = data.items;
      if (!items?.length) return "找不到該影片。";
      const v = items[0];
      const s = v.snippet;
      const st = v.statistics ?? {};
      return [
        `**${s.title}**`,
        `頻道：${s.channelTitle}`,
        `發布：${s.publishedAt?.slice(0, 10)}`,
        `觀看：${fmtCount(st.viewCount ?? 0)} | 👍 ${fmtCount(st.likeCount ?? 0)} | 💬 ${fmtCount(st.commentCount ?? 0)}`,
        `連結：https://youtu.be/${v.id}`,
        ``,
        s.description?.slice(0, 500) ?? "",
      ].join("\n");
    }

    // 播放清單列表
    case "list_playlists": {
      const data = rawData as { items?: any[] };
      const items = data.items;
      if (!items?.length) return "尚未建立任何播放清單。";
      return items
        .map((p: any) => {
          const s = p.snippet;
          return `- **${s.title}** (${s.description?.slice(0, 60) || "無描述"}) | ID: ${p.id}`;
        })
        .join("\n");
    }

    // 播放清單內影片
    case "list_playlist_items": {
      const data = rawData as { items?: any[] };
      const items = data.items;
      if (!items?.length) return "播放清單中沒有影片。";
      return items
        .map((item: any, i: number) => {
          const s = item.snippet;
          const videoId = s.resourceId?.videoId ?? "";
          return `${i + 1}. **${s.title}** by ${s.channelTitle} | https://youtu.be/${videoId}`;
        })
        .join("\n");
    }

    // 新增至播放清單
    case "add_to_playlist": {
      const data = rawData as any;
      const s = data.snippet;
      if (!s) return "已新增至播放清單。";
      return `已將 **${s.title}** 新增至播放清單。`;
    }

    // 留言列表
    case "get_comments": {
      const data = rawData as { items?: any[] };
      const items = data.items;
      if (!items?.length) return "這部影片沒有留言。";
      return items
        .map((item: any) => {
          const c = item.snippet?.topLevelComment?.snippet;
          if (!c) return null;
          return `- **@${c.authorDisplayName}**: ${c.textDisplay?.slice(0, 200)}`;
        })
        .filter(Boolean)
        .join("\n");
    }

    // 頻道資訊
    case "get_channel": {
      const data = rawData as { items?: any[] };
      const items = data.items;
      if (!items?.length) return "無法取得頻道資訊。";
      const ch = items[0];
      const s = ch.snippet;
      const st = ch.statistics ?? {};
      return [
        `**${s.title}**`,
        s.description ? `簡介：${s.description.slice(0, 200)}` : "",
        `訂閱者：${fmtCount(st.subscriberCount ?? 0)}`,
        `總觀看：${fmtCount(st.viewCount ?? 0)}`,
        `影片數：${fmtCount(st.videoCount ?? 0)}`,
        `建立日期：${s.publishedAt?.slice(0, 10)}`,
      ]
        .filter(Boolean)
        .join("\n");
    }

    default:
      return JSON.stringify(rawData, null, 2);
  }
}

// ── 智慧錯誤引導 ──────────────────────────────────────────
function formatError(action: string, errorMessage: string): string | null {
  // 配額超限
  if (
    errorMessage.includes("quotaExceeded") ||
    errorMessage.includes("dailyLimitExceeded") ||
    errorMessage.includes("rateLimitExceeded")
  ) {
    return `「YouTube API 每日配額已用完 (YOUTUBE_QUOTA_EXCEEDED)」\n每日配額為 10,000 單位，search 每次消耗 100 單位。配額於太平洋時間午夜重置。\n建議：減少 search 次數，改用 get_video 查詢已知影片（僅 1 單位）。`;
  }
  // 影片找不到
  if (errorMessage.includes("videoNotFound")) {
    return `「找不到該影片 (VIDEO_NOT_FOUND)」\n請確認影片 ID 是否正確，或該影片可能已被刪除/設為私人。`;
  }
  // 播放清單找不到
  if (errorMessage.includes("playlistNotFound")) {
    return `「找不到該播放清單 (PLAYLIST_NOT_FOUND)」\n請確認播放清單 ID 是否正確。`;
  }
  // 留言已停用
  if (errorMessage.includes("commentsDisabled")) {
    return `「該影片已停用留言功能 (COMMENTS_DISABLED)」`;
  }
  // 權限不足
  if (
    errorMessage.includes("forbidden") ||
    errorMessage.includes("insufficientPermissions")
  ) {
    return `「權限不足 (YOUTUBE_FORBIDDEN)」\n請確認 YouTube 已正確連結，且授權包含必要的權限範圍。`;
  }
  return null;
}

// ── MCP 工具定義 ──────────────────────────────────────────
const tools: ToolDefinition[] = [
  {
    name: "youtube_search",
    description:
      "Search YouTube videos by keyword. Returns video titles, channels, and links. Costs 100 API quota units per call.",
    inputSchema: {
      query: z.string().describe("Search keywords"),
      max_results: z
        .number()
        .optional()
        .describe("Maximum number of results (default 10, max 50)"),
    },
  },
  {
    name: "youtube_get_video",
    description:
      "Get detailed information about a YouTube video including title, description, view count, likes, and comment count.",
    inputSchema: {
      video_id: z
        .string()
        .describe("YouTube video ID (e.g., dQw4w9WgXcQ)"),
    },
  },
  {
    name: "youtube_list_playlists",
    description:
      "List the authenticated user's YouTube playlists with titles and descriptions.",
    inputSchema: {
      max_results: z
        .number()
        .optional()
        .describe("Maximum number of results (default 25, max 50)"),
    },
  },
  {
    name: "youtube_list_playlist_items",
    description:
      "List all videos in a specific YouTube playlist with titles and links.",
    inputSchema: {
      playlist_id: z.string().describe("YouTube playlist ID"),
      max_results: z
        .number()
        .optional()
        .describe("Maximum number of results (default 25, max 50)"),
    },
  },
  {
    name: "youtube_add_to_playlist",
    description:
      "Add a video to a YouTube playlist. Costs 50 API quota units per call.",
    inputSchema: {
      playlist_id: z.string().describe("Target playlist ID"),
      video_id: z.string().describe("Video ID to add to the playlist"),
    },
  },
  {
    name: "youtube_get_comments",
    description:
      "Get top-level comments on a YouTube video with author names and comment text.",
    inputSchema: {
      video_id: z.string().describe("YouTube video ID"),
      max_results: z
        .number()
        .optional()
        .describe("Maximum number of comments (default 20, max 100)"),
    },
  },
  {
    name: "youtube_get_channel",
    description:
      "Get the authenticated user's YouTube channel info including name, subscriber count, and total views.",
    inputSchema: {},
  },
];

// ── 工具執行邏輯 ──────────────────────────────────────────
async function execute(
  toolName: string,
  params: Record<string, unknown>,
  token: string,
): Promise<ToolResult> {
  switch (toolName) {
    // 搜尋影片
    case "youtube_search": {
      const maxResults = Math.min((params.max_results as number) ?? 10, 50);
      const q = encodeURIComponent(params.query as string);
      const result = await ytFetch(
        `/search?part=snippet&q=${q}&type=video&maxResults=${maxResults}`,
        token,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 取得影片詳情
    case "youtube_get_video": {
      const result = await ytFetch(
        `/videos?part=snippet,statistics&id=${encodeURIComponent(params.video_id as string)}`,
        token,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 列出使用者的播放清單
    case "youtube_list_playlists": {
      const maxResults = Math.min((params.max_results as number) ?? 25, 50);
      const result = await ytFetch(
        `/playlists?part=snippet&mine=true&maxResults=${maxResults}`,
        token,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 列出播放清單中的影片
    case "youtube_list_playlist_items": {
      const maxResults = Math.min((params.max_results as number) ?? 25, 50);
      const playlistId = encodeURIComponent(params.playlist_id as string);
      const result = await ytFetch(
        `/playlistItems?part=snippet&playlistId=${playlistId}&maxResults=${maxResults}`,
        token,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 將影片加入播放清單
    case "youtube_add_to_playlist": {
      const result = await ytFetch("/playlistItems?part=snippet", token, {
        method: "POST",
        body: JSON.stringify({
          snippet: {
            playlistId: params.playlist_id,
            resourceId: {
              kind: "youtube#video",
              videoId: params.video_id,
            },
          },
        }),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 取得影片留言
    case "youtube_get_comments": {
      const maxResults = Math.min((params.max_results as number) ?? 20, 100);
      const videoId = encodeURIComponent(params.video_id as string);
      const result = await ytFetch(
        `/commentThreads?part=snippet&videoId=${videoId}&maxResults=${maxResults}`,
        token,
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 取得自己的頻道資訊
    case "youtube_get_channel": {
      const result = await ytFetch(
        `/channels?part=snippet,statistics&mine=true`,
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

// ── Token 刷新：使用 refresh_token 取得新的 access_token ─
async function refreshYouTubeToken(
  refreshToken: string,
): Promise<TokenSet> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env.YOUTUBE_OAUTH_CLIENT_ID!,
      client_secret: process.env.YOUTUBE_OAUTH_CLIENT_SECRET!,
    }).toString(),
  });

  if (!res.ok) {
    throw new Error(`YouTube token refresh failed (YOUTUBE_REFRESH_FAILED)`);
  }

  const data = await res.json();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? refreshToken,
    expires_in: data.expires_in,
  };
}

// ── Adapter 匯出 ─────────────────────────────────────────
export const youtubeAdapter: AppAdapter = {
  name: "youtube",
  displayName: { zh: "YouTube", en: "YouTube" },
  icon: "youtube",
  authType: "oauth2",
  authConfig,
  actionMap,
  getSkill,
  formatResponse,
  formatError,
  tools,
  execute,
  refreshToken: refreshYouTubeToken,
};
