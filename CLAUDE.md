# OctoDock

> 🐙 One URL. All Apps. Remembers You.

## 你在做什麼

OctoDock 是一個面向非技術用戶的基礎設施產品。用戶只需設定一個 MCP URL，就能讓任何 AI agent 操作所有已授權的 App，並擁有跨 agent 共享的操作記憶。

## 技術棧

- **語言**：TypeScript
- **MCP Server**：@modelcontextprotocol/sdk（Streamable HTTP）
- **Web 框架**：Next.js（App Router）
- **資料庫**：PostgreSQL + pgvector
- **ORM**：Drizzle ORM
- **用戶認證**：NextAuth.js（Google 登入）
- **Token 加密**：AES-256-GCM
- **部署**：Replit（MVP）→ Railway
- **DB（開發）**：`postgresql://postgres:password@helium/heliumdb?sslmode=disable`（Replit 本地 PostgreSQL）
- **DB（正式）**：`postgresql://neondb_owner:npg_AfqGlnb8u5Wg@ep-noisy-credit-a6o1pvlt.us-west-2.aws.neon.tech/neondb?sslmode=require`（Neon）
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

### 排程引擎

cron-based 排程，三種類型：
- simple：規則引擎直接執行（零成本）
- sop：內部 AI 讀 SOP 執行
- ai：內部 AI 理解自然語言執行

### 訂閱系統

三條收款線：Paddle（網站）、IAP（iOS，未來）、ECPay（台灣企業）。
方案分級：free / pro / team。

## 工作流程守則

每次完成一輪程式碼變更後，問自己一個問題：**「這次學到的東西，下次還會踩到嗎？」** 會的話就更新 CLAUDE.md 或建新 skill。不會的話就不用動。

機械性的檢查（前端同步、DB migration）交給 `.claude/hooks/post-commit-check.sh` 自動提醒，不用靠記憶。

碰到問題時先問：**「這是只有這個 App 會碰到的，還是所有 App 都會碰到的？」** 通用的改架構（types.ts / server.ts），不改個別 adapter。同一個問題在第二個 App 出現時就該升級到架構層（詳見 `.claude/skills/architecture-thinking.md`）。

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

## 文件索引

### 規劃與紀錄
- **升級計畫書**：`docs/agentdock-upgrade-plan.md`（所有 Phase 的規劃和進度）
- **討論紀錄**：`docs/agentdock-discussion-log.md`（Notion 討論彙整）

### Skills（語意觸發，不是固定關鍵字）
- **自我改進檢查**：`.claude/skills/self-improve.md` — 每次改完程式碼自動判斷 CLAUDE.md 和 skills 是否需要更新或建立新的
- **規劃文件**：`.claude/skills/planning-doc.md` — 3 個以上檔案改動時必須先寫規劃文件
- **前後端同步**：`.claude/skills/frontend-sync.md` — 後端變更時自動檢查前端是否需要同步
- **Adapter 品質檢查**：`.claude/skills/adapter-quality-checklist.md` — 新增或修改 adapter 時的品質基準線
- **新增 App 研究**：`.claude/skills/new-app-research.md` — 新增 App 時先研究 API 再寫程式碼
- **架構思維**：`.claude/skills/architecture-thinking.md` — 架構總覽 + 碰到問題時判斷改架構還是改個別 App

### App 操作手冊（設定 + 維護 + AI 操作指南）
- `.claude/skills/setup-notion.md` — Notion
- `.claude/skills/setup-gmail.md` — Gmail
- `.claude/skills/setup-google-calendar.md` — Google Calendar
- `.claude/skills/setup-google-drive.md` — Google Drive
- `.claude/skills/setup-google-sheets.md` — Google Sheets
- `.claude/skills/setup-google-tasks.md` — Google Tasks
- `.claude/skills/setup-google-docs.md` — Google Docs
- `.claude/skills/setup-youtube.md` — YouTube
- `.claude/skills/setup-github.md` — GitHub
- `.claude/skills/setup-line.md` — LINE
- `.claude/skills/setup-telegram.md` — Telegram
- `.claude/skills/setup-threads.md` — Threads
- `.claude/skills/setup-instagram.md` — Instagram

### Agents
- **開發指南**：`.claude/agents/octodock-dev.md`
- **MCP 開發**：`.claude/agents/mcp-server-builder.md`
- **認證開發**：`.claude/agents/oauth-integrator.md`
