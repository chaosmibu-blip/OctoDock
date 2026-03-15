---
name: Threads 設定指南
description: Threads 的連結設定流程，包含 Meta OAuth 申請和環境變數設定
---

# Skill: setup-threads

引導用戶完成 Threads（Meta）OAuth 整合設定。

## 觸發條件
用戶輸入 `/setup-threads` 或詢問如何設定 Threads。

## 執行步驟

### Step 1: 建立 Meta App

1. 前往 [Meta for Developers](https://developers.facebook.com/)
2. 點 **My Apps → Create App**
3. 選擇 **Other** → **Consumer** 類型
4. 填寫 App 名稱（建議：`OctoDock`）
5. 建立完成後，進入 App Dashboard

### Step 2: 設定 Threads API

1. 在 App Dashboard 左側選單，找到 **Add Products**
2. 找到 **Threads** 並點 **Set Up**
3. 前往 **Settings → Basic**，記下：
   - **App ID** — 這是 OAuth Client ID
   - **App Secret** — 這是 OAuth Client Secret

### Step 3: 設定 OAuth Redirect URI

1. 在 App Dashboard 前往 **Threads API → Settings**（或 **Facebook Login → Settings**）
2. 在 **Valid OAuth Redirect URIs** 加入：
   ```
   https://octo-dock.com/callback/threads
   ```
3. 儲存設定

### Step 4: 確認 API 範圍（Scopes）

Threads Adapter 需要以下 permissions：
- `threads_basic` — 基本讀取
- `threads_content_publish` — 發佈貼文
- `threads_read_replies` — 讀取回覆
- `threads_manage_replies` — 管理回覆
- `threads_manage_insights` — 查看互動數據

### Step 5: 設定環境變數

Threads 和 Instagram 共用 Meta OAuth 憑證。在 Replit Secrets 加入：
- `META_OAUTH_CLIENT_ID` = App ID
- `META_OAUTH_CLIENT_SECRET` = App Secret

> 注意：如果已經設定過 Instagram，這些變數可能已經存在，Threads 共用相同的憑證。

### Step 6: 重新部署

```bash
npm run build
```

然後 Republish。

### Step 7: 測試連結

1. 前往 Dashboard（`https://octo-dock.com/dashboard`）
2. 點 Threads 的 **「連結」** 按鈕
3. 跳轉到 Threads 授權頁面
4. 允許存取權限
5. 跳回 Dashboard，Threads 顯示「已連結」
6. 測試：透過 agent 發佈一則測試貼文

### Token 說明

- Threads 使用短期 token → 長期 token 的交換機制
- 短期 token 有效期約 1 小時
- 系統會自動交換為長期 token（有效期約 60 天）
- 長期 token 會在到期前自動刷新

### 常見問題

**Q: 按連結後出現 redirect_uri 錯誤？**
- 確認 Valid OAuth Redirect URI 包含：`https://octo-dock.com/callback/threads`
- 注意 Meta 的 Redirect URI 設定可能需要幾分鐘才生效

**Q: 授權後無法發佈貼文？**
- 確認 App 已通過 Meta App Review（開發模式下僅自己可用）
- 確認已取得 `threads_content_publish` 權限

**Q: 貼文字數限制？**
- Threads 貼文最多 500 字元

**Q: 和 Instagram 共用 App 嗎？**
- 是的，Threads 和 Instagram 共用同一個 Meta App 和 `META_OAUTH_CLIENT_ID`/`META_OAUTH_CLIENT_SECRET`

## 相關文件
- 環境設定指南：`docs/setup-guide.md`
- Threads Adapter 原始碼：`src/adapters/threads.ts`（5 個工具）

## OctoDock Threads 工具清單

| 類別 | 工具名稱 | 功能 |
|------|---------|------|
| 發佈 | `threads_publish` | 發佈文字貼文 |
| 讀取 | `threads_get_posts` | 取得最近貼文列表 |
| 互動 | `threads_reply` | 回覆貼文 |
| 數據 | `threads_get_insights` | 取得貼文互動數據 |
| 個人 | `threads_get_profile` | 取得用戶檔案資訊 |
