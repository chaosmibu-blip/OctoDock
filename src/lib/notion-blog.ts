/**
 * Notion Blog API 工具
 * 專門給 /blog 頁面用，不依賴用戶 session
 * 用 NOTION_BLOG_TOKEN 環境變數（Internal Integration Token）直接查 Notion API
 */

// ── Blog 資料庫 ID（從環境變數讀取，不硬編碼） ──
const BLOG_DATABASE_ID = process.env.NOTION_BLOG_DATABASE_ID || "";
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

// ============================================================
// Block 拉取 — 遞迴拉取所有 block（含子 block）
// ============================================================

interface NotionBlock {
  id: string;
  type: string;
  has_children: boolean;
  children?: NotionBlock[]; // 遞迴拉取後填入
  [key: string]: unknown;
}

/** 拉取一個 block 的所有直接子 block（分頁） */
async function fetchChildren(blockId: string): Promise<NotionBlock[]> {
  const blocks: NotionBlock[] = [];
  let cursor: string | undefined;
  const MAX_BLOCKS = 500;

  while (blocks.length < MAX_BLOCKS) {
    const url = `/blocks/${blockId}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`;
    const data = await notionFetch(url);
    if (!data) break;

    const page = data as {
      results: NotionBlock[];
      has_more: boolean;
      next_cursor: string | null;
    };

    blocks.push(...page.results);
    if (!page.has_more || !page.next_cursor) break;
    cursor = page.next_cursor;
  }

  return blocks;
}

/** 遞迴拉取所有 block，包含子 block（最多 3 層深度） */
async function fetchBlocksRecursive(blockId: string, depth = 0): Promise<NotionBlock[]> {
  const blocks = await fetchChildren(blockId);
  if (depth >= 3) return blocks; // 防止無限遞迴

  // 並行拉取所有有子 block 的 block
  const withChildren = blocks.filter((b) => b.has_children);
  if (withChildren.length > 0) {
    const childResults = await Promise.all(
      withChildren.map((b) => fetchBlocksRecursive(b.id, depth + 1)),
    );
    for (let i = 0; i < withChildren.length; i++) {
      withChildren[i].children = childResults[i];
    }
  }

  return blocks;
}

/**
 * 取得頁面內容（Notion blocks → Markdown）
 * 遞迴拉取所有 blocks（含子 block），再轉 Markdown
 */
export async function fetchPostContent(pageId: string): Promise<string> {
  const blocks = await fetchBlocksRecursive(pageId);
  return blocksToMarkdown(blocks, 0);
}

// ============================================================
// Notion blocks → Markdown 轉換
// 支援巢狀結構、column layout、toggle 內容、embed 等
// ============================================================

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
    underline?: boolean;
    color?: string;
  };
  href?: string | null;
}> | undefined): string {
  if (!richText || richText.length === 0) return "";
  return richText.map((t) => {
    let text = t.plain_text;
    const a = t.annotations;
    // 套用格式（code 最內層，避免跟其他格式衝突）
    if (a?.code) text = `\`${text}\``;
    if (a?.bold) text = `**${text}**`;
    if (a?.italic) text = `*${text}*`;
    if (a?.strikethrough) text = `~~${text}~~`;
    // 超連結
    if (t.href) text = `[${text}](${t.href})`;
    return text;
  }).join("");
}

/** 產生縮排前綴 */
function indent(depth: number): string {
  return "  ".repeat(depth);
}

/**
 * 將 Notion API blocks 轉換為 Markdown
 * 支援巢狀結構（透過 depth 參數控制縮排）
 */
