# OctoDock 產品演化規劃：短期 → 中期 → 長期

> 日期：2026-03-25
> 來源：協作有局產品思考討論 + 現有架構分析
> 狀態：**設計審查中（等待聖堯確認）**

---

## 一、演化路徑總覽

```
短期（現在）：工具連接層 — 連接既有 App 的 API
    ↓
中期：記憶與上下文層 — 事件圖譜 + 上下文接續 + SOP 強化 + 企業內部管理
    ↓
長期：服務基礎設施 — 服務 API + 知識技能市場 + 信任層 + 供需洞察
```

本文件涵蓋**全部三個階段**的設計框架，共五個模組：

| 模組 | 階段 | 性質 |
|------|------|------|
| A. 事件圖譜 | 中期 | **新增**（基礎設施） |
| B. 上下文接續 | 中期 | **微調 + 強化**（依賴 A） |
| C. 服務 API（輸出 API） | 長期 | **新增**（延伸現有 adapter 機制） |
| D. 知識技能市場 | 長期 | **新增**（依賴 C，是 C 的終極形態） |
| E. 信任層 + 供需洞察 | 長期 | **新增**（依賴 A + C） |

模組之間的依賴：

```
A（事件圖譜）──→ B（上下文接續）
    │
    ├──────────→ E（信任層：A 的數據 + C 的服務）
    │
C（服務 API）──→ D（知識技能市場：C 的終極形態）
    │
    └──────────→ E
```

---

## 二、現狀盤點：我們已經有什麼

### 已有的，可以直接延伸

| 現有機制 | 位置 | 能延伸到 |
|----------|------|----------|
| `operations` 表 | `schema.ts` | 事件圖譜的原始數據源 |
| `logOperation()` | `logger.ts` | 已記錄 userId/app/action/params/result/duration |
| `agentInstanceId` | `server.ts`（X-Agent-Id header） | 上下文接續的 agent 識別 |
| `pre-context` middleware | `pre-context.ts` | 上下文接續的注入點 |
| `action-chain` middleware | `action-chain.ts` | 已有 Markov chain 建議 |
| `sop-detector` | `sop-detector.ts` | 已有操作序列分析 |
| `memory` 表 + pgvector | `schema.ts` + `memory-engine.ts` | 語意搜尋基礎 |
| `AppAdapter` 介面 | `types.ts` | 服務 API 的骨架 |
| `adapter registry` | `registry.ts` | 自動掃描 + 註冊機制 |
| `connectedApps` 表 + 權限 | `schema.ts` | 三層權限的基礎 |
| `subscriptions` 表 | `schema.ts` | 商業模式的基礎 |

### 缺少的，需要新建

| 缺少的 | 對應模組 | 為什麼需要 |
|--------|---------|-----------|
| 操作之間的因果關係 | A | `operations` 只記錄單筆操作，不知道因果 |
| 操作分組查詢 | A | sop-detector 已有 30 分鐘間隔分組邏輯，前端和上下文接續需要共用 |
| Agent 換手偵測 | B | `agentInstanceId` 有記錄但沒有比對邏輯 |
| 用戶可見的操作歷史 | A | 操作紀錄只存 DB，沒有前端 |
| 外部服務註冊機制 | C | 只有開發者寫的 adapter，沒有用戶上傳管道 |
| 知識打包與出租機制 | D | SOP/memory 只能自用，不能對外提供 |
| 履約品質追蹤 | E | 操作紀錄只記錄成功/失敗，沒有服務品質維度 |
| 供需數據分析 | E | 有操作數據但沒有「誰需要什麼 + 誰提供什麼」的結構化分析 |

---

## 三、模組 A：事件圖譜（中期）

### A1. 核心定位

事件圖譜要回答的問題：**「AI 代表我做了什麼？」**

不是 log（給開發者 debug 用），是**用戶能看懂的操作歷史**，而且操作之間有因果關係。

### A2. 與現有 operations 表的關係：微調，不重建

現有 `operations` 表已經記錄了單筆操作的完整資訊（app/action/params/result/duration/intent）。事件圖譜不是取代它，而是**在它上面加一層關聯結構**。

**需要微調 operations 表（加欄位，不改現有欄位）：**

| 新增欄位 | 用途 | 為什麼不是新表 |
|----------|------|---------------|
| `parentOperationId` | 因果：這個操作是因為哪個操作觸發的 | 因果關係是操作的屬性，不是獨立實體 |

