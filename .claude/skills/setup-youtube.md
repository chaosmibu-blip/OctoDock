---
name: YouTube 設定指南
description: YouTube 的連結設定流程，包含 OAuth 申請和環境變數設定
---

# Skill: setup-youtube

引導用戶完成 YouTube OAuth 整合設定。

## 觸發條件
用戶輸入 `/setup-youtube` 或詢問如何設定 YouTube。

## 執行步驟

### Step 1: 建立 Google Cloud OAuth Client

前往 [Google Cloud Console](https://console.cloud.google.com/) 建立 OAuth 2.0 憑證。

1. 選擇或建立專案
2. 前往 **APIs & Services → OAuth consent screen**，設定應用程式名稱（建議：`OctoDock`）
3. 前往 **APIs & Services → Library**，啟用 **YouTube Data API v3**
4. 前往 **APIs & Services → Credentials → Create Credentials → OAuth client ID**

需要填寫的欄位：

| 欄位 | 建議值 | 說明 |
|------|--------|------|
| Application type | Web application | |
| Name | `OctoDock YouTube` | 方便辨識用途 |
| Authorized redirect URIs | `https://octo-dock.com/callback/youtube` | **必須完全一致** |

點 **Create** 建立。

### Step 2: 取得 OAuth 憑證

建立後會顯示：

1. 複製 **Client ID**
2. 複製 **Client Secret**

### Step 3: 確認 API 範圍（Scopes）

YouTube Adapter 需要以下 OAuth scopes：
- `https://www.googleapis.com/auth/youtube.readonly` — 唯讀存取 YouTube 資料
- `https://www.googleapis.com/auth/youtube.force-ssl` — 管理播放清單、留言等（需 SSL）

### Step 4: 設定環境變數

在 Replit Secrets 加入：
- `YOUTUBE_OAUTH_CLIENT_ID` = 複製的 Client ID
- `YOUTUBE_OAUTH_CLIENT_SECRET` = 複製的 Client Secret

### Step 5: 重新部署

```bash
npm run build
```

然後 Republish。

### Step 6: 測試連結

1. 前往 Dashboard（`https://octo-dock.com/dashboard`）
2. 點 YouTube 的 **「連結」** 按鈕
3. 跳轉到 Google 授權頁面
4. 允許 YouTube 存取權限
5. 跳回 Dashboard，YouTube 顯示「已連結」
6. 測試：透過 agent 詢問「搜尋 TypeScript 教學影片」

### 重要：API 配額限制

YouTube Data API v3 每日配額為 **10,000 單位**，不同操作消耗不同單位：

| 操作 | 配額消耗 |
|------|---------|
| `youtube_search` | 100 單位 |
| `youtube_add_to_playlist` | 50 單位 |
| `youtube_get_video` | 1 單位 |
| `youtube_list_playlists` | 1 單位 |
| `youtube_list_playlist_items` | 1 單位 |
| `youtube_get_comments` | 1 單位 |
| `youtube_get_channel` | 1 單位 |

建議：減少 search 次數，改用 get_video 查詢已知影片。配額於太平洋時間午夜重置。

### 常見問題

**Q: 按連結後出現 redirect_uri_mismatch 錯誤？**
- 確認 Redirect URI 完全一致：`https://octo-dock.com/callback/youtube`

**Q: 搜尋影片時出現 quotaExceeded？**
- YouTube API 每日配額已用完，配額於太平洋時間午夜重置
- 每次 search 消耗 100 單位，一天最多搜尋 100 次

**Q: 無法新增影片到播放清單？**
- 確認 OAuth scopes 包含 `youtube.force-ssl`
- 確認播放清單是用戶自己建立的（無法新增到他人的播放清單）

## 相關文件
- 環境設定指南：`docs/setup-guide.md`
- YouTube Adapter 原始碼：`src/adapters/youtube.ts`（7 個工具）

## OctoDock YouTube 工具清單

| 類別 | 工具名稱 | 功能 |
|------|---------|------|
| 搜尋 | `youtube_search` | 搜尋影片（100 配額單位） |
| 影片 | `youtube_get_video` | 取得影片詳情與統計 |
| 播放清單 | `youtube_list_playlists` | 列出用戶的播放清單 |
| | `youtube_list_playlist_items` | 列出播放清單中的影片 |
| | `youtube_add_to_playlist` | 新增影片到播放清單 |
| 留言 | `youtube_get_comments` | 取得影片留言 |
| 頻道 | `youtube_get_channel` | 取得用戶的頻道資訊 |
