/**
 * 取得用戶在各 App 裡的身份（userId + userName）
 * OAuth callback 時呼叫，寫入 connected_apps 的 app_user_id / app_user_name
 * 每個 provider 有不同的 userinfo 端點
 */

// 各 provider 的 userinfo 端點和回應格式
const USERINFO_ENDPOINTS: Record<string, {
  url: string;
  extractId: (data: Record<string, unknown>) => string | null;
  extractName: (data: Record<string, unknown>) => string | null;
}> = {
  // Google 系列共用同一個 userinfo 端點
  gmail: {
    url: "https://www.googleapis.com/oauth2/v2/userinfo",
    extractId: (d) => (d.email as string) ?? null,
    extractName: (d) => (d.name as string) ?? (d.email as string) ?? null,
  },
  google_calendar: {
    url: "https://www.googleapis.com/oauth2/v2/userinfo",
    extractId: (d) => (d.email as string) ?? null,
    extractName: (d) => (d.name as string) ?? (d.email as string) ?? null,
  },
  google_drive: {
    url: "https://www.googleapis.com/oauth2/v2/userinfo",
    extractId: (d) => (d.email as string) ?? null,
    extractName: (d) => (d.name as string) ?? (d.email as string) ?? null,
  },
  google_sheets: {
    url: "https://www.googleapis.com/oauth2/v2/userinfo",
    extractId: (d) => (d.email as string) ?? null,
    extractName: (d) => (d.name as string) ?? (d.email as string) ?? null,
  },
  google_docs: {
    url: "https://www.googleapis.com/oauth2/v2/userinfo",
    extractId: (d) => (d.email as string) ?? null,
    extractName: (d) => (d.name as string) ?? (d.email as string) ?? null,
  },
  google_tasks: {
    url: "https://www.googleapis.com/oauth2/v2/userinfo",
    extractId: (d) => (d.email as string) ?? null,
    extractName: (d) => (d.name as string) ?? (d.email as string) ?? null,
  },
  youtube: {
    url: "https://www.googleapis.com/oauth2/v2/userinfo",
    extractId: (d) => (d.email as string) ?? null,
    extractName: (d) => (d.name as string) ?? (d.email as string) ?? null,
  },
  // Microsoft 系列共用 Graph /me 端點
  microsoft_excel: {
    url: "https://graph.microsoft.com/v1.0/me",
    extractId: (d) => (d.mail as string) ?? (d.userPrincipalName as string) ?? null,
    extractName: (d) => (d.displayName as string) ?? null,
  },
  microsoft_word: {
    url: "https://graph.microsoft.com/v1.0/me",
    extractId: (d) => (d.mail as string) ?? (d.userPrincipalName as string) ?? null,
    extractName: (d) => (d.displayName as string) ?? null,
  },
  microsoft_powerpoint: {
    url: "https://graph.microsoft.com/v1.0/me",
    extractId: (d) => (d.mail as string) ?? (d.userPrincipalName as string) ?? null,
    extractName: (d) => (d.displayName as string) ?? null,
  },
  // GitHub
  github: {
    url: "https://api.github.com/user",
    extractId: (d) => (d.login as string) ?? null,
    extractName: (d) => (d.name as string) ?? (d.login as string) ?? null,
  },
  // Notion — owner 資訊在 token response 裡就有，但也可以用 /v1/users/me
  notion: {
    url: "https://api.notion.com/v1/users/me",
    extractId: (d) => (d.id as string) ?? null,
    extractName: (d) => (d.name as string) ?? null,
  },
  // Canva
  canva: {
    url: "https://api.canva.com/rest/v1/users/me",
    extractId: (d) => (d.id as string) ?? null,
    extractName: (d) => (d.display_name as string) ?? null,
  },
  // Todoist
  todoist: {
    url: "https://api.todoist.com/rest/v2/user",
    extractId: (d) => (d.email as string) ?? null,
    extractName: (d) => (d.full_name as string) ?? null,
  },
};

/**
 * 取得用戶在指定 App 的身份
 * @returns { appUserId, appUserName } 或 null（不支援或查詢失敗時）
 */
export async function fetchAppUser(
  appName: string,
  accessToken: string,
): Promise<{ appUserId: string; appUserName: string } | null> {
  const config = USERINFO_ENDPOINTS[appName];
  if (!config) return null; // 此 App 不支援 userinfo 查詢

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
    };
    // Notion 需要額外的 version header
    if (appName === "notion") {
      headers["Notion-Version"] = "2022-06-28";
    }

    const res = await fetch(config.url, { headers });
    if (!res.ok) return null;

    const data = (await res.json()) as Record<string, unknown>;
    const appUserId = config.extractId(data);
    const appUserName = config.extractName(data);

    if (!appUserId) return null;
    return { appUserId, appUserName: appUserName ?? appUserId };
  } catch {
    // userinfo 查詢失敗不阻塞 OAuth 流程
    return null;
  }
}