**不需要 operations 因果欄位。** 現有的 `userId` + `agentInstanceId` + `createdAt` 已足夠在查詢時動態分組（30 分鐘間隔 or agentInstanceId 變更 = 新 session）。不需要額外的 sessionId 欄位或獨立的 operations 因果欄位——存推斷得出來的東西是多餘的。

### A3. Session 分組方式（查詢時動態計算）

不需要預先標記 session。查詢操作歷史時，用以下規則動態分組：

- 同一 `userId`，按 `createdAt` 排序
- 相鄰操作間隔 > 30 分鐘 → 分組邊界

**注意：`agentInstanceId` 目前不可靠。** Production 數據顯示 1515 筆操作中，所有 Claude.ai 請求都帶同一個 `Claude-User`，無法區分不同 session 或不同 AI。MCP 協議目前沒有標準的 client identity 機制，未來如果各 AI 客戶端開始帶唯一 ID，可以再加入分組條件。現階段純靠時間間隔。

### A4. 因果關係建立方式

不靠 AI 推斷，靠**程式碼層面的確定性規則**：

| 規則 | 判定為因果 | 範例 |
|------|-----------|------|
| 同 session、相鄰操作、後者的 params 包含前者 result 中的 ID | 是 | search_page → get_page（search 回傳的 page_id 被 get 使用） |
| 同 session、相鄰操作、同 App、CRUD 順序 | 是 | create_page → update_page（同一個 page） |
| 同 session、跨 App、後者 params 引用前者 result 內容 | 是（跨 App 關聯） | get_email → create_page（email 內容寫進 Notion） |
| 同 session 但間隔超過 5 分鐘、無參數引用 | 否 | 兩個獨立操作 |

### A5. 用戶可見的介面

**在 Dashboard 新增「操作歷史」頁面：**

- 時間線視圖：按 session 分組，每個 session 顯示摘要 + 展開看細節
- 每個操作顯示：App 圖示 + action 名稱 + 一句話描述結果 + 時間
- 因果關係用連線或縮排表示
- 篩選：按 App、按日期、按 agent
- 不顯示 raw params/result，只顯示人類看得懂的摘要

### A6. 需要改動的現有程式碼

| 檔案 | 改動類型 | 改什麼 |
|------|---------|--------|
| `schema.ts` | 微調 | operations 加 `parentOperationId` 欄位 |
| `logger.ts` | 微調 | logOperation 時帶入 parentOperationId |
| `server.ts` | 微調 | 判定因果關係（前一筆操作的 result ID 是否被當前 params 引用） |
| Dashboard 前端 | 新增 | 操作歷史頁面 |

---

## 四、模組 B：上下文接續（中期）

### B1. 核心定位

上下文接續要解決的問題：**「AI 換手了，新 AI 不知道之前做了什麼。」**

OctoDock 扮演的角色是**老員工帶新人**——偵測到 AI 換手時，主動把相關上下文塞進回應裡。

### B2. 與現有機制的關係：強化，不重建

| 現有機制 | 現在做到的 | 要強化到 |
|----------|-----------|---------|
| `agentInstanceId`（X-Agent-Id） | 記錄但不比對 | 比對前後差異，觸發上下文補充 |
| `pre-context` middleware | 查目標物件的現狀 | 加入「用戶近期做了什麼」的摘要 |
| `usedAppsThisSession` | 首次使用 App 時附帶記憶 | 擴充為首次使用 App 時附帶近期操作摘要 |
| `action-chain` Markov | 建議下一步 | 加入「上次你做到哪裡」的脈絡 |
| `memory` 的 context 類型 | 記住名稱 → ID | 加入最近操作的摘要快取 |

### B3. 換手偵測邏輯

**何時判定為「新的工作階段」（可能是換手，也可能是同一 AI 的新 session）：**

1. 距離上一次操作 > 30 分鐘
2. 未來若 MCP 協議支援 client identity，`agentInstanceId` 改變也算

**注意：目前無法可靠區分「換了 AI」和「同一個 AI 開了新 session」。** Production 數據顯示所有 Claude.ai 請求的 agentInstanceId 都是 `Claude-User`，無法分辨。因此上下文接續的策略是：**不管是不是換手，只要是新的工作階段，就補上下文。**

**新工作階段開始時 OctoDock 要做的事：**

