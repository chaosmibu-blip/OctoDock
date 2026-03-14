# AgentDock 討論紀錄

> 時間範圍：2026-03-11 ~ 2026-03-13
> 來源：聖堯 × Claude.ai 產品架構對話，共 8 篇 Notion 筆記彙整

---

## 一、產品定位與核心價值

### AgentDock 是什麼

> 一個 MCP URL，讓任何 agent 都能用你所有的 App，而且越用越懂你。

AgentDock 面向的是**已經在付 AI 訂閱費的人**（Claude Pro/Max、ChatGPT Plus）。用戶不需要架 server、不需要買 API key、不需要離開習慣的 AI 平台。只要貼一個 MCP URL，AI 就能操作所有已授權的 App，而且不管換到哪個 AI 平台，記憶都會跟著走。

### 與 OpenClaw 的差異化（2026-03-12）

討論中深度對比了 AgentDock 與 OpenClaw（28 萬+ GitHub stars、前身為 Clawdbot）：

| 維度 | OpenClaw | AgentDock |
|------|----------|-----------|
| 部署 | 自架（需 Docker/命令列） | 雲端 SaaS，貼 URL 即用 |
| AI 模型 | 用戶自帶 API key（按 token 付費） | 用戶自己的訂閱（不碰 key） |
| 記憶 | 本地 Markdown 檔案（單一實例） | PostgreSQL + pgvector（跨 agent 共享） |
| 安全性 | 完整本機存取，風險高（曾爆 RCE 漏洞） | 只走 OAuth，不碰本機 |
| 目標用戶 | 技術愛好者、開發者 | 訂閱版 AI 用戶，特別是亞洲市場 |

**核心洞察 — 訂閱 ≠ API key**：OpenClaw 用戶的 Claude Pro 訂閱費等於浪費（OpenClaw 不接受訂閱版，必須另付 API 費）。AgentDock 讓訂閱費被充分利用。

**誠實面對的風險**：
- 「簡單」不是護城河，OpenClaw 生態在自我簡化（一鍵部署、AI 自動寫 skill）
- 「跨 agent 記憶」的前提是用戶會頻繁切換 AI 平台，需要驗證
- MCP 對一般人還太新，會去設定 MCP URL 的目前是少數

**但需求是真實的**：聖堯自己就是第一個用戶。

### 與 OpenClaw 的四個可能關係
1. **成為 OpenClaw 的上遊** — OpenClaw 支援 MCP，AgentDock 可以被當成「記憶 + OAuth 工具」外掛
2. **SOP 市場差異化** — 專注中文 SOP，台灣/日本小公司老闆用中文寫流程
3. **亞洲在地化** — LINE 深度整合 + 中日文 UX
4. **付費 API 代理** — 統一代理圖片生成、語音等付費 API

---

## 二、MCP 架構設計演進

### 問題：MCP 工具定義佔 context

每個 MCP 工具連線時，會把完整工具定義灌進 AI 的 context window：
- 一個工具定義 ≈ 200-500 tokens
- 直接接 4-5 個 App 的 MCP ≈ 65+ 個工具 ≈ 20,000 tokens
- 每一輪對話都重複注入（不是說一次就記住）
- 工具越多，AI 選錯的機率越高（注意力稀釋）

### 解法演進

最初討論了四種策略讓 AI 正確呼叫工具：
- ❌ 策略 A：什麼都不介紹（成功率 30%）
- ⚠️ 策略 B：給範例 + 記憶（成功率 75%）
- ⚠️ 策略 C：所有 App 操作清單一次列出（成功率 95%，但浪費 token）
- ❌ 策略 D：全量 JSON Schema（跟直接接 MCP 一樣）

### 最終架構：do + help 雙工具模型（2026-03-13 確定）

聖堯的核心洞察：**查資料和做事從 AI 角度都是同一個動作**。搜尋 Notion 也是在「做一件事」，差別只是 API 端的讀寫，AI 不需要管。

```
agentdock_do(app, action, params)   — 所有操作（不分讀寫）
agentdock_help(app?)                — 取得操作說明（skill）
```

