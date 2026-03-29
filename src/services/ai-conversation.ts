/**
 * AI 對話引擎
 *
 * 驅動兩個 AI 服務之間的多輪自動對話。
 * 由 AI adapter 的 converse action 觸發。
 * OctoDock 主動驅動對話流程，與通用 session 是獨立機制。
 */
import { db } from "@/db";
import { aiConversations } from "@/db/schema";
import { getAdapter } from "@/mcp/registry";
import { randomUUID } from "crypto";

/** 對話引擎的輸入參數 */
export interface ConversationParams {
  initiatorApp: string;        // 發起方 AI（例如 "openai"）
  partnerApp: string;          // 對話方 AI（例如 "anthropic"）
  topic: string;               // 討論主題
  maxRounds: number;           // 最多幾輪來回
  initiatorModel?: string;     // 發起方使用的模型
  initiatorSystemPrompt?: string; // 發起方的 system prompt
  userId: string;              // 用戶 ID（由 server.ts 注入）
  getToken: (app: string) => Promise<string>; // token 取得函式（由 server.ts 注入）
}

/** 對話中的單輪紀錄 */
interface ConversationRound {
  round: number;
  speaker: string;    // app name
  content: string;
}

/** 對話結果 */
export interface ConversationResult {
  conversationId: string;
  topic: string;
  initiator: string;
  partner: string;
  rounds: ConversationRound[];
  totalRounds: number;
  conclusion: string;
}

/** 保留的歷史上限 */
const MAX_HISTORY_ROUNDS = 10;

/**
 * 呼叫單一 AI 服務的 send_message
 * 統一封裝，讓對話引擎不用關心各家 API 差異
 */
async function callAi(
  appName: string,
  message: string,
  history: Array<{ role: string; content: string }>,
  systemPrompt: string | undefined,
  model: string | undefined,
  token: string,
): Promise<string> {
  const adapter = getAdapter(appName);
  if (!adapter) throw new Error(`AI adapter "${appName}" not found`);

  // 組裝帶歷史的訊息
  // 各家 API 的歷史格式由 adapter.execute 內部處理
  // 這裡用 system prompt 帶入歷史 context
  const historyText = history.length > 0
    ? "\n\n--- Previous conversation ---\n" +
      history.map((h) => `[${h.role}]: ${h.content}`).join("\n\n") +
      "\n--- End of previous conversation ---\n\n"
    : "";

  const fullMessage = historyText + message;
  const params: Record<string, unknown> = {
    message: fullMessage,
  };
  if (systemPrompt) params.system_prompt = systemPrompt;
  if (model) params.model = model;

  const toolName = adapter.actionMap?.["send_message"];
  if (!toolName) throw new Error(`AI adapter "${appName}" has no send_message action`);

  const result = await adapter.execute(toolName, params, token);
  const text = result.content?.[0]?.text;
  if (!text) throw new Error(`No response from ${appName}`);

  const parsed = JSON.parse(text);
  return parsed.response ?? text;
}

/**
 * 執行 AI 對話
 *
 * 流程：
 * 1. 把主題丟給 AI A（發起方），取得回覆
 * 2. 把 A 的回覆轉給 AI B（對話方），取得回覆
 * 3. 把 B 的回覆轉回 A
 * 4. 如此來回，直到達到指定輪數上限
 */
export async function runAiConversation(
  params: ConversationParams,
): Promise<ConversationResult> {
  const conversationId = randomUUID();
  const rounds: ConversationRound[] = [];
  const history: Array<{ role: string; content: string }> = [];

  const { initiatorApp, partnerApp, topic, maxRounds, userId, getToken } = params;

  // 取得雙方 token
  const [initiatorToken, partnerToken] = await Promise.all([
    getToken(initiatorApp),
    getToken(partnerApp),
  ]);

  // 取得對話方 adapter 的預設 model
  const partnerAdapter = getAdapter(partnerApp);
  if (!partnerAdapter) throw new Error(`Partner AI adapter "${partnerApp}" not found`);

  // 對話系統提示
  const baseSystemPrompt = `You are participating in a discussion about: "${topic}". Engage thoughtfully and build on the other participant's points. Be concise but substantive.`;
  const initiatorSystem = params.initiatorSystemPrompt
    ? `${params.initiatorSystemPrompt}\n\n${baseSystemPrompt}`
    : baseSystemPrompt;
  const partnerSystem = baseSystemPrompt;

  // 第一輪：把主題丟給發起方
  let currentMessage = `Let's discuss this topic: "${topic}". Please share your thoughts and perspective.`;

  for (let round = 1; round <= maxRounds; round++) {
    // A 回覆
    const aResponse = await callAi(
      initiatorApp,
      currentMessage,
      history.slice(-MAX_HISTORY_ROUNDS * 2), // 保留最近 10 輪（每輪 2 條）
      initiatorSystem,
      params.initiatorModel,
      initiatorToken,
    );

    rounds.push({ round, speaker: initiatorApp, content: aResponse });
    history.push({ role: initiatorApp, content: aResponse });

    // 紀錄到 DB（非同步，不阻塞對話）
    logConversationRound(conversationId, userId, initiatorApp, partnerApp, round, initiatorApp, aResponse).catch(() => {});

    // B 回覆（除非已是最後一輪且 A 剛說完）
    const bMessage = `The other participant (${initiatorApp}) said:\n\n${aResponse}\n\nPlease respond with your thoughts.`;
    const bResponse = await callAi(
      partnerApp,
      bMessage,
      history.slice(-MAX_HISTORY_ROUNDS * 2),
      partnerSystem,
      undefined, // partner 用預設 model
      partnerToken,
    );

    rounds.push({ round, speaker: partnerApp, content: bResponse });
    history.push({ role: partnerApp, content: bResponse });

    logConversationRound(conversationId, userId, initiatorApp, partnerApp, round, partnerApp, bResponse).catch(() => {});

    // 準備下一輪的訊息
    currentMessage = `The other participant (${partnerApp}) said:\n\n${bResponse}\n\nPlease respond with your thoughts.`;
  }

  // 取最後一輪雙方的回覆作為結論
  const lastTwo = rounds.slice(-2);
  const conclusion = lastTwo.map((r) => `**${r.speaker}**: ${r.content.slice(0, 500)}`).join("\n\n");

  return {
    conversationId,
    topic,
    initiator: initiatorApp,
    partner: partnerApp,
    rounds,
    totalRounds: maxRounds,
    conclusion,
  };
}

/** 非同步寫入對話紀錄 */
function logConversationRound(
  conversationId: string,
  userId: string,
  initiatorApp: string,
  partnerApp: string,
  round: number,
  speaker: string,
  content: string,
): Promise<void> {
  return db.insert(aiConversations).values({
    conversationId,
    userId,
    initiatorApp,
    partnerApp,
    round,
    speaker,
    content: content.slice(0, 10000), // 限制單輪內容大小
  }).then(() => {}).catch((err) => {
    console.error("Failed to log conversation round:", err);
  });
}