- 從事件圖譜拉最近 3 組操作的摘要
- 如果第一個操作跟前一組操作相關（同 App 或相關 action），附加更詳細的上下文
- 上下文放在 `DoResult.context` 欄位，不影響正常操作結果

### B4. 異常偵測：不只是換手

**除了換手，還要偵測「同一個 AI 突然行為異常」：**

| 異常模式 | 偵測方式 | 回應 |
|---------|---------|------|
| 呼叫了一個從沒用過的 action（但有類似的常用 action） | 比對 operations 歷史 | 提示：「你之前都用 X action，這次用了 Y，確定嗎？附上 X 的用法」 |
| 參數格式突然不同（之前都傳物件，這次傳字串） | 比對同 action 的近期 params pattern | param-guard 自動修正 + 提示 |
| 重複執行已完成的操作（create 同名頁面） | 事件圖譜查重 | 提示：「30 分鐘前已建立過同名頁面，要繼續嗎？」附上現有頁面連結 |

### B5. 上下文注入的格式

上下文不是長篇大論，是**精準的 3-5 行提示**，放在 `DoResult.context` 裡：

```
範例（AI 換手時）：
context: "Recent activity (last 2 sessions):
- 14:30 [Claude] Created 3 pages in Notion '專案規劃' folder
- 14:45 [Claude] Sent summary email to team@company.com
Your last session ended 2 hours ago. This is a new agent session."

範例（異常偵測）：
context: "Note: You usually call 'get_events' (used 47 times).
This is your first time calling 'list_events'.
'list_events' is an alias for 'get_events' — proceeding normally."
```

### B6. 需要改動的現有程式碼

| 檔案 | 改動類型 | 改什麼 |
|------|---------|--------|
| `server.ts` | 微調 | 請求進來時比對時間間隔，判定是否新工作階段 |
| `pre-context.ts` | 強化 | 換手時從事件圖譜拉近期摘要，注入 context |
| `action-chain.ts` | 強化 | 異常偵測邏輯（呼叫從沒用過的 action） |
| `logger.ts` | 微調 | 記錄 agentInstanceId 變化事件 |
| `memory-engine.ts` | 微調 | 新增「操作摘要快取」查詢函式 |

---

## 五、模組 C：服務 API / 輸出 API（長期）

### C1. 核心定位

現有的 adapter 是「開發者寫好的軟體服務連接器」。服務 API 把同一套機制延伸，讓**用戶也能上傳自己的服務描述**，無論是軟體服務還是實體服務。

**本質：把「人」類比成「App」。** 一個 App 透過 API 讓 AI 知道它能做什麼，一個人（商家）也可以透過 API 讓 AI 知道他能提供什麼服務。

**兩種 API 的對比：**

| | 現有 Adapter（軟體服務） | 服務 API（用戶上傳） |
|---|---|---|
| 誰寫 | OctoDock 開發者 | 用戶 / 商家 |
| 連什麼 | 既有 App 的 API（Notion/Gmail/GitHub） | 用戶自定義的服務（記帳士/餐廳/自由工作者） |
| 存在哪 | `src/adapters/*.ts`，部署時載入 | DB 裡的服務描述，動態載入 |
| 格式 | TypeScript AppAdapter 介面 | 結構化描述（自然語言 → OctoDock 轉成標準格式） |
| 誰能呼叫 | 服務擁有者自己的 AI | 看權限：自己 / 員工 / 外部消費者的 AI |

### C2. 服務描述的資料模型

用戶不需要懂 API 或程式碼。他用自然語言描述服務，OctoDock 轉成結構化格式：

**新增 services 表：**

| 欄位 | 用途 |
|------|------|
| `id` | 服務唯一 ID |
| `ownerId` | 服務提供者（userId） |
| `name` | 服務名稱（如「王記帳士事務所」） |
| `description` | 服務描述（自然語言，OctoDock 輔助產生） |
| `category` | 服務分類（會計、餐飲、跑腿、軟體開發…） |
| `actions` | JSONB — 這個服務能做哪些事（類似 adapter 的 actionMap） |
| `pricing` | JSONB — 價格/計費方式 |
| `availability` | JSONB — 營業時間、服務範圍、即時狀態 |
| `serviceArea` | JSONB — 地理服務範圍（實體服務用） |
| `contactEndpoint` | 可選 — 外部 webhook 或 AI 客服端點（商家 AI 回應入口） |
| `permissions` | JSONB — 三層權限定義（管理員/員工/外部） |
| `status` | draft / active / suspended |
| `qualityScore` | 從事件圖譜累積的履約品質分數（模組 E） |
| `createdAt` / `updatedAt` | 時間戳 |

