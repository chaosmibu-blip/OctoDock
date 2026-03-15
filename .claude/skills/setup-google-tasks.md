---
name: Google Tasks 設定指南
description: Google Tasks 的連結設定流程，包含 OAuth 申請和環境變數設定
---

# Skill: setup-google-tasks

引導用戶完成 Google Tasks OAuth 整合設定。

## 觸發條件
用戶輸入 `/setup-google-tasks` 或詢問如何設定 Google Tasks。

## 執行步驟

### Step 1: 建立 Google Cloud OAuth Client

前往 [Google Cloud Console](https://console.cloud.google.com/) 建立 OAuth 2.0 憑證。

1. 選擇或建立專案
2. 前往 **APIs & Services → OAuth consent screen**，設定應用程式名稱（建議：`OctoDock`）
3. 前往 **APIs & Services → Library**，啟用 **Google Tasks API**
4. 前往 **APIs & Services → Credentials → Create Credentials → OAuth client ID**

需要填寫的欄位：

| 欄位 | 建議值 | 說明 |
|------|--------|------|
| Application type | Web application | |
| Name | `OctoDock Google Tasks` | 方便辨識用途 |
| Authorized redirect URIs | `https://octo-dock.com/callback/google_tasks` | **必須完全一致** |

點 **Create** 建立。

### Step 2: 取得 OAuth 憑證

建立後會顯示：

1. 複製 **Client ID**
2. 複製 **Client Secret**

### Step 3: 確認 API 範圍（Scopes）

Google Tasks Adapter 需要以下 OAuth scope：
- `https://www.googleapis.com/auth/tasks` — 完整任務存取（讀寫）

### Step 4: 設定環境變數

在 Replit Secrets 加入：
- `GTASKS_OAUTH_CLIENT_ID` = 複製的 Client ID
- `GTASKS_OAUTH_CLIENT_SECRET` = 複製的 Client Secret

### Step 5: 重新部署

```bash
npm run build
```

然後 Republish。

### Step 6: 測試連結

1. 前往 Dashboard（`https://octo-dock.com/dashboard`）
2. 點 Google Tasks 的 **「連結」** 按鈕
3. 跳轉到 Google 授權頁面
4. 允許任務存取權限
5. 跳回 Dashboard，Google Tasks 顯示「已連結」
6. 測試：透過 agent 詢問「列出我的待辦事項」

### 常見問題

**Q: 按連結後出現 redirect_uri_mismatch 錯誤？**
- 確認 Redirect URI 完全一致：`https://octo-dock.com/callback/google_tasks`

**Q: 找不到任務清單？**
- 先用 `gtasks_list_tasklists` 取得清單 ID
- 預設清單通常有一個名為「My Tasks」的清單

**Q: 建立任務時 due date 格式錯誤？**
- due 需為 RFC 3339 格式，例如 `2026-03-20T00:00:00.000Z`

## 相關文件
- 環境設定指南：`docs/setup-guide.md`
- Google Tasks Adapter 原始碼：`src/adapters/google-tasks.ts`（7 個工具）

## OctoDock Google Tasks 工具清單

| 類別 | 工具名稱 | 功能 |
|------|---------|------|
| 清單 | `gtasks_list_tasklists` | 列出所有任務清單 |
| 任務 | `gtasks_list_tasks` | 列出清單中的任務 |
| | `gtasks_get_task` | 取得單一任務詳情 |
| | `gtasks_create_task` | 建立新任務 |
| | `gtasks_update_task` | 更新任務 |
| | `gtasks_delete_task` | 永久刪除任務 |
| | `gtasks_complete_task` | 標記任務為已完成 |
