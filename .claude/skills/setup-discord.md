---
name: Discord 設定指南
description: Discord 的連結設定流程，包含 Bot Token 申請和設定
---

# Skill: setup-discord

引導用戶完成 Discord Bot 整合設定。

## 觸發條件
用戶輸入 `/setup-discord` 或詢問如何設定 Discord。

## 認證方式

Discord 使用 **Bot Token 認證**，從 Discord Developer Portal 取得。

## 執行步驟

### Step 1: 建立 Discord Application + Bot

1. 前往 [Discord Developer Portal](https://discord.com/developers/applications)
2. 點 **New Application** → 輸入名稱（例如 `OctoDock Bot`）
3. 左側選 **Bot**
4. 點 **Reset Token** 產生 Bot Token
5. 複製 token — ⚠️ 只顯示一次！

### Step 2: 設定 Bot 權限並加入伺服器

1. 左側選 **OAuth2** → **URL Generator**
2. Scopes 勾選 `bot`
3. Bot Permissions 勾選需要的權限（建議至少勾選）：
   - Send Messages
   - Manage Messages
   - Read Message History
   - Add Reactions
   - Manage Channels
   - Manage Roles
   - Kick Members / Ban Members
4. 複製產生的 URL，在瀏覽器開啟
5. 選擇要加入的伺服器，點 **Authorize**

### Step 3: 在 Dashboard 連結

1. 前往 Dashboard（`https://octo-dock.com/dashboard`）
2. 點 Discord 的 **「連結」** 按鈕
3. 貼入 Bot Token
4. 驗證通過後，Discord 顯示「已連結」

### Step 4: 測試連結

1. 透過 agent 測試發送訊息到某個頻道
2. 需要 channel_id — 在 Discord 開啟開發者模式（設定 → 進階 → 開發者模式），右鍵頻道 → 複製 ID

### 常見問題

**Q: Bot Token 驗證失敗？**
- 確認複製的是 Bot Token（不是 Client Secret）
- 確認 token 沒有多餘的空格

**Q: 發送訊息時出現 Missing Access？**
- Bot 需要有該頻道的「Send Messages」權限
- 確認 Bot 已被加入伺服器

**Q: 如何取得 Channel ID / Server ID？**
- 開啟 Discord 開發者模式（用戶設定 → 進階 → 開發者模式）
- 右鍵頻道/伺服器 → 複製 ID

## 相關文件
- Discord Adapter 原始碼：`src/adapters/discord.ts`（50 個工具）

## OctoDock Discord 工具清單

| 類別 | 工具名稱 | 功能 |
|------|---------|------|
| 訊息 | `discord_send_message` | 傳送訊息（支援 Markdown + Embeds） |
| | `discord_get_messages` | 取得頻道訊息 |
| | `discord_get_message` | 取得單一訊息 |
| | `discord_edit_message` | 編輯訊息 |
| | `discord_delete_message` | 刪除訊息 |
| | `discord_bulk_delete` | 批量刪除訊息 |
| | `discord_add_reaction` | 加反應 |
| | `discord_pin_message` | 置頂訊息 |
| | `discord_unpin_message` | 取消置頂 |
| | `discord_get_pinned` | 取得置頂訊息 |
| 頻道 | `discord_get_channel` | 取得頻道資訊 |
| | `discord_edit_channel` | 編輯頻道 |
| | `discord_delete_channel` | 刪除頻道 |
| | `discord_create_channel` | 建立頻道 |
| | `discord_get_invites` | 取得邀請連結 |
| | `discord_trigger_typing` | 顯示輸入中 |
| 討論串 | `discord_start_thread` | 從訊息開始討論串 |
| | `discord_start_thread_no_message` | 建立獨立討論串 |
| | `discord_join_thread` | 加入討論串 |
| | `discord_leave_thread` | 離開討論串 |
| | `discord_list_thread_members` | 列出討論串成員 |
| | `discord_list_active_threads` | 列出活躍討論串 |
| 伺服器 | `discord_get_guild` | 伺服器資訊 |
| | `discord_get_guild_channels` | 列出頻道 |
| | `discord_get_guild_preview` | 伺服器預覽 |
| | `discord_modify_guild` | 編輯伺服器 |
| | `discord_get_audit_log` | 稽核日誌 |
| 成員 | `discord_get_member` | 成員資訊 |
| | `discord_list_members` | 列出成員 |
| | `discord_search_members` | 搜尋成員 |
| | `discord_modify_member` | 編輯成員 |
| | `discord_add_role` | 新增角色 |
| | `discord_remove_role` | 移除角色 |
| | `discord_kick_member` | 踢出成員 |
| | `discord_ban_member` | 封禁成員 |
| | `discord_unban_member` | 解除封禁 |
| | `discord_get_bans` | 列出封禁 |
| 角色 | `discord_get_roles` | 列出角色 |
| | `discord_create_role` | 建立角色 |
| | `discord_modify_role` | 編輯角色 |
| | `discord_delete_role` | 刪除角色 |
| Webhook | `discord_create_webhook` | 建立 Webhook |
| | `discord_get_webhooks` | 列出 Webhook |
| | `discord_execute_webhook` | 透過 Webhook 發訊 |
| | `discord_delete_webhook` | 刪除 Webhook |
| 其他 | `discord_get_user` | 用戶資訊 |
| | `discord_create_dm` | 開啟私訊頻道 |
| | `discord_get_bot_info` | Bot 資訊 |
