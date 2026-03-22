/**
 * 雲端儲存共用函式
 *
 * 將 OctoDock 生成的二進位檔案（PDF、圖片、圖表等）自動上傳到
 * 用戶已連接的雲端硬碟（Google Drive 優先、OneDrive 備選）。
 * 如果沒有連接任何雲端，fallback 回傳 base64。
 */
import { db } from "@/db";
import { connectedApps } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { decrypt } from "@/lib/crypto";

/** 上傳結果 */
export interface CloudSaveResult {
  saved: boolean; // 是否成功上傳到雲端
  url?: string; // 雲端檔案的分享連結
  fileName: string;
  storage?: string; // 儲存位置（google_drive / microsoft_word / base64）
  base64?: string; // fallback：base64 編碼（未連接雲端時）
  size: number; // 檔案大小（bytes）
}

/**
 * 自動上傳檔案到用戶已連接的雲端硬碟
 * 優先順序：Google Drive → OneDrive（任一 Microsoft adapter）→ base64 fallback
 */
export async function saveToCloud(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  userId: string,
): Promise<CloudSaveResult> {
  /* 查詢用戶已連接的雲端 App */
  const apps = await db
    .select({ appName: connectedApps.appName, accessToken: connectedApps.accessToken })
    .from(connectedApps)
    .where(
      and(
        eq(connectedApps.userId, userId),
        eq(connectedApps.status, "active"),
      ),
    );

  const appMap = new Map(apps.map(a => [a.appName, a.accessToken]));

  /* 嘗試 Google Drive */
  if (appMap.has("google_drive")) {
    try {
      const token = await getValidTokenForApp(userId, "google_drive");
      const result = await uploadToGoogleDrive(buffer, fileName, mimeType, token);
      return {
        saved: true,
        url: result.webViewLink,
        fileName: result.name || fileName,
        storage: "google_drive",
        size: buffer.length,
      };
    } catch {
      /* Google Drive 上傳失敗，繼續嘗試 OneDrive */
    }
  }

  /* 嘗試 OneDrive（任一 Microsoft adapter） */
  const msApps = ["microsoft_word", "microsoft_excel", "microsoft_powerpoint"];
  for (const msApp of msApps) {
    if (appMap.has(msApp)) {
      try {
        const token = await getValidTokenForApp(userId, msApp);
        const result = await uploadToOneDrive(buffer, fileName, mimeType, token);
        return {
          saved: true,
          url: (result as { webUrl?: string }).webUrl,
          fileName,
          storage: "onedrive",
          size: buffer.length,
        };
      } catch {
        /* 繼續嘗試下一個 */
      }
    }
  }

  /* Fallback：回傳 base64（未連接雲端或全部上傳失敗） */
  return {
    saved: false,
    fileName,
    storage: "base64",
    base64: `data:${mimeType};base64,${buffer.toString("base64")}`,
    size: buffer.length,
  };
}

/** 取得有效的 access token（含 refresh 邏輯） */
async function getValidTokenForApp(userId: string, appName: string): Promise<string> {
  const { getValidToken } = await import("@/services/token-manager");
  return getValidToken(userId, appName);
}

/** 上傳到 Google Drive */
async function uploadToGoogleDrive(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  token: string,
): Promise<{ name: string; webViewLink: string }> {
  const metadata = { name: fileName, parents: [] };
  const boundary = "octodock_cloud_" + Date.now();

  /* multipart/related 格式：metadata + file content */
  const metaPart = JSON.stringify(metadata);
  const header = [
    `--${boundary}`,
    "Content-Type: application/json; charset=UTF-8",
    "",
    metaPart,
    `--${boundary}`,
    `Content-Type: ${mimeType}`,
    "Content-Transfer-Encoding: base64",
    "",
    buffer.toString("base64"),
    `--${boundary}--`,
  ].join("\r\n");

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body: header,
    },
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Google Drive upload failed: ${err}`);
  }

  return res.json() as Promise<{ name: string; webViewLink: string }>;
}

/** 上傳到 OneDrive */
async function uploadToOneDrive(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  token: string,
): Promise<unknown> {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/root:/${fileName}:/content`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": mimeType,
      },
      body: buffer as unknown as BodyInit,
    },
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OneDrive upload failed: ${err}`);
  }

  return res.json();
}
