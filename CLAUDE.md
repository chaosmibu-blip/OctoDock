# OctoDock

> 🐙 One URL. All Apps. Remembers You.

## 你在做什麼

OctoDock 是一個面向非技術用戶的基礎設施產品。用戶只需設定一個 MCP URL，就能讓任何 AI agent 操作所有已授權的 App，並擁有跨 agent 共享的操作記憶。

**OctoDock 的定位：做 Claude Code 做不到的事，不重複 Claude Code 已有的功能。**

三個核心方向：
1. **跨 App 操作層**：讓 AI 一句話同時操作多個 App（Notion + Gmail + GitHub + Calendar 等），這是 Claude Code 內建 connector 做不到的深度整合
2. **記憶層**：跨 session、跨 agent 記住用戶偏好、操作模式、常用 ID。不管用戶用哪個 AI、開幾個 session，記憶都在
3. **AI 使用體驗優化層**：pre-context（操作前自動查現狀）、action-chain（操作後建議下一步）、param-suggest（自動補參數）、SOP 自動偵測（重複操作自動變工作流）、response compression（大回傳壓縮）

不做的事（用 Claude Code 本身的功能）：
- 排程 → 用 Claude Code 的 /loop、Desktop /schedule、雲端排程
- Channel 即時推送 → 用 Claude Code 的官方 Telegram/Discord Channel

## 技術棧

- **語言**：TypeScript
- **MCP Server**：@modelcontextprotocol/sdk（Streamable HTTP）
- **Web 框架**：Next.js（App Router）
- **資料庫**：PostgreSQL + pgvector
- **ORM**：Drizzle ORM
- **用戶認證**：NextAuth.js（Google 登入）
- **Token 加密**：AES-256-GCM
- **部署**：Replit（MVP）→ Railway
- **域名**：`octo-dock.com`
- **DB**：PostgreSQL（連線字串從環境變數 `DATABASE_URL` 讀取，見 `.env.example`）
- **Production DB**：Neon PostgreSQL（連線字串在 `DATABASE_URL` 環境變數）
- **授權**：BSL 1.1（可自用，不可做競品託管服務，4 年後轉 MIT）

## 核心架構

### MCP：do + help 雙工具

OctoDock 的 MCP server 只暴露 2 個工具（~300 tokens），不管連了幾個 App 都一樣：
- `octodock_do(app, action, params)` — 所有操作的統一入口
- `octodock_help(app?, action?)` — 按需取得操作說明

### Adapter Registry

每個 App 是一個獨立的 Adapter 模組（`src/adapters/*.ts`），實作統一的 `AppAdapter` 介面。核心系統啟動時自動掃描 adapters 資料夾、自動註冊。

**加一個新 App = 在 adapters/ 加一個檔案，核心系統不用改。**

### 記憶引擎

PostgreSQL + pgvector 語意搜尋。四種記憶類型：preference、pattern、context、sop。
- `resolveIdentifier`：名稱 → ID 自動解析（越用越懂你）
- `learnIdentifier`：每次操作成功後自動學習
- `pattern-analyzer`：偵測常用操作模式
- `sop-detector`：偵測重複操作流程，自動建議存成 SOP

### SOP 系統

Markdown 流程文件，存在 memory 表 category='sop'。AI 透過 do/help 取得並一步步執行。三層模型：
1. 用戶手動寫 SOP
2. OctoDock 自動偵測重複操作 → 建議存成 SOP
3. OctoDock 主動優化 SOP（合併步驟、建議排程）

### 訂閱系統

三條收款線：Paddle（網站）、IAP（iOS，未來）、ECPay（台灣企業）。
方案分級：free / pro / team。

## 核心迭代迴路

**OctoDock 的核心使命：讓 AI 越用越好用。** 每一次開發都在優化這個迴路：

```
AI 使用 → param-guard 修正格式 → pre-context 補現狀 → 執行 → 記錄
  → 分析失敗模式 → 優化程式碼 + 寫入認知 → AI 下次用得更好
```