function blocksToMarkdown(blocks: NotionBlock[], depth: number): string {
  const lines: string[] = [];
  let numberedIndex = 0; // 追蹤有序列表的序號

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const type = block.type;
    const data = block[type] as Record<string, unknown> | undefined;
    if (!data) continue;

    // 重置有序列表序號（當 block 類型不再是 numbered_list_item）
    if (type !== "numbered_list_item") numberedIndex = 0;

    // 取得帶格式文字
    const text = richTextToMarkdown(data.rich_text as Array<{
      plain_text: string;
      annotations?: { bold?: boolean; italic?: boolean; strikethrough?: boolean; code?: boolean; underline?: boolean; color?: string };
      href?: string | null;
    }>);

    const prefix = indent(depth);

    switch (type) {
      // ── 標題 ──
      case "heading_1":
        lines.push(`${prefix}# ${text}`);
        break;
      case "heading_2":
        lines.push(`${prefix}## ${text}`);
        break;
      case "heading_3":
        lines.push(`${prefix}### ${text}`);
        break;

      // ── 文字 ──
      case "paragraph":
        lines.push(`${prefix}${text || ""}`);
        break;

      // ── 列表 ──
      case "bulleted_list_item": {
        lines.push(`${prefix}- ${text}`);
        // 遞迴渲染子 block（巢狀列表）
        if (block.children?.length) {
          lines.push(blocksToMarkdown(block.children, depth + 1));
        }
        break;
      }
      case "numbered_list_item": {
        numberedIndex++;
        lines.push(`${prefix}${numberedIndex}. ${text}`);
        if (block.children?.length) {
          lines.push(blocksToMarkdown(block.children, depth + 1));
        }
        break;
      }
      case "to_do": {
        const checked = data.checked ? "x" : " ";
        lines.push(`${prefix}- [${checked}] ${text}`);
        if (block.children?.length) {
          lines.push(blocksToMarkdown(block.children, depth + 1));
        }
        break;
      }

      // ── 引用 / Callout ──
      case "quote": {
        // 每行都加 > 前綴
        lines.push(`${prefix}> ${text}`);
        if (block.children?.length) {
          const childMd = blocksToMarkdown(block.children, 0);
          // 子內容每行都加 > 前綴
          for (const childLine of childMd.split("\n")) {
            lines.push(`${prefix}> ${childLine}`);
          }
        }
        break;
      }
      case "callout": {
        const icon = data.icon as { emoji?: string } | undefined;
        const emoji = icon?.emoji ? `${icon.emoji} ` : "";
        // callout 渲染為帶 emoji 的 blockquote
        lines.push(`${prefix}> ${emoji}**${text}**`);
        if (block.children?.length) {
          const childMd = blocksToMarkdown(block.children, 0);
          for (const childLine of childMd.split("\n")) {
            lines.push(`${prefix}> ${childLine}`);
          }
        }
        break;
      }

      // ── 程式碼 ──
      case "code": {
        const lang = (data.language as string) || "";
        const codeText = richTextToPlain(data.rich_text as Array<{ plain_text: string }>);
        lines.push(`${prefix}\`\`\`${lang}\n${codeText}\n\`\`\``);
        break;
      }

      // ── Toggle（摺疊） ──
      case "toggle": {
        // 用 HTML details/summary 保留摺疊功能
        lines.push(`${prefix}<details><summary>${text}</summary>`);
        lines.push("");
        if (block.children?.length) {
          lines.push(blocksToMarkdown(block.children, depth));
        }
        lines.push(`${prefix}</details>`);
        lines.push("");
        break;
      }

      // ── 分隔線 ──
      case "divider":
        lines.push(`${prefix}---`);
        break;

      // ── 圖片 ──
      case "image": {
        const imgData = data as { type?: string; file?: { url: string }; external?: { url: string } };
        const url = imgData.file?.url || imgData.external?.url || "";
        const caption = richTextToPlain(data.caption as Array<{ plain_text: string }>);
        if (url) {
          lines.push(`${prefix}![${caption}](${url})`);
        }
        break;
      }

      // ── 影片 ──
      case "video": {
        const vidData = data as { type?: string; file?: { url: string }; external?: { url: string } };
        const url = vidData.external?.url || vidData.file?.url || "";
        if (url) {
          // YouTube / Vimeo 等外部影片用連結呈現
          lines.push(`${prefix}[▶ 影片](${url})`);
        }
        break;
      }

      // ── 嵌入 ──
      case "embed": {
        const embedUrl = (data as { url?: string }).url || "";
        if (embedUrl) {
          lines.push(`${prefix}[🔗 嵌入內容](${embedUrl})`);
        }
        break;
      }

      // ── 書籤 ──
      case "bookmark": {
        const bmUrl = (data as { url?: string }).url || "";
        const caption = richTextToPlain(data.caption as Array<{ plain_text: string }>);
        lines.push(`${prefix}[${caption || bmUrl}](${bmUrl})`);
        break;
      }

      // ── 檔案 ──
      case "file": {
        const fileData = data as { type?: string; file?: { url: string }; external?: { url: string }; name?: string };
        const url = fileData.file?.url || fileData.external?.url || "";
        const caption = richTextToPlain(data.caption as Array<{ plain_text: string }>);
        if (url) {
          lines.push(`${prefix}[📎 ${caption || fileData.name || "下載檔案"}](${url})`);
        }
        break;
      }

      // ── 表格 ──
      case "table": {
        // table 的子 block 是 table_row，已在遞迴時拉取
        if (block.children?.length) {
          for (let rowIdx = 0; rowIdx < block.children.length; rowIdx++) {
            const row = block.children[rowIdx];
            const rowData = row.table_row as { cells?: Array<Array<{ plain_text: string }>> } | undefined;
            if (!rowData?.cells) continue;
            const cells = rowData.cells.map((cell) => richTextToPlain(cell));
            lines.push(`${prefix}| ${cells.join(" | ")} |`);
            // 第一行後加分隔線
            if (rowIdx === 0) {
              lines.push(`${prefix}| ${cells.map(() => "---").join(" | ")} |`);
            }
          }
          lines.push(""); // 表格後空行
        }
        break;
      }

      // ── Column Layout（多欄排版） ──
      case "column_list": {
        // 多欄在 Markdown 中無法完美呈現，改為依序渲染每一欄
        if (block.children?.length) {
          for (const column of block.children) {
            if (column.children?.length) {
              lines.push(blocksToMarkdown(column.children, depth));
            }
          }
        }
        break;
      }
      case "column": {
        // column 單獨出現時直接渲染子內容
        if (block.children?.length) {
          lines.push(blocksToMarkdown(block.children, depth));
        }
        break;
      }

      // ── Synced Block ──
      case "synced_block": {
        // synced_block 的內容在子 block 中
        if (block.children?.length) {
          lines.push(blocksToMarkdown(block.children, depth));
        }
        break;
      }

      // ── 子頁面 ──
      case "child_page": {
        const title = (data as { title?: string }).title || "";
        lines.push(`${prefix}📄 ${title}`);
        break;
      }

      case "child_database": {
        const title = (data as { title?: string }).title || "";
        lines.push(`${prefix}📊 ${title}`);
        break;
      }

      // ── 方程式 ──
      case "equation": {
        const expression = (data as { expression?: string }).expression || "";
        lines.push(`${prefix}$$${expression}$$`);
        break;
      }

      // ── 未知類型 ──
      default:
        if (text) lines.push(`${prefix}${text}`);
        break;
    }
  }

  return lines.join("\n");
}
