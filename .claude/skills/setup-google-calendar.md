---
name: Google Calendar 設定指南
description: Google Calendar 的連結設定流程，包含 OAuth 申請和環境變數設定
---

# Skill: setup-google-calendar

引導用戶完成 Google Calendar OAuth 整合設定。

## 觸發條件
用戶輸入 `/setup-google-calendar` 或詢問如何設定 Google Calendar。

## 執行步驟

### Step 1: 建立 Google Cloud OAuth Client

前往 [Google Cloud Console](https://console.cloud.google.com/) 建立 OAuth 2.0 憑證。

1. 選擇或建立專案
2. 前往 **APIs & Services → OAuth consent screen**，設定應用程式名稱（建議：`OctoDock`）
3. 前往 **APIs & Services → Library**，啟用 **Google Calendar API**
4. 前往 **APIs & Services → Credentials → Create Credentials → OAuth client ID**

需要填寫的欄位：

| 欄位 | 建議值 | 說明 |
|------|--------|------|
| Application type | Web application | |
| Name | `OctoDock Google Calendar` | 方便辨識用途 |
| Authorized redirect URIs | `https://agent-dock.replit.app/callback/google_calendar` | **必須完全一致** |

點 **Create** 建立。

### Step 2: 取得 OAuth 憑證

建立後會顯示：

1. 複製 **Client ID**
2. 複製 **Client Secret**

### Step 3: 確認 API 範圍（Scopes）

Google Calendar Adapter 需要以下 OAuth scopes：
- `https://www.googleapis.com/auth/calendar` — 完整日曆存取
- `https://www.googleapis.com/auth/calendar.events` — 事件管理

### Step 4: 設定環境變數

在 Replit Secrets 加入：
- `GCAL_OAUTH_CLIENT_ID` = 複製的 Client ID
- `GCAL_OAUTH_CLIENT_SECRET` = 複製的 Client Secret

### Step 5: 重新部署

```bash
npm run build
```

然後 Republish。

### Step 6: 測試連結

1. 前往 Dashboard（`https://agent-dock.replit.app/dashboard`）
2. 點 Google 日曆的 **「連結」** 按鈕
3. 跳轉到 Google 授權頁面
4. 允許日曆存取權限
5. 跳回 Dashboard，Google 日曆顯示「已連結」
6. 測試：透過 agent 詢問「今天有什麼行程？」

### 常見問題

**Q: 按連結後出現 redirect_uri_mismatch 錯誤？**
- 確認 Redirect URI 完全一致：`https://agent-dock.replit.app/callback/google_calendar`
- 注意 callback 路徑使用底線 `google_calendar`，非連字號

**Q: 查詢事件時沒有結果？**
- 預設查詢未來 7 天的事件，確認該時間範圍內有事件
- 確認用戶授權了正確的 Google 帳號

**Q: 無法建立或刪除事件？**
- 確認 OAuth scopes 包含 `calendar.events`
- 確認用戶對該日曆有編輯權限

## 相關文件
- 環境設定指南：`docs/setup-guide.md`
- Google Calendar Adapter 原始碼：`src/adapters/google-calendar.ts`（8 個工具）

## OctoDock Google Calendar 工具清單

| 類別 | 工具名稱 | 功能 |
|------|---------|------|
| 日曆 | `gcal_list_calendars` | 列出所有日曆 |
| 事件 | `gcal_get_events` | 查詢時間範圍內的事件 |
| | `gcal_get_event` | 取得單一事件詳情 |
| | `gcal_create_event` | 建立新事件 |
| | `gcal_update_event` | 更新事件（部分更新） |
| | `gcal_delete_event` | 刪除事件 |
| | `gcal_quick_add` | 用自然語言快速新增事件 |
| 查詢 | `gcal_freebusy` | 查詢空閒/忙碌時段 |
