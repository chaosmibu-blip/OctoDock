# AgentDock 架構升級計畫書

> 根據 2026-03-11~13 產品討論結論，對照現有程式碼產出的修改計畫
> 制定日期：2026-03-14

---

## 現狀概述

AgentDock 已完成原始架構藍圖的施工，包含：
- Adapter Registry 自動掃描機制
- Notion adapter（18 個 MCP 工具）
- OAuth 連線流程（授權 → 回調 → 加密存儲）
- MCP Server（Streamable HTTP，stateless transport）
- Dashboard（連結/斷開 App、查看工具列表）
- 記憶層基礎（memory_query / memory_store）
- 操作記錄（operations 表）

**核心問題**：現有架構是「每個 App 暴露多個工具」的模式（Notion 就有 18 個），與討論結論的「do + help 雙工具」模式有根本差異。

---

## 修改計畫

### Phase 1：MCP 工具架構重構（核心）

#### 1.1 新增 do + help 雙工具

**目標**：MCP server 只暴露 `agentdock_do` 和 `agentdock_help` 兩個工具（~300 tokens）

**修改檔案**：
- `src/mcp/server.ts` — 重寫 `createServerForUser`，移除逐個註冊 adapter 工具的邏輯，改為只註冊 `agentdock_do` 和 `agentdock_help`

**agentdock_do 規格**：
```typescript
agentdock_do({
  app: string,        // "notion" | "gmail" | "line" | ...
  action: string,     // "create_page" | "search" | "send" | ...
  params: object      // 簡化參數，AgentDock 內部轉換成 API 格式
})

// 回傳格式
{ ok: true, url?: string, data?: any, title?: string }
{ ok: false, error: string, suggestions?: string[] }
```

**agentdock_help 規格**：
```typescript
agentdock_help({
  app?: string        // 省略 → 列出所有已連 App + SOP；指定 → 回傳該 App 的 skill
})
```

#### 1.2 建立 Skill 定義

**目標**：為每個 App 建立精簡的操作說明（100-200 tokens），`help` 被呼叫時回傳

**新增檔案**：
- `src/mcp/skills/notion.ts`
- `src/mcp/skills/gmail.ts`（待 adapter 完成）
- `src/mcp/skills/index.ts` — skill registry

**Skill 範例（Notion）**：
```
notion 可用 action：
  search(query) — 搜尋頁面和資料庫
  create_page(title, content, folder?) — 建立頁面
  update_page(page, content) — 更新頁面內容
  get_page(page) — 取得頁面內容
  delete_page(page) — 刪除頁面
  query_database(database, filter?) — 查詢資料庫
  create_database_item(database, properties) — 新增資料庫項目
  create_comment(page, content) — 新增評論
  get_users() — 列出工作區成員
```

#### 1.3 參數格式轉換層

**目標**：AI 傳簡化參數，AgentDock 內部轉換成各 App API 的原始格式

**修改檔案**：
- `src/adapters/notion.ts` — 新增 `translateParams(action, simplifiedParams)` 方法
- `src/adapters/types.ts` — `AppAdapter` 介面新增 `translateParams` 和 `getSkill` 方法

**轉換範例**：
```typescript
// AI 傳入
{ action: "create_page", params: { title: "會議紀錄", folder: "會議", content: "..." } }

// AgentDock 內部轉換
// 1. 查記憶：「會議」→ parent_id: "317a9617..."
// 2. 轉換成 Notion API 格式：parent、properties、children blocks
```

#### 1.4 記憶輔助解析

**目標**：`do` 收到簡化參數（名字、代稱）時，查記憶表對應到實際 ID

**修改檔案**：
- `src/services/memory-engine.ts` — 新增 `resolveIdentifier(userId, name, app)` 方法
- `src/mcp/server.ts` — 在 `agentdock_do` 執行前呼叫 resolve

---

### Phase 2：記憶層強化

#### 2.1 MD 格式渲染器

**目標**：`memory_query` 回傳渲染好的 MD 格式，不是原始 JSON

**修改檔案**：
- `src/services/memory-engine.ts` — 新增 `renderToMarkdown(memories)` 方法

**回傳範例**：
```markdown
## 用戶記憶摘要

### 偏好
- Notion 筆記結構：H2 分大段、bullet points、中英混用
- 郵件回覆：簡短直接、署名用英文名

### 行為模式
- 每週五下午從 Notion 整理週報
```

#### 2.2 自然語言寫入

**目標**：`memory_store` 接收自然語言，後端 AI 解析為結構化資料

