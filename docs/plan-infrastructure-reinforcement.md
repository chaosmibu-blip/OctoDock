# 規劃文件：OctoDock 基礎設施補強與 AI 決策輔助

**狀態：✅ 已完成（2026-03-18）**

## 1. 目標

根據 2026-03-18 交辦事項，實作 A 組（事實記錄欄位）、B 組（基礎設施補強）、C 組（AI 決策輔助層）、E 組（AI 決策輔助進階）共 20 個子任務。

## 2. 影響範圍

### 需要修改的現有檔案

| 檔案 | 改動內容 | 相關任務 |
|------|---------|---------|
| `src/db/schema.ts` | operations 表新增 `agent_instance_id`、`record_hash` 欄位 | A1, A3 |
| `src/mcp/middleware/logger.ts` | 改造 catch block 用 classifyError；result 改存摘要；接入 circuit breaker、pre-context、post-check | A2, B1, B4, C1, C2 |
| `src/mcp/server.ts` | 接入 rate limit；接入 pre-context/post-check 結果到 DoResult；dryRun 檢查；E 組的 nextSuggestion/recoveryHint/relatedAcrossApps | B3, C5, C6, E1, E2, E4 |
| `src/services/token-manager.ts` | 加 per-user-per-app refresh lock | B2 |
| `src/lib/rate-limit.ts` | 新增 `checkMcpRateLimit` 函式（sliding window + per-action 高風險限制），保留現有 `checkRateLimit` 不動（HTTP 層在用） | B3 |
| `src/app/mcp/[apiKey]/route.ts` | 傳遞 request headers 到 createServerForUser，供 A1 提取 agent instance id | A1 |
| `src/adapters/types.ts` | DoResult 新增 `summary`、`warnings`、`nextSuggestion`、`recoveryHint` optional 欄位；AppAdapter 新增 `extractSummary` optional 方法 | C5, E1, E2 |

### 需要新建的檔案

| 檔案 | 用途 | 相關任務 |
|------|------|---------|
| `src/db/migrations/003_operations_fields.sql` | A1+A3 的 DB migration | A1, A3 |
| `src/mcp/error-types.ts` | OctoDockError 介面 + classifyError() | B1 |
| `src/mcp/middleware/circuit-breaker.ts` | Per-app circuit breaker 狀態機 | B4 |
| `src/app/api/health/route.ts` | 健康檢查 endpoint | B5 |
| `src/mcp/middleware/pre-context.ts` | 操作前自動查目標現狀 + 命名慣例推斷 | C1, C4 |
| `src/mcp/middleware/post-check.ts` | 操作後歷史基線比對 + 修正 pattern 偵測 | C2, C3 |
| `src/mcp/middleware/action-chain.ts` | 操作鏈馬可夫建議 + 失敗修復建議 + 跨 App 關聯 | E1, E2, E4 |

## 3. 執行步驟

### Phase A：事實記錄欄位（migration 級小改動）

| 步驟 | 任務 | 依賴 | 改動檔案 |
|------|------|------|---------|
| 1 | A1: operations 表新增 `agent_instance_id` | 無 | schema.ts, migration SQL, route.ts, server.ts, logger.ts |
| 2 | A2: logger.ts 的 result 改存摘要（格式：`{ ok, title?, url?, error? }`） | 無 | logger.ts |
| 3 | A3: operations 表新增 `record_hash` | 可與 A1 合併 migration | schema.ts, migration SQL |

A1 + A3 共用同一個 migration 檔。A2 與 A1/A3 可並行。
A1 需要把 request headers 從 route.ts → createServerForUser() → registerDoTool() → executeWithMiddleware() 一路傳遞，才能提取 User-Agent / X-Agent-Id。

### Phase B：基礎設施補強（按依賴順序）

| 步驟 | 任務 | 依賴 | 改動檔案 |
|------|------|------|---------|
| 4 | B1: 統一錯誤處理 | 無 | 新建 error-types.ts, 改 logger.ts, 改 server.ts |
| 5 | B2: Token refresh lock | 無（可與 B1 並行） | token-manager.ts |
| 6 | B3: Rate limit 升級 | B1（需要 OctoDockError） | rate-limit.ts, server.ts |
| 7 | B4: Circuit breaker | B1（需要 OctoDockError） | 新建 circuit-breaker.ts, 改 logger.ts |
| 8 | B5: 健康檢查 endpoint | B4（需要 breaker 狀態） | 新建 health/route.ts |

### Phase C：AI 決策輔助層

| 步驟 | 任務 | 依賴 | 改動檔案 |
|------|------|------|---------|
| 9 | C1+C4: Pre-context middleware | B 組完成 | 新建 pre-context.ts, 改 logger.ts/server.ts |
| 10 | C2+C3: Post-check middleware | B 組完成 | 新建 post-check.ts, 改 logger.ts/server.ts |
| 11 | C5: extractSummary | C1 完成 | types.ts, server.ts |
| 12 | C6: Dry-run 模式 | C1 完成（共用查詢邏輯） | server.ts |

### Phase E：AI 決策輔助進階

| 步驟 | 任務 | 依賴 | 改動檔案 |
|------|------|------|---------|
| 13 | E1: 操作鏈自動補全 | C 組完成 | 新建 action-chain.ts, 改 server.ts, types.ts |
| 14 | E2: 失敗修復建議 | B1+E1（共用檔案） | action-chain.ts, server.ts |
| 15 | E3: Action 推薦引擎 | E1 完成 | server.ts（registerHelpTool） |
| 16 | E4: 跨 App 上下文連結 | E1 完成 | action-chain.ts, server.ts |

## 4. 驗證方式

- 每個步驟完成後 `npm run build` 確認 TypeScript 編譯通過
- A1/A3: 在正式 DB 執行 migration SQL 確認欄位新增成功
- B1: 故意觸發不同類型錯誤，確認回傳結構化 OctoDockError
- B2: 模擬兩個並發 refresh 請求，確認只觸發一次
- B3: 確認超過限制時回傳 RATE_LIMITED 錯誤
- B4: 模擬連續失敗，確認 circuit 正確開閉
- B5: `curl /api/health` 確認回傳正確格式
- C/E 組: build 通過 + 手動測試 MCP 操作確認 response 帶有新欄位

## 5. 風險

- **DB migration**：A1/A3 都是新增 nullable 欄位，不影響現有資料，無破壞性
- **DoResult 新欄位**：全部 optional，不改現有欄位，向後相容
- **Rate limit**：已確認 `checkRateLimit` 被 route.ts 使用（HTTP 層）。B3 新增獨立的 `checkMcpRateLimit` 函式，不動現有函式
- **Logger.ts 改動最多**：B1+B4+C1+C2 都要改這個檔案，需注意 try-catch 範圍不被打斷
- **依賴循環**：新 middleware 只被 logger.ts/server.ts 呼叫，不互相 import

## 6. 工程守則（來自交辦 D 組）

- 所有閾值用檔案頂部常數或環境變數，不硬寫在 if 裡
- 依賴方向：server.ts → logger.ts → token-manager/circuit-breaker/error-types
- pre-context/post-check 不直接 import adapter，透過參數傳入
- 新 middleware 的 catch 裡至少 `console.error`，不用空 catch
- 每個任務分開 commit，commit message 帶任務編號
