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
  // Slack 獨立
  slack: "SLACK",
  // Todoist 獨立
  todoist: "TODOIST",
  // Microsoft 系列共用
  microsoft_excel: "MICROSOFT",
  microsoft_word: "MICROSOFT",
  microsoft_powerpoint: "MICROSOFT",
  // Canva 獨立
  canva: "CANVA",
  // Gamma 獨立
  gamma: "GAMMA",
  // AI 語言模型
  openai: "OPENAI",
  anthropic: "ANTHROPIC",
  google_gemini: "GOOGLE_GEMINI",
};

// ── AI 語言模型的公開 OAuth Client ID ──
// 這些是各家 CLI 工具的公開客戶端，不是 secret
const PUBLIC_CLIENT_IDS: Record<string, string> = {
  openai: "app_EMoamEEZ73f0CkXaXp7hrann", // OpenAI Codex CLI 公開客戶端
  google_gemini: "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j", // Gemini CLI 公開客戶端
};

const PUBLIC_CLIENT_SECRETS: Record<string, string> = {
  // OpenAI Codex 是純公開客戶端，無 secret（靠 PKCE）
  // Gemini CLI 有嵌入的 client_secret（Google 的 installed app 慣例）
  google_gemini: "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",
};

/**
 * 取得 App 的 OAuth Client ID
 * 優先查 ENV_PREFIX_MAP 對應的前綴，找不到就用 APP_NAME 大寫
 * Google 系全部對應到 GOOGLE_CLIENT_ID（與登入共用）
 */
export function getOAuthClientId(appName: string): string {
  // AI 語言模型使用公開的 client_id（來自各家 CLI 工具原始碼）
  if (PUBLIC_CLIENT_IDS[appName]) return PUBLIC_CLIENT_IDS[appName];
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
  // AI 語言模型使用公開的 client_secret（部分無 secret，靠 PKCE）
  if (appName in PUBLIC_CLIENT_IDS) return PUBLIC_CLIENT_SECRETS[appName] ?? "";
  const prefix = ENV_PREFIX_MAP[appName] ?? appName.toUpperCase();
  const key = `${prefix}_CLIENT_SECRET`;
  return process.env[key] ?? process.env[`${prefix}_OAUTH_CLIENT_SECRET`] ?? "";
}
