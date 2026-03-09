// Map app names to their OAuth environment variable prefixes
// Threads and Instagram both use Meta OAuth credentials
const ENV_PREFIX_MAP: Record<string, string> = {
  threads: "META",
  instagram: "META",
};

export function getOAuthClientId(appName: string): string {
  const prefix = ENV_PREFIX_MAP[appName] ?? appName.toUpperCase();
  return process.env[`${prefix}_OAUTH_CLIENT_ID`] ?? "";
}

export function getOAuthClientSecret(appName: string): string {
  const prefix = ENV_PREFIX_MAP[appName] ?? appName.toUpperCase();
  return process.env[`${prefix}_OAUTH_CLIENT_SECRET`] ?? "";
}
