# AgentDock 環境設定指南

## 1. PostgreSQL 資料庫

### Replit 環境
Replit 專案自帶 PostgreSQL，`DATABASE_URL` 會自動注入環境變數。

### 本地開發
```bash
# 用 Docker 啟動
docker run -d --name agentdock-db \
  -e POSTGRES_DB=agentdock \
  -e POSTGRES_USER=agentdock \
  -e POSTGRES_PASSWORD=your_password \
  -p 5432:5432 postgres:16

# DATABASE_URL
DATABASE_URL=postgresql://agentdock:your_password@localhost:5432/agentdock
```

### 推送 Schema 到資料庫
```bash
npx drizzle-kit push
```

---

## 2. Token 加密金鑰

```bash
# 產生 32 bytes 隨機金鑰
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

將結果填入 `TOKEN_ENCRYPTION_KEY`。

---

## 3. NextAuth 設定

```bash
# 產生 secret
npx auth secret
# 或
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

填入 `NEXTAUTH_SECRET`，`NEXTAUTH_URL` 設為你的部署網址（本地開發用 `http://localhost:3000`）。

---

## 4. Google OAuth（AgentDock 登入用）

這組 credentials 讓用戶用 Google 帳號登入 AgentDock Dashboard。

1. 前往 [Google Cloud Console](https://console.cloud.google.com/)
2. 建立或選擇一個專案
3. 左側選單 → APIs & Services → Credentials
4. 點「Create Credentials」→「OAuth client ID」
5. Application type: **Web application**
6. Name: `AgentDock Login`
7. Authorized redirect URIs 加入：
   - `http://localhost:3000/api/auth/callback/google`（本地）
   - `https://your-domain.com/api/auth/callback/google`（正式）
8. 複製 Client ID 和 Client Secret

填入 `GOOGLE_CLIENT_ID` 和 `GOOGLE_CLIENT_SECRET`。

---

## 5. Gmail OAuth（Gmail API 操作用）

這組 credentials 讓 AgentDock 代替用戶操作 Gmail，**與登入用的是不同的 credentials**。

1. 同一個 Google Cloud 專案
2. 啟用 **Gmail API**：APIs & Services → Library → 搜尋 Gmail API → Enable
3. 建立另一組 OAuth client ID：
   - Name: `AgentDock Gmail`
   - Authorized redirect URIs：
     - `http://localhost:3000/callback/gmail`（本地）
     - `https://your-domain.com/callback/gmail`（正式）
4. OAuth consent screen 設定：
   - User Type: **External**
   - Scopes 加入：
     - `https://www.googleapis.com/auth/gmail.readonly`
     - `https://www.googleapis.com/auth/gmail.send`
     - `https://www.googleapis.com/auth/gmail.compose`
     - `https://www.googleapis.com/auth/gmail.modify`
   - 測試期間需加入測試用戶的 email

填入 `GMAIL_OAUTH_CLIENT_ID` 和 `GMAIL_OAUTH_CLIENT_SECRET`。

---

## 6. Notion OAuth Integration

### 6.1 建立 Public Integration

1. 登入 Notion，前往 [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. 點 **「+ New integration」**
3. 填寫以下欄位（全部必填）：

| 欄位 | 值 | 說明 |
|------|-----|------|
| **Integration name** | `AgentDock` | 用戶授權時會看到的名稱 |
| **Icon** | 上傳 512x512 PNG | 專案內有 `public/icon-512.png` 可用 |
| **Associated workspace** | 選你的工作區 | 這是你的開發/測試用工作區，其他用戶會透過 OAuth 連自己的工作區 |
| **Company name** | `AgentDock` | |
| **Website** | `https://octo-dock.com` | 部署網址 |
| **Tagline** | `One MCP URL for all your apps` | |
| **Privacy Policy URL** | `https://octo-dock.com` | MVP 先填首頁 |
| **Terms of Use URL** | `https://octo-dock.com` | MVP 先填首頁 |
| **Email** | 你的 email | 開發者聯絡信箱 |
| **Redirect URIs** | `https://octo-dock.com/callback/notion` | OAuth 回調地址，必須包含協定（https） |
| **Notion URL for optional template** | （留空） | |

4. 點 **Create**

### 6.2 取得 OAuth 憑證

建立完成後，進入整合設定頁面：

1. 找到 **OAuth client ID** — 複製
2. 找到 **OAuth client secret** — ⚠️ **只會顯示一次**，立刻複製保存！

### 6.3 設定 Capabilities

進入整合的 **Capabilities** 設定，確認勾選：
- ✅ Read content
- ✅ Update content
- ✅ Insert content
- ✅ Read comments
- ✅ Create comments
- ✅ Read user information（包含 email）

### 6.4 設定環境變數

在 Replit Secrets（或 `.env`）加入：
```
NOTION_OAUTH_CLIENT_ID=你的_client_id
NOTION_OAUTH_CLIENT_SECRET=你的_client_secret
```

### 6.5 測試連結

1. 前往 AgentDock Dashboard
2. 點 Notion 的 **「連結」**
3. 跳轉到 Notion 授權頁面
4. 選擇要分享的頁面（⚠️ 只有用戶選擇分享的頁面，API 才能存取）
5. 點 **Allow access**
6. 跳回 Dashboard，顯示「已連結」

### 6.6 重要備註

- **Associated workspace 只影響你自己**：其他用戶透過 OAuth 授權時，連的是他們自己的工作區
- **用戶控制權限**：每次授權時，用戶選擇分享哪些頁面，未分享的 API 看不到
- **Token 特性**：Public Integration 有 refresh_token，AgentDock 已實作自動刷新
- **API 限制**：3 次/秒（每 15 分鐘 2,700 次），超過回 429
- **AgentDock 的 Notion 工具數**：18 個（搜尋、頁面 CRUD、區塊 CRUD、資料庫、留言、用戶）

---

## 7. 完整 .env 範例

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/agentdock

# NextAuth
NEXTAUTH_SECRET=<產生的 secret>
NEXTAUTH_URL=http://localhost:3000

# Google OAuth（登入用）
GOOGLE_CLIENT_ID=<Google Cloud 的 Client ID>
GOOGLE_CLIENT_SECRET=<Google Cloud 的 Client Secret>

# Token 加密（32 bytes hex）
TOKEN_ENCRYPTION_KEY=<產生的 hex 金鑰>

# Notion OAuth
NOTION_OAUTH_CLIENT_ID=<Notion Integration 的 Client ID>
NOTION_OAUTH_CLIENT_SECRET=<Notion Integration 的 Client Secret>

# Gmail OAuth（API 操作用，跟登入用的不同）
GMAIL_OAUTH_CLIENT_ID=<Gmail 用的 Client ID>
GMAIL_OAUTH_CLIENT_SECRET=<Gmail 用的 Client Secret>

# Meta OAuth（Phase 2）
META_OAUTH_CLIENT_ID=
META_OAUTH_CLIENT_SECRET=
```

---

## 8. 啟動

```bash
# 安裝依賴
npm install

# 推送 Schema
npx drizzle-kit push

# 開發模式
npm run dev

# 正式建置
npm run build && npm start
```

啟動後：
1. 瀏覽器開啟 `http://localhost:3000`
2. 用 Google 帳號登入
3. 進入 Dashboard，複製 MCP URL
4. 連結 Notion / Gmail
5. 在 Claude Desktop 或其他 MCP Client 貼上 MCP URL
