# 實作規則

> 觸發條件：寫程式碼時
> CLAUDE.md 是認知層（為什麼），這裡是執行層（怎麼做）。

## 編碼慣例

- MCP 工具的 name 和 description 一律英文
- 用戶介面預設繁中，多語系
- 所有程式碼都要加中文註解說明用途和邏輯
- 時間統一台灣時間 UTC+8：cron、log、報告、跟用戶溝通
- Token 絕不明文：日誌、回應、錯誤訊息中絕不包含明文 token
- 錯誤隔離：一個 App 掛掉不影響其他 App（circuit breaker + try/catch）
- 操作記錄不阻塞主請求（非同步寫入）
- 錯誤訊息雙語：`「Notion 未連結 (NOTION_NOT_CONNECTED)」`
- Commit 摘要：中文 + Conventional Commits 格式

## 資料流規則

- 所有失敗路徑都要記錄：`server.ts` 中每個提前返回的失敗都必須呼叫 `logOperation`，帶入所有可用欄位。不記錄 = 無法觀測 = 無法改善
- AI 輸入的每個欄位都要存進 DB：MCP 工具定義裡的所有參數都必須記錄到 operations 表。新增 MCP 參數時，同步更新 `operations` schema + 所有 `logOperation` 呼叫
- param-guard 做轉換不只驗證：AI 傳的參數格式和 API 要的不同是常態，`param-guard.ts` 負責統一正規化。新增 App 時，先在 param-guard 加轉換規則，不要在 adapter 裡各做各的
- 能自動修正就修正，不要只回傳 warning 讓 AI 重試

## 品質標準

### UI/UX
- 零學習成本：打開就知道怎麼用
- 最少步驟：能 2 步完成的事不要設計成 5 步
- 預防錯誤：在用戶卡住之前就解決
- 清楚的回饋：每個操作都有即時回饋（loading → 成功/失敗），不靜默
- 漸進式揭露：預設只顯示最重要的資訊，細節按需展開
- 錯誤訊息說人話：「Token 無效，請從 @BotFather 重新複製」而不是「Error 401」

### 前端
- 每個元件考慮 5 種狀態（正常、空、載入中、錯誤、邊界值），缺任何一種都是 bug
- 首頁 < 1 秒，不必要的 re-render 用 useMemo/useCallback 優化
- 響應式：手機、平板、桌面都正常，觸控目標 ≥ 44px
- 用 shadcn/ui 元件庫，不手寫基礎元件
- 單一元件不超過 300 行，重複 UI 結構出現 2 次就抽元件

### 後端
- operation log 記錄 userId/app/action/duration/success，出問題能查

## Adapter 品質基準線

詳見 `.claude/skills/adapter-quality-checklist.md`，摘要：

1. G1 回傳格式轉換：實作 `formatResponse()`，不准把 raw JSON 丟給 AI
2. G2 CRUD 完整閉環：有「內容」概念的 resource 必須提供完整的建/讀/改/刪
3. G3 I/O 格式對稱：讀出來的格式 = 寫入的格式
4. B2 help 分層查詢：`octodock_help(app, action)` 回傳特定 action 的完整參數 schema
5. B3 智慧錯誤引導：實作 `formatError()`，攔截常見 API 錯誤，回傳有用提示

## 新增 App + Adapter 開發流程

先研究再寫程式碼（詳見 `.claude/skills/new-app-research.md`）：
1. 用 WebSearch 查 API 規格（免費額度、端點、認證方式、速率限制）
2. 寫規格文件 `docs/{app}-api-reference.md`
3. 建立 `src/adapters/your-app.ts`，實作 `AppAdapter` 介面：
   - `actionMap` — 簡化 action 名稱 → 內部工具名稱
   - `getSkill()` — 精簡操作說明（100-200 tokens）
   - `formatResponse()` — raw JSON → AI 友善格式
   - `formatError()` — 常見錯誤 → 有用提示
   - `execute()` — 實際 API 呼叫
4. 不用改核心系統，Registry 自動掃描
5. 測試

## 踩坑細節

### Google 系 adapter 的 refreshToken 環境變數
Google 系 adapter 全部共用 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`（由 `oauth-env.ts` 統一管理）。每個 adapter 的 `refreshToken()` 函式也必須用這兩個變數，不可以用 `YOUTUBE_OAUTH_CLIENT_ID`、`GMAIL_OAUTH_CLIENT_ID` 等不存在的變數名。

### youtube-transcript 套件 CJS export bug
`youtube-transcript@1.3.0` 的 CJS bundle 有 export bug，`import { YoutubeTranscript }` 會拿到 undefined。解法是用 dynamic import：
```ts
async function getYoutubeTranscript() {
  const mod = await import("youtube-transcript");
  return mod.YoutubeTranscript;
}
```
不能降版到 1.2.x，因為 1.3.0 的 InnerTube API 才能繞過 Replit IP 被 YouTube reCAPTCHA 擋的問題。

### getSkill(action) 找不到 action 時必須回傳 null
不能回傳錯誤文字，否則 server.ts 的 fallback 永遠不會執行。adapter 只負責回傳自己知道的，不知道的交給 server.ts 兜底。

### formatResponse 收到的是物件不是字串
`server.ts` 的 `toolResultToDoResult` 會先 `JSON.parse`，所以 `formatResponse` 收到的 `rawData` 永遠是 JS 物件。不能用 `String(rawData)` 當 fallback，要用 `JSON.stringify(rawData, null, 2)`。

### Dashboard 引導流程
用戶連完 App 後的引導流程必須引導到 MCP 設定，不是引導到 AI 對話。目前支援的平台引導：Claude.ai、Cursor。新增平台時在 `dashboard-client.tsx` 的引導區塊加按鈕 + i18n 翻譯。

## 檔案索引

### MCP 中介層
- `src/mcp/middleware/logger.ts` — 取 token → 執行 → 記錄
- `src/mcp/middleware/circuit-breaker.ts` — Per-app 斷路器
- `src/mcp/middleware/pre-context.ts` — 操作前查目標現狀
- `src/mcp/middleware/post-check.ts` — 操作後基線比對
- `src/mcp/middleware/action-chain.ts` — 操作鏈建議 + 跨 App 關聯
- `src/mcp/middleware/param-guard.ts` — 參數防呆
- `src/mcp/error-types.ts` — 統一錯誤分類
- `src/mcp/error-hints.ts` — App-specific 錯誤說明
- `src/mcp/response-formatter.ts` — 統一回傳格式

### Agents
- `.claude/agents/octodock-dev.md` — 開發指南
- `.claude/agents/mcp-server-builder.md` — MCP 開發
- `.claude/agents/oauth-integrator.md` — 認證開發
