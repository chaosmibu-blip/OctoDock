/**
 * OpenAI Adapter
 *
 * 讓 AI agent 透過 OctoDock 呼叫 OpenAI 的 Chat Completions API。
 * 支援兩種認證方式：
 * 1. Codex OAuth（用 ChatGPT Plus/Pro 訂閱帳號登入，PKCE 公開客戶端）
 * 2. API Key（用戶自行提供 OpenAI API Key，按用量計費）
 */
import type {
  AppAdapter,
  ApiKeyConfig,
  OAuthConfig,
  TokenSet,
  ToolDefinition,
  ToolResult,
} from "./types";

// ── 認證設定（主要：Codex OAuth 訂閱制登入）─────────────────
const authConfig: OAuthConfig = {
  type: "oauth2",
  authorizeUrl: "https://auth.openai.com/oauth/authorize",
  tokenUrl: "https://auth.openai.com/oauth/token",
  scopes: ["openid", "profile", "email", "offline_access"],
  authMethod: "post",
  extraParams: {
    code_challenge_method: "S256", // PKCE 必要
    audience: "https://api.openai.com/v1",
  },
};

// ── 備用認證設定：API Key（按用量計費）─────────────────────
const altAuthConfig: ApiKeyConfig = {
  type: "api_key",
  instructions: {
    zh: "請到 https://platform.openai.com/api-keys 建立 API Key，然後貼到這裡。",
    en: "Go to https://platform.openai.com/api-keys to create an API Key, then paste it here.",
  },
  validateEndpoint: "https://api.openai.com/v1/models",
};

// ── API 基礎設定 ───────────────────────────────────────────
const OPENAI_API = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o";

// ── 輔助函式 ──────────────────────────────────────────────
async function openaiRequest(
  path: string,
  token: string,
  body: unknown,
): Promise<unknown> {
  const res = await fetch(`${OPENAI_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`OpenAI API error: ${res.status} ${errText} (OPENAI_API_ERROR)`);
  }
  return res.json();
}

// ── actionMap ──────────────────────────────────────────────
const actionMap: Record<string, string> = {
  send_message: "openai_send_message",
  converse: "openai_converse",
};

// ── ACTION_SKILLS ──────────────────────────────────────────
const ACTION_SKILLS: Record<string, string> = {
  send_message: `## openai.send_message
Send a message to OpenAI and get a response.
### Parameters
  message: The message to send (required)
  model (optional): Model to use (default: gpt-4o). Options: gpt-4o, gpt-4o-mini, gpt-4.1, o3-mini
  system_prompt (optional): System prompt to set context
  temperature (optional): 0-2, controls randomness (default: 1)
  max_tokens (optional): Maximum response length
### Example
octodock_do(app:"openai", action:"send_message", params:{message:"Explain quantum computing in simple terms"}, intent:"Ask OpenAI about quantum computing")`,

  converse: `## openai.converse
Start a multi-round conversation between OpenAI and another connected AI service.
OctoDock drives the conversation automatically, sending responses back and forth.
### Parameters
  partner: The other AI app to converse with (required, e.g. "anthropic", "google_gemini")
  topic: The discussion topic (required)
  max_rounds (optional): Maximum rounds of back-and-forth (default: 5, max: 20)
  system_prompt (optional): System prompt for OpenAI's role in the conversation
  model (optional): Model to use (default: gpt-4o)
### Example
octodock_do(app:"openai", action:"converse", params:{partner:"anthropic", topic:"Compare functional and OOP paradigms", max_rounds:3}, intent:"Let OpenAI and Anthropic discuss programming paradigms")`,
};

// ── Adapter 定義 ──────────────────────────────────────────
const tools: ToolDefinition[] = [];

export const openaiAdapter: AppAdapter = {
  name: "openai",
  displayName: { zh: "OpenAI", en: "OpenAI" },
  icon: "openai",
  authType: "oauth2",
  authConfig,
  altAuthConfig,
  tools,
  actionMap,

  getSkill(action?: string): string | null {
    if (!action) {
      return `# OpenAI
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
      const usage = data.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
      let text = response ?? JSON.stringify(data);
      if (model) text += `\n\n---\nModel: ${model}`;
      if (usage) text += ` | Tokens: ${usage.prompt_tokens ?? "?"}→${usage.completion_tokens ?? "?"}`;
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
    if (errorMessage.includes("401") || errorMessage.includes("Unauthorized")) {
      return "OpenAI API Key is invalid or expired. Please update your API Key in the OctoDock Dashboard.";
    }
    if (errorMessage.includes("429") || errorMessage.includes("Rate limit")) {
      return "OpenAI rate limit reached. Please wait a moment and try again, or check your OpenAI plan quota.";
    }
    if (errorMessage.includes("insufficient_quota")) {
      return "OpenAI API quota exceeded. Please check your billing at https://platform.openai.com/account/billing";
    }
    return null;
  },

  async execute(
    toolName: string,
    params: Record<string, unknown>,
    token: string,
  ): Promise<ToolResult> {
    if (toolName === "openai_send_message") {
      const message = params.message as string;
      const model = (params.model as string) || DEFAULT_MODEL;
      const systemPrompt = params.system_prompt as string | undefined;
      const temperature = params.temperature as number | undefined;
      const maxTokens = params.max_tokens as number | undefined;

      const messages: Array<{ role: string; content: string }> = [];
      if (systemPrompt) messages.push({ role: "system", content: systemPrompt });
      messages.push({ role: "user", content: message });

      const body: Record<string, unknown> = { model, messages };
      if (temperature !== undefined) body.temperature = temperature;
      if (maxTokens !== undefined) body.max_tokens = maxTokens;

      const result = await openaiRequest("/chat/completions", token, body) as {
        choices: Array<{ message: { content: string } }>;
        model: string;
        usage: { prompt_tokens: number; completion_tokens: number };
      };

      const responseText = result.choices?.[0]?.message?.content ?? "";
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            response: responseText,
            model: result.model,
            usage: result.usage,
          }),
        }],
      };
    }

    if (toolName === "openai_converse") {
      // converse 由 ai-conversation engine 驅動，這裡轉交
      const { runAiConversation } = await import("@/services/ai-conversation");
      const result = await runAiConversation({
        initiatorApp: "openai",
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

  // OAuth token 自動刷新（Codex 訂閱制登入的 token 會過期）
  async refreshToken(refreshToken: string): Promise<TokenSet> {
    const res = await fetch("https://auth.openai.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
      }).toString(),
    });
    if (!res.ok) {
      throw new Error(`OpenAI token refresh failed: ${res.status}`);
    }
    const data = await res.json();
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
    };
  },
};