**新增 serviceMembers 表（員工/角色管理）：**

| 欄位 | 用途 |
|------|------|
| `serviceId` | 關聯的服務 |
| `userId` | 成員的 userId |
| `role` | owner / admin / member / external |
| `permissions` | JSONB — 這個角色能操作的 action 清單 |

### C3. 三層權限模型（記帳士事務所案例）

同一個服務 API，三種角色看到不同的 action：

**第一層 — 老闆（owner/admin）：**
- 所有客戶資料、員工績效、財務數據
- 管理權限、管理員工、管理對外開放的內容
- 完整的 CRUD

**第二層 — 員工（member）：**
- 只看到自己負責的客戶
- 可查進度、新增待辦、查帳務紀錄
- 不能看其他員工的資料、不能改權限

**第三層 — 外部消費者的 AI（external）：**
- 只看到「提供什麼服務、價格多少、現在能不能接案」
- 可發起諮詢（連到 contactEndpoint，由商家的 AI 即時回應）
- 不能看到任何內部資料

**權限檢查的時機：** 跟現有的 `disabledActions` 機制一致，在 action resolution 之後、execute 之前檢查。

### C4. 「一句話開店」— 自然語言 → 標準化 API

商家不會寫 API。OctoDock 要做的是：

1. 商家用自然語言描述：「我賣滷肉飯，一碗 50 元，營業時間 11-14 點，外送範圍宜蘭市區，下單要給地址和數量」
2. OctoDock 轉成結構化的 services 記錄：actions（下單、查詢菜單、查詢營業狀態）、pricing、availability、serviceArea
3. 商家確認 → 服務上線
4. 任何 AI 透過 OctoDock 發現這個服務 → 呼叫 → 完成交易

**OctoDock 掌握的是格式標準。** 統一或客製化呼叫與回傳的內容格式，這本身就是收費項目。

### C5. 服務發現機制

外部 AI 怎麼找到 OctoDock 上的服務？

**方式一：透過 octodock_help 擴充**
- `octodock_help()` 目前回傳已連結的 App 列表
- 擴充為也回傳「這個用戶有權限存取的外部服務」
- 外部消費者的 AI 透過自己的 MCP URL 呼叫 help，看到可用的服務

**方式二：公開的服務目錄 API**
- 新增 `/api/services/discover` 端點
- 支援分類、地區、關鍵字搜尋
- 回傳標準化的服務描述（類似 adapter 的 getSkill）

**方式三：服務目錄頁面（前端）**
- Dashboard 或獨立頁面，展示所有公開服務
- SEO 友善，讓 Google 也能索引
- 每個服務有獨立頁面，包含描述、評價、聯繫方式

### C6. 與現有架構的接合點

服務 API 不是另起爐灶，是**延伸現有的 adapter 機制**：

| 現有機制 | 怎麼延伸 |
|----------|---------|
| `AppAdapter` 介面 | 新增 `ServiceAdapter` 介面，簡化版的 AppAdapter（不需要 OAuth，不需要 refreshToken） |
| `registry.ts` 自動掃描 | 擴充為同時載入 DB 裡的 services |
| `server.ts` 的 action resolution | 除了 adapter 的 actionMap，也查 services 的 actions |
| `logger.ts` 的 logOperation | 服務呼叫也記錄到 operations，事件圖譜統一追蹤 |
| `param-guard.ts` | 服務定義自帶參數格式，param-guard 統一驗證 |
| `memory` 系統 | 消費者對服務的偏好也存入記憶 |

### C7. 需要新增的程式碼

| 項目 | 類型 | 說明 |
|------|------|------|
| `schema.ts` | 新增 | services 表 + serviceMembers 表 |
| `ServiceAdapter` 介面 | 新增 | 簡化版 AppAdapter，從 DB 動態生成 |
| `registry.ts` | 微調 | 啟動時也載入 DB 的 services |
| `server.ts` | 微調 | action resolution 擴充查詢範圍 |
| 服務管理 API | 新增 | CRUD 端點（/api/services） |
| 服務管理前端 | 新增 | Dashboard 的「我的服務」頁面 |
| 服務目錄前端 | 新增 | 公開的服務瀏覽/搜尋頁面 |
| 自然語言 → 結構化轉換 | 新增 | 「一句話開店」的轉換邏輯 |

