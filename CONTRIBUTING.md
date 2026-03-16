# Contributing to OctoDock

感謝你對 OctoDock 的興趣！以下是貢獻指南。

## 開發環境設定

```bash
git clone https://github.com/chaosmibu-blip/OctoDock.git
cd OctoDock
npm install
cp .env.example .env   # 填入你的 OAuth 憑證
npm run dev
```

需要的環境：
- Node.js 20+
- PostgreSQL（本地或 Neon/Supabase）

## 新增 App Adapter

OctoDock 最需要的貢獻是新增 App adapter。每個 adapter 是一個獨立檔案：

1. 建立 `src/adapters/your-app.ts`
2. 實作 `AppAdapter` 介面（見 `src/adapters/types.ts`）
3. 必須實作：
   - `actionMap` — action 名稱對應表
   - `getSkill()` — 操作說明（動態計數）
   - `formatResponse()` — raw JSON → AI 友善格式（**不准丟 raw JSON**）
   - `formatError()` — 常見錯誤 → 有用提示
   - `execute()` — 實際 API 呼叫
4. 在 `src/mcp/registry.ts` 加入 import
5. 品質基準線見 `.claude/skills/adapter-quality-checklist.md`

## 程式碼風格

- TypeScript strict mode
- 所有函式和區塊加中文註解
- MCP 工具名稱和描述用英文
- 參數命名用 snake_case（不用 camelCase）
- Commit 用中文 + Conventional Commits 格式

## PR 流程

1. Fork → 建立 feature branch
2. 確保 `npx tsc --noEmit` 通過
3. 確保 `npm run build` 成功
4. PR 標題簡潔，描述寫清楚改了什麼、為什麼改
5. 一個 PR 做一件事

## 不要做的事

- 不要提交 `.env` 或任何含有密鑰的檔案
- 不要在程式碼中硬編碼 token 或密碼
- 不要在日誌或錯誤訊息中輸出明文 token
- 不要在 PR 裡塞不相關的 refactor

## 授權

貢獻的程式碼將採用與專案相同的 BSL 1.1 授權。
