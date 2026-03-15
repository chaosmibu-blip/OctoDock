---
name: Telegram 設定指南
description: Telegram 的連結設定流程，包含 Bot Token 申請和設定
---

# Skill: setup-telegram

引導用戶完成 Telegram Bot 整合設定。

## 觸發條件
用戶輸入 `/setup-telegram` 或詢問如何設定 Telegram。

## 認證方式

Telegram 使用 **Bot Token 認證**，從 @BotFather 取得。OctoDock 會自動設定 Webhook。

## 執行步驟

### Step 1: 建立 Telegram Bot

1. 在 Telegram 搜尋 **@BotFather**
2. 傳送 `/newbot` 開始建立
3. 按照指示設定：
   - **Bot 名稱**（顯示名稱）：例如 `OctoDock Bot`
   - **Bot username**（唯一識別名）：例如 `octodock_bot`（必須以 `bot` 結尾）
4. BotFather 會回傳一個 **Bot Token**，格式類似：
   ```
   123456789:ABCdefGHIjklMNOpqrsTUVwxyz
   ```
5. 複製這個 token

### Step 2: 在 Dashboard 連結

1. 前往 Dashboard（`https://octo-dock.com/dashboard`）
2. 點 Telegram 的 **「連結」** 按鈕
3. 貼入 Bot Token
4. 系統會自動驗證 token 並設定 Webhook
5. 驗證通過後，Telegram 顯示「已連結」

### Step 3: 測試連結

1. 在 Telegram 搜尋你的 Bot username
2. 傳送 `/start` 開始對話
3. 透過 agent 測試功能：
   - 發送文字訊息（需要 chat_id）
   - 發送圖片
   - 取得最近收到的訊息

### 如何取得 Chat ID

- 方法 1：向 Bot 傳送訊息，然後用 `telegram_get_updates` 工具查看最近訊息，其中包含 chat_id
- 方法 2：搜尋 @userinfobot 並傳送訊息，它會回傳你的 chat ID

### 常見問題

**Q: Bot Token 驗證失敗？**
- 確認複製的是完整的 token（包含冒號前的數字和冒號後的字串）
- 確認 token 沒有多餘的空格

**Q: 發送訊息時出現 chat not found？**
- 用戶必須先向 Bot 傳送至少一則訊息（`/start`），Bot 才能主動發送訊息
- 對於群組，需要將 Bot 加入群組

**Q: Webhook 設定失敗？**
- OctoDock 會在連結時自動設定 Webhook
- 如需手動設定，可使用 `telegram_set_webhook` 工具

**Q: 訊息格式支援？**
- `telegram_send_message` 支援 Markdown、MarkdownV2 和 HTML 格式
- 預設使用 Markdown 格式

## 相關文件
- 環境設定指南：`docs/setup-guide.md`
- Telegram Adapter 原始碼：`src/adapters/telegram.ts`（47 個工具）

## OctoDock Telegram 工具清單

| 類別 | 工具名稱 | 功能 |
|------|---------|------|
| 訊息傳送 | `tg_send_message` | 傳送文字訊息（支援 Markdown/HTML） |
| | `tg_send_photo` | 傳送圖片 |
| | `tg_send_video` | 傳送影片 |
| | `tg_send_document` | 傳送檔案 |
| | `tg_send_audio` | 傳送音訊 |
| | `tg_send_voice` | 傳送語音訊息 |
| | `tg_send_sticker` | 傳送貼圖 |
| | `tg_send_location` | 傳送位置 |
| | `tg_send_contact` | 傳送聯絡人 |
| | `tg_send_poll` | 傳送投票 |
| 訊息管理 | `tg_forward_message` | 轉發訊息 |
| | `tg_copy_message` | 複製訊息（無轉發標記） |
| | `tg_edit_message` | 編輯已發送訊息 |
| | `tg_delete_message` | 刪除訊息 |
| | `tg_set_reaction` | 對訊息加反應 |
| | `tg_pin_message` | 置頂訊息 |
| | `tg_unpin_message` | 取消置頂 |
| | `tg_unpin_all` | 取消所有置頂 |
| 聊天管理 | `tg_get_chat` | 取得聊天資訊 |
| | `tg_get_chat_member` | 取得成員資訊 |
| | `tg_get_chat_member_count` | 成員數量 |
| | `tg_get_chat_admins` | 列出管理員 |
| | `tg_ban_member` | 封禁用戶 |
| | `tg_unban_member` | 解除封禁 |
| | `tg_restrict_member` | 限制用戶權限 |
| | `tg_promote_member` | 升為管理員 |
| | `tg_set_chat_title` | 修改群組名稱 |
| | `tg_set_chat_description` | 修改群組描述 |
| | `tg_leave_chat` | Bot 離開聊天 |
| | `tg_get_invite_link` | 取得邀請連結 |
| 論壇主題 | `tg_create_forum_topic` | 建立主題 |
| | `tg_edit_forum_topic` | 編輯主題 |
| | `tg_close_forum_topic` | 關閉主題 |
| | `tg_reopen_forum_topic` | 重新開啟主題 |
| Bot 設定 | `tg_get_me` | 取得 Bot 資訊 |
| | `tg_set_my_commands` | 設定指令選單 |
| | `tg_get_my_commands` | 取得指令列表 |
| | `tg_delete_my_commands` | 刪除所有指令 |
| | `tg_set_my_name` | 設定 Bot 名稱 |
| | `tg_set_my_description` | 設定 Bot 描述 |
| Webhook | `tg_get_updates` | 取得最近訊息 |
| | `tg_set_webhook` | 設定 Webhook URL |
| | `tg_get_webhook` | 取得 Webhook 資訊 |
| | `tg_delete_webhook` | 刪除 Webhook |
| 內容 | `tg_get_file` | 取得檔案下載路徑 |
| | `tg_get_user_photos` | 取得用戶頭像 |
| Callback | `tg_answer_callback` | 回應行內按鈕回調 |