**Token 消耗對比**：

| | 現在（分開 MCP） | AgentDock（do + help） |
|---|---|---|
| 工具定義 | ~50-80K tokens | ~300 tokens |
| 30 輪對話累積 | 1.5M tokens | 9K tokens |

### 步驟 0 設計原則

對話開始時**只載入兩個工具定義**（~300 tokens），不預載任何摘要、App 清單、SOP。AI 只需要知道門在哪裡，不需要事先拿到門後面所有房間的地圖。

### Skill 系統

Skill = 每個 App 每個 action 的簡化操作說明（100-200 tokens）。不是步驟 0 就載入，而是 AI 第一次用某 App 時透過 `help` 取得，進入對話歷史，同一 chat 不用再問。

### Context 動態性

- 跨對話是動態的 — 每次新 chat，MCP server 可以回傳不同的工具列表
- 同一個 chat 裡是固定的 — 中途不會改變
- 用戶在同一個 chat 裡新增/斷開 MCP server 不會生效，要開新 chat

---

## 三、記憶層架構

### 核心結論

**儲存用 DB，呈現用 MD，寫入收自然語言。**

三個環節各用最適合的格式：

| 層 | 用什麼 | 為什麼 |
|---|---|---|
| 儲存 | PostgreSQL + pgvector | 並發安全、語意搜尋、規模化 |
| 呈現 | MD 格式字串 | AI 天生理解、token 效率高 |
| 快取（Phase 3+） | Redis 存渲染好的 MD | 避免每次重新查 DB |

### 為什麼不用 MD 檔取代 DB

- 多 agent 並發寫入時 MD 檔會互相覆蓋（無檔案鎖）
- 語意搜尋需要 pgvector，MD 只能全文掃描
- 10,000 用戶 = 10,000 個檔案，檔案系統會崩潰

### JSON vs MD 對 AI 的差異

| 面向 | JSON | MD |
|---|---|---|
| Token 效率 | 大括號/引號/逗號佔 30-40% | 幾乎全是語意內容 |
| 巢狀深度 | 5-6 層後注意力分散 | 扁平化，一行一個資訊 |
| AI 回寫 | 容易出格式錯誤 | 幾乎不會出錯 |

結論：**讀給 AI 用 MD，程式間傳遞用 JSON，存儲用 DB。**

### 四種記憶類型

preference、pattern、context、sop

### 呼叫失敗是機會

以「在 Notion 建週報」為例：
- 直接接 MCP：AI 不知道 parent_id → 反問用戶 → 打斷流程
- AgentDock 最差情況：AI 漏了 parent_id → AgentDock 結合記憶補完 → 自動重試 → 成功
- AgentDock 最佳情況：伺服器端直接用記憶補完 → 一次成功

**失敗是讓 AgentDock 從「省 token 的工具」進化成「越用越懂你的助手」的機會。**

---

## 四、六層架構（聖堯的原始框架）

聖堯的六個關鍵字：**MCP、skill、工具、記憶、思考、輸入-輸出**

| 關鍵字 | 架構角色 | 具體實現 |
|---|---|---|
| MCP | 通道 | do + help 雙工具，~300 tokens |
| Skill | 翻譯官 | 每個 App 的精簡操作說明，按需載入 |
| 工具 | 手腳 | Notion、Gmail、LINE 等 Adapter |
| 記憶 | 長期儲存 | PostgreSQL + pgvector，四種類型 |
| 思考 | 決策引擎 | 用戶在線→用戶 AI 思考；不在線→內部 Haiku |
| 輸入-輸出 | 格式轉換 | 簡化參數 → API 原始格式 → 精簡回傳 |

**AgentDock 的角色**：AI 是做事的人，AgentDock 是一扇聯絡所有 App 的門，而且這扇門會自動記住所有經過它的人和事。

---

## 五、排程引擎（Scheduler）

### 問題

MCP 是單向的 — AI 呼叫 AgentDock，AgentDock 不能反過來叫醒 AI。用戶不在線時 MCP 通道斷了，但排程的事還是要做。