---

## 六、模組 D：知識技能市場（長期）

### D1. 核心定位

模組 C 讓用戶對外提供「服務」。模組 D 更進一步：讓用戶對外提供**「認知」**。

**差別：** 服務需要人（或人的 AI）即時執行；認知是打包好的 know-how，別人的 AI 呼叫後自動套用，不需要原始擁有者在線。

**類比：** Fiverr 賣的是人的時間（有上限），知識技能市場賣的是人的認知模型（可無限複製）。

### D2. 兩種場景

**場景一：非同步 — 認知 Skill 出租**

用戶在 OctoDock 上累積的某個領域專業認知（透過 SOP、操作模式、偏好設定），被打包成一個可呼叫的 Skill 模組。別人的 AI 在執行同類任務時，透過這個 Skill 達到更好的完成品質。

範例：一個旅行社老闆透過 OctoDock 累積的行程規劃 know-how（哪些景點搭什麼交通、預算分配、季節考量），被打包成「旅行規劃 Skill」。其他用戶的 AI 在規劃旅行時呼叫這個 Skill，得到專業水準的建議。

**場景二：同步 — AI 諮詢服務**

用戶或用戶的 AI 跟帶有某個 Skill 的 AI 對話，等於間接獲得專業領域的諮詢服務。

範例：一個中小企業主的 AI 跟帶有「稅務規劃 Skill」的 AI 對話，得到針對他公司狀況的節稅建議。

### D3. 與模組 C 的關係

模組 D 是模組 C 的**終極形態**：

| | 模組 C（服務 API） | 模組 D（知識技能市場） |
|---|---|---|
| 賣什麼 | 服務（需要人或人的 AI 執行） | 認知模型（自動套用，不需要人在線） |
| 輸入來源 | 用戶手動描述 | 從 OctoDock 的 SOP + memory + 操作模式自動萃取 |
| 交付方式 | 執行服務 → 回傳結果 | AI 套用 Skill → 提升任務品質 |
| 可複製性 | 受限於提供者的時間和人力 | 無限複製 |

### D4. 知識打包的資料模型

**新增 skills 表：**

| 欄位 | 用途 |
|------|------|
| `id` | Skill 唯一 ID |
| `ownerId` | 知識提供者（userId） |
| `name` | Skill 名稱（如「旅行規劃專家」） |
| `domain` | 專業領域（旅遊、稅務、設計、行銷…） |
| `description` | Skill 描述 |
| `knowledgeBase` | JSONB — 打包的認知內容（SOP + 偏好 + 判斷規則） |
| `sourceMemoryIds` | 來源：從哪些 memory/SOP 萃取的 |
| `pricing` | JSONB — 按次計費 / 月費 / 免費 |
| `usageCount` | 被呼叫次數 |
| `rating` | 用戶評分 |
| `status` | draft / active / suspended |
| `visibility` | private / public / unlisted |

### D5. 知識萃取方式

不靠用戶手動打包，靠**從現有數據自動萃取**：

1. 從 `memory` 表的 `sop` 類型取得用戶的工作流程
2. 從 `memory` 表的 `preference` 類型取得用戶的判斷偏好
3. 從 `operations` 表分析用戶在特定領域的操作模式（哪些參數組合最常用、哪些替代方案最常選）
4. 組合成一個結構化的 Skill 描述
5. 用戶審查 + 編輯 → 發布

### D6. 隱私邊界

**用戶的原始資料絕不外洩。** Skill 包含的是抽象化的認知模式，不是具體的客戶名稱、金額、個人資訊。

範例：「稅務 Skill」知道「營收超過 XX 級距時建議用 YY 方案」，但不知道「王先生的公司去年營收 300 萬」。

萃取過程需要**去識別化**：移除所有 PII（姓名、email、ID），只保留結構化的判斷邏輯。

### D7. 需要新增的程式碼

| 項目 | 類型 | 說明 |
|------|------|------|
| `schema.ts` | 新增 | skills 表 |
| 知識萃取引擎 | 新增 | 從 memory + operations 自動萃取 Skill |
| 去識別化模組 | 新增 | 移除 PII，保留認知模式 |
| Skill 管理 API | 新增 | CRUD + 發布 + 定價 |
| Skill 管理前端 | 新增 | Dashboard 的「我的知識」頁面 |
| Skill 市集前端 | 新增 | 公開的 Skill 瀏覽/搜尋/購買頁面 |
| Skill 呼叫機制 | 新增 | AI 呼叫 Skill 時的注入邏輯（類似 pre-context 但注入的是外部認知） |

