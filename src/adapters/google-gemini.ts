/**
 * Google Gemini Adapter
 *
 * 讓 AI agent 透過 OctoDock 呼叫 Google Gemini API。
 * 支援兩種認證方式：
 * 1. Google 帳號 OAuth（用 Google AI Pro/Ultra 訂閱，Gemini CLI 的公開客戶端）
 * 2. API Key（從 Google AI Studio 取得，免費額度或按用量計費）
 */
import type {
  AppAdapter,
  ApiKeyConfig,
  OAuthConfig,
  TokenSet,
  ToolDefinition,
  ToolResult,
} from "./types";

// ── 認證設定（主要：Google OAuth 訂閱制登入）─────────────
const authConfig: OAuthConfig = {
  type: "oauth2",
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  scopes: [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
  ],
  authMethod: "post",
  extraParams: {
    code_challenge_method: "S256", // PKCE
    access_type: "offline",
    prompt: "consent",
  },
};

// ── 備用認證設定：API Key（免費額度或按用量計費）─────────
const altAuthConfig: ApiKeyConfig = {
  type: "api_key",
  instructions: {
    zh: "請到 https://aistudio.google.com/apikey 建立 API Key，然後貼到這裡。",
    en: "Go to https://aistudio.google.com/apikey to create an API Key, then paste it here.",
  },
  validateEndpoint: "https://generativelanguage.googleapis.com/v1beta/models",
};

// ── API 基礎設定 ───────────────────────────────────────────
const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-2.5-flash";

