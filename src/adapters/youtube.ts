/**
 * YouTube Adapter
 * 提供 YouTube 影片搜尋、播放清單管理、留言管理、頻道資訊、影片管理、訂閱功能
 * YouTube Data API v3 — 每日配額 10,000 單位
 */
import { z } from "zod";
// youtube-transcript@1.3.0 的 CJS bundle 有 export bug，
// 改用 dynamic import 確保 Next.js server runtime 正確載入 ESM 版本
async function getYoutubeTranscript() {
  const mod = await import("youtube-transcript");
  return mod.YoutubeTranscript;
}
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
  extraParams: { access_type: "offline", prompt: "consent" },
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
  // 204 No Content（like_video、delete_video、delete_playlist 等）
  if (res.status === 204) return { success: true };

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
  upload_video: "youtube_upload_video",
  update_video: "youtube_update_video",
  delete_video: "youtube_delete_video",
  like_video: "youtube_like_video",
  subscribe: "youtube_subscribe",
  create_playlist: "youtube_create_playlist",
  delete_playlist: "youtube_delete_playlist",
  reply_comment: "youtube_reply_comment",
  post_comment: "youtube_post_comment",
  get_transcript: "youtube_get_transcript",
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

  upload_video: `## youtube.upload_video
Create video metadata on YouTube (metadata only — does not upload a video file). Costs 1600 quota units.
### Parameters
  title: Video title
  description: Video description
  tags (optional): Array of tags
  privacy_status (optional): "public" | "private" | "unlisted" (default "private")
### Example
octodock_do(app:"youtube", action:"upload_video", params:{title:"My Video", description:"A cool video", tags:["tutorial","coding"], privacy_status:"private"})`,

  update_video: `## youtube.update_video
Update an existing video's metadata (title, description, tags). Costs 50 quota units.
### Parameters
  video_id: YouTube video ID
  title (optional): New title
  description (optional): New description
  tags (optional): New tags array
### Example
octodock_do(app:"youtube", action:"update_video", params:{video_id:"dQw4w9WgXcQ", title:"Updated Title", description:"New description"})`,

  delete_video: `## youtube.delete_video
Delete a video from YouTube. Costs 50 quota units. This action is irreversible.
### Parameters
  video_id: YouTube video ID to delete
### Example
octodock_do(app:"youtube", action:"delete_video", params:{video_id:"dQw4w9WgXcQ"})`,

  like_video: `## youtube.like_video
Like a YouTube video. Costs 50 quota units.
### Parameters
  video_id: YouTube video ID to like
### Example
octodock_do(app:"youtube", action:"like_video", params:{video_id:"dQw4w9WgXcQ"})`,

  subscribe: `## youtube.subscribe
Subscribe to a YouTube channel. Costs 50 quota units.
### Parameters
  channel_id: YouTube channel ID to subscribe to
### Example
octodock_do(app:"youtube", action:"subscribe", params:{channel_id:"UC_x5XG1OV2P6uZZ5FSM9Ttw"})`,

  create_playlist: `## youtube.create_playlist
Create a new YouTube playlist. Costs 50 quota units.
### Parameters
  title: Playlist title
  description (optional): Playlist description
  privacy_status (optional): "public" | "private" | "unlisted" (default "private")
### Example
octodock_do(app:"youtube", action:"create_playlist", params:{title:"My Favorites", description:"Best videos", privacy_status:"private"})`,

  delete_playlist: `## youtube.delete_playlist
Delete a YouTube playlist. Costs 50 quota units. This action is irreversible.
### Parameters
  playlist_id: YouTube playlist ID to delete
### Example
octodock_do(app:"youtube", action:"delete_playlist", params:{playlist_id:"PLrAXtmErZgOe..."})`,

  reply_comment: `## youtube.reply_comment
Reply to an existing YouTube comment. Costs 50 quota units.
### Parameters
  parent_id: Comment ID to reply to
  text: Reply text
### Example
octodock_do(app:"youtube", action:"reply_comment", params:{parent_id:"UgxABC123", text:"Thanks for your comment!"})`,

  post_comment: `## youtube.post_comment
Post a new top-level comment on a YouTube video. Costs 50 quota units.
### Parameters
  video_id: YouTube video ID to comment on
  text: Comment text
### Example
octodock_do(app:"youtube", action:"post_comment", params:{video_id:"dQw4w9WgXcQ", text:"Great video!"})`,

  get_transcript: `## youtube.get_transcript
Get video transcript/subtitles as plain text. FREE — does not use YouTube API quota.
Works with auto-generated and manually uploaded captions. Other people's videos are supported.
### Parameters
  video_id: YouTube video ID
  language (optional): Language code (e.g. "en", "zh-TW", default: auto)
### Example
octodock_do(app:"youtube", action:"get_transcript", params:{video_id:"dQw4w9WgXcQ"})
octodock_do(app:"youtube", action:"get_transcript", params:{video_id:"dQw4w9WgXcQ", language:"zh-TW"})`,
};

