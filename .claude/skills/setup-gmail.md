---
name: Gmail 設定指南
description: Gmail 的連結設定流程，包含 OAuth 申請和環境變數設定
---

# Skill: setup-gmail

引導用戶完成 Gmail OAuth 整合設定。

## 觸發條件
用戶輸入 `/setup-gmail` 或詢問如何設定 Gmail。

## 執行步驟

### Step 1: 建立 Google Cloud OAuth Client

前往 [Google Cloud Console](https://console.cloud.google.com/) 建立 OAuth 2.0 憑證。

1. 選擇或建立專案
2. 前往 **APIs & Services → OAuth consent screen**，設定應用程式名稱（建議：`OctoDock`）
3. 前往 **APIs & Services → Library**，啟用 **Gmail API**
4. 前往 **APIs & Services → Credentials → Create Credentials → OAuth client ID**

需要填寫的欄位：

| 欄位 | 建議值 | 說明 |
|------|--------|------|
| Application type | Web application | |
| Name | `OctoDock Gmail` | 方便辨識用途 |
| Authorized redirect URIs | `https://agent-dock.replit.app/callback/gmail` | **必須完全一致** |

點 **Create** 建立。

### Step 2: 取得 OAuth 憑證

建立後會顯示：

1. 複製 **Client ID**
2. 複製 **Client Secret**

### Step 3: 確認 API 範圍（Scopes）

Gmail Adapter 需要以下 OAuth scopes：
- `https://www.googleapis.com/auth/gmail.readonly` — 讀取郵件
- `https://www.googleapis.com/auth/gmail.send` — 發送郵件
- `https://www.googleapis.com/auth/gmail.compose` — 撰寫郵件
- `https://www.googleapis.com/auth/gmail.modify` — 修改郵件（標記已讀等）

### Step 4: 設定環境變數

在 Replit Secrets 加入：
- `GMAIL_OAUTH_CLIENT_ID` = 複製的 Client ID
- `GMAIL_OAUTH_CLIENT_SECRET` = 複製的 Client Secret

### Step 5: 重新部署

```bash
npm run build
```

然後 Republish。

### Step 6: 測試連結

1. 前往 Dashboard（`https://agent-dock.replit.app/dashboard`）
2. 點 Gmail 的 **「連結」** 按鈕
3. 跳轉到 Google 授權頁面
4. 允許 Gmail 存取權限
5. 跳回 Dashboard，Gmail 顯示「已連結」

### 常見問題

**Q: 按連結後出現 redirect_uri_mismatch 錯誤？**
- 確認 Redirect URI 完全一致：`https://agent-dock.replit.app/callback/gmail`
- 注意不要有尾端斜線或多餘空格

**Q: 授權時顯示「This app isn't verified」？**
- 開發階段正常現象，點 **Advanced → Go to OctoDock (unsafe)** 繼續
- 正式上線前需提交 Google 驗證

**Q: 發送郵件失敗？**
- 確認 OAuth scopes 包含 `gmail.send` 和 `gmail.compose`
- 確認 Gmail API 已在 Google Cloud Console 中啟用

## 相關文件
- 環境設定指南：`docs/setup-guide.md`
- Gmail Adapter 原始碼：`src/adapters/gmail.ts`（5 個工具）

## OctoDock Gmail 工具清單

| 類別 | 工具名稱 | 功能 |
|------|---------|------|
| 搜尋 | `gmail_search` | 搜尋郵件（支援 Gmail 搜尋語法） |
| 閱讀 | `gmail_read` | 讀取指定郵件的完整內容 |
| 發送 | `gmail_send` | 發送新郵件 |
| 回覆 | `gmail_reply` | 回覆既有郵件（維持 thread） |
| 草稿 | `gmail_draft` | 建立草稿郵件 |
