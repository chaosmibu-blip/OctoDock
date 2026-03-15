---
name: Google Docs 設定指南
description: Google Docs 的連結設定流程，包含 OAuth 申請和環境變數設定
---

# Skill: setup-google-docs

引導用戶完成 Google Docs OAuth 整合設定。

## 觸發條件
用戶輸入 `/setup-google-docs` 或詢問如何設定 Google Docs。

## 執行步驟

### Step 1: 建立 Google Cloud OAuth Client

前往 [Google Cloud Console](https://console.cloud.google.com/) 建立 OAuth 2.0 憑證。

1. 選擇或建立專案
2. 前往 **APIs & Services → OAuth consent screen**，設定應用程式名稱（建議：`OctoDock`）
3. 前往 **APIs & Services → Library**，啟用 **Google Docs API**
4. 前往 **APIs & Services → Credentials → Create Credentials → OAuth client ID**

需要填寫的欄位：

| 欄位 | 建議值 | 說明 |
|------|--------|------|
| Application type | Web application | |
| Name | `OctoDock Google Docs` | 方便辨識用途 |
| Authorized redirect URIs | `https://octo-dock.com/callback/google_docs` | **必須完全一致** |

點 **Create** 建立。

### Step 2: 取得 OAuth 憑證

建立後會顯示：

1. 複製 **Client ID**
2. 複製 **Client Secret**

### Step 3: 確認 API 範圍（Scopes）

Google Docs Adapter 需要以下 OAuth scope：
- `https://www.googleapis.com/auth/documents` — 完整文件存取（讀寫）

### Step 4: 設定環境變數

在 Replit Secrets 加入：
- `GDOCS_OAUTH_CLIENT_ID` = 複製的 Client ID
- `GDOCS_OAUTH_CLIENT_SECRET` = 複製的 Client Secret

### Step 5: 重新部署

```bash
npm run build
```

然後 Republish。

### Step 6: 測試連結

1. 前往 Dashboard（`https://octo-dock.com/dashboard`）
2. 點 Google 文件的 **「連結」** 按鈕
3. 跳轉到 Google 授權頁面
4. 允許文件存取權限
5. 跳回 Dashboard，Google 文件顯示「已連結」
6. 測試：透過 agent 建立新文件

### 常見問題

**Q: 按連結後出現 redirect_uri_mismatch 錯誤？**
- 確認 Redirect URI 完全一致：`https://octo-dock.com/callback/google_docs`

**Q: 讀取文件時內容為空？**
- 確認 documentId 正確（可從文件 URL 中取得）
- URL 格式：`https://docs.google.com/document/d/{documentId}/edit`

**Q: 插入文字時 index 超出範圍？**
- index 從 1 開始，1 表示文件開頭
- 使用 `gdocs_append_text` 可自動追加到文件末尾，不需手動計算 index

## 相關文件
- 環境設定指南：`docs/setup-guide.md`
- Google Docs Adapter 原始碼：`src/adapters/google-docs.ts`（5 個工具）

## OctoDock Google Docs 工具清單

| 類別 | 工具名稱 | 功能 |
|------|---------|------|
| 建立 | `gdocs_create` | 建立新文件 |
| 讀取 | `gdocs_get` | 取得文件內容（純文字） |
| 編輯 | `gdocs_insert_text` | 在指定位置插入文字 |
| | `gdocs_replace_text` | 全文尋找與取代 |
| | `gdocs_append_text` | 在文件末尾追加文字 |
