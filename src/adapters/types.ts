import { z } from "zod";

// ============================================================
// Auth config types
// ============================================================

export type OAuthConfig = {
  type: "oauth2";
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  authMethod: "basic" | "post"; // Notion uses basic, Google/Meta use post
};

export type ApiKeyConfig = {
  type: "api_key";
  instructions: Record<string, string>; // i18n setup instructions
  validateEndpoint: string;
};

export type BotTokenConfig = {
  type: "bot_token";
  instructions: Record<string, string>;
  setupWebhook: boolean;
};

export type AuthConfig = OAuthConfig | ApiKeyConfig | BotTokenConfig;

// ============================================================
// Tool types
// ============================================================

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, z.ZodTypeAny>;
}

export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

// ============================================================
// AppAdapter interface
// ============================================================

export interface AppAdapter {
  name: string; // 'notion' | 'gmail' | ...
  displayName: Record<string, string>; // { zh: 'Notion', en: 'Notion' }
  icon: string;

  authType: "oauth2" | "api_key" | "bot_token";
  authConfig: AuthConfig;

  tools: ToolDefinition[];

  execute(
    toolName: string,
    params: Record<string, unknown>,
    token: string,
  ): Promise<ToolResult>;

  refreshToken?(refreshToken: string): Promise<TokenSet>;
}

// Type guard
export function isAppAdapter(obj: unknown): obj is AppAdapter {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "name" in obj &&
    "authType" in obj &&
    "tools" in obj &&
    "execute" in obj
  );
}
