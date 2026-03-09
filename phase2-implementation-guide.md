# AgentDock Phase 2 實作指令：社群 + 記憶

> 前置條件：Phase 1 完成（Notion + Gmail 可用、MCP Server 運行中、操作記錄正常寫入）
> 提前準備：去 Meta for Developers 申請 App，取得 Threads + Instagram API 權限（審核需 2-4 週）

---

## Step 1：Meta OAuth + Threads Adapter

目標：用戶能授權 AgentDock 存取 Threads 帳號。

### 1.1 Threads Adapter 骨架
`src/adapters/threads.ts` — 實作 AppAdapter 介面

authConfig：
- authorizeUrl: `https://www.threads.net/oauth/authorize`
- tokenUrl: `https://graph.threads.net/oauth/access_token`
- scopes: `['threads_basic', 'threads_content_publish', 'threads_manage_replies', 'threads_manage_insights', 'threads_read_replies']`
- authMethod: `'post'`

### 1.2 Threads Token 特殊處理
三步流程：
1. 用 code 換 short-lived token（約 1 小時）
2. 立刻換 long-lived token（60 天）：`GET https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret={secret}&access_token={short_lived}`
3. 過期前 refresh：`GET https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token={long_lived}`

OAuth callback 成功後自動換 long-lived token 再加密儲存。adapter 實作 refreshToken()。

### 1.3 取得 Threads User ID
`GET https://graph.threads.net/me?fields=id,username&access_token={token}` → 存到 app_user_id / app_user_name。

### 1.4 五個工具實作

**threads_publish** — 兩步驟：建 container `POST /{user_id}/threads` → 發布 `POST /{user_id}/threads_publish`。支援 TEXT / IMAGE / VIDEO。

**threads_get_posts** — `GET /{user_id}/threads?fields=id,text,timestamp,media_type,permalink&limit=10`

**threads_reply** — 同 publish 但加 reply_to_id

**threads_get_insights** — `GET /{media_id}/insights?metric=views,likes,replies,reposts,quotes`

**threads_get_profile** — `GET /me?fields=id,username,threads_profile_picture_url,threads_biography`

### 1.5 環境變數
.env 新增：META_OAUTH_CLIENT_ID, META_OAUTH_CLIENT_SECRET

**做完 Step 1 後暫停，讓我測試 Threads 授權和工具。**

---

## Step 2：Instagram Adapter

目標：用戶能連結 Instagram，agent 能發文、讀留言、看數據。

### 2.1 Instagram OAuth
`src/adapters/instagram.ts`

Instagram 走 Facebook Login：
- authorizeUrl: `https://www.facebook.com/dialog/oauth`
- tokenUrl: `https://graph.facebook.com/v18.0/oauth/access_token`
- scopes: `['instagram_basic', 'instagram_content_publish', 'instagram_manage_comments', 'instagram_manage_insights', 'pages_show_list', 'pages_read_engagement']`

授權後需要：`GET /me/accounts` → `GET /{page_id}?fields=instagram_business_account` → 存 IG Business Account ID。

Token：short-lived → long-lived（`grant_type=fb_exchange_token`）→ 定期 refresh。

### 2.2 五個工具實作

**instagram_publish** — `POST /{ig_user_id}/media` + `POST /{ig_user_id}/media_publish`

**instagram_get_posts** — `GET /{ig_user_id}/media?fields=id,caption,media_type,media_url,timestamp,permalink`

**instagram_reply_comment** — `POST /{comment_id}/replies`

**instagram_get_comments** — `GET /{media_id}/comments?fields=id,text,username,timestamp`

**instagram_get_insights** — `GET /{ig_user_id}/insights?metric=impressions,reach,profile_views&period=day`

**做完 Step 2 後暫停，讓我測試 Instagram。**

---

## Step 3：記憶系統 MVP

目標：agent 能存取跨 agent 共享的記憶。

### 3.1 Memory Engine
`src/services/memory-engine.ts`
- `queryMemory(userId, query, appName?)` — MVP 用文字 ILIKE 匹配，Phase 3 加 pgvector
- `storeMemory(userId, { category, appName?, key, value, confidence? })` — 寫入 memory 表
- `deleteMemory(userId, memoryId)` — 刪除

### 3.2 系統工具填上真實邏輯
`src/mcp/server.ts` — 把 Phase 1 的空殼換成真實邏輯：
- **agentdock_memory_query**：呼叫 queryMemory，回傳 key/value/confidence/category
- **agentdock_memory_store**：呼叫 storeMemory，回傳儲存結果
- **agentdock_list_apps**：從 connected_apps + registry 組合出完整清單

**做完 Step 3 後暫停，讓我測試記憶存取。**

---

## Step 4：偏好設定頁面

目標：用戶能在網頁上手動設定偏好。

### 4.1 頁面
`src/app/preferences/page.tsx`
- 分區顯示每個 App 的偏好（Threads 語氣/hashtag、Gmail 回信語氣、Notion 預設位置等）
- 通用偏好（語言、時區）
- 儲存到 memory 表（category = 'preference'）

### 4.2 API
`src/app/api/preferences/route.ts` — GET 讀取 / PUT 更新 preference 記憶

**做完 Step 4 後暫停。**

---

## Step 5：Token 刷新 + 錯誤處理 + 整合測試

### 5.1 Token Manager 完善
- 正式接入各 adapter 的 refreshToken()
- 刷新失敗 → 標記 status='expired' + 雙語錯誤訊息

### 5.2 通用錯誤處理
每個 adapter 統一處理：401 → 刷新/expired、403 → 提示 scopes、429 → 回傳等待時間、5xx → 重試一次

### 5.3 整合測試
- 四 App 逐一測試
- 跨 App：「讀 Gmail → 整理到 Notion → 摘要發 Threads」
- 記憶跨 agent：Claude 存 → GPT 讀
- 錯誤場景：token 過期、App 未連結

**Phase 2 完成！里程碑：四 App 全通 + 跨 agent 記憶可用。**
