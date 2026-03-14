---
name: 前後端同步檢查
description: 後端有變更時自動檢查前端是否需要同步更新
---

# 前後端同步檢查

## 什麼時候觸發

任何後端變更完成後，自動檢查以下前端檔案是否需要同步：

- 新增或刪除 App adapter
- 修改 App adapter 的名稱、action、工具定義
- 修改 MCP 工具名稱或架構
- 修改 OAuth 認證流程
- 修改 DB schema（可能影響 Dashboard 顯示）

## 檢查清單

### 1. Dashboard App 列表
**檔案**：`src/app/dashboard/dashboard-client.tsx` 的 `APP_KEYS`

- 新增 adapter → 加到 APP_KEYS
- 刪除 adapter → 從 APP_KEYS 移除
- 改名 → 同步改 APP_KEYS 的 name 和 displayName

### 2. 多語系翻譯
**檔案**：`src/lib/i18n.tsx`

- 新增 App → 加 `app.{name}.desc` 的中英文翻譯
- 新增工具 → 加 `tool.{name}` 的中英文翻譯

### 3. OAuth 環境變數映射
**檔案**：`src/lib/oauth-env.ts` 的 `ENV_PREFIX_MAP`

- 新增 OAuth App → 加映射（例如 google_calendar → GCAL）
- 同時更新 `.env.example`

### 4. OAuth 回調路由
**檔案**：`src/app/callback/[app]/route.ts`

- 新增有特殊 token 交換流程的 App → 確認回調能處理

### 5. 記憶/偏好頁面
**檔案**：`src/app/preferences/preferences-client.tsx`

- 新增記憶類型 → 確認 category 篩選器有包含
