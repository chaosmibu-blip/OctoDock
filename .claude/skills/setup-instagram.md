---
name: Instagram 設定指南
description: Instagram 的連結設定流程，包含 Meta OAuth 申請和環境變數設定
---

# Skill: setup-instagram

引導用戶完成 Instagram Business 帳號的 OAuth 整合設定。

## 觸發條件
用戶輸入 `/setup-instagram` 或詢問如何設定 Instagram。

## 前提條件

Instagram API 需要：
1. **Instagram Business 帳號**（非個人帳號）
2. **Facebook 粉絲專頁**已連結到 Instagram Business 帳號

如果還沒有，請先：
1. 在 Instagram 設定中將帳號切換為「商業帳號」或「創作者帳號」
2. 在 Facebook 建立粉絲專頁並連結到 Instagram 帳號

## 執行步驟

### Step 1: 建立 Meta App

1. 前往 [Meta for Developers](https://developers.facebook.com/)
2. 點 **My Apps → Create App**
3. 選擇 **Other** → **Consumer** 類型
4. 填寫 App 名稱（建議：`OctoDock`）
5. 建立完成後，進入 App Dashboard

### Step 2: 設定 Instagram API

1. 在 App Dashboard 左側選單，找到 **Add Products**
2. 找到 **Instagram** 並點 **Set Up**
3. 同時加入 **Facebook Login** 產品
4. 前往 **Settings → Basic**，記下：
   - **App ID** — 這是 OAuth Client ID
   - **App Secret** — 這是 OAuth Client Secret

### Step 3: 設定 OAuth Redirect URI

1. 在 App Dashboard 前往 **Facebook Login → Settings**
2. 在 **Valid OAuth Redirect URIs** 加入：
   ```
   https://octo-dock.com/callback/instagram
   ```
3. 儲存設定

### Step 4: 確認 API 範圍（Scopes）

Instagram Adapter 需要以下 permissions：
- `instagram_basic` — 基本讀取
- `instagram_content_publish` — 發佈貼文
- `instagram_manage_comments` — 管理留言
- `instagram_manage_insights` — 查看洞察數據
- `pages_show_list` — 列出 Facebook 粉絲專頁
- `pages_read_engagement` — 讀取粉絲專頁互動

### Step 5: 設定環境變數

Instagram 和 Threads 共用 Meta OAuth 憑證。在 Replit Secrets 加入：
- `META_OAUTH_CLIENT_ID` = App ID
- `META_OAUTH_CLIENT_SECRET` = App Secret

> 注意：如果已經設定過 Threads，這些變數可能已經存在，Instagram 共用相同的憑證。

### Step 6: 重新部署

```bash
npm run build
```

然後 Republish。

### Step 7: 測試連結

1. 前往 Dashboard（`https://octo-dock.com/dashboard`）
2. 點 Instagram 的 **「連結」** 按鈕
3. 跳轉到 Facebook 授權頁面（Instagram 透過 Facebook OAuth）
4. 選擇要連結的 Facebook 粉絲專頁和 Instagram 帳號
5. 允許所有權限
6. 跳回 Dashboard，Instagram 顯示「已連結」
7. 測試：透過 agent 取得最近貼文列表

### Token 說明

- Instagram 使用短期 token → 長期 token 的交換機制
- 系統會自動交換為長期 token（有效期約 60 天）
- 長期 token 會在到期前自動刷新

### 常見問題

**Q: 按連結後出現 redirect_uri 錯誤？**
- 確認 Facebook Login Settings 中 Valid OAuth Redirect URI 包含：`https://octo-dock.com/callback/instagram`

**Q: 授權後出現「No Facebook Pages found」？**
- Instagram API 需要 Facebook 粉絲專頁
- 確認你的 Facebook 帳號有至少一個粉絲專頁
- 確認粉絲專頁已連結到 Instagram Business 帳號

**Q: 出現「No Instagram Business account」？**
- Instagram 帳號必須是 Business 或 Creator 帳號
- 在 Instagram App → 設定 → 帳號 → 切換為專業帳號

**Q: 無法發佈貼文？**
- `instagram_publish` 需要提供公開可存取的圖片 URL
- Instagram API 不支援純文字貼文，必須包含圖片
- 確認已取得 `instagram_content_publish` 權限

**Q: 和 Threads 共用 App 嗎？**
- 是的，Instagram 和 Threads 共用同一個 Meta App 和 `META_OAUTH_CLIENT_ID`/`META_OAUTH_CLIENT_SECRET`

## 相關文件
- 環境設定指南：`docs/setup-guide.md`
- Instagram Adapter 原始碼：`src/adapters/instagram.ts`（5 個工具）

## OctoDock Instagram 工具清單

| 類別 | 工具名稱 | 功能 |
|------|---------|------|
| 發佈 | `instagram_publish` | 發佈圖片貼文 |
| 讀取 | `instagram_get_posts` | 取得最近貼文列表 |
| 留言 | `instagram_get_comments` | 取得貼文留言 |
| | `instagram_reply_comment` | 回覆留言 |
| 數據 | `instagram_get_insights` | 取得貼文互動數據 |
