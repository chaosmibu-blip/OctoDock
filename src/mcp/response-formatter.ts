// ============================================================
// J1: Response Style Guide — 統一回傳格式
// I3: 寫入型 action 不再只回 "Done."，改回結構化資料
//
// 所有 adapter 的 execute 回傳後，統一經過這裡包裝
// 不改 JSON 結構（ok/data/summary/suggestions），只統一 data 裡的人話格式
// ============================================================

/** 從 raw result 中提取常見欄位 */
function extractField(data: unknown, ...keys: string[]): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const obj = data as Record<string, unknown>;
  for (const key of keys) {
    if (obj[key] && typeof obj[key] === "string") return obj[key] as string;
    // 深一層（如 page.id, result.url）
    for (const val of Object.values(obj)) {
      if (val && typeof val === "object" && (val as Record<string, unknown>)[key]) {
        return String((val as Record<string, unknown>)[key]);
      }
    }
  }
  return undefined;
}

/** 從 Notion page 物件中提取標題 */
function extractTitle(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const obj = data as Record<string, unknown>;
  // Notion page 格式
  const props = obj.properties as Record<string, unknown> | undefined;
  if (props) {
    const titleProp = (props.title ?? props.Name) as { title?: Array<{ plain_text: string }> } | undefined;
    if (titleProp?.title?.[0]?.plain_text) return titleProp.title[0].plain_text;
  }
  // 通用格式
  return (obj.title ?? obj.name ?? obj.subject ?? obj.display_name) as string | undefined;
}

/**
 * J1: 格式化成功回傳
 * 根據 action 類型（create/update/delete/query）產生統一的人話格式
 */
export function formatSuccessResponse(
  app: string,
  action: string,
  toolName: string,
  rawData: unknown,
): string | null {
  // 只處理 adapter formatResponse 之前的 raw JSON 回傳
  // 如果 rawData 已經是格式化的文字，不再處理
  if (typeof rawData === "string") return null;

  const id = extractField(rawData, "id");
  const title = extractTitle(rawData) ?? extractField(rawData, "title", "name", "subject");
  const url = extractField(rawData, "url", "webViewLink", "html_url", "edit_url");

  // create 型
  if (/create|add|new|upload|publish/.test(action)) {
    const parts = [`${action} 完成。`];
    if (title) parts.push(`標題：${title}`);
    if (id) parts.push(`ID：${id}`);
    if (url) parts.push(`連結：${url}`);
    return parts.join("\n");
  }

  // update/move/replace 型
  if (/update|move|replace|rename|edit|append/.test(action)) {
    const parts = [`${action} 完成。`];
    if (title) parts.push(`標題：${title}`);
    if (id) parts.push(`ID：${id}`);
    return parts.join("\n");
  }

  // delete/trash/archive 型
  if (/delete|trash|archive|remove/.test(action)) {
    const parts = [`${action} 完成。`];
    if (title) parts.push(`已刪除：${title}`);
    if (id) parts.push(`ID：${id}`);
    return parts.join("\n");
  }

  return null; // 其他類型（query/read）由 adapter 自己的 formatResponse 處理
}

/**
 * J2: 從 raw result 提取結構化 summary
 * 通用 fallback — 如果 adapter 沒實作 extractSummary，用這個
 */
export function extractDefaultSummaryFromRaw(
  action: string,
  rawData: unknown,
): Record<string, unknown> | null {
  if (!rawData || typeof rawData !== "object") return null;

  const id = extractField(rawData, "id");
  const title = extractTitle(rawData) ?? extractField(rawData, "title", "name", "subject");
  const url = extractField(rawData, "url", "webViewLink", "html_url");

  if (!id && !title) return null;

  const summary: Record<string, unknown> = {};
  if (id) summary.id = id;
  if (title) summary.title = title;
  if (url) summary.url = url;
  return summary;
}
