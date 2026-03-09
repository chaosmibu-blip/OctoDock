# AgentDock Phase 4 實作指令：Bot 自動回覆 + 擴展

> 前置條件：Phase 3 完成（六 App 可用、記憶智慧化、Webhook 能接收外部訊息、beta 用戶已在使用）

---

## Step 1：Bot 自動回覆引擎

目標：外部用戶傳訊息給 LINE/Telegram Bot 時，AgentDock 自動用 AI 回覆。

### 1.1 自動回覆引擎
`src/services/auto-reply.ts`

```typescript
async function processIncomingMessage(botConfig: BotConfig, message: IncomingMessage) {
  // 1. 取得 Bot 所屬用戶的記憶
  const memories = await queryMemory(botConfig.userId, message.text);

  // 2. 取得對話歷史（最近 N 則，從 operations 表讀）
  const history = await getConversationHistory(botConfig.id, message.senderId, 10);

  // 3. 組合 prompt
  const messages = [
    { role: "system", content: buildSystemPrompt(botConfig.systemPrompt, memories) },
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: "user", content: message.text },
  ];

  // 4. 呼叫 LLM API（用戶自帶的 API key）
  const reply = await callLLM(botConfig.llmProvider, decrypt(botConfig.llmApiKey), messages);

  // 5. 透過對應平台 API 回覆
  if (botConfig.platform === 'line') {
    await lineReply(botConfig, message.replyToken, reply);
  } else if (botConfig.platform === 'telegram') {
    await telegramReply(botConfig, message.chatId, reply);
  }

  // 6. 記錄到 operations
  await logOperation({
    userId: botConfig.userId,
    appName: botConfig.platform,
    toolName: `${botConfig.platform}_auto_reply`,
    action: 'auto_reply',
    params: { incoming: message.text },
    result: { reply },
    intent: 'Automated bot reply',
    success: true,
  });
}
```

### 1.2 LLM 呼叫模組
`src/services/llm-client.ts`
- `callLLM(provider, apiKey, messages)` — 統一介面
- 支援 provider：'claude'（Anthropic API）、'openai'（OpenAI API）、'gemini'（Google AI API）
- 每個 provider 一個 adapter function，統一回傳 string
- 錯誤處理：API key 無效 → 清楚提示用戶更新 key

### 1.3 Webhook 接入自動回覆
更新 Phase 3 建立的 Webhook 端點：
- `src/app/api/webhook/line/route.ts` — 收到訊息後檢查 bot_config.is_active → 如果有設定 llm_api_key → 呼叫 processIncomingMessage
- `src/app/api/webhook/telegram/route.ts` — 同上
- LINE 要求 1 秒內回 200，所以 processIncomingMessage 必須非同步（先回 200，背景處理）

**做完 Step 1 後暫停，讓我測試自動回覆。**

---

## Step 2：對話歷史管理

目標：Bot 能記住跟同一個人的對話脈絡。

### 2.1 對話歷史表
`src/db/schema.ts` — 新增 bot_conversations 表：

```sql
CREATE TABLE bot_conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_config_id   UUID REFERENCES bot_configs(id) ON DELETE CASCADE,
  external_user_id TEXT NOT NULL,       -- LINE userId 或 Telegram chatId
  role            TEXT NOT NULL,        -- 'user' | 'assistant'
  content         TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_bot_conv_lookup ON bot_conversations(bot_config_id, external_user_id, created_at DESC);
```

### 2.2 歷史讀寫
- processIncomingMessage 收到訊息 → 寫入 bot_conversations（role='user'）
- LLM 回覆後 → 寫入 bot_conversations（role='assistant'）
- getConversationHistory → 從 bot_conversations 讀最近 N 則

### 2.3 歷史上限
- 每次查詢限制最近 20 則（避免 context 太長）
- 超過 100 則的對話自動清理最舊的（背景排程）

**做完 Step 2 後暫停。**

---

## Step 3：Bot 人設系統

目標：用戶能自訂 Bot 的語氣、知識範圍、行為規則。

### 3.1 Bot 設定頁面
`src/app/bot-settings/page.tsx`
- 列出用戶的所有 Bot（LINE / Telegram）
- 每個 Bot 可設定：
  - **名稱**：Bot 的顯示名稱
  - **人設 System Prompt**：自由文字，用戶描述 Bot 的角色和語氣
  - **LLM 選擇**：Claude / GPT / Gemini 下拉選單
  - **LLM API Key**：密碼輸入框，加密儲存
  - **開關**：啟用/停用自動回覆
