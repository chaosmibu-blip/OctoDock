---
name: LINE 設定指南
description: LINE 的連結設定流程，包含 Channel Access Token 申請和 API Key 設定
---

# Skill: setup-line

引導用戶完成 LINE Messaging API 整合設定。

## 觸發條件
用戶輸入 `/setup-line` 或詢問如何設定 LINE。

## 認證方式

LINE 使用 **API Key 認證**（Channel Access Token），不走 OAuth 流程。用戶需從 LINE Developers Console 取得 token 並直接貼入 Dashboard。

## 執行步驟

### Step 1: 建立 LINE Messaging API Channel

1. 前往 [LINE Developers Console](https://developers.line.biz/)
2. 使用 LINE 帳號登入
3. 建立 Provider（如果還沒有的話），例如 `OctoDock`
4. 點 **Create a new channel** → 選擇 **Messaging API**

需要填寫的欄位：

| 欄位 | 建議值 | 說明 |
|------|--------|------|
| Channel type | Messaging API | |
| Provider | 選擇你的 Provider | |
| Channel name | `OctoDock Bot` | 用戶在 LINE 上看到的名稱 |
| Channel description | `Your AI-powered assistant` | |
| Category | 適合的類別 | |
| Subcategory | 適合的子類別 | |

點 **Create** 建立。

### Step 2: 取得 Channel Access Token

1. 進入新建的 Channel 設定頁面
2. 切換到 **Messaging API** 分頁
3. 捲到底部找到 **Channel access token (long-lived)**
4. 點 **Issue** 產生 token
5. 複製 token — 這就是你的 API Key

### Step 3: 設定 Webhook（選用）

如果需要接收用戶傳來的訊息（用於 reply 功能）：

1. 在 **Messaging API** 分頁找到 **Webhook URL**
2. 設定為：`https://octo-dock.com/api/webhook/line`
3. 開啟 **Use webhook**

### Step 4: 在 Dashboard 連結

1. 前往 Dashboard（`https://octo-dock.com/dashboard`）
2. 點 LINE 的 **「連結」** 按鈕
3. 貼入 Channel Access Token
4. 系統會自動驗證 token 是否有效
5. 驗證通過後，LINE 顯示「已連結」

### Step 5: 測試連結

1. 在 LINE 搜尋並加入你的 Bot
2. 透過 agent 測試發送訊息：
   - 發送訊息給指定用戶（需要 user_id）
   - 廣播訊息給所有好友
3. 確認訊息成功送達

### 如何取得 User ID

- 當用戶傳訊息給 Bot 時，webhook 會收到包含 `userId` 的事件
- 也可以在 LINE Developers Console → **Basic Settings** 找到你自己的 User ID（Your user ID）

### 常見問題

**Q: token 驗證失敗？**
- 確認複製的是 **Channel access token (long-lived)**，不是 Channel secret
- 確認 token 沒有多餘的空格或換行

**Q: 發送訊息失敗？**
- 確認對方已加入 Bot 為好友
- 確認 user_id 格式正確（以 U 開頭的 33 字元字串）

**Q: 廣播訊息的限制？**
- LINE 免費方案每月有訊息數量限制
- broadcast 會發送給所有好友，注意月費額度

**Q: Reply token 過期？**
- Reply token 只在收到 webhook 事件後 1 分鐘內有效
- 超過時間請改用 send_message

## 相關文件
- 環境設定指南：`docs/setup-guide.md`
- LINE Adapter 原始碼：`src/adapters/line.ts`（49 個工具）

## OctoDock LINE 工具清單

| 類別 | 工具名稱 | 功能 |
|------|---------|------|
| 傳送 | `line_send_message` | 傳送文字訊息給指定用戶 |
| | `line_send_image` | 傳送圖片訊息 |
| | `line_send_sticker` | 傳送 LINE 貼圖 |
| | `line_send_flex` | 傳送 Flex Message（富卡片） |
| | `line_multicast` | 群發訊息（最多 500 人） |
| | `line_broadcast` | 廣播訊息給所有好友 |
| | `line_reply` | 使用 reply token 回覆訊息 |
| 用戶/群組 | `line_get_profile` | 取得用戶資料（名稱、頭像） |
| | `line_get_group_summary` | 取得群組資訊（名稱、人數） |
| | `line_get_group_members` | 取得群組成員 ID 列表 |
| | `line_leave_group` | Bot 離開群組 |
| | `line_get_followers_ids` | 取得粉絲 ID 列表 |
| 統計 | `line_get_followers` | 取得粉絲數與統計 |
| | `line_get_quota` | 取得訊息配額與用量 |
| | `line_get_bot_info` | 取得 Bot 資訊 |
| | `line_get_demographics` | 取得好友人口統計 |
| Webhook | `line_set_webhook` | 設定 Webhook URL |
| | `line_get_webhook` | 取得 Webhook 資訊 |
