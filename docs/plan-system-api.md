# 規劃文件：G 組 System API — AI 操作輔助層

## 1. 目標

實作 5 個 system action（G8, G5, G6, G1, G7），讓 AI 操作更順、更準、更省 token。

## 2. 影響範圍

### 修改的現有檔案

| 檔案 | 改動 | 任務 |
|------|------|------|
| `src/mcp/system-actions.ts` | 新增 5 個 case + systemActionMap 登錄 | G1, G5, G6, G7, G8 |
| `src/mcp/server.ts` | G8: error response 嵌入 hint 欄位 | G8 |

### 新建的檔案

| 檔案 | 用途 | 任務 |
|------|------|------|
| `src/mcp/error-hints.ts` | error code → 說明 + 建議修法 mapping table | G8 |

## 3. 執行步驟（按優先順序）

| 步驟 | 任務 | 依賴 |
|------|------|------|
| 1 | G8: error hints 嵌入 error response | 無 |
| 2 | G5: resolve_name（名稱→ID 解析） | 無 |
| 3 | G6: param_suggest（參數建議） | 無 |
| 4 | G1: batch_do（批次執行） | 無 |
| 5 | G7: multi_search（跨 App 搜尋） | 無 |

全部互相獨立，可並行。

## 4. 各任務設計

### G8: explain_error
- 新建 `error-hints.ts`，維護 error code → hint mapping
- 通用 mapping：401→token 說明、403→權限說明、429→rate limit 說明
- Per-app mapping：notion 403→share 給 integration、gmail 403→scope 不足
- 在 server.ts 的 error response 流程中，從 hint table 取 hint 附在 result 上

### G5: resolve_name
- 接收 `{ name, app?, type? }`
- 先查 memory（resolveIdentifier）
- 沒有 → 打 app 的 search API
- 找到 → 自動 learnIdentifier
- 多個候選 → 回傳列表讓 AI 選

### G6: param_suggest
- 接收 `{ app, action }`
- 從 memory 查 pattern（default_parent、frequent_actions 等）
- 從 operations 表查最近成功的同 action params
- 回傳建議參數

### G1: batch_do
- 接收 `{ actions: [{app, action, params}], mode: "sequential"|"parallel", on_error: "abort"|"continue" }`
- sequential：依序執行，abort 模式遇到失敗就停
- parallel：Promise.all 並行
- 回傳 result array

### G7: multi_search
- 接收 `{ query, apps?: string[] }`
- 並行打多個 App 的 search action
- 統一格式：`{ app, type, title, url, snippet, updated_at }`
- 預設搜全部已連結的 App

## 5. 風險
- G1 batch_do 需要防止遞迴（batch 裡不能包含 batch）
- G7 multi_search 需要 timeout 避免某個 App 太慢拖累全部
