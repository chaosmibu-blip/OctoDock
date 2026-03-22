/**
 * Microsoft Graph API 共用工具函式
 *
 * Excel / Word / PowerPoint adapter 共用的 Graph API 呼叫封裝。
 * 包含：HTTP 請求封裝、檔案列表/搜尋/刪除、Token refresh。
 */
import type { TokenSet } from "./types";
import { getOAuthClientId, getOAuthClientSecret } from "@/lib/oauth-env";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// ── Graph API fetch 封裝 ──────────────────────────────────
/** 通用 Graph API 請求（JSON body） */
export async function graphFetch(
  path: string,
  token: string,
  options?: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    rawResponse?: boolean; // true = 回傳 Response（用於下載二進位）
  },
): Promise<unknown> {
  const method = options?.method ?? "GET";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    ...options?.headers,
  };
  /* body 是 JSON 才加 Content-Type */
  if (options?.body && !options.headers?.["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }

  const res = await fetch(`${GRAPH_BASE}${path}`, {
    method,
    headers,
    body: options?.body
      ? typeof options.body === "string"
        ? options.body
        : JSON.stringify(options.body)
      : undefined,
  });

  /* 下載二進位檔案時回傳 Response 本身 */
  if (options?.rawResponse) return res;

  /* 204 No Content（刪除等操作） */
  if (res.status === 204) return { ok: true };

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    const msg = (err as { error?: { message?: string } }).error?.message || res.statusText;
    throw new Error(JSON.stringify({ status: res.status, message: msg }));
  }

  return res.json();
}

/** 上傳小檔案到 OneDrive（< 4MB，用 PUT content） */
export async function uploadSmallFile(
  token: string,
  fileName: string,
  content: Buffer,
  contentType: string,
  folder?: string,
): Promise<unknown> {
  const folderPath = folder ? `/${folder}` : "";
  const res = await fetch(
    `${GRAPH_BASE}/me/drive/root:${folderPath}/${fileName}:/content`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": contentType,
      },
      body: content as unknown as BodyInit,
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error(JSON.stringify({ status: res.status, message: (err as { error?: { message?: string } }).error?.message }));
  }
  return res.json();
}

// ── 共用 action：檔案列表 / 搜尋 / 刪除 / 資訊 ──────────
/** 列出 OneDrive 指定類型的檔案 */
export async function listFiles(
  token: string,
  extension: string, // e.g. "xlsx", "docx", "pptx"
  limit: number = 20,
  folder?: string,
): Promise<unknown[]> {
  /* 用 search 端點篩選副檔名 */
  const path = folder
    ? `/me/drive/root:/${folder}:/search(q='.${extension}')?$top=${limit}&$select=id,name,size,lastModifiedDateTime,webUrl,createdDateTime`
    : `/me/drive/root/search(q='.${extension}')?$top=${limit}&$select=id,name,size,lastModifiedDateTime,webUrl,createdDateTime`;
  const result = await graphFetch(path, token) as { value: unknown[] };
  /* 過濾確保只回傳指定副檔名 */
  return (result.value || []).filter((f: unknown) =>
    ((f as { name: string }).name || "").toLowerCase().endsWith(`.${extension}`)
  );
}

/** 搜尋 OneDrive 檔案 */
export async function searchFiles(
  token: string,
  query: string,
  extension?: string,
  limit: number = 20,
): Promise<unknown[]> {
  const searchQuery = extension ? `${query} .${extension}` : query;
  const path = `/me/drive/root/search(q='${encodeURIComponent(searchQuery)}')?$top=${limit}&$select=id,name,size,lastModifiedDateTime,webUrl`;
  const result = await graphFetch(path, token) as { value: unknown[] };
  const items = result.value || [];
  if (extension) {
    return items.filter((f: unknown) =>
      ((f as { name: string }).name || "").toLowerCase().endsWith(`.${extension}`)
    );
  }
  return items;
}

/** 刪除 OneDrive 檔案 */
export async function deleteFile(token: string, fileId: string): Promise<void> {
  await graphFetch(`/me/drive/items/${fileId}`, token, { method: "DELETE" });
}

/** 取得檔案資訊 */
export async function getFileInfo(token: string, fileId: string): Promise<unknown> {
  return graphFetch(`/me/drive/items/${fileId}?$select=id,name,size,lastModifiedDateTime,webUrl,createdDateTime,createdBy,lastModifiedBy`, token);
}

