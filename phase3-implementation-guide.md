# AgentDock Phase 3 實作指令：Bot 串接 + 智慧化

> 前置條件：Phase 2 完成（四 App 全通、記憶系統 MVP 可用）

---

## Step 1：LINE Bot Adapter

目標：agent 能透過 MCP 發 LINE 訊息。

### 1.1 LINE Adapter
`src/adapters/line.ts` — 實作 AppAdapter 介面

authType: `'api_key'`（不是 OAuth，用戶手動貼 Channel Access Token）

authConfig:
```typescript
{
  type: 'api_key',
  instructions: {
    zh: '1. 到 LINE Developers Console 建立 Messaging API channel\n2. 複製 Channel Access Token\n3. 貼到下方欄位',
    en: '1. Go to LINE Developers Console, create a Messaging API channel\n2. Copy Channel Access Token\n3. Paste below'
  },
  validateEndpoint: 'https://api.line.me/v2/bot/info'
}
```

### 1.2 Dashboard — API Key 連結流程
跟 OAuth 不同，不是跳轉授權，而是：
- 用戶點「連結 LINE Bot」→ 顯示圖文教學 + 輸入框
- 用戶貼上 Channel Access Token
- AgentDock 呼叫 validateEndpoint 驗證 token 有效
- 有效 → encrypt 後存入 connected_apps（auth_type='api_key'）
- config 欄位存 Channel ID 和 Channel Secret（用於 Webhook 簽章驗證）

### 1.3 通用 API Key 連結 API
`src/app/api/connect-key/[app]/route.ts`
- POST：接收 token + 額外設定 → 驗證 → 加密儲存
- 這是通用的，未來其他 api_key 類型的 App 也走這裡

### 1.4 五個工具

**line_send_message** — `POST https://api.line.me/v2/bot/message/push`，body: `{ to: userId, messages: [...] }`

**line_broadcast** — `POST https://api.line.me/v2/bot/message/broadcast`，body: `{ messages: [...] }`

**line_get_profile** — `GET https://api.line.me/v2/bot/profile/{userId}`

**line_get_followers** — `GET https://api.line.me/v2/bot/followers/ids` + `GET https://api.line.me/v2/bot/insight/followers`

**line_reply** — `POST https://api.line.me/v2/bot/message/reply`，body: `{ replyToken, messages: [...] }`

所有 LINE API 請求帶：`Authorization: Bearer {channel_access_token}`

**做完 Step 1 後暫停，讓我測試 LINE Bot 連結和發訊息。**

---

## Step 2：Telegram Bot Adapter

目標：agent 能透過 MCP 發 Telegram 訊息。

### 2.1 Telegram Adapter
`src/adapters/telegram.ts` — 實作 AppAdapter 介面

authType: `'bot_token'`

authConfig:
```typescript
{
  type: 'bot_token',
  instructions: {
    zh: '1. 在 Telegram 找 @BotFather\n2. 輸入 /newbot，按照步驟建立\n3. 複製 Bot Token\n4. 貼到下方欄位',
    en: '1. Find @BotFather on Telegram\n2. Send /newbot and follow steps\n3. Copy Bot Token\n4. Paste below'
  },
  setupWebhook: true
}
```

### 2.2 自動設定 Webhook
用戶貼上 Bot Token 後，AgentDock 自動呼叫：
`POST https://api.telegram.org/bot{token}/setWebhook`，body: `{ url: 'https://agentdock.app/api/webhook/telegram?botId={bot_config_id}' }`

### 2.3 Dashboard — Bot Token 連結流程
跟 LINE 類似，用戶貼 token → 驗證（`GET https://api.telegram.org/bot{token}/getMe`）→ 加密儲存 → 自動設定 webhook

### 2.4 四個工具

**telegram_send_message** — `POST /bot{token}/sendMessage`，body: `{ chat_id, text, parse_mode: 'Markdown' }`

**telegram_send_photo** — `POST /bot{token}/sendPhoto`，body: `{ chat_id, photo: url, caption }`

**telegram_get_updates** — `POST /bot{token}/getUpdates`，回傳最近的訊息

**telegram_set_webhook** — `POST /bot{token}/setWebhook`，讓用戶可以切換 webhook URL

**做完 Step 2 後暫停，讓我測試 Telegram Bot。**

---

## Step 3：Webhook 接收端點

目標：AgentDock 能接收 LINE / Telegram 的外部訊息（為 Phase 4 自動回覆做準備）。

### 3.1 LINE Webhook
`src/app/api/webhook/line/route.ts`
- POST handler
- 驗證 x-line-signature（用 Channel Secret + HMAC-SHA256）
- 從 body.destination 找到對應的 bot_config
- 將收到的訊息寫入 operations 表（app='line', action='incoming_message'）
- Phase 3：只記錄，不自動回覆
- Phase 4：觸發自動回覆引擎

