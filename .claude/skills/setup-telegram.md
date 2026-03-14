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

1. 前往 Dashboard（`https://agent-dock.replit.app/dashboard`）
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
- Telegram Adapter 原始碼：`src/adapters/telegram.ts`（4 個工具）

## OctoDock Telegram 工具清單

| 類別 | 工具名稱 | 功能 |
|------|---------|------|
| 傳送 | `telegram_send_message` | 傳送文字訊息（支援 Markdown） |
| | `telegram_send_photo` | 傳送圖片（URL） |
| 接收 | `telegram_get_updates` | 取得最近收到的訊息 |
| 設定 | `telegram_set_webhook` | 設定或更新 Webhook URL |