**修改檔案**：
- `src/services/memory-engine.ts` — 新增 `parseNaturalLanguage(text)` 方法
- 使用 Haiku 解析 category / key / value / confidence

**暫緩**：此項需要 Anthropic API key，可在 Phase 3 內部 AI 一起處理

#### 2.3 操作自動記錄強化

**目標**：所有 `do` 和 `help` 操作自動提煉跨對話記憶

**修改檔案**：
- `src/mcp/middleware/logger.ts` — 除了記 operations 表，還要分析是否有可提煉的記憶（常用 folder、常用操作模式）

---

### Phase 3：Adapter 擴充

#### 3.1 Google 全家桶

**目標**：一次 OAuth，scope 累加，吃 Gmail + Calendar + Drive

**新增檔案**：
- `src/adapters/google/gmail.ts`
- `src/adapters/google/calendar.ts`
- `src/adapters/google/drive.ts`
- `src/adapters/google/index.ts` — 共用 OAuth 邏輯

**注意**：Google 系列 API 全部免費無限量，只有速率限制

#### 3.2 LINE Adapter

**目標**：Messaging API + LINE Login 整合

**新增檔案**：
- `src/adapters/line.ts`

**Auth type**：bot_token（Channel Access Token）

**核心 action**：
- reply_message / push_message / broadcast
- get_profile / get_content
- set_rich_menu / get_quota

**差異化價值**：Composio 不支援 LINE，這是 AgentDock 在亞洲市場的關鍵差異化

#### 3.3 GitHub Adapter

**新增檔案**：
- `src/adapters/github.ts`

**核心 action**：讀 repo、管 issue、PR

---

### Phase 4：SOP 系統

#### 4.1 SOP 存儲

**目標**：SOP 存為 memory 表 `category='sop'`

**修改檔案**：
- `src/services/memory-engine.ts` — SOP 專用的存取方法

#### 4.2 SOP 透過 help 取得

`agentdock_help()` 不帶參數時，除了列出已連 App，也列出可用 SOP

---

### Phase 5：排程引擎

#### 5.1 排程器基礎

**新增檔案**：
- `src/services/scheduler.ts` — cron-based 排程引擎
- `src/db/schema.ts` — 新增 `schedules` 表

**分層處理**：
- 簡單排程 → 規則引擎直接執行（零成本）
- 需要理解的排程 → 呼叫內部 Haiku

#### 5.2 內部 AI

**新增檔案**：
- `src/services/internal-ai.ts` — Haiku 呼叫封裝

**成本**：~$0.001-0.005/次

---

### Phase 6：收款與 iOS App

#### 6.1 Paddle 串接

**目標**：網站訂閱收款

#### 6.2 iOS App

**目標**：設定介面 + IAP 訂閱（RevenueCat）
- 管理已連接的 App
- 調整設定、記憶管理、SOP 編輯
- 查看操作記錄
- 訂閱管理

---

## 優先序與里程碑

```
Phase 1（核心重構）  ← 最高優先，改完才算是討論結論的實現
  ├── 1.1 do + help 雙工具
  ├── 1.2 Skill 定義
  ├── 1.3 參數格式轉換
  └── 1.4 記憶輔助解析

Phase 2（記憶強化）
  ├── 2.1 MD 渲染器
  └── 2.3 操作自動記錄

Phase 3（Adapter 擴充）
  ├── 3.1 Google 全家桶  ← 一次 OAuth 吃三個，CP 值最高
  ├── 3.2 LINE          ← 差異化關鍵
  └── 3.3 GitHub

Phase 4（SOP）
Phase 5（排程引擎 + 內部 AI）
Phase 6（收款 + iOS App）
```

---

## 風險與注意事項

1. **Phase 1 是破壞性變更** — 從多工具改為雙工具，所有現有 MCP 連線方式都會改變。建議保留舊路由一段時間做相容。

2. **Skill 精簡度** — Skill 必須控制在 100-200 tokens，太多參數說明會失去「省 token」的優勢。

3. **記憶輔助解析的準確度** — 「會議」→ parent_id 的對應需要足夠的記憶累積。初期可能需要 fallback 機制（找不到時回傳 suggestions 讓 AI 反問用戶）。

4. **不串 Composio 的代價** — 自己串每個 App 的工作量較大，但保有核心控制權。MVP 先專注 4 個 App（Notion、Google、LINE、GitHub）。

5. **Phase 2.2（自然語言寫入）需要 API key** — 依賴 Anthropic API，會產生成本。可以先用規則引擎做簡單解析，Phase 5 內部 AI 再統一處理。