function getSkill(action?: string): string {
  if (action && ACTION_SKILLS[action]) return ACTION_SKILLS[action];
  if (action)
    return `Action "${action}" not found. Available: ${Object.keys(ACTION_SKILLS).join(", ")}`;
  return `youtube actions (${Object.keys(actionMap).length}):
  search(query, max_results?) — search videos (⚠️ 100 quota units per call)
  get_video(video_id) — get video details + stats (1 unit)
  list_playlists(max_results?) — list your playlists (1 unit)
  list_playlist_items(playlist_id, max_results?) — list videos in playlist (1 unit)
  add_to_playlist(playlist_id, video_id) — add video to playlist (50 units)
  get_comments(video_id, max_results?) — get video comments (1 unit)
  get_channel() — get your channel info (1 unit)
  upload_video(title, description, tags?, privacy_status?) — create video metadata (1600 units)
  update_video(video_id, title?, description?, tags?) — update video metadata (50 units)
  delete_video(video_id) — delete a video (50 units)
  like_video(video_id) — like a video (50 units)
  subscribe(channel_id) — subscribe to a channel (50 units)
  create_playlist(title, description?, privacy_status?) — create playlist (50 units)
  delete_playlist(playlist_id) — delete a playlist (50 units)
  reply_comment(parent_id, text) — reply to a comment (50 units)
  post_comment(video_id, text) — post a top-level comment (50 units)
  get_transcript(video_id, language?) — get video transcript/subtitles (FREE, no quota)
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
          // videoOwnerChannelTitle 才是影片原頻道名（channelTitle 是加入者）
          const author = s.videoOwnerChannelTitle ?? s.channelTitle ?? "?";
          return `${i + 1}. **${s.title}** by ${author} | https://youtu.be/${videoId}`;
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

    // 建立影片中繼資料
    case "upload_video": {
      const data = rawData as any;
      const s = data.snippet;
      if (!s) return "已建立影片中繼資料。";
      return `已建立影片中繼資料：**${s.title}**\nID: ${data.id}\n隱私狀態：${data.status?.privacyStatus ?? "unknown"}`;
    }

    // 更新影片中繼資料
    case "update_video": {
      const data = rawData as any;
      const s = data.snippet;
      if (!s) return "已更新影片中繼資料。";
      return `已更新影片：**${s.title}**\nID: ${data.id}`;
    }

    // 刪除影片
    case "delete_video": {
      return "已成功刪除影片。";
    }

    // 喜歡影片
    case "like_video": {
      return "已對影片按讚。";
    }

    // 訂閱頻道
    case "subscribe": {
      const data = rawData as any;
      const title = data.snippet?.title ?? data.snippet?.resourceId?.channelId ?? "";
      return title ? `已訂閱頻道：**${title}**` : "已成功訂閱頻道。";
    }

    // 建立播放清單
    case "create_playlist": {
      const data = rawData as any;
      const s = data.snippet;
      if (!s) return "已建立播放清單。";
      return `已建立播放清單：**${s.title}**\nID: ${data.id}\n隱私狀態：${data.status?.privacyStatus ?? "unknown"}`;
    }

    // 刪除播放清單
    case "delete_playlist": {
      return "已成功刪除播放清單。";
    }

    // 回覆留言
    case "reply_comment": {
      const data = rawData as any;
      const text = data.snippet?.textOriginal ?? data.snippet?.textDisplay ?? "";
      return text ? `已回覆留言：「${text.slice(0, 100)}」` : "已成功回覆留言。";
    }

    // 發表留言
    case "post_comment": {
      const data = rawData as any;
      const text = data.snippet?.topLevelComment?.snippet?.textOriginal ?? "";
      return text ? `已發表留言：「${text.slice(0, 100)}」` : "已成功發表留言。";
    }

    // 影片逐字稿
    case "get_transcript": {
      if (typeof rawData === "string") return rawData;
      return String(rawData);
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
  {
    name: "youtube_upload_video",
    description:
      "Create video metadata on YouTube (metadata only — does not upload a video file). Sets title, description, tags, and privacy status.",
    inputSchema: {
      title: z.string().describe("Video title"),
      description: z.string().describe("Video description"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Array of video tags"),
      privacy_status: z
        .enum(["public", "private", "unlisted"])
        .optional()
        .describe('Privacy status (default "private")'),
    },
  },
  {
    name: "youtube_update_video",
    description:
      "Update an existing YouTube video's metadata (title, description, tags).",
    inputSchema: {
      video_id: z.string().describe("YouTube video ID to update"),
      title: z.string().optional().describe("New video title"),
      description: z.string().optional().describe("New video description"),
      tags: z
        .array(z.string())
        .optional()
        .describe("New tags array"),
    },
  },
  {
    name: "youtube_delete_video",
    description:
      "Delete a video from YouTube. This action is irreversible.",
    inputSchema: {
      video_id: z.string().describe("YouTube video ID to delete"),
    },
  },
  {
    name: "youtube_like_video",
    description:
      "Like a YouTube video (add a 'like' rating).",
    inputSchema: {
      video_id: z.string().describe("YouTube video ID to like"),
    },
  },
  {
    name: "youtube_subscribe",
    description:
      "Subscribe to a YouTube channel.",
    inputSchema: {
      channel_id: z.string().describe("YouTube channel ID to subscribe to"),
    },
  },
  {
    name: "youtube_create_playlist",
    description:
      "Create a new YouTube playlist with a title, optional description, and privacy status.",
    inputSchema: {
      title: z.string().describe("Playlist title"),
      description: z.string().optional().describe("Playlist description"),
      privacy_status: z
        .enum(["public", "private", "unlisted"])
        .optional()
        .describe('Privacy status (default "private")'),
    },
  },
  {
    name: "youtube_delete_playlist",
    description:
      "Delete a YouTube playlist. This action is irreversible.",
    inputSchema: {
      playlist_id: z.string().describe("YouTube playlist ID to delete"),
    },
  },
  {
    name: "youtube_reply_comment",
    description:
      "Reply to an existing YouTube comment.",
    inputSchema: {
      parent_id: z.string().describe("Comment ID to reply to"),
      text: z.string().describe("Reply text"),
    },
  },
  {
    name: "youtube_post_comment",
    description:
      "Post a new top-level comment on a YouTube video.",
    inputSchema: {
      video_id: z.string().describe("YouTube video ID to comment on"),
      text: z.string().describe("Comment text"),
    },
  },
  // 影片逐字稿（不需 OAuth、不吃 quota）
  {
    name: "youtube_get_transcript",
    description:
      "Get video transcript/subtitles as plain text. FREE — does not use YouTube API quota. Works with auto-generated and manual captions.",
    inputSchema: {
      video_id: z.string().describe("YouTube video ID"),
      language: z.string().optional().describe("Language code (e.g. 'en', 'zh-TW', default: auto)"),
    },
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

    // 建立影片中繼資料（不含實際檔案上傳）
    case "youtube_upload_video": {
      const body: Record<string, unknown> = {
        snippet: {
          title: params.title,
          description: params.description,
          ...(params.tags ? { tags: params.tags } : {}),
        },
        status: {
          privacyStatus: (params.privacy_status as string) || "private",
        },
      };
      const result = await ytFetch("/videos?part=snippet,status", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 更新影片中繼資料
    case "youtube_update_video": {
      const snippet: Record<string, unknown> = {};
      if (params.title !== undefined) snippet.title = params.title;
      if (params.description !== undefined) snippet.description = params.description;
      if (params.tags !== undefined) snippet.tags = params.tags;
      const body = {
        id: params.video_id,
        snippet,
      };
      const result = await ytFetch("/videos?part=snippet", token, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 刪除影片
    case "youtube_delete_video": {
      const videoId = encodeURIComponent(params.video_id as string);
      const result = await ytFetch(`/videos?id=${videoId}`, token, {
        method: "DELETE",
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 對影片按讚
    case "youtube_like_video": {
      const videoId = encodeURIComponent(params.video_id as string);
      const result = await ytFetch(
        `/videos/rate?id=${videoId}&rating=like`,
        token,
        { method: "POST" },
      );
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 訂閱頻道
    case "youtube_subscribe": {
      const body = {
        snippet: {
          resourceId: {
            kind: "youtube#channel",
            channelId: params.channel_id,
          },
        },
      };
      const result = await ytFetch("/subscriptions?part=snippet", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 建立播放清單
    case "youtube_create_playlist": {
      const body = {
        snippet: {
          title: params.title,
          ...(params.description ? { description: params.description } : {}),
        },
        status: {
          privacyStatus: (params.privacy_status as string) || "private",
        },
      };
      const result = await ytFetch("/playlists?part=snippet,status", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 刪除播放清單
    case "youtube_delete_playlist": {
      const playlistId = encodeURIComponent(params.playlist_id as string);
      const result = await ytFetch(`/playlists?id=${playlistId}`, token, {
        method: "DELETE",
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 回覆留言
    case "youtube_reply_comment": {
      const body = {
        snippet: {
          parentId: params.parent_id,
          textOriginal: params.text,
        },
      };
      const result = await ytFetch("/comments?part=snippet", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 發表頂層留言
    case "youtube_post_comment": {
      const body = {
        snippet: {
          videoId: params.video_id,
          topLevelComment: {
            snippet: {
              textOriginal: params.text,
            },
          },
        },
      };
      const result = await ytFetch("/commentThreads?part=snippet", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }

    // 影片逐字稿（不需 OAuth、不吃 YouTube API quota）
    // 使用自定義 fetch 加上瀏覽器 headers，避免 Replit IP 被 YouTube bot 偵測擋掉
    case "youtube_get_transcript": {
      try {
        const videoId = params.video_id as string;
        const lang = params.language as string | undefined;
        // 動態載入 YoutubeTranscript（繞過 CJS export bug）
        const YoutubeTranscript = await getYoutubeTranscript();
        const config: { lang?: string } = {};
        if (lang) config.lang = lang;
        const transcript = await YoutubeTranscript.fetchTranscript(videoId, config);
        // 將逐字稿拼成純文字
        const text = transcript.map((t: { text: string }) => t.text).join(" ");
        return {
          content: [{ type: "text", text: JSON.stringify({ video_id: videoId, language: lang ?? "auto", length: transcript.length, text }, null, 2) }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        // 區分不同錯誤類型給出更精準的提示
        let hint = "此影片無可用字幕。";
        if (msg.includes("captcha")) hint = "YouTube 要求驗證碼，伺服器 IP 可能被限流。請稍後再試。";
        else if (msg.includes("no longer available")) hint = "此影片已下架或不存在。";
        else if (msg.includes("No transcripts are available in")) hint = msg.replace("[YoutubeTranscript] 🚨 ", "");
        return {
          content: [{ type: "text", text: `${hint} (TRANSCRIPT_NOT_AVAILABLE)\n${msg}` }],
          isError: true,
        };
      }
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