// ── 輔助函式 ──────────────────────────────────────────────
async function geminiRequest(
  model: string,
  token: string,
  body: unknown,
): Promise<unknown> {
  // 判斷 token 類型：OAuth token 用 Bearer header，API Key 用 query parameter
  // OAuth token 通常以 ya29. 開頭或很長，API Key 通常以 AI 開頭且較短
  const isOAuthToken = token.startsWith("ya29.") || token.length > 100;
  const url = isOAuthToken
    ? `${GEMINI_API}/models/${model}:generateContent`
    : `${GEMINI_API}/models/${model}:generateContent?key=${token}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (isOAuthToken) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`Gemini API error: ${res.status} ${errText} (GEMINI_API_ERROR)`);
  }
  return res.json();
}

// ── actionMap ──────────────────────────────────────────────
const actionMap: Record<string, string> = {
  send_message: "google_gemini_send_message",
  converse: "google_gemini_converse",
};

// ── ACTION_SKILLS ──────────────────────────────────────────
const ACTION_SKILLS: Record<string, string> = {
  send_message: `## google_gemini.send_message
Send a message to Google Gemini and get a response.
### Parameters
  message: The message to send (required)
  model (optional): Model to use (default: gemini-2.5-flash). Options: gemini-2.5-pro, gemini-2.5-flash, gemini-2.0-flash
  system_prompt (optional): System prompt to set context
  temperature (optional): 0-2, controls randomness (default: 1)
  max_tokens (optional): Maximum response length
### Example
octodock_do(app:"google_gemini", action:"send_message", params:{message:"Explain quantum computing in simple terms"}, intent:"Ask Gemini about quantum computing")`,

  converse: `## google_gemini.converse
Start a multi-round conversation between Google Gemini and another connected AI service.
OctoDock drives the conversation automatically, sending responses back and forth.
### Parameters
  partner: The other AI app to converse with (required, e.g. "openai", "anthropic")
  topic: The discussion topic (required)
  max_rounds (optional): Maximum rounds of back-and-forth (default: 5, max: 20)
  system_prompt (optional): System prompt for Gemini's role in the conversation
  model (optional): Model to use (default: gemini-2.5-flash)
### Example
octodock_do(app:"google_gemini", action:"converse", params:{partner:"openai", topic:"Compare functional and OOP paradigms", max_rounds:3}, intent:"Let Gemini and OpenAI discuss programming paradigms")`,
};

// ── Adapter 定義 ──────────────────────────────────────────
const tools: ToolDefinition[] = [];

export const googleGeminiAdapter: AppAdapter = {
  name: "google_gemini",
  displayName: { zh: "Google Gemini", en: "Google Gemini" },
  icon: "google_gemini",
  authType: "oauth2",
  authConfig,
  altAuthConfig,
  tools,
  actionMap,

  getSkill(action?: string): string | null {
    if (!action) {
      return `# Google Gemini
AI language model — send messages and get responses, or start multi-AI conversations.
## Available Actions
- **send_message** — Send a message and get a response
- **converse** — Multi-round conversation with another AI service`;
    }
    return ACTION_SKILLS[action] ?? null;
  },

  formatResponse(action: string, rawData: unknown): string {
    const data = rawData as Record<string, unknown>;
    if (action === "send_message") {
      const response = data.response as string | undefined;
      const model = data.model as string | undefined;
      const usage = data.usage as { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;
      let text = response ?? JSON.stringify(data);
      if (model) text += `\n\n---\nModel: ${model}`;
      if (usage) text += ` | Tokens: ${usage.promptTokenCount ?? "?"}→${usage.candidatesTokenCount ?? "?"}`;
      return text;
    }
    if (action === "converse") {
      const rounds = data.rounds as Array<{ round: number; speaker: string; content: string }> | undefined;
      const conclusion = data.conclusion as string | undefined;
      if (!rounds) return JSON.stringify(data);
      let text = `**Conversation completed (${rounds.length} rounds)**\n\n`;
      for (const r of rounds) {
        text += `### Round ${r.round} — ${r.speaker}\n${r.content}\n\n`;
      }
      if (conclusion) text += `---\n**Conclusion:**\n${conclusion}`;
      return text;
    }
    return JSON.stringify(data);
  },

  formatError(action: string, errorMessage: string): string | null {
    if (errorMessage.includes("API_KEY_INVALID") || errorMessage.includes("401")) {
      return "Gemini API Key is invalid. Please update your API Key in the OctoDock Dashboard.";
    }
    if (errorMessage.includes("429") || errorMessage.includes("RESOURCE_EXHAUSTED")) {
      return "Gemini rate limit or quota reached. Please wait a moment and try again, or check your quota at https://aistudio.google.com/apikey";
    }
    return null;
  },

  async execute(
    toolName: string,
    params: Record<string, unknown>,
    token: string,
  ): Promise<ToolResult> {
    if (toolName === "google_gemini_send_message") {
      const message = params.message as string;
      const model = (params.model as string) || DEFAULT_MODEL;
      const systemPrompt = params.system_prompt as string | undefined;
      const temperature = params.temperature as number | undefined;
      const maxTokens = params.max_tokens as number | undefined;

      const body: Record<string, unknown> = {
        contents: [{ parts: [{ text: message }] }],
      };

      if (systemPrompt) {
        body.systemInstruction = { parts: [{ text: systemPrompt }] };
      }

      const generationConfig: Record<string, unknown> = {};
      if (temperature !== undefined) generationConfig.temperature = temperature;
      if (maxTokens !== undefined) generationConfig.maxOutputTokens = maxTokens;
      if (Object.keys(generationConfig).length > 0) {
        body.generationConfig = generationConfig;
      }

      const result = await geminiRequest(model, token, body) as {
        candidates: Array<{ content: { parts: Array<{ text: string }> } }>;
        modelVersion?: string;
        usageMetadata?: { promptTokenCount: number; candidatesTokenCount: number };
      };

      const responseText = result.candidates?.[0]?.content?.parts
        ?.map((p) => p.text)
        .join("\n") ?? "";

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            response: responseText,
            model: result.modelVersion ?? model,
            usage: result.usageMetadata,
          }),
        }],
      };
    }

    if (toolName === "google_gemini_converse") {
      const { runAiConversation } = await import("@/services/ai-conversation");
      const result = await runAiConversation({
        initiatorApp: "google_gemini",
        partnerApp: params.partner as string,
        topic: params.topic as string,
        maxRounds: Math.min((params.max_rounds as number) || 5, 20),
        initiatorModel: (params.model as string) || DEFAULT_MODEL,
        initiatorSystemPrompt: params.system_prompt as string | undefined,
        userId: params._userId as string,
        getToken: params._getToken as (app: string) => Promise<string>,
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    }

    return {
      content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
      isError: true,
    };
  },

  extractSummary(action: string, rawResult: unknown): Record<string, unknown> | null {
    const data = rawResult as Record<string, unknown>;
    if (action === "send_message") {
      const response = data.response as string | undefined;
      return {
        model: data.model,
        responseLength: response?.length ?? 0,
        usage: data.usage,
      };
    }
    if (action === "converse") {
      const rounds = data.rounds as Array<unknown> | undefined;
      return {
        totalRounds: rounds?.length ?? 0,
        partner: data.partner,
        topic: data.topic,
      };
    }
    return null;
  },

  // Google OAuth token 自動刷新（訂閱制登入的 token 會過期）
  // 使用 Gemini CLI 的公開 client credentials
  async refreshToken(refreshToken: string): Promise<TokenSet> {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j",
        client_secret: "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",
      }).toString(),
    });
    if (!res.ok) {
      throw new Error(`Gemini token refresh failed: ${res.status}`);
    }
    const data = await res.json();
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
    };
  },
};
