---
name: Canva 設定指南
description: Canva 的連結設定流程，包含 OAuth 申請和環境變數設定
---

# Skill: setup-canva

引導用戶完成 Canva Connect API OAuth 整合設定。

## 觸發條件
用戶輸入 `/setup-canva` 或詢問如何設定 Canva。

## 執行步驟

### Step 1: 建立 Canva Integration

1. 前往 [Canva Developers](https://www.canva.com/developers/)
2. 點 **Create an integration**
3. 填寫：
   - Integration name: `OctoDock`
   - Integration type: **Public**（所有 Canva 用戶可用）或 **Private**（限 Enterprise 團隊）
4. 在 **Scopes** 中勾選：
   - `asset:read`, `asset:write`
   - `design:content:read`, `design:content:write`, `design:meta:read`
   - `comment:read`, `comment:write`
   - `folder:read`, `folder:write`
   - `profile:read`
5. 在 **OAuth settings** 中：
   - Redirect URI: `https://octo-dock.com/callback/canva`
6. 複製 **Client ID** 和 **Client Secret**

### Step 2: 設定環境變數

在 `.env` 中加入：

```
CANVA_CLIENT_ID=your_client_id
CANVA_CLIENT_SECRET=your_client_secret
```

### Step 3: 測試

1. 到 Dashboard 點「連結 Canva」
2. 授權後測試：`octodock_do(app:"canva", action:"get_profile")`

## 注意事項

- Canva OAuth 使用 **Basic Auth** 交換 token（跟 Notion 一樣）
- Canva 的 token 有 refresh 機制，adapter 已實作 `refreshToken()`
- **Public integration 需要 Canva 審核**才能讓所有用戶使用
- MVP 先建 Private integration 或用 development mode 測試
- Autofill 和 Brand Template 功能需要 **Canva Enterprise** 方案
- 速率限制：建立設計 20 次/分鐘、匯出 10 次/分鐘
