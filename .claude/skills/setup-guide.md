---
name: App 設定指南
description: 各 App 的 OAuth/API Key/Bot Token 設定流程
---

# App 設定指南

所有 App 的連結設定流程，按認證方式分組。

---

## OAuth 2.0 — Google 系

所有 Google 系 App 共用相同的設定流程，差異在啟用的 API 和環境變數名稱。

### 共通步驟

1. 前往 [Google Cloud Console](https://console.cloud.google.com/)
2. 選擇或建立專案
3. **APIs & Services → OAuth consent screen** 設定應用程式名稱（`OctoDock`）
4. **APIs & Services → Library** 啟用對應 API
5. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   - Application type: `Web application`
   - Authorized redirect URIs: `https://octo-dock.com/callback/{app_key}`
6. 複製 Client ID 和 Client Secret，設定到環境變數

### Gmail

- **啟用 API**：Gmail API
- **Callback URL**：`https://octo-dock.com/callback/gmail`
- **Scopes**：`gmail.readonly`, `gmail.send`, `gmail.compose`, `gmail.modify`
- **環境變數**：`GMAIL_OAUTH_CLIENT_ID`, `GMAIL_OAUTH_CLIENT_SECRET`

### Google Calendar

- **啟用 API**：Google Calendar API
- **Callback URL**：`https://octo-dock.com/callback/google_calendar`
- **Scopes**：`calendar`, `calendar.events`
- **環境變數**：`GCAL_OAUTH_CLIENT_ID`, `GCAL_OAUTH_CLIENT_SECRET`

### Google Docs

- **啟用 API**：Google Docs API
- **Callback URL**：`https://octo-dock.com/callback/google_docs`
- **Scopes**：`documents`
- **環境變數**：`GDOCS_OAUTH_CLIENT_ID`, `GDOCS_OAUTH_CLIENT_SECRET`

### Google Drive

- **啟用 API**：Google Drive API
- **Callback URL**：`https://octo-dock.com/callback/google_drive`
- **Scopes**：`drive.file`, `drive.readonly`
- **環境變數**：`GDRIVE_OAUTH_CLIENT_ID`, `GDRIVE_OAUTH_CLIENT_SECRET`

### Google Sheets

- **啟用 API**：Google Sheets API
- **Callback URL**：`https://octo-dock.com/callback/google_sheets`
- **Scopes**：`spreadsheets`
- **環境變數**：`GSHEETS_OAUTH_CLIENT_ID`, `GSHEETS_OAUTH_CLIENT_SECRET`

### Google Tasks

- **啟用 API**：Google Tasks API
- **Callback URL**：`https://octo-dock.com/callback/google_tasks`
- **Scopes**：`tasks`
- **環境變數**：`GTASKS_OAUTH_CLIENT_ID`, `GTASKS_OAUTH_CLIENT_SECRET`

### YouTube

- **啟用 API**：YouTube Data API v3
- **Callback URL**：`https://octo-dock.com/callback/youtube`
- **Scopes**：`youtube.readonly`, `youtube.force-ssl`
- **環境變數**：`YOUTUBE_OAUTH_CLIENT_ID`, `YOUTUBE_OAUTH_CLIENT_SECRET`

---

## OAuth 2.0 — Notion

1. 前往 [Notion Integrations](https://www.notion.so/my-integrations) 建立 **Public Integration**
2. 填寫：Integration name `OctoDock`、Website `https://octo-dock.com`
3. Redirect URI：`https://octo-dock.com/callback/notion`
4. Capabilities 勾選：Read/Update/Insert content、Read/Create comments、Read user info
5. 複製 OAuth client ID 和 OAuth client secret
- **環境變數**：`NOTION_OAUTH_CLIENT_ID`, `NOTION_OAUTH_CLIENT_SECRET`

---

## OAuth 2.0 — Meta（Threads / Instagram）

Threads 和 Instagram 共用同一個 Meta App 和同一組環境變數。

### 共通步驟

1. 前往 [Meta for Developers](https://developers.facebook.com/)
2. **My Apps → Create App** → 選 **Other → Consumer**
3. App 名稱：`OctoDock`
4. 在 **Settings → Basic** 取得 App ID（Client ID）和 App Secret（Client Secret）

### Threads

- **Products**：在 App Dashboard 加入 **Threads**
- **Callback URL**：`https://octo-dock.com/callback/threads`
- **Scopes**：`threads_basic`, `threads_content_publish`, `threads_read_replies`, `threads_manage_replies`, `threads_manage_insights`

### Instagram

- **前提**：需要 Instagram Business 帳號 + 已連結的 Facebook 粉絲專頁
- **Products**：在 App Dashboard 加入 **Instagram** + **Facebook Login**
- **Callback URL**：`https://octo-dock.com/callback/instagram`
- **Scopes**：`instagram_basic`, `instagram_content_publish`, `instagram_manage_comments`, `instagram_manage_insights`, `pages_show_list`, `pages_read_engagement`

### 環境變數（共用）

- `META_OAUTH_CLIENT_ID` = App ID
- `META_OAUTH_CLIENT_SECRET` = App Secret

---

## OAuth 2.0 — GitHub

1. 前往 [GitHub Settings > Developer settings > OAuth Apps](https://github.com/settings/developers)
2. **New OAuth App**
3. 填寫：Application name `OctoDock`、Homepage URL `https://octo-dock.com`、Authorization callback URL `https://octo-dock.com/callback/github`
4. 複製 Client ID，產生並複製 Client Secret
- **環境變數**：`GITHUB_APP_OAUTH_CLIENT_ID`, `GITHUB_APP_OAUTH_CLIENT_SECRET`
- **注意**：GitHub OAuth token 不會過期（除非用戶撤銷）、Rate limit 5000 req/hr

---

## OAuth 2.0 — Canva

1. 前往 [Canva Developers](https://www.canva.com/developers/) → **Create an integration**
2. Integration name: `OctoDock`、type: Public 或 Private
3. Scopes：`asset:read/write`, `design:content:read/write`, `design:meta:read`, `comment:read/write`, `folder:read/write`, `profile:read`
4. Redirect URI：`https://octo-dock.com/callback/canva`
5. 複製 Client ID 和 Client Secret
- **環境變數**：`CANVA_CLIENT_ID`, `CANVA_CLIENT_SECRET`
- **注意**：使用 Basic Auth 交換 token（同 Notion）、Public integration 需 Canva 審核、速率限制：建立設計 20 次/分鐘、匯出 10 次/分鐘

---

## API Key — LINE

1. 前往 [LINE Developers Console](https://developers.line.biz/)
2. 建立 Provider → **Create a new channel** → **Messaging API**
3. Channel name: `OctoDock Bot`
4. 進入 Channel 設定 → **Messaging API** 分頁 → **Channel access token (long-lived)** → **Issue**
5. 複製 token，在 Dashboard 貼入
- **Webhook URL**（選用）：`https://octo-dock.com/api/webhook/line`
- **認證方式**：用戶在 Dashboard 直接貼入 Channel Access Token，不走 OAuth

---

## Bot Token — Telegram

1. 在 Telegram 搜尋 **@BotFather** → `/newbot`
2. 設定 Bot 名稱（例如 `OctoDock Bot`）和 username（必須以 `bot` 結尾）
3. BotFather 回傳 Bot Token（格式：`123456789:ABCdefGHI...`）
4. 在 Dashboard 貼入 Bot Token，系統自動設定 Webhook
- **認證方式**：用戶在 Dashboard 直接貼入 Bot Token
- **取得 Chat ID**：向 Bot 傳訊後用 `telegram_get_updates` 查看，或搜尋 @userinfobot

---

## Phone Auth — Telegram (User)

用戶帳號直接操作，不需要 Bot。

### 管理員設定（一次性）
1. 前往 [my.telegram.org](https://my.telegram.org) 用手機號碼登入
2. 點 **API development tools**
3. 填寫 App 名稱（`OctoDock`）、Platform（`Other`）
4. 取得 **API ID**（整數）和 **API Hash**（hex 字串）
5. 設定環境變數：`TG_API_ID` 和 `TG_API_HASH`

### 用戶連接流程
1. 在 Dashboard 點 Telegram (User) 的「連接」
2. 輸入手機號碼（含國碼，如 `+886912345678`）
3. Telegram App 會收到驗證碼
4. 輸入驗證碼
5. 如果有兩步驗證，再輸入密碼
- **認證方式**：手機號碼 + 驗證碼 + 可選 2FA → StringSession 加密存儲
- **注意**：非官方 API 使用會被 Telegram 自動監控，避免大量自動化操作

---

## Bot Token — Discord

1. 前往 [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**
2. 左側選 **Bot** → **Reset Token** 產生 Bot Token（只顯示一次）
3. **OAuth2 → URL Generator**：Scopes 勾 `bot`，Bot Permissions 勾 Send/Manage Messages、Read Message History、Add Reactions、Manage Channels/Roles
4. 複製產生的邀請 URL，在瀏覽器開啟並選擇伺服器授權
5. 在 Dashboard 貼入 Bot Token
- **認證方式**：用戶在 Dashboard 直接貼入 Bot Token
- **取得 Channel ID**：Discord 開啟開發者模式（設定 → 進階），右鍵頻道 → 複製 ID
