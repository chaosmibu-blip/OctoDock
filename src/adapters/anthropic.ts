/**
 * Anthropic Adapter
 *
 * 讓 AI agent 透過 OctoDock 呼叫 Anthropic Messages API。
 * 支援兩種認證方式：
 * 1. API Key（從 console.anthropic.com 取得，按用量計費）
 * 2. Setup Token（用 Claude Pro/Max 訂閱，執行 `claude setup-token` 取得）
 * 兩種 token 都透過 x-api-key header 使用，API 端點相同。
 */
import type {
  AppAdapter,
  ApiKeyConfig,
  TokenSet,
  ToolDefinition,
  ToolResult,
} from "./types";

// ── 認證設定（主要：API Key，按用量計費）─────────────────
const authConfig: ApiKeyConfig = {
  type: "api_key",
  instructions: {
    zh: "請到 https://console.anthropic.com/settings/keys 建立 API Key，然後貼到這裡。",
    en: "Go to https://console.anthropic.com/settings/keys to create an API Key, then paste it here.",
  },
  validateEndpoint: "https://api.anthropic.com/v1/messages",
};

// ── 備用認證設定：Setup Token（用訂閱額度）────────────────
const altAuthConfig: ApiKeyConfig = {
  type: "api_key",
  instructions: {
    zh: "使用 Claude Pro/Max 訂閱：\n1. 安裝 Claude Code CLI\n2. 執行 claude setup-token\n3. 複製產生的 token（sk-ant-oat01-... 開頭）貼到這裡\n\n此 token 使用你的訂閱額度，不額外計費。",
    en: "Use your Claude Pro/Max subscription:\n1. Install Claude Code CLI\n2. Run claude setup-token\n3. Copy the generated token (starts with sk-ant-oat01-...) and paste it here\n\nThis token uses your subscription quota, no extra charges.",
  },
  validateEndpoint: "https://api.anthropic.com/v1/messages",
};

// ── API 基礎設定 ───────────────────────────────────────────
const ANTHROPIC_API = "https://api.anthropic.com/v1";
const DEFAULT_MODEL = "claude-sonnet-4-20250514";