---

## 七、模組 E：信任層 + 供需洞察（長期）

### E1. 核心定位

OctoDock 同時擁有三樣東西時，它就不只是工具了：

1. **供給**：誰能做什麼（服務 API + 知識 Skill）
2. **需求**：誰需要什麼（用戶的操作意圖 + 搜尋紀錄）
3. **品質**：做得好不好（事件圖譜的履約紀錄）

同時擁有供給、需求、品質數據的角色，在傳統世界裡叫做**「市場」**。

### E2. 賣信任 — 履約品質追蹤

**數據來源：事件圖譜（模組 A）**

每次服務被呼叫（模組 C）或 Skill 被使用（模組 D），事件圖譜記錄：
- AI 呼叫了什麼
- 實際做了什麼
- 用戶最終有沒有得到應有的服務

**品質分數的累積方式：**

| 信號 | 正面 / 負面 | 權重 |
|------|-----------|------|
| 服務呼叫成功 | 正面 | 低（基本要求） |
| 用戶在服務呼叫後沒有 undo/重做 | 正面 | 中（代表結果令人滿意） |
| 用戶在服務呼叫後立即做修正操作 | 負面 | 中（代表結果不符預期） |
| 重複購買同一服務 | 正面 | 高（用腳投票） |
| 用戶主動評分 | 正面/負面 | 高（明確回饋） |

**跟現有平台的差別：**

蝦皮/Uber 的評分靠用戶主動打分（很多人不打）。OctoDock 的品質分數是從**行為數據自動累積**的——不需要用戶額外操作，事件圖譜本身就是信任的證據。

### E3. 賣洞察 — 供需理解

**數據來源：operations 表的 intent + 服務目錄**

OctoDock 知道：
- 每天有多少人在找某類服務（需求側）
- 有多少人提供某類服務（供給側）
- 各類服務的品質分布（品質側）

**洞察產品的可能形態：**

- **給商家：** 「你的服務在同類中排名第 X，主要差距在 Y」「最近對 Z 服務的需求增加了 30%，你要開放這個 action 嗎？」
- **給市場分析：** 匿名化後的供需趨勢報告（哪些領域供不應求、哪些已飽和）

### E4. 跟現有平台的差別

| | 蝦皮/Uber/Airbnb | OctoDock |
|---|---|---|
| 流量擁有者 | 平台 | 每個用戶的 AI（流量分散） |
| 媒合方式 | 平台演算法 | 用戶的 AI 自行判斷（基於 OctoDock 的結構化資訊） |
| 商家依賴 | 依賴平台流量 | 依賴格式標準（OctoDock 定義，但資料是商家的） |
| 信任來源 | 用戶主動評分 | 行為數據自動累積 |
| 數據性質 | 爬來的雜亂網頁 / 用戶填的表單 | 結構化 + 雙向驗證（不只商家說自己好，有履約紀錄） |

**OctoDock 更像 DNS 之於網際網路。** DNS 不擁有任何網站，但沒有 DNS 你就找不到任何網站。OctoDock 是 **AI 時代的服務 DNS**。

### E5. 需要新增的程式碼

| 項目 | 類型 | 說明 |
|------|------|------|
| 品質分數計算引擎 | 新增 | 從事件圖譜累積 qualityScore |
| 供需分析引擎 | 新增 | 從 operations.intent + services 分析供需 |
| 商家洞察 API | 新增 | 給商家看自己的品質排名和需求趨勢 |
| 商家洞察前端 | 新增 | Dashboard 的「我的服務表現」頁面 |

---

## 八、五個模組的完整互動關係

```
短期（現在）
┌─────────────────────────────────────────────┐
│  工具連接層                                    │
│  adapters + registry + middleware pipeline    │
│  operations 表 + memory 表                    │
└──────────────────┬──────────────────────────┘
                   │ 延伸
中期               ▼
┌──────────────────────────────────────────────┐
│  A. 事件圖譜                B. 上下文接續       │
│  operations 因果欄位                pre-context 強化   │
│  operations 加 parentOperationId       換手偵測            │
│  用戶可見的操作歷史           異常偵測            │
│                                               │
│  A 提供數據 ──→ B 用數據補上下文                 │
└──────────────────┬───────────────────────────┘
                   │ 延伸
長期               ▼
┌──────────────────────────────────────────────┐
│  C. 服務 API         D. 知識技能市場            │
│  services 表          skills 表                │
│  ServiceAdapter       知識萃取引擎              │
│  三層權限              去識別化                  │
│  自然語言→標準 API     Skill 市集                │
│  服務目錄                                      │
│                                               │
│  C 的終極形態 ──→ D                             │
│                                               │
│  E. 信任層 + 供需洞察                           │
│  品質分數（A 的數據 + C/D 的服務）                │
│  供需分析（operations.intent + services）        │
│  OctoDock = AI 時代的服務 DNS                   │
└──────────────────────────────────────────────┘
```

