# AgentDock Phase 1 實作指令

> 這份文件是給 Claude Code 看的逐步實作指令。每個 Step 做完後暫停讓我確認，再繼續下一個 Step。
> 所有技術細節請參考 agentdock-spec.md。

---

## 已完成

- [x] Step 0：專案初始化（Next.js + TypeScript + App Router + Tailwind）
- [x] Step 0：核心依賴安裝
- [x] Step 0：資料夾結構建立
- [x] Step 0：Drizzle Schema（users + connected_apps）
- [x] Step 0：AppAdapter 介面定義（src/adapters/types.ts）
- [x] Step 0：AES-256-GCM 加解密（src/lib/crypto.ts）

---

## Step 1：MCP Server 核心骨架

目標：MCP Server 能啟動、能接收請求、能辨識用戶。

### 1.1 Adapter Registry
`src/mcp/registry.ts`
- 自動掃描 `src/adapters/` 資料夾，用 `isAppAdapter` 過濾
- 建立 `adapters: Map<string, AppAdapter>`
- export：`loadAdapters()`, `getAdapter(appName)`, `getAllAdapters()`

### 1.2 MCP Server 主入口
`src/mcp/server.ts`
- `createServerForUser(user)` 函式
- 從 db 取得用戶已連結的 App
- 用 registry 動態註冊工具（for loop，不用 if/else）
- 註冊四個系統工具（先放空殼 handler，回傳 "Not implemented yet"）：
  - `agentdock_memory_query`：Query user's cross-agent memory by natural language
  - `agentdock_memory_store`：Store a memory entry for the user
  - `agentdock_list_apps`：List user's connected apps and available tools
  - `agentdock_discover_tools`：Search for additional tools not loaded in current session

### 1.3 認證 Middleware
`src/mcp/middleware/auth.ts`
- `authenticateByApiKey(apiKey: string)` → 查 users 表，回傳 user 或 null

### 1.4 操作記錄 Middleware
`src/mcp/middleware/logger.ts`
- `executeWithMiddleware(userId, toolName, params, handler)` 函式
- 流程：計時開始 → getValidToken → 執行 handler → 非同步寫入 operations 表 → 回傳結果
- 失敗時也記錄（success: false）
- 參考 agentdock-spec.md 第 8 節

### 1.5 MCP API Route
`src/app/mcp/[apiKey]/route.ts`
- POST handler：
  1. 用 auth middleware 驗證 apiKey
  2. 無效 → 回傳 401
  3. createServerForUser(user)
  4. StreamableHTTPServerTransport 處理請求
  5. 回傳結果

### 1.6 Token Manager
`src/services/token-manager.ts`
- `getValidToken(userId, appName)` 函式
- 從 connected_apps 取出 token → decrypt → 檢查 token_expires_at
- 5 分鐘內過期 → 呼叫 adapter 的 refreshToken（先放空殼）
- 回傳解密後的 access_token

### 1.7 Operation Logger Service
`src/services/operation-logger.ts`
- `logOperation(data)` 函式
- 寫入 operations 表，非同步執行（不 await，不阻塞主流程）

**做完 Step 1 後暫停，讓我確認 MCP Server 能啟動。**

---

## Step 2：資料庫完善 + 用戶登入

目標：用戶能用 Google 帳號登入 AgentDock，拿到 MCP URL。

### 2.1 補齊 Drizzle Schema
`src/db/schema.ts` — 新增 operations 表和 memory 表（SQL 定義在 spec 第 4 節）

### 2.2 Drizzle 設定
- `drizzle.config.ts` — 連線 DATABASE_URL
- `src/db/index.ts` — export db instance
- 執行 `drizzle-kit generate` + `drizzle-kit push` 建表

### 2.3 NextAuth 設定
`src/app/api/auth/[...nextauth]/route.ts`
- Google Provider
- 登入時自動建立 users 記錄（如果不存在）
- 自動產生 mcp_api_key（格式：`ak_` + 隨機字串）
- Session 包含 user.id 和 mcp_api_key

### 2.4 環境變數
確認 `.env` 包含：DATABASE_URL, NEXTAUTH_SECRET, NEXTAUTH_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, TOKEN_ENCRYPTION_KEY

**做完 Step 2 後暫停，讓我確認能登入。**

---

## Step 3：Dashboard（最陽春版）

目標：用戶登入後看到 MCP URL，可以複製。

### 3.1 首頁
`src/app/page.tsx`
- AgentDock 簡短說明
- Google 登入按鈕
- 已登入 → 導向 /dashboard

### 3.2 Dashboard
`src/app/dashboard/page.tsx`
- 顯示用戶的 MCP URL（`https://{host}/mcp/{mcp_api_key}`）+ 複製按鈕
- 列出已連結的 App（從 connected_apps 表讀取）
- 每個未連結的 App 顯示「連結」按鈕（Phase 1 只有 Notion 和 Gmail）
- 已連結的 App 顯示「中斷連結」按鈕
- 登出按鈕
- UI 用 Tailwind，風格簡潔，多語系先不做，全部繁中

### 3.3 Layout
`src/app/layout.tsx`
- 全局 SessionProvider
- 基本的 header / footer

**做完 Step 3 後暫停，讓我確認畫面正確。**

---

## Step 4：Notion Adapter

目標：用戶能連結 Notion，agent 能透過 MCP 操作 Notion。

### 4.1 Notion OAuth
`src/adapters/notion.ts` — 實作 AppAdapter 介面

