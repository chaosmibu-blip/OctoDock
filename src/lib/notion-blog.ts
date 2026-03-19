/**
 * Notion Blog API 工具
 * 專門給 /blog 頁面用，不依賴用戶 session
 * 用 NOTION_BLOG_TOKEN 環境變數（Internal Integration Token）直接查 Notion API
 */

// ── Blog 資料庫 ID ──
const BLOG_DATABASE_ID = "328a9617-875f-81f5-8923-c66e691c57d0";
const NOTION_API = "https://api.notion.com/v1";

// ── 文章資料型別 ──
export interface BlogPost {
  id: string;
  title: string;
  slug: string;
  language: string;
  category: string;
  status: string;
  aiTool: string;
  app: string;
  problem: string;
  publishedDate: string | null;
  url: string;
}

// ── Notion API 請求封裝 ──
async function notionFetch(path: string, options: RequestInit = {}): Promise<unknown> {
  const token = process.env.NOTION_BLOG_TOKEN;
  if (!token) return null; // 沒設定 token 時靜默回傳 null，不報錯

  const res = await fetch(`${NOTION_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
      "Content-Type": "application/json",
      ...(options.headers as object),
    },
    // ISR: 1 小時快取
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    console.error(`Notion Blog API error: ${res.status} ${res.statusText}`);
    return null;
  }

  return res.json();
}

// ── 從 Notion properties 提取文章資料 ──
function extractPost(page: Record<string, unknown>): BlogPost {
  const props = page.properties as Record<string, unknown>;

  /** 安全取得 property 值的輔助函式 */
  const getTitle = (prop: unknown): string => {
    const p = prop as { title?: Array<{ plain_text: string }> };
    return p?.title?.[0]?.plain_text ?? "";
  };
  const getRichText = (prop: unknown): string => {
    const p = prop as { rich_text?: Array<{ plain_text: string }> };
    return p?.rich_text?.[0]?.plain_text ?? "";
  };
  const getSelect = (prop: unknown): string => {
    const p = prop as { select?: { name: string } };
    return p?.select?.name ?? "";
  };
  const getMultiSelect = (prop: unknown): string => {
    const p = prop as { multi_select?: Array<{ name: string }> };
    return p?.multi_select?.map((s) => s.name).join(", ") ?? "";
  };
  const getDate = (prop: unknown): string | null => {
    const p = prop as { date?: { start: string } };
    return p?.date?.start ?? null;
  };

  return {
    id: page.id as string,
    title: getTitle(props.Title ?? props.Name ?? props.title),
    slug: getRichText(props.Slug),
    language: getSelect(props.Language),
    category: getSelect(props.Category),
    status: getSelect(props.Status),
    aiTool: getMultiSelect(props["AI Tool"]),
    app: getMultiSelect(props.App),
    problem: getMultiSelect(props.Problem),
    publishedDate: getDate(props["Published Date"]),
    url: (page.url as string) ?? "",
  };
}

/**
 * 取得所有已發佈的 Blog 文章
 * 按發佈日期降序排列
 */
export async function fetchPublishedPosts(): Promise<BlogPost[]> {
  const data = await notionFetch(`/databases/${BLOG_DATABASE_ID}/query`, {
    method: "POST",
    body: JSON.stringify({
      filter: {
        property: "Status",
        select: { equals: "published" },
      },
      sorts: [
        { property: "Published Date", direction: "descending" },
      ],
    }),
  });

  if (!data) return [];
  const results = (data as { results: Array<Record<string, unknown>> }).results ?? [];
  return results.map(extractPost);
}

/**
 * 取得所有文章（包含 draft，給 sitemap 用）
 */
export async function fetchAllPosts(): Promise<BlogPost[]> {
  const data = await notionFetch(`/databases/${BLOG_DATABASE_ID}/query`, {
    method: "POST",
    body: JSON.stringify({
      sorts: [
        { property: "Published Date", direction: "descending" },
      ],
    }),
  });

  if (!data) return [];
  const results = (data as { results: Array<Record<string, unknown>> }).results ?? [];
  return results.map(extractPost);
}

/**
 * 用 Slug 查詢單篇文章
 * 只回傳 published 狀態的文章
 */
export async function fetchPostBySlug(slug: string): Promise<BlogPost | null> {
  const data = await notionFetch(`/databases/${BLOG_DATABASE_ID}/query`, {
    method: "POST",
    body: JSON.stringify({
      filter: {
        and: [
          { property: "Slug", rich_text: { equals: slug } },
          { property: "Status", select: { equals: "published" } },
        ],
      },
    }),
  });

  if (!data) return null;
  const results = (data as { results: Array<Record<string, unknown>> }).results ?? [];
  if (results.length === 0) return null;
  return extractPost(results[0]);
}

/**
 * 取得頁面內容（Notion blocks → Markdown）
 * 遞迴分頁拉取所有 blocks
 */
export async function fetchPostContent(pageId: string): Promise<string> {
  const blocks: Array<Record<string, unknown>> = [];
  let cursor: string | undefined;
  const MAX_BLOCKS = 500; // 防止無限迴圈

  // 分頁拉取所有 blocks
  while (blocks.length < MAX_BLOCKS) {
    const url = `/blocks/${pageId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`;
    const data = await notionFetch(url);
    if (!data) break;

    const page = data as {
      results: Array<Record<string, unknown>>;
      has_more: boolean;
      next_cursor: string | null;
    };

    blocks.push(...page.results);

    if (!page.has_more || !page.next_cursor) break;
    cursor = page.next_cursor;
  }

  return blocksToMarkdown(blocks);
}

// ── Notion blocks → Markdown 轉換（複用 notion.ts 的邏輯）──

/** 從 Notion rich_text 陣列提取純文字 */
function richTextToPlain(richText: Array<{ plain_text: string }> | undefined): string {
  if (!richText || richText.length === 0) return "";
  return richText.map((t) => t.plain_text).join("");
}

/** 從 Notion rich_text 陣列提取帶格式的 Markdown 文字 */
function richTextToMarkdown(richText: Array<{
  plain_text: string;
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    code?: boolean;
  };
  href?: string | null;
}> | undefined): string {
  if (!richText || richText.length === 0) return "";
  return richText.map((t) => {
    let text = t.plain_text;
    const a = t.annotations;
    // 套用格式
    if (a?.code) text = `\`${text}\``;
    if (a?.bold) text = `**${text}**`;
    if (a?.italic) text = `*${text}*`;
    if (a?.strikethrough) text = `~~${text}~~`;
    // 超連結
    if (t.href) text = `[${text}](${t.href})`;
    return text;
  }).join("");
}

