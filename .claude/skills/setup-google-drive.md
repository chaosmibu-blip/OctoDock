---
name: Google Drive 設定指南
description: Google Drive 的連結設定流程，包含 OAuth 申請和環境變數設定
---

# Skill: setup-google-drive

引導用戶完成 Google Drive OAuth 整合設定。

## 觸發條件
用戶輸入 `/setup-google-drive` 或詢問如何設定 Google Drive。

## 執行步驟

### Step 1: 建立 Google Cloud OAuth Client

前往 [Google Cloud Console](https://console.cloud.google.com/) 建立 OAuth 2.0 憑證。

1. 選擇或建立專案
2. 前往 **APIs & Services → OAuth consent screen**，設定應用程式名稱（建議：`OctoDock`）
3. 前往 **APIs & Services → Library**，啟用 **Google Drive API**
4. 前往 **APIs & Services → Credentials → Create Credentials → OAuth client ID**

需要填寫的欄位：

| 欄位 | 建議值 | 說明 |
|------|--------|------|
| Application type | Web application | |
| Name | `OctoDock Google Drive` | 方便辨識用途 |
| Authorized redirect URIs | `https://octo-dock.com/callback/google_drive` | **必須完全一致** |

點 **Create** 建立。

### Step 2: 取得 OAuth 憑證

建立後會顯示：

1. 複製 **Client ID**
2. 複製 **Client Secret**

### Step 3: 確認 API 範圍（Scopes）

Google Drive Adapter 需要以下 OAuth scopes：
- `https://www.googleapis.com/auth/drive.file` — 存取應用程式建立或開啟的檔案
- `https://www.googleapis.com/auth/drive.readonly` — 唯讀存取所有檔案

### Step 4: 設定環境變數

在 Replit Secrets 加入：
- `GDRIVE_OAUTH_CLIENT_ID` = 複製的 Client ID
- `GDRIVE_OAUTH_CLIENT_SECRET` = 複製的 Client Secret

### Step 5: 重新部署

```bash
npm run build
```

然後 Republish。

### Step 6: 測試連結

1. 前往 Dashboard（`https://octo-dock.com/dashboard`）
2. 點 Google Drive 的 **「連結」** 按鈕
3. 跳轉到 Google 授權頁面
4. 允許 Drive 存取權限
5. 跳回 Dashboard，Google Drive 顯示「已連結」
6. 測試：透過 agent 搜尋「幫我找 Drive 裡的 PDF 檔案」

### 常見問題

**Q: 按連結後出現 redirect_uri_mismatch 錯誤？**
- 確認 Redirect URI 完全一致：`https://octo-dock.com/callback/google_drive`

**Q: 搜尋檔案時找不到？**
- Drive 搜尋使用 Google Drive 查詢語法，例如 `name contains 'report'`
- 確認檔案在授權帳號的 Drive 中

**Q: 無法下載檔案？**
- `gdrive_download` 僅支援文字類型檔案（txt, csv, json 等）
- 二進位檔案（PDF, 圖片等）無法直接下載文字內容

## 相關文件
- 環境設定指南：`docs/setup-guide.md`
- Google Drive Adapter 原始碼：`src/adapters/google-drive.ts`（7 個工具）

## OctoDock Google Drive 工具清單

| 類別 | 工具名稱 | 功能 |
|------|---------|------|
| 搜尋 | `gdrive_search` | 搜尋檔案（支援 Drive 查詢語法） |
| 檔案 | `gdrive_get_file` | 取得檔案詳細資訊 |
| | `gdrive_download` | 下載文字檔案內容 |
| | `gdrive_create` | 建立檔案或資料夾 |
| | `gdrive_update` | 更新檔案名稱/描述 |
| | `gdrive_delete` | 移至垃圾桶 |
| 分享 | `gdrive_share` | 分享檔案給指定用戶或公開連結 |