// ── 輔助函式 ──────────────────────────────────────────────
async function anthropicRequest(
  path: string,
  token: string,
  body: unknown,
): Promise<unknown> {
  // OAuth token（sk-ant-oat01-）用 Bearer header；API key（sk-ant-api03-）用 x-api-key header
  const isOAuthToken = token.startsWith("sk-ant-oat01-");
  const headers: Record<string, string> = {
    "anthropic-version": "2023-06-01",
    "Content-Type": "application/json",
  };
  if (isOAuthToken) {
    headers["Authorization"] = `Bearer ${token}`;
  } else {
    headers["x-api-key"] = token;
  }

  const res = await fetch(`${ANTHROPIC_API}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    const tokenPrefix = token.substring(0, 16) + "...";
    const authMethod = isOAuthToken ? "Bearer" : "x-api-key";
    console.error(`[anthropic] ${res.status} ${path} | auth=${authMethod} token=${tokenPrefix} | ${errText}`);
    throw new Error(`Anthropic API error: ${res.status} ${errText} (ANTHROPIC_API_ERROR)`);
  }
  return res.json();
}

// ── actionMap ──────────────────────────────────────────────
const actionMap: Record<string, string> = {
  send_message: "anthropic_send_message",
  converse: "anthropic_converse",
};

// ── ACTION_SKILLS ──────────────────────────────────────────
const ACTION_SKILLS: Record<string, string> = {
  send_message: `## anthropic.send_message
Send a message to Anthropic Claude and get a response.
### Parameters
  message: The message to send (required)
  model (optional): Model to use (default: claude-sonnet-4-20250514). Options: claude-opus-4-20250514, claude-sonnet-4-20250514, claude-haiku-4-20250506
  system_prompt (optional): System prompt to set context
  temperature (optional): 0-1, controls randomness (default: 1)
  max_tokens (optional): Maximum response length (default: 1024)
### Example
octodock_do(app:"anthropic", action:"send_message", params:{message:"Explain quantum computing in simple terms"}, intent:"Ask Claude about quantum computing")`,

  converse: `## anthropic.converse
Start a multi-round conversation between Anthropic Claude and another connected AI service.
OctoDock drives the conversation automatically, sending responses back and forth.
### Parameters
  partner: The other AI app to converse with (required, e.g. "openai", "google_gemini")
  topic: The discussion topic (required)
  max_rounds (optional): Maximum rounds of back-and-forth (default: 5, max: 20)
  system_prompt (optional): System prompt for Claude's role in the conversation
  model (optional): Model to use (default: claude-sonnet-4-20250514)
### Example
octodock_do(app:"anthropic", action:"converse", params:{partner:"openai", topic:"Compare functional and OOP paradigms", max_rounds:3}, intent:"Let Claude and OpenAI discuss programming paradigms")`,
};

// ── Adapter 定義 ──────────────────────────────────────────
const tools: ToolDefinition[] = [];

export const anthropicAdapter: AppAdapter = {
  name: "anthropic",
  displayName: { zh: "Anthropic", en: "Anthropic" },
  icon: "anthropic",
  authType: "api_key",
  authConfig,
  altAuthConfig,
  tools,
  actionMap,

  getSkill(action?: string): string | null {
    if (!action) {
      return `# Anthropic
AI language model (Claude) — send messages and get responses, or start multi-AI conversations.
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
      const usage = data.usage as { input_tokens?: number; output_tokens?: number } | undefined;
      let text = response ?? JSON.stringify(data);
      if (model) text += `\n\n---\nModel: ${model}`;
      if (usage) text += ` | Tokens: ${usage.input_tokens ?? "?"}→${usage.output_tokens ?? "?"}`;
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
    if (errorMessage.includes("401") || errorMessage.includes("authentication_error")) {
      return "Anthropic API Key is invalid or expired. Please update your API Key in the OctoDock Dashboard.";
    }
    if (errorMessage.includes("429") || errorMessage.includes("rate_limit")) {
      return "Anthropic rate limit reached. Please wait a moment and try again, or check your Anthropic plan.";
    }
    if (errorMessage.includes("credit") || errorMessage.includes("billing")) {
      return "Anthropic API credit exhausted. Please check your billing at https://console.anthropic.com/settings/billing";
    }
    return null;
  },

  async execute(
    toolName: string,
    params: Record<string, unknown>,
    token: string,
  ): Promise<ToolResult> {
    if (toolName === "anthropic_send_message") {
      const message = params.message as string;
      const model = (params.model as string) || DEFAULT_MODEL;
      const systemPrompt = params.system_prompt as string | undefined;
      const temperature = params.temperature as number | undefined;
      const maxTokens = (params.max_tokens as number) || 1024;

      const body: Record<string, unknown> = {
        model,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: message }],
      };
      if (systemPrompt) body.system = systemPrompt;
      if (temperature !== undefined) body.temperature = temperature;

      const result = await anthropicRequest("/messages", token, body) as {
        content: Array<{ type: string; text: string }>;
        model: string;
        usage: { input_tokens: number; output_tokens: number };
      };

      const responseText = result.content
        ?.filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n") ?? "";

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

    if (toolName === "anthropic_converse") {
      const { runAiConversation } = await import("@/services/ai-conversation");
      const result = await runAiConversation({
        initiatorApp: "anthropic",
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

  // Setup-token（sk-ant-oat01-）自動刷新
  // API Key（sk-ant-api03-）不需要刷新，此方法只對 OAuth token 生效
  async refreshToken(refreshToken: string): Promise<TokenSet> {
    const res = await fetch("https://api.anthropic.com/v1/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    if (!res.ok) {
      throw new Error(`Anthropic token refresh failed: ${res.status}`);
    }
    const data = await res.json();
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: data.expires_in,
    };
  },
};
