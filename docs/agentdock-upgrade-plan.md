# OctoDock 架構升級計畫書

> 根據 2026-03-11~15 產品討論結論，對照現有程式碼產出的修改計畫
> 制定日期：2026-03-14｜更新：2026-03-15

---

## 已完成進度

| Phase | 內容 | 狀態 |
|-------|------|------|
| Phase 1 | MCP do + help 雙工具架構 | ✅ 完成 |
| Phase 2 | 記憶層強化（MD 渲染、pattern analyzer） | ✅ 完成 |
| Phase 3 | 全部 6 個 Adapter 升級 do + help | ✅ 完成 |
| Phase 4 | SOP 系統 CRUD | ✅ 完成 |
| Phase 5 | 排程引擎 + 內部 AI 框架 | ✅ 完成 |
| Phase 6 | 訂閱系統 + Paddle/ECPay webhook | ✅ 完成 |
| 品牌重塑 | AgentDock → OctoDock | ✅ 完成 |
| Adapter 品質框架 | formatResponse + CRUD 閉環 + I/O 對稱 | ✅ 完成 |
| 開源準備 | README + Dockerfile + docker-compose + BSL 授權 | ✅ 完成 |

---

## Phase 7：Bug 修復 + 功能強化（2026-03-15 新增）

> 來源：Notion「Adapter 優化路線圖」第八～十節 + Claude AI 測試報告 + 競品分析

### 7.1 名稱自動解析 Bug 修復 🔴

**問題**：v2 測試報告指出 `create_page(folder: "待辦")` 和 `get_page(page: "頁面名稱")` 報錯，只能接受 UUID。`resolveIdentifier` 寫好了但沒正確觸發。

**修復**：
- 檢查 `translateSimplifiedParams` 的欄位掃描邏輯
- 確認 `page`、`folder`、`database` 這些 alias 有被正確匹配
- 當記憶裡找不到時，自動 fallback 到 Notion search

### 7.2 get_comments Bug 修復 🔴

**問題**：`add_comment` 成功但 `get_comments` 報錯。可能是 Notion integration 權限或 endpoint 問題。

**修復**：
- 確認 integration capabilities 包含 read_comments
- 確認 endpoint 是 `GET /v1/comments?block_id=xxx`

### 7.3 help 分層查詢（B2）🟡

**目標**：`octodock_help(app, action)` 回傳特定 action 的完整參數 schema + 使用範例

**現狀**：help 只支援 app 級別，AI 遇到複雜參數只能猜

**實作**：
- `octodock_help` 新增 `action` 參數
- 每個 adapter 的 `getSkill()` 改為接受可選的 action 參數
- 回傳該 action 的完整參數說明 + 一個範例

### 7.4 智慧錯誤引導（B3）🟡

**目標**：adapter 層攔截常見 API 錯誤，回傳有用的提示而非原始錯誤

**實作**：
- AppAdapter 介面新增可選方法 `formatError(action, error)`
- 在 `octodock_do` 的錯誤處理中呼叫
- 各 adapter 定義常見錯誤的對應提示

### 7.5 system.note 輕量筆記（B4）🟢

**目標**：`octodock_do(app: "system", action: "note", params: {text: "..."})` 快速留筆記

**實作**：本質上就是 `memory_store` 的簡化版，category 固定為 "note"

---

## Phase 8：SOP 自動辨識（第八、九節）

> OctoDock 相對 Composio 的獨有優勢 — 記憶驅動的 SOP 三層模型

### 8.1 操作序列記錄

**目標**：按 session 分組記錄操作序列

**實作**：
- 在 operations 表上做 session 分組（同一個 MCP 請求鏈 = 一個 session）
- 提取 `app.action` 序列

### 8.2 規則引擎偵測重複模式

**目標**：用 LCS（最長共同子序列）比對找出重複的操作流程

**實作**：
- `src/services/sop-detector.ts` — 序列比對引擎
- 同一用戶的操作序列出現 3 次以上 → 標記為候選 SOP
- 純程式碼邏輯，不需要 AI

### 8.3 在回傳中塞 suggestions

**目標**：偵測到候選 SOP 時，在 `octodock_do` 的回傳裡加入 suggestions

**回傳格式**：
```json
{
  "ok": true,
  "data": "...正常結果...",
  "suggestions": [{
    "type": "sop_candidate",
    "message": "你已經第 3 次執行『查 Notion 待辦 → 改逾期 → LINE 通知』，要存成快捷指令嗎？",
    "pattern": ["notion.query_database", "notion.update_page", "line.send_message"]
  }]
}
```

正在連接的 AI（Claude/ChatGPT）看到 suggestions 會自然地問用戶確認。AgentDock 負責觀察，AI 負責溝通。

---

## Phase 9：跨 App Demo + 推廣準備

### 9.1 跨 App Demo 流程（B1）

**目標**：設計殺手場景展示 OctoDock 的跨 App + 共享記憶優勢

**Demo 流程**：
1. `octodock_do(notion, query_database, {database: "待辦"})` — 查詢逾期任務
2. `octodock_do(gmail, send, {to: "boss@...", subject: "逾期任務提醒", body: "..."})` — 寄提醒
3. `octodock_do(line, send_message, {user_id: "...", message: "已寄出提醒"})` — LINE 通知自己

一句話觸發：「幫我檢查 Notion 有沒有逾期任務，有的話寄信給老闆，然後 LINE 通知我」

### 9.2 60 秒影片腳本

**Before**（直接接 5 個 MCP）：65 個工具、50,000 tokens、每個 App 分開設定
**After**（接 OctoDock 一個 URL）：2 個工具、300 tokens、一句話跨 App 操作

---

## 優先序

```
Phase 7（Bug 修復 + 強化）  ← 最急，影響用戶體驗
  ├── 7.1 名稱自動解析 bug  🔴
  ├── 7.2 get_comments bug  🔴
  ├── 7.3 help 分層查詢     🟡
  ├── 7.4 智慧錯誤引導       🟡
  └── 7.5 system.note       🟢

Phase 8（SOP 自動辨識）  ← OctoDock 獨有優勢
  ├── 8.1 操作序列記錄
  ├── 8.2 規則引擎偵測重複
  └── 8.3 suggestions 回傳

Phase 9（跨 App Demo）  ← 推廣用
  ├── 9.1 跨 App demo 流程
  └── 9.2 影片腳本
```