/** 下載檔案二進位內容 */
export async function downloadFile(token: string, fileId: string): Promise<Buffer> {
  const res = await graphFetch(`/me/drive/items/${fileId}/content`, token, { rawResponse: true }) as Response;
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/** 轉換檔案格式（如 PDF） */
export async function convertFile(token: string, fileId: string, format: string): Promise<Buffer> {
  const res = await graphFetch(`/me/drive/items/${fileId}/content?format=${format}`, token, { rawResponse: true }) as Response;
  if (!res.ok) throw new Error(`Conversion failed: ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ── Token refresh ──────────────────────────────────────────
/** Microsoft OAuth token 刷新（三個 adapter 共用） */
export async function refreshMicrosoftToken(
  refreshToken: string,
  appName: string,
): Promise<TokenSet> {
  const clientId = getOAuthClientId(appName);
  const clientSecret = getOAuthClientSecret(appName);

  const res = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: "offline_access Files.ReadWrite User.Read",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Microsoft token refresh failed: ${err}`);
  }

  const data = await res.json();
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_in: data.expires_in,
  };
}

// ── 共用 formatResponse 工具 ──────────────────────────────
/** 格式化檔案列表 */
export function formatFileList(files: unknown[], fileType: string): string {
  if (!Array.isArray(files) || files.length === 0) return `No ${fileType} files found.`;
  return files.map((f: unknown, i: number) => {
    const file = f as { name: string; id: string; size?: number; lastModifiedDateTime?: string; webUrl?: string };
    const size = file.size ? `${(file.size / 1024).toFixed(1)}KB` : "?";
    const modified = file.lastModifiedDateTime ? new Date(file.lastModifiedDateTime).toLocaleDateString() : "?";
    return `${i + 1}. **${file.name}** (${size}, modified ${modified})\n   ID: ${file.id}`;
  }).join("\n");
}

/** 格式化檔案資訊 */
export function formatFileInfo(file: unknown): string {
  const f = file as { name: string; id: string; size?: number; webUrl?: string; lastModifiedDateTime?: string; createdDateTime?: string; createdBy?: { user?: { displayName?: string } }; lastModifiedBy?: { user?: { displayName?: string } } };
  return [
    `**${f.name}**`,
    `ID: ${f.id}`,
    f.size ? `Size: ${(f.size / 1024).toFixed(1)}KB` : null,
    f.webUrl ? `URL: ${f.webUrl}` : null,
    f.createdDateTime ? `Created: ${new Date(f.createdDateTime).toLocaleString()}` : null,
    f.lastModifiedDateTime ? `Modified: ${new Date(f.lastModifiedDateTime).toLocaleString()}` : null,
    f.createdBy?.user?.displayName ? `Created by: ${f.createdBy.user.displayName}` : null,
    f.lastModifiedBy?.user?.displayName ? `Modified by: ${f.lastModifiedBy.user.displayName}` : null,
  ].filter(Boolean).join("\n");
}

// ── 共用 formatError ──────────────────────────────────────
/** 共用的 Microsoft API 錯誤格式化 */
export function formatMicrosoftError(errorMessage: string): string | null {
  const msg = errorMessage.toLowerCase();
  if (msg.includes("invalidauthenticationtoken") || msg.includes("401"))
    return "「Token 無效或已過期 (MS_AUTH_ERROR)」\n請在 Dashboard 重新連接 Microsoft。";
  if (msg.includes("itemnotfound") || msg.includes("404"))
    return "「找不到檔案 (MS_FILE_NOT_FOUND)」\n請確認檔案 ID 是否正確。";
  if (msg.includes("accessdenied") || msg.includes("403"))
    return "「權限不足 (MS_ACCESS_DENIED)」\n請確認 App 有 Files.ReadWrite 權限。";
  if (msg.includes("429") || msg.includes("throttl"))
    return "「速率限制 (MS_RATE_LIMITED)」\n請稍後再試。";
  if (msg.includes("activitylimitreached"))
    return "「Excel 操作頻率過高 (MS_EXCEL_THROTTLE)」\n請等幾秒後再試。";
  if (msg.includes("nameconflict"))
    return "「檔案名稱已存在 (MS_NAME_CONFLICT)」\n請使用不同的檔名。";
  return null;
}
