---
name: Google Sheets 設定指南
description: Google Sheets 的連結設定流程，包含 OAuth 申請和環境變數設定
---

# Skill: setup-google-sheets

引導用戶完成 Google Sheets OAuth 整合設定。

## 觸發條件
用戶輸入 `/setup-google-sheets` 或詢問如何設定 Google Sheets。

## 執行步驟

### Step 1: 建立 Google Cloud OAuth Client

前往 [Google Cloud Console](https://console.cloud.google.com/) 建立 OAuth 2.0 憑證。

1. 選擇或建立專案
2. 前往 **APIs & Services → OAuth consent screen**，設定應用程式名稱（建議：`OctoDock`）
3. 前往 **APIs & Services → Library**，啟用 **Google Sheets API**
4. 前往 **APIs & Services → Credentials → Create Credentials → OAuth client ID**

需要填寫的欄位：

| 欄位 | 建議值 | 說明 |
|------|--------|------|
| Application type | Web application | |
| Name | `OctoDock Google Sheets` | 方便辨識用途 |
| Authorized redirect URIs | `https://agent-dock.replit.app/callback/google_sheets` | **必須完全一致** |

點 **Create** 建立。

### Step 2: 取得 OAuth 憑證

建立後會顯示：

1. 複製 **Client ID**
2. 複製 **Client Secret**

### Step 3: 確認 API 範圍（Scopes）

Google Sheets Adapter 需要以下 OAuth scope：
- `https://www.googleapis.com/auth/spreadsheets` — 完整試算表存取（讀寫）

### Step 4: 設定環境變數

在 Replit Secrets 加入：
- `GSHEETS_OAUTH_CLIENT_ID` = 複製的 Client ID
- `GSHEETS_OAUTH_CLIENT_SECRET` = 複製的 Client Secret

### Step 5: 重新部署

```bash
npm run build
```

然後 Republish。

### Step 6: 測試連結

1. 前往 Dashboard（`https://agent-dock.replit.app/dashboard`）
2. 點 Google 試算表的 **「連結」** 按鈕
3. 跳轉到 Google 授權頁面
4. 允許試算表存取權限
5. 跳回 Dashboard，Google 試算表顯示「已連結」
6. 測試：透過 agent 建立新試算表

### 常見問題

**Q: 按連結後出現 redirect_uri_mismatch 錯誤？**
- 確認 Redirect URI 完全一致：`https://agent-dock.replit.app/callback/google_sheets`

**Q: 讀取試算表時顯示「找不到」？**
- 確認 spreadsheetId 正確（可從試算表 URL 中取得）
- URL 格式：`https://docs.google.com/spreadsheets/d/{spreadsheetId}/edit`

**Q: 範圍格式錯誤？**
- 使用 A1 表示法，例如 `Sheet1!A1:D10`
- 先用 `gsheets_get` 查看可用的工作表名稱

## 相關文件
- 環境設定指南：`docs/setup-guide.md`
- Google Sheets Adapter 原始碼：`src/adapters/google-sheets.ts`（6 個工具）

## OctoDock Google Sheets 工具清單

| 類別 | 工具名稱 | 功能 |
|------|---------|------|
| 建立 | `gsheets_create` | 建立新試算表 |
| 讀取 | `gsheets_get` | 取得試算表資訊（工作表名稱等） |
| | `gsheets_read` | 讀取儲存格資料 |
| 寫入 | `gsheets_write` | 寫入儲存格資料（覆蓋） |
| | `gsheets_append` | 追加列資料 |
| 清除 | `gsheets_clear` | 清除儲存格資料（保留格式） |
