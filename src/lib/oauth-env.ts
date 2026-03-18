// Map app names to their OAuth environment variable prefixes
// 同一個平台的 App 共用 OAuth credentials

const ENV_PREFIX_MAP: Record<string, string> = {
  // Meta 系列共用
  threads: "META",
  instagram: "META",
  // Google 系列全部共用 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
  // 不同 App 靠 scope 區分權限，不需要各自獨立的 OAuth App
  gmail: "GOOGLE",
  google_calendar: "GOOGLE",
  google_drive: "GOOGLE",
  google_sheets: "GOOGLE",
  google_tasks: "GOOGLE",
  google_docs: "GOOGLE",
  youtube: "GOOGLE",
  // GitHub 獨立
  github: "GITHUB_APP",
  // Canva 獨立
  canva: "CANVA",
};

/**
 * 取得 App 的 OAuth Client ID
 * 優先查 ENV_PREFIX_MAP 對應的前綴，找不到就用 APP_NAME 大寫
 * Google 系全部對應到 GOOGLE_CLIENT_ID（與登入共用）
 */
export function getOAuthClientId(appName: string): string {
  const prefix = ENV_PREFIX_MAP[appName] ?? appName.toUpperCase();
  // Google 系共用登入憑證：GOOGLE_CLIENT_ID
  const key = `${prefix}_CLIENT_ID`;
  return process.env[key] ?? process.env[`${prefix}_OAUTH_CLIENT_ID`] ?? "";
}

/**
 * 取得 App 的 OAuth Client Secret
 * Google 系共用 GOOGLE_CLIENT_SECRET
 */
export function getOAuthClientSecret(appName: string): string {
  const prefix = ENV_PREFIX_MAP[appName] ?? appName.toUpperCase();
  const key = `${prefix}_CLIENT_SECRET`;
  return process.env[key] ?? process.env[`${prefix}_OAUTH_CLIENT_SECRET`] ?? "";
}
