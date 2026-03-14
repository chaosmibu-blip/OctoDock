// ============================================================
// 內部 AI（Internal AI）
// 用於排程引擎和模糊意圖處理
//
// 用戶在線時：用戶的 AI（Claude/ChatGPT）做決策
// 用戶不在線時：AgentDock 內部 AI 代為執行
//
// 模型選擇：Claude Haiku（最便宜，~$0.001-0.005/次）
// 需要環境變數：ANTHROPIC_API_KEY
//
// Phase 5.2：目前只提供基礎框架
// 完整實作需要 Anthropic API key 設定後才能測試
// ============================================================

/** 內部 AI 是否可用（需要 API key） */
export function isInternalAiAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/**
 * 用內部 AI 執行自然語言任務
 * 給 AI 一段 prompt，讓它理解並回傳結構化的操作指令
 *
 * @param prompt 自然語言任務描述
 * @param context 額外的上下文（例如 SOP 內容、用戶記憶）
 * @returns AI 的回應文字
 */
export async function executeWithAi(
  prompt: string,
  context?: string,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return "Internal AI not available — ANTHROPIC_API_KEY not set.";
  }

  // 組合系統提示詞
  const systemPrompt = `You are AgentDock's internal AI assistant. Your job is to execute scheduled tasks on behalf of the user.
You have access to the user's connected apps and memory through AgentDock.
Be concise and action-oriented. Execute the task described, don't just plan it.
${context ? `\nContext:\n${context}` : ""}`;

  try {
    // 呼叫 Anthropic API（Claude Haiku）
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const error = await res.json().catch(() => ({ error: { message: res.statusText } }));
      throw new Error(
        `Anthropic API error: ${(error as { error: { message: string } }).error.message}`,
      );
    }

    const data = (await res.json()) as {
      content: Array<{ type: string; text: string }>;
    };

    return data.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return `Internal AI execution failed: ${msg}`;
  }
}