**程式碼能解決的 > 規則能解決的。** 如果問題能在 param-guard / middleware 自動修正，改程式碼的效果永遠大於寫 CLAUDE.md 規則。規則是給開發者看的，程式碼是給所有 AI 用的。

### 雙引擎持續迭代

| 引擎 | 時機 | 做什麼 | Skill |
|------|------|--------|-------|
| **工作流程覺察器** | 每次開始工作**前** | 識別情境 → 檢索對應 skill → 載入執行 | `.claude/skills/workflow-awareness.md` |
| **認知進化引擎** | 做了特定事情**後**（見 Skills 觸發表格） | 先改程式碼 → 再寫 CLAUDE.md / 建 skill | `.claude/skills/cognitive-evolution.md` |

前者確保「每個情境都有適配的工作流程」，後者確保「每次改動都不留下資料流斷裂」。觸發不靠「覺察」，靠 **if-then 規則**：改了 tool schema → 檢查 DB 欄位；修了第二次同類 bug → 升級到架構層。

## 工作流程守則

機械性的檢查（前端同步、DB migration）交給 `.claude/hooks/post-commit-check.sh` 自動提醒，不用靠記憶。

碰到問題時先問：**「這是只有這個 App 會碰到的，還是所有 App 都會碰到的？」** 通用的改架構（types.ts / server.ts），不改個別 adapter。同一個問題在第二個 App 出現時就該升級到架構層（詳見 `.claude/skills/architecture-thinking.md`）。

**治標不如治本，今日事今日畢。** 看到的任務就是一次做完，不要只做一半或拆成多個對話。檢查文件時發現問題，修正後直接執行，不要只列出問題等用戶確認。

**Replit 不會自動 deploy。** 改完程式碼並 `npm run build` 成功後，必須提醒用戶去 Replit 手動點 Deploy / Publish。MCP 呼叫走的是 production（octo-dock.com），不是 localhost，所以 localhost 測試通過不代表 MCP 會生效。

**Claude Code memory 不進 repo。** `.claude/projects/` 已加入 `.gitignore`。Memory 檔案只存本地供跨對話使用，不 commit 到開源 repo。需要跨對話持久化的知識寫 CLAUDE.md 或 skills，不要依賴 memory 檔案作為唯一來源。

## 開發原則

0. **不重複造輪子**：寫程式碼或收到需求時，優先看現有程式碼有沒有可直接修改的。不要重複建立功能，也不要堆積廢棄程式碼。修改完要刪掉舊的（包含文件記錄），免得後續維護時錯亂
0.1. **不擅自省略**：不要擅自判斷某個功能「不需要做」或「可以省略」。即使功能跟現有的重疊（例如 Google Docs 跟 Notion），只要用戶的使用習慣不同就要做。有疑問就問，不要自己決定跳過
0.2. **前後端同步**：任何後端的變更（新增 App adapter、改工具名稱、改架構）都要同步更新前端（Dashboard APP_KEYS、i18n 翻譯、OAuth env 映射）。不要只改後端就以為完成了
1. **治本優先**：修正問題根源，不在程式碼中打補丁
2. **Token 絕不明文**：日誌、回應、錯誤訊息中絕不包含明文 token
4. **錯誤隔離**：一個 App 掛掉不影響其他 App
5. **非同步記錄**：操作記錄不阻塞主請求
6. **MCP 工具描述英文**：name 和 description 一律英文（模型理解最佳）
7. **用戶介面多語系**：Dashboard 等用戶看的介面預設繁中
8. **所有程式碼都要加註解**：每個函式、每個區塊都要有中文註解說明用途和邏輯
9. **時間統一台灣時間（UTC+8）**：cron 表達式、log、報告、跟用戶溝通，全部用台灣時間
10. **優先使用 OctoDock 自有功能**：操作已連結的 App（Notion/Gmail/GitHub 等）用 OctoDock MCP 而非直接呼叫 API；記憶和 SOP 用 OctoDock memory/sop 系統。只有 OctoDock 沒有的功能才用其他方式。排程用 Claude Code 的 /loop 或雲端排程，Channel 用 Claude Code 官方的 Telegram/Discord plugin
11. **所有失敗路徑都要記錄**：`server.ts` 中每個提前返回的失敗（app not connected、unknown action、名稱驗證攔截等）都必須呼叫 `logOperation`。不記錄 = 無法觀測 = 無法改善
12. **param-guard 做轉換不只驗證**：AI 傳的參數格式和 API 要的不同是常態，`param-guard.ts` 負責統一正規化（字串→物件、日期補全、陣列包裝、型別轉換）。新增 App 時，先在 param-guard 加轉換規則，不要在 adapter 裡各做各的
13. **能自動修正就修正，不要只警告**：如果系統能判斷「AI 傳的 Title 其實就是 DB 裡的 標題」，直接修正，不要只回傳 warning 讓 AI 重試
14. **AI 輸入的每個欄位都要存進 DB**：MCP 工具定義裡的所有參數（`intent`、`difficulty`、`app`、`action`、`params`）都必須記錄到 operations 表。處理完就丟 = 資料流斷裂 = 無法驗證、回溯、分析。新增 MCP 參數時，同步更新 `operations` schema + `logOperation` 呼叫