### 3.2 Telegram Webhook
`src/app/api/webhook/telegram/route.ts`
- POST handler
- 從 query parameter 的 botId 找到對應的 bot_config
- 將收到的訊息寫入 operations 表
- Phase 3：只記錄，不自動回覆

### 3.3 bot_configs 表
確認 Drizzle schema 有 bot_configs 表（spec 第 4.5 節）。新增 migration。

**做完 Step 3 後暫停。**

---

## Step 4：自動偏好歸納

目標：系統自動從操作記錄中歸納出用戶的偏好和模式。

### 4.1 歸納引擎
`src/services/memory-engine.ts` 新增：
- `analyzeOperations(userId)` — 從 operations 表分析最近 N 筆操作
- 規則型歸納（MVP，不用 LLM）：
  - Threads 發文中 >60% 包含同一個 hashtag → 歸納為 preference
  - 每週同一天做同樣的操作 → 歸納為 pattern
  - 最近 3 天集中使用某個 App → 歸納為 context
- 產生的記憶寫入 memory 表，confidence 根據出現次數計算

### 4.2 觸發時機
- 每次 operations 寫入後，檢查該用戶累積的操作數
- 每 50 筆新操作觸發一次 analyzeOperations
- 非同步執行，不阻塞

### 4.3 信心分數衰減
- context 類記憶每天衰減 confidence（過時的脈絡要自動淡化）
- preference 和 pattern 不衰減，但 source_count 要持續更新

**做完 Step 4 後暫停。**

---

## Step 5：pgvector 語意搜尋

目標：agentdock_memory_query 支援語意搜尋，不只是文字匹配。

### 5.1 啟用 pgvector
- Migration：`CREATE EXTENSION IF NOT EXISTS vector;`
- 確認 memory 表的 embedding 欄位和索引已建立

### 5.2 Embedding 產生
- 每次 storeMemory 時，呼叫 OpenAI embeddings API（或用戶自帶的 API key）產生 embedding
- 模型：text-embedding-3-small（1536 維）
- 儲存到 memory.embedding 欄位

### 5.3 語意查詢
- queryMemory 升級：先用 embedding cosine similarity 找最相關的記憶，再用文字匹配補充
- `SELECT *, 1 - (embedding <=> $1) AS similarity FROM memory WHERE user_id = $2 ORDER BY similarity DESC LIMIT 10`

### 5.4 環境變數
.env 新增：OPENAI_API_KEY（用於 embedding，或讓用戶自帶）

**做完 Step 5 後暫停。**

---

## Step 6：智慧工具篩選

目標：工具多了以後，不全部塞給 agent，根據記憶動態篩選。

### 6.1 工具篩選邏輯
在 `src/mcp/server.ts` 的 createServerForUser 中：
- 如果用戶的工具總數 ≤ 20 → 全部載入（不需要篩選）
- 如果 > 20 → 啟動智慧篩選：
  1. 從 operations 表取最近 7 天的工具使用頻率
  2. 從 memory 表取 context 記憶（用戶最近在做什麼）
  3. 優先載入：高頻使用的工具 + 跟當前脈絡相關的工具
  4. 限制載入數量：8-15 個
  5. 永遠載入系統工具（memory_query, memory_store, list_apps, discover_tools）

### 6.2 agentdock_discover_tools 實作
- 輸入：query（自然語言，如 "I need to send a LINE message"）
- 從所有已連結但未載入的工具中，用語意搜尋找最相關的
- 回傳工具的 name + description，agent 可以要求載入

### 6.3 動態工具追加
- Agent 呼叫 discover_tools 找到需要的工具後
- 在同一個 session 中追加註冊這些工具
- 下次 session 開始時，這個工具的使用會被記錄到 operations，影響未來的篩選

**做完 Step 6 後暫停。**

---

## Step 7：開放 beta + 整合測試

### 7.1 完整測試
- 六個 App 逐一測試所有工具
- 跨 App 複雜操作
- 記憶自動歸納是否正確
- 智慧工具篩選是否合理
- Webhook 能正確接收外部訊息

### 7.2 安全檢查
- 所有 token 確認加密儲存
- API key 只在 HTTPS 傳輸
- 用戶 A 不能存取用戶 B 的資料
- Rate limiting 正常運作

### 7.3 開放 beta
- 邀請 5-10 個目標用戶測試
- 收集回饋
- 修 bug

**Phase 3 完成！里程碑：Bot 可被 agent 操作 + 系統越用越懂你 + 第一批外部用戶。**