- 提供幾個人設模板讓用戶參考：
  - 「專業客服」：語氣正式、回答產品問題、不確定時建議聯繫人工客服
  - 「活潑小編」：語氣輕鬆、使用 emoji、適合粉絲互動
  - 「預約助手」：引導用戶完成預約流程、確認時間和項目

### 3.2 Bot 設定 API
`src/app/api/bot-settings/route.ts`
- GET：讀取用戶所有 bot_configs
- POST：建立新 Bot config
- PUT：更新 Bot config（包括 system_prompt、llm 設定）
- DELETE：刪除 Bot config + 撤銷 webhook

### 3.3 System Prompt 組合
`src/services/auto-reply.ts` 的 buildSystemPrompt：
```
用戶自訂的人設
+
用戶的相關記憶（從 memory 表查）
+
固定的安全規則（不洩漏用戶隱私、不做有害行為）
```

**做完 Step 3 後暫停。**

---

## Step 4：LLM 費用機制

目標：用戶自帶 API key，AgentDock 不承擔 LLM 費用。

### 4.1 API Key 管理
- 用戶在 Bot 設定頁面貼上 API key → AES-256-GCM 加密儲存
- 每次自動回覆時解密 → 呼叫對應 LLM API → 用完不保留明文
- key 驗證：儲存前先呼叫一次 API（低成本的 request）確認 key 有效

### 4.2 用量追蹤（簡單版）
- 在 operations 表記錄每次自動回覆的 LLM 使用
- Dashboard 顯示本月 Bot 自動回覆次數（讓用戶自己對帳單）
- 不做精確的 token 計算，只記次數

### 4.3 無 API Key 時的行為
- 用戶沒設定 API key → Webhook 收到訊息 → 只記錄不回覆
- 提示用戶：「設定 LLM API Key 後，Bot 才會自動回覆」

**做完 Step 4 後暫停。**

---

## Step 5：更多 App 串接

目標：利用 Adapter Registry 快速擴展。

### 5.1 Google Calendar Adapter
`src/adapters/google-calendar.ts`
- 跟 Gmail 共用 Google OAuth credentials（同一個 Google Cloud 專案）
- 需要額外 scope：`https://www.googleapis.com/auth/calendar`
- 工具：calendar_list_events, calendar_create_event, calendar_update_event, calendar_delete_event, calendar_find_free_time

### 5.2 Google Drive Adapter
`src/adapters/google-drive.ts`
- 同上共用 credentials
- 需要額外 scope：`https://www.googleapis.com/auth/drive.readonly`（MVP 先只讀）
- 工具：drive_search, drive_get_file, drive_list_files

### 5.3 Facebook Pages Adapter
`src/adapters/facebook.ts`
- 跟 Threads/Instagram 共用 Meta App credentials
- 工具：facebook_publish, facebook_get_posts, facebook_reply_comment, facebook_get_insights

### 5.4 OAuth 多 scope 處理
Google 和 Meta 的情況：一組 credentials 但不同 App 需要不同 scopes。
- 方案：connected_apps 每個 App 一筆記錄，各自有各自的 scopes
- 用戶連結 Gmail 時拿到 gmail 相關 scopes
- 用戶再連結 Calendar 時，重新授權拿到 gmail + calendar scopes → 更新 Gmail 的記錄也一起更新 token
- 或者：一次授權就包含所有 Google scopes，在 Dashboard 上呈現為多個 App

**做完 Step 5 後暫停。**

---

## Step 6：整合測試 + 商業化準備

### 6.1 完整測試
- Bot 自動回覆端到端（LINE 外部用戶發訊息 → 收到 AI 回覆）
- Bot 人設正確套用（不同 Bot 用不同語氣回覆）
- 對話歷史連貫（Bot 記得之前聊的內容）
- 新 App（Calendar、Drive、Facebook）基本功能

### 6.2 效能測試
- 多個 Bot 同時收到訊息 → 確認不阻塞
- 自動回覆延遲 < 5 秒
- 記憶查詢延遲 < 500ms

### 6.3 Dashboard 最終版
- 總覽：已連結 App 數量、本月操作次數、Bot 回覆次數
- Bot 管理：建立/設定/刪除 Bot
- 記憶管理：查看/刪除 AI 歸納的記憶
- 帳號設定：刪除帳號（CASCADE 清除所有資料）

### 6.4 商業化準備
- 定價方案設計（免費版限制 App 數、付費版無限制）
- 付款整合（Stripe）
- 隱私政策 + 服務條款
- Landing page

**Phase 4 完成！里程碑：Bot 7×24 自動回覆 + 完整商業化準備。**