## 品質標準

### 好的 UI/UX — 用戶不用想

- **零學習成本**：打開就知道怎麼用，不需要看說明文件
- **最少步驟**：能 2 步完成的事不要設計成 5 步
- **預防錯誤**：在用戶卡住之前就解決，不是等出錯再提示
- **清楚的回饋**：每個操作都有即時回饋（loading → 成功/失敗），不靜默
- **漸進式揭露**：預設只顯示最重要的資訊，細節按需展開（help 機制就是這個原則）
- **錯誤訊息說人話**：「Token 無效，請從 @BotFather 重新複製」而不是「Error 401」

### 好的前端 — 快、穩、好維護

- **狀態完整**：每個元件考慮 5 種狀態（正常、空、載入中、錯誤、邊界值），缺任何一種都是 bug
- **效能**：首頁 < 1 秒，不必要的 re-render 要用 useMemo/useCallback 優化
- **響應式**：手機、平板、桌面都正常，觸控目標 ≥ 44px
- **視覺一致**：用 shadcn/ui 元件庫，不手寫基礎元件。色彩/間距/圓角/字級統一用設計系統
- **元件拆分**：單一元件不超過 300 行，重複 UI 結構出現 2 次就抽元件

### 好的後端 — 安全、可靠、出問題能查

- **安全**：Token 全程加密，log 只有 ID，永不明文
- **錯誤隔離**：一個 App 掛不影響其他 App（circuit breaker + try/catch）
- **非同步記錄**：操作紀錄不阻塞主請求
- **可觀測**：operation log 記錄 userId/app/action/duration/success，出問題能查
- **擴展性**：加新 App = 加一個 adapter 檔案，不用改核心系統

## Adapter 品質基準線

每個 App Adapter 必須遵守（詳見 `.claude/skills/adapter-quality-checklist.md`）：

1. **G1 回傳格式轉換**：實作 `formatResponse()` — 不准把 raw JSON 丟給 AI，read 類 action 必須轉成 AI 友善格式（Notion → Markdown、Gmail → 純文字信件）
2. **G2 CRUD 完整閉環**：有「內容」概念的 resource 必須提供完整的建/讀/改/刪
3. **G3 I/O 格式對稱**：讀出來的格式 = 寫入的格式（吃 MD 就吐 MD）
4. **B2 help 分層查詢**：`octodock_help(app, action)` 回傳特定 action 的完整參數 schema
5. **B3 智慧錯誤引導**：實作 `formatError()` — 攔截常見 API 錯誤，回傳有用提示

## 新增 App 標準流程