authConfig：
- authorizeUrl: `https://api.notion.com/v1/oauth/authorize`
- tokenUrl: `https://api.notion.com/v1/oauth/token`
- scopes: []（Notion 不用指定）
- authMethod: `'basic'`（Notion 用 Basic Auth 換 token，不是 POST body）

特殊注意：Notion 的 token 不會過期，沒有 refresh_token。

### 4.2 OAuth Callback（通用）
`src/app/callback/[app]/route.ts`
- 從 Adapter Registry 取得對應 adapter 的 authConfig
- 驗證 state（防 CSRF）
- 用 code 換 token（根據 authMethod 決定用 Basic Auth 或 POST body）
- 加密儲存到 connected_apps
- 導回 /dashboard?connected={app}
- 參考 agentdock-spec.md 第 7 節

### 4.3 Dashboard 連結按鈕的 API
`src/app/api/connect/[app]/route.ts`
- GET handler：產生授權 URL（帶加密的 state）→ redirect
- DELETE handler：撤銷連結（更新 connected_apps status → 'revoked'）

### 4.4 Notion 工具實作
在 `src/adapters/notion.ts` 的 execute() 中實作 6 個工具：

| 工具 | Notion API |
|------|-----------|
| notion_search | POST /v1/search |
| notion_get_page | GET /v1/pages/{id} + GET /v1/blocks/{id}/children |
| notion_create_page | POST /v1/pages |
| notion_update_page | PATCH /v1/pages/{id} |
| notion_query_database | POST /v1/databases/{id}/query |
| notion_create_database_item | POST /v1/pages（parent type = database_id） |

所有 Notion API 請求都要帶：
```
Authorization: Bearer {access_token}
Notion-Version: 2022-06-28
Content-Type: application/json
```

工具的 description 一律英文。參考 spec 第 6 節。

### 4.5 環境變數
.env 新增：NOTION_OAUTH_CLIENT_ID, NOTION_OAUTH_CLIENT_SECRET

**做完 Step 4 後暫停。我會用 Claude 透過 MCP 測試 Notion 操作。**

---

## Step 5：Gmail Adapter

目標：用戶能連結 Gmail，agent 能透過 MCP 操作 Gmail。

### 5.1 Gmail OAuth
`src/adapters/gmail.ts` — 實作 AppAdapter 介面

authConfig：
- authorizeUrl: `https://accounts.google.com/o/oauth2/v2/auth`
- tokenUrl: `https://oauth2.googleapis.com/token`
- scopes: `['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.compose']`
- authMethod: `'post'`

授權 URL 額外參數：`access_type=offline` + `prompt=consent`（確保拿到 refresh_token）

### 5.2 Gmail Token 刷新
在 gmail adapter 實作 refreshToken()：
- POST https://oauth2.googleapis.com/token
- Content-Type: application/x-www-form-urlencoded
- Body: client_id, client_secret, refresh_token, grant_type=refresh_token

同時更新 src/services/token-manager.ts 的 getValidToken()：
- 當 token 快過期時，從 registry 拿到 adapter → 呼叫 adapter.refreshToken()
- 加密儲存新 token

### 5.3 Gmail 工具實作
在 `src/adapters/gmail.ts` 的 execute() 中實作 5 個工具：

| 工具 | Gmail API |
|------|----------|
| gmail_search | GET /gmail/v1/users/me/messages?q={query} |
| gmail_read | GET /gmail/v1/users/me/messages/{id}?format=full |
| gmail_send | POST /gmail/v1/users/me/messages/send（body: { raw: base64url }） |
| gmail_reply | POST /gmail/v1/users/me/messages/send（含 threadId + In-Reply-To header） |
| gmail_draft | POST /gmail/v1/users/me/drafts |

注意：Gmail 寄送需要把郵件編碼成 RFC 2822 格式再 base64url 編碼。

### 5.4 環境變數
.env 新增：GMAIL_OAUTH_CLIENT_ID, GMAIL_OAUTH_CLIENT_SECRET
（注意：這跟 NextAuth 登入用的 Google credentials 是不同的一組）

**做完 Step 5 後暫停。我會用 Claude 透過 MCP 測試 Gmail 操作。**

---

## Step 6：整合測試 + 收尾

目標：完整的 Phase 1 可以端到端跑通。

### 6.1 MCP Inspector 測試
- 用 `npx @modelcontextprotocol/inspector` 連上 MCP 端點
- 確認 tools/list 回傳正確的工具清單
- 測試每個工具的基本功能

### 6.2 實際 Agent 測試
- 在 Claude Desktop 或 claude.ai 的 MCP 設定中加入 AgentDock URL
- 測試：「幫我在 Notion 搜尋最近的頁面」
- 測試：「幫我搜尋最近的 Gmail」
- 測試：跨 App 操作「讀 Gmail 裡最新的信，把重點整理到 Notion」

### 6.3 錯誤處理確認
- 未連結 App 時呼叫工具 → 應該回傳清楚的錯誤訊息（雙語）
- 無效 API key → 401
- App API 回傳錯誤 → 轉成清楚的錯誤訊息

### 6.4 操作記錄確認
- 每次工具呼叫都有寫入 operations 表
- 記錄包含 source_agent, tool_name, success, duration_ms

**Phase 1 完成！里程碑：你自己能用 Claude 透過 AgentDock 操作 Notion 和 Gmail。**

---

## 後續提醒

Phase 1 完成後，下一步是 Phase 2（Threads + Instagram + 記憶系統）。到時候再生成 Phase 2 的實作指令。

Phase 2 需要提前做的事（可以在 Phase 1 開發期間並行）：
- 去 Meta for Developers 申請 App（Threads + Instagram API 權限）
- Meta 審核通常需要 2-4 週，越早申請越好