/**
 * 將 Notion API blocks 轉換為 Markdown
 * 支援標題、段落、列表、程式碼、圖片、表格、引用、分隔線等
 */
function blocksToMarkdown(blocks: Array<Record<string, unknown>>): string {
  const lines: string[] = [];
  let inTable = false; // 追蹤是否在表格內
  let tableRowIndex = 0;

  for (const block of blocks) {
    const type = block.type as string;
    const data = block[type] as Record<string, unknown> | undefined;
    if (!data) continue;

    // 表格結束偵測
    if (type !== "table_row" && inTable) {
      inTable = false;
      tableRowIndex = 0;
    }

    // 用帶格式的 Markdown（粗體、斜體、連結等）
    const text = richTextToMarkdown(data.rich_text as Array<{
      plain_text: string;
      annotations?: { bold?: boolean; italic?: boolean; strikethrough?: boolean; code?: boolean };
      href?: string | null;
    }>);

    switch (type) {
      case "heading_1":
        lines.push(`# ${text}`);
        break;
      case "heading_2":
        lines.push(`## ${text}`);
        break;
      case "heading_3":
        lines.push(`### ${text}`);
        break;
      case "paragraph":
        lines.push(text || "");
        break;
      case "bulleted_list_item":
        lines.push(`- ${text}`);
        break;
      case "numbered_list_item":
        lines.push(`1. ${text}`);
        break;
      case "to_do": {
        const checked = data.checked ? "x" : " ";
        lines.push(`- [${checked}] ${text}`);
        break;
      }
      case "quote":
        lines.push(`> ${text}`);
        break;
      case "callout": {
        const icon = data.icon as { emoji?: string } | undefined;
        const prefix = icon?.emoji ? `${icon.emoji} ` : "";
        lines.push(`> ${prefix}${text}`);
        break;
      }
      case "code": {
        const lang = (data.language as string) || "";
        const codeText = richTextToPlain(data.rich_text as Array<{ plain_text: string }>);
        lines.push(`\`\`\`${lang}\n${codeText}\n\`\`\``);
        break;
      }
      case "divider":
        lines.push("---");
        break;
      case "toggle":
        lines.push(`<details><summary>${text}</summary></details>`);
        break;
      case "image": {
        const imgData = data as { type?: string; file?: { url: string }; external?: { url: string } };
        const url = imgData.file?.url || imgData.external?.url || "";
        const caption = richTextToPlain(data.caption as Array<{ plain_text: string }>);
        lines.push(`![${caption}](${url})`);
        break;
      }
      case "bookmark": {
        const bmUrl = (data as { url?: string }).url || "";
        const caption = richTextToPlain(data.caption as Array<{ plain_text: string }>);
        lines.push(`[${caption || bmUrl}](${bmUrl})`);
        break;
      }
      case "table": {
        // table block 本身不含內容，子 blocks 是 table_row
        // 標記進入表格狀態
        inTable = true;
        tableRowIndex = 0;
        break;
      }
      case "table_row": {
        const cells = data.cells as Array<Array<{ plain_text: string }>> | undefined;
        if (cells) {
          const row = cells.map((cell) => richTextToPlain(cell)).join(" | ");
          lines.push(`| ${row} |`);
          // 第一行後加分隔線
          if (tableRowIndex === 0) {
            lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
          }
          tableRowIndex++;
        }
        break;
      }
      case "child_page": {
        const title = (data as { title?: string }).title || "";
        lines.push(`📄 ${title}`);
        break;
      }
      default:
        if (text) lines.push(text);
        break;
    }
  }

  return lines.join("\n");
}