### 各模組間的價值流動

| 從 | 到 | 提供什麼 |
|----|-----|---------|
| A（事件圖譜） | B（上下文接續） | 近期操作的結構化歷史，讓 B 能精準補上下文 |
| A（事件圖譜） | E（信任層） | 每次服務呼叫的履約紀錄，累積品質分數 |
| B（上下文接續） | C（服務 API） | 消費者 AI 第一次用某服務時，補充過去的偏好 |
| C（服務 API） | D（知識市場） | 服務機制的基礎架構（ServiceAdapter、權限、目錄） |
| C（服務 API） | E（信任層） | 服務的供給側數據 |
| D（知識市場） | E（信任層） | Skill 的使用和評價數據 |
| E（信任層） | C/D | 品質分數和供需洞察回饋給商家，形成正循環 |

---

## 九、設計原則（貫穿所有模組、所有階段）

1. **延伸不重建**：現有的 operations 表、middleware pipeline、adapter 機制都繼續用，在上面加層，不推倒重來

2. **用戶不用懂技術**：服務描述用自然語言，操作歷史用人話，知識打包自動萃取。用戶面對的永遠是「一句話」，不是 JSON

3. **程式碼能解決的不靠規則**：session 邊界、因果關係、換手偵測、品質分數都用確定性規則，不靠 AI 猜測

4. **非同步不阻塞**：事件圖譜寫入、session 摘要產生、品質分數計算，都不阻塞主請求

5. **隱私分層**：三層權限是硬邊界，不是建議。外部 AI 絕對看不到內部資料。知識 Skill 去識別化，不外洩原始數據

6. **一個 API 三種角色**：不是三套系統，是同一套系統的三個視角（管理/員工/外部）

7. **信任靠行為不靠聲明**：品質分數從事件圖譜自動累積，不靠商家自評或用戶主動打分

---

## 十、待聖堯確認的問題

1. **事件圖譜的可見度**：操作歷史頁面要多細？只看 session 摘要就好，還是要能展開看每一步的 params/result？

2. **上下文接續的主動程度**：AI 換手時，OctoDock 是每次都補上下文（可能有點囉嗦），還是只在偵測到異常時才補？

3. **服務 API 的 contactEndpoint**：商家的 AI 客服端點，是 OctoDock 代管（OctoDock 幫商家跑一個 AI），還是商家自己提供 webhook？

4. **知識技能的定價模型**：按次計費、月費、還是抽成？誰定價——Skill 擁有者自定，還是 OctoDock 有建議定價？

5. **供需洞察的開放程度**：匿名化趨勢數據是免費公開（引流），還是付費產品？

6. **金流結算**：AI 代替用戶付款的機制，是對接現有金流（信用卡/Paddle），還是需要新機制（例如 OctoDock 錢包預儲值）？

7. **冷啟動策略**：服務目錄一開始沒有商家願意上怎麼辦？先從 OctoDock 現有用戶的「個人技能開放」開始，還是主動邀請特定產業的商家？

---

## 十一、完整演化路徑（三階段）

```
短期（現在）
  OctoDock = AI 的工具連接層
  連接既有 App 的 API
  ✅ 已完成

中期
  OctoDock = AI 的記憶與上下文層
  事件圖譜 + 上下文接續 + SOP 強化 + 企業內部管理工具
  模組 A + B

長期
  OctoDock = AI 時代的服務基礎設施
  任何人都能註冊服務，任何 AI 都能發現和呼叫
  品質可追蹤，一個 API 三層角色
  模組 C + D + E
```

---

## 十二、這份文件不包含的（留到確認後再展開）

- 具體的 DB migration SQL
- API 端點的 request/response 格式
- 前端元件的設計稿
- 金流結算的技術實作
- 各模組的實作優先序（由聖堯決定）