### 解法：內部 AI 代為執行

```
正常情境（用戶在線）：
  用戶 → Claude → agentdock_do → AgentDock → App API

排程情境（用戶不在線）：
  排程器觸發 → AgentDock 內部 AI（代替 Claude）→ App API
```

### 分層處理

- 簡單排程（查天氣、轉發）→ 規則引擎，零成本
- 需要理解的排程（早報、週報）→ 內部 Haiku，~$0.001-0.005/次
- 用戶指定高級模型 → Claude API，成本轉嫁用戶

### 商業模式意義

排程功能可以成為付費差異化：免費版手動操作，付費版排程自動執行。

---

## 六、LINE 整合情境（2026-03-12）

根據 LINE 官方文件整理了 12 個具體 MCP 情境：

### Messaging API
1. **回覆用戶訊息** — Reply message，免費
2. **主動推送** — Push message，算 1 則從免費額度扣
3. **廣播** — Broadcast，按好友數算（免費方案 200 則/月）
4. **受眾發送** — Narrowcast，需 50 人以上
5. **取得用戶內容** — 圖片/影片/音訊/檔案
6. **Rich Menu** — 免費
7. **用戶 Profile** — 顯示名稱/頭像（不含真實姓名/email/電話）
8. **發送統計** — 查額度/已發數

### LINE Login
9. **用戶登入** — OAuth 2.0 + OpenID Connect
10. **帳號連結** — LINE userId ↔ MIBU userId

### LINE Pay
11. **建立付款** — Request API v3

---

## 七、收款策略（2026-03-13）

### Stripe 現狀
Stripe 不支援台灣商家註冊。

### MIBU 收款
- **B2C 旅客**：App Store IAP + RevenueCat
- **B2B 台灣商家**：ECPay 綠界（2.75%）

### AgentDock 收款
聖堯的洞察：做一個 **iOS App 當設定介面**（管理連接、設定、排程、訂閱），實際使用在 Claude/ChatGPT。

三線並行：
| 渠道 | 費率 | 適用 |
|---|---|---|
| iOS App → IAP（RevenueCat） | 15-30% | 個人用戶，最方便 |
| 網站 → Paddle | 5% + $0.50 | 精打細算用戶 |
| ECPay | 2.75% | 台灣企業客戶 |

### Stripe Atlas
月營收超過 $10,000 再考慮開美國 LLC（一次性 $500 + 每年 $1,500-4,000 維護）。

---

## 八、技術決策紀錄

### 不串 Composio（2026-03-13 確定）

理由：
1. 核心價值被架空 — token 存 Composio，AgentDock 變套殼
2. 不支援 LINE — 台灣/日本核心 App 缺席
3. 成本卡住 — 免費 20K 次/月，100 用戶就超額
4. 已有 Adapter Registry — 統一介面 + auto-scan

結論：自己串最重要的 5-10 個 App。

### Adapter 架構

三種 auth type：oauth2 / api_key / bot_token

```
adapters/
  google/      ← 一個 Adapter，一套 OAuth，多個 module（Gmail/Calendar/Drive）
  notion/      ← 獨立 Adapter（OAuth2）
  line/        ← 獨立 Adapter（bot_token）
  github/      ← 獨立 Adapter（OAuth2）
  threads/     ← 獨立 Adapter（Meta OAuth2）
```

### MVP 優先序
1. Google（Gmail + Calendar + Drive）— 一次 OAuth 吃三個
2. Notion
3. LINE — Composio 不支援，AgentDock 差異化
4. GitHub — 讀 repo、管 issue

### 跨 App 共用認證

同一個 Google 帳號不同 App 仍需各自授權（不同 scope）。AgentDock 的 OAuth token 不能給 n8n 用（client_id 不匹配）。n8n 整合建議在用戶量大了再考慮。

### 對話歷史 = 短期記憶

AgentDock 記憶層的核心工作：把對話內的短期記憶**提煉成跨對話的長期記憶**。
