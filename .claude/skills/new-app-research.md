---
name: 新增 App API 研究
description: 每次新增一個 App adapter 時，自動研究該 App 的免費 API、功能、規格
---

# 新增 App 時的標準流程

每次聖堯說要新增一個 App adapter 時，**先做研究再寫程式碼**。

## Step 1：API 研究

用 WebSearch 查詢以下資訊：

1. **免費 API 列表** — 這個 App 有哪些 API？哪些免費？配額多少？
2. **認證方式** — OAuth 2.0 / API Key / Bot Token？scope 有哪些？
3. **核心端點** — 每個 API 能做什麼？CRUD 哪些資源？
4. **速率限制** — 每分鐘/每天的請求上限
5. **回傳格式** — API 回傳的 JSON 結構長什麼樣

## Step 2：寫規格文件

將研究結果寫成 `docs/{app}-api-reference.md`，格式：

```markdown
# {App} API 規格

## 認證
- 方式：OAuth 2.0
- Scopes：...
- Token 有效期：...

## 免費額度
- 每日配額：...
- 速率限制：...

## API 端點

### {端點名稱}
- Method: GET/POST
- URL: ...
- 參數：...
- 回傳：...
- 配額消耗：...
```

## Step 3：寫 Adapter

根據規格文件，按 adapter-quality-checklist 的標準寫 adapter：

1. `actionMap` — 所有 action
2. `getSkill(action?)` — 每個 action 都要有 ACTION_SKILLS 範例
3. `formatResponse()` — raw JSON → AI 友善格式
4. `formatError()` — 常見錯誤 → 有用提示
5. `execute()` — 實際 API 呼叫

## Step 4：測試

用 MCP 呼叫每個 action 確認能用。

## 重要

- 不要猜 API 規格，一定要查官方文件
- 免費 API 優先，付費 API 標記清楚
- 同一個 OAuth 能共用的就共用（例如 Google 全家桶）
