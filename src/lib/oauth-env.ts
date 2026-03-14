// Map app names to their OAuth environment variable prefixes
// 同一個平台的 App 共用 OAuth credentials
const ENV_PREFIX_MAP: Record<string, string> = {
  // Meta 系列共用
  threads: "META",
  instagram: "META",
  // Google 系列各自獨立（不同 scope 需要不同的 OAuth App）
  google_calendar: "GCAL",
  google_drive: "GDRIVE",
  google_sheets: "GSHEETS",
  google_tasks: "GTASKS",
  google_docs: "GDOCS",
  youtube: "YOUTUBE",
};

export function getOAuthClientId(appName: string): string {
  const prefix = ENV_PREFIX_MAP[appName] ?? appName.toUpperCase();
  return process.env[`${prefix}_OAUTH_CLIENT_ID`] ?? "";
}

export function getOAuthClientSecret(appName: string): string {
  const prefix = ENV_PREFIX_MAP[appName] ?? appName.toUpperCase();
  return process.env[`${prefix}_OAUTH_CLIENT_SECRET`] ?? "";
}