**先研究再寫程式碼。** 每次新增 App 時（詳見 `.claude/skills/new-app-research.md`）：
1. 用 WebSearch 查 API 規格（免費額度、端點、認證方式、速率限制）
2. 寫規格文件 `docs/{app}-api-reference.md`
3. 根據規格寫 Adapter
4. 測試

## Adapter 開發流程

1. 建立 `src/adapters/your-app.ts`
2. 實作 `AppAdapter` 介面：
   - `actionMap` — 簡化 action 名稱 → 內部工具名稱
   - `getSkill()` — 精簡操作說明（100-200 tokens）
   - `formatResponse()` — raw JSON → AI 友善格式
   - `formatError()` — 常見錯誤 → 有用提示
   - `execute()` — 實際 API 呼叫
3. 不用改核心系統，Registry 自動掃描

## 踩過的坑（血淚教訓）

### Google 系 adapter 的 refreshToken 環境變數

Google 系 adapter 全部共用 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`（由 `oauth-env.ts` 統一管理）。每個 adapter 的 `refreshToken()` 函式也必須用這兩個變數，**不可以**用 `YOUTUBE_OAUTH_CLIENT_ID`、`GMAIL_OAUTH_CLIENT_ID` 等不存在的變數名。

**教訓**：架構層（`oauth-env.ts`）統一了環境變數映射，但各 adapter 的 `refreshToken()` 是獨立實作的，沒跟上架構的統一。連結時走 `oauth-env.ts` 正常，refresh 時走 adapter 自己的函式就壞了。**改架構時要 grep 所有 adapter 確認沒有殘留舊邏輯。**

### youtube-transcript 套件 CJS export bug

`youtube-transcript@1.3.0` 的 CJS bundle 有 export bug，`import { YoutubeTranscript }` 會拿到 undefined。解法是用 dynamic import：
```ts
async function getYoutubeTranscript() {
  const mod = await import("youtube-transcript");
  return mod.YoutubeTranscript;
}
```
不能降版到 1.2.x，因為 1.3.0 的 InnerTube API（模擬 Android app）才能繞過 Replit IP 被 YouTube reCAPTCHA 擋的問題。

### getSkill(action) 不可以自己處理「找不到 action」

`getSkill(action)` 在 `ACTION_SKILLS` 找不到 action 時，**必須回傳 `null`**，不能回傳 `"Action not found..."` 的錯誤文字。

**教訓**：之前 15 個 adapter 都在 `getSkill()` 裡回傳 `"Action not found. Available: ${Object.keys(ACTION_SKILLS)...}"`，導致 server.ts 的 fallback（用 `actionMap` 查 `inputSchema`）永遠不會執行。結果就是 `actionMap` 有 21 個 action，但 `octodock_help(app, action)` 只認得 `ACTION_SKILLS` 裡手寫的 12 個。**adapter 只負責「我知道的回傳說明」，不知道的回傳 `null`，讓 server.ts 統一兜底。**

### formatResponse 收到的是物件不是字串

`server.ts` 的 `toolResultToDoResult` 會把 adapter 回傳的 JSON 字串 `JSON.parse` 成物件，再傳給 `formatResponse(action, data)`。所以 **`formatResponse` 收到的 `rawData` 永遠是已解析的 JS 物件**，不是 JSON 字串。

**教訓**：`String(物件)` 會變成 `[object Object]`。所有 adapter 的 `formatResponse` 都不能用 `String(rawData)` 當 fallback，必須用 `JSON.stringify(rawData, null, 2)`。新增 action 的 formatResponse case 時，記得 rawData 是物件，要從屬性取值或用 `JSON.stringify`。

### Dashboard 引導區塊的設計原則

用戶連完 App 後的引導流程必須**引導到 MCP 設定**，不是引導到 AI 對話。用戶的瓶頸在「把 MCP URL 貼進 AI 工具的設定」這一步，不是「不知道要跟 AI 說什麼」。

**教訓**：早期引導區塊只叫用戶複製「試試 OctoDock」貼到 AI 對話，但用戶根本還沒把 MCP URL 設進 AI 工具，那句話貼了也沒用。7 個註冊用戶中 6 個卡在這步。改成分步引導（複製 URL → 選平台 → 直接跳到設定頁）後，點「前往設定」時自動複製 MCP URL，減少操作步驟。

目前支援的平台引導：Claude.ai（直連 `claude.ai/settings/integrations`）、Cursor。新增平台時在 `dashboard-client.tsx` 的引導區塊加按鈕 + i18n 翻譯即可。

### AI 參數格式 ≠ API 參數格式（系統性阻抗失配）

AI 傳的參數和 API 預期的格式之間存在固定的落差模式：字串 vs 物件（GCal start/end）、日期格式不一致（GTasks due）、名稱大小寫（Notion title）、路徑格式（GitHub 尾部斜線）、陣列 vs 字串（Gmail to、GitHub labels）。

**教訓**：這不是個別 App 的 bug，是 AI 和 API 之間的系統性問題。解法不是在每個 adapter 各自處理，而是在 `param-guard.ts` 中介層統一轉換。新增 App 時，**先在 param-guard 加轉換規則（J3e-J3h），再寫 adapter**。adapter 裡可以保留防禦性轉換作為 fallback，但主邏輯在 middleware。

### server.ts 提前返回的失敗沒有記錄

`octodock_do` 有多個提前返回的失敗路徑（app not connected、unknown action、名稱驗證攔截、preValidate 攔截、param guard 攔截），這些都在 `executeWithMiddleware` 之前就 return 了，所以不會被 logger.ts 記錄到 operations 表。

**教訓**：每次在 `server.ts` 加新的提前返回路徑時，**必須同時加 `logOperation`**。不記錄 = 看不見 = 不知道壞了。已用 `startTime` 提到最外層，所有路徑都能計算耗時。

## 名稱解析機制

AI 可以用名稱（不用 ID）操作：
1. 先查記憶（`resolveIdentifier`）
2. 記憶沒有 → fallback 到 App search
3. 找到後自動學習（`learnIdentifier`）
4. 下次直接從記憶解析

## SOP 自動辨識機制

1. 記錄操作序列（operations 表）
2. 按 session 分組（30 分鐘間隔 = 新 session）
3. 用 LCS 比對找重複模式（≥ 3 次 = 候選 SOP）
4. 在 `octodock_do` 回傳裡塞 `suggestions`
5. 正在連接的 AI 看到 suggestions 會自然地問用戶確認

## 語言策略

| 對象 | 語言 |
|------|------|
| MCP 工具名稱 + 描述 | 英文 |
| 用戶介面 | 多語系（預設繁中） |
| 程式碼註解 | 中文 |
| 錯誤訊息 | 雙語：`「Notion 未連結 (NOTION_NOT_CONNECTED)」` |
| Commit 摘要 | 中文 + Conventional Commits 格式 |

## Blog 文章規則

Blog 文章的寫作規則存在 Notion 頁面 `32ba9617-875f-81a4-a751-cbc0b7668487`（Blog SKILL）。這是唯一真實來源，由 claude.ai 維護。**執行 Blog 相關任務前，先用 `notion.get_page` 讀這個頁面拿最新規則。**

## 文件索引

### 規劃與紀錄
- **升級計畫書**：`docs/agentdock-upgrade-plan.md`（所有 Phase 的規劃和進度）
- **討論紀錄**：`docs/agentdock-discussion-log.md`（Notion 討論彙整）

### Skills（if-then 規則 + hook 雙層觸發）

Hook（`.claude/hooks/post-commit-check.sh`）會在 commit 後根據改動的檔案自動提醒對應 skill。以下規則也必須在**開始工作前**主動判斷：

| 觸發條件 | 必須讀取的 Skill | 說明 |
|----------|-----------------|------|
| 新增或修改 `src/adapters/*.ts` | `.claude/skills/adapter-quality-checklist.md` | G1-G3、B2-B3 品質基準線逐項檢查 |
| **新增** adapter（全新 App） | `.claude/skills/new-app-research.md` | 先研究 API 再寫程式碼，產出規格文件 |
| 後端變更（adapter / MCP / auth / schema） | `.claude/skills/frontend-sync.md` | 檢查前端是否需要同步（APP_KEYS、i18n、oauth-env） |
| 修改 `src/app/` 或 `src/components/` | `.claude/skills/ui-review.md` | 16 層面前端審查：UI/UX + 實作品質 + 架構 |
| 修改 `src/app/` 或 `src/components/` | `.claude/skills/visual-design.md` | 視覺美學：色彩/字級/間距/動畫/質感持續優化 |
| 修改核心架構（server.ts / types.ts / middleware） | `.claude/skills/architecture-thinking.md` | 判斷是架構層問題還是個別 App 問題 |
| 任務涉及 3 個以上檔案改動 | `.claude/skills/planning-doc.md` | 先寫規劃文件，不能直接動手 |
| 改了 server.ts 的 tool schema（z.object 參數定義） | `.claude/skills/cognitive-evolution.md` | 檢查 operations 表有沒有對應欄位 + logOperation 有沒有傳 |
| 改了 param-guard 或新增 App | `.claude/skills/cognitive-evolution.md` | 檢查是個別 App 問題還是該提升到 middleware |
| 同一類型的 bug 修了第二次 | `.claude/skills/cognitive-evolution.md` | 升級到架構層（middleware / param-guard / CLAUDE.md 原則） |
| 用戶糾正做法或方向 | `.claude/skills/cognitive-evolution.md` | 寫入 CLAUDE.md 開發原則，避免重蹈覆轍 |
| 查 production 數據發現失敗模式 | `.claude/skills/cognitive-evolution.md` | 先改程式碼修復 → 再寫認知 |
| 設定 App 的 OAuth / API Key / Bot Token | `.claude/skills/setup-guide.md` | 16 個 App 的認證設定流程 |
| 用戶提到寫文章、產文章、blog、SEO、意圖矩陣、Claude 專欄 | `.claude/skills/blog-writer.md` | Blog 文章產生器：三種類型 + Claude 專欄，寫入 Notion |
| 用戶要建立新 skill、加 skill、提供 skill 規格 | `.claude/skills/skill-builder.md` | Skill 建立器：完整流程（寫檔案 + 觸發規則 + 驗證不重複） |
| 用戶說 commit、提交、git commit | `.claude/skills/commit.md` | Commit 前完整性檢查：遺漏檔案 + 敏感資訊掃描 + build |

### App 設定指南（所有 App 的 OAuth / API Key / Bot Token 設定流程）
- `.claude/skills/setup-guide.md` — 16 個 App 的設定指南（按認證類型分組）

### MCP 中介層（server.ts 管線中的 middleware）
- `src/mcp/middleware/logger.ts` — 操作中介層：取 token → 執行 → 記錄
- `src/mcp/middleware/circuit-breaker.ts` — Per-app 斷路器（B4）
- `src/mcp/middleware/pre-context.ts` — 操作前查目標現狀（C1+C4）
- `src/mcp/middleware/post-check.ts` — 操作後基線比對（C2+C3）
- `src/mcp/middleware/action-chain.ts` — 操作鏈建議 + 跨 App 關聯（E1+E4）
- `src/mcp/middleware/param-guard.ts` — 參數防呆（J3：UUID 補全、查詢語法轉換）
- `src/mcp/error-types.ts` — 統一錯誤分類（B1）
- `src/mcp/error-hints.ts` — App-specific 錯誤說明（G8）
- `src/mcp/response-formatter.ts` — 統一回傳格式（J1）

### Agents
- **開發指南**：`.claude/agents/octodock-dev.md`
- **MCP 開發**：`.claude/agents/mcp-server-builder.md`
- **認證開發**：`.claude/agents/oauth-integrator.md`
