# 結構性修復規劃：讓系統不可能靜默地壞掉

> 日期：2026-03-25
> 狀態：**規劃中（等待確認後執行）**
> 來源：Production DB 資料完整性稽核發現的系統性問題

---

## 問題本質

不是「某個欄位漏了」，是「系統沒有自我驗證的能力」。寫了欄位不知道有沒有值，寫了程式碼不知道對不對，上了線不知道有沒有壞。全部靠人記得去查，人沒查就不知道。

三個結構性解法，解決的是同一個問題的三個面向：

| 解法 | 解決什麼 | 核心思路 |
|------|---------|---------|
| 一、單一出口模式 | 「忘記記錄」不可能發生 | 所有路徑收束到一個出口，出口負責記錄 |
| 二、Schema-Code 契約檢查 | 「schema 有欄位但沒程式碼寫入」被自動攔住 | 自動掃描 schema，確認每個欄位有對應的寫入程式碼 |
| 三、Health Check | 「壞了但不知道」被自動發現 | 自動檢查所有表的資料完整性 |

依賴順序：一 → 二 → 三

---

## 解法一：單一出口模式

### 現狀

server.ts 的 octodock_do 有 ~12 個 return 點，octodock_help 有 ~11 個 return 點。每個 return 自己決定要不要呼叫 logOperation、帶哪些欄位。

結果：
- octodock_help 的 11 條回傳路徑完全沒呼叫 logOperation
- octodock_do 的 9 條提前返回路徑缺 agentInstanceId
- dry-run 路徑沒有任何記錄

### 資料流定義

輸入欄位（每次 MCP 請求都有的）：
- userId — 從 auth 取得
- app — 從參數取得
- action — 從參數取得
- params — 從參數取得
- intent — 從參數取得（octodock_do）
- difficulty — 從參數取得（octodock_help）
- agentInstanceId — 從 HTTP header 取得
- startTime — 請求進入時記錄

輸出欄位（每條路徑執行後產生的）：
- result — 執行結果
- success — 成功/失敗
- toolName — 對應的工具名稱
- durationMs — 耗時

所有輸入 + 輸出，不管走哪條路徑，最終都要寫進 operations 表。

### 設計

把 octodock_do 和 octodock_help 的邏輯改為：

1. 在 handler 最外層宣告 result 變數
2. 內部所有邏輯把結果賦值給 result（不直接 return）
3. 最後統一經過一個出口函式，負責：
   - 呼叫 logOperation，帶入所有可用欄位
   - 回傳 MCP 格式的 response

### 與 executeWithMiddleware 的整合

executeWithMiddleware 內部已經有 logOperation。不能重複記錄。

方案：executeWithMiddleware 成功時，它自己記錄（因為它有最完整的 result 資訊）。出口函式檢查「這條路徑是不是已經被 executeWithMiddleware 記錄過了」，如果是就跳過，不是就記錄。

用一個旗標 `alreadyLogged` 即可，由 executeWithMiddleware 設定。

### 受影響的檔案

| 檔案 | 改動 |
|------|------|
| server.ts | registerDoTool：所有 return 改為賦值 + 最後統一出口 |
| server.ts | registerHelpTool：同上 |
| logger.ts | executeWithMiddleware：設定 alreadyLogged 旗標 |

### 驗證方式

改完後，用 production DB 的 Neon 連線查詢：
- 呼叫 octodock_help → 確認 operations 有記錄
- 觸發一個 unknown action → 確認 agentInstanceId 有值
- 做一次 dry-run → 確認有記錄

---

## 解法二：Schema-Code 契約檢查

### 現狀

schema.ts 定義了欄位，但沒有機制確認程式碼有實際寫入。app_user_id、app_user_name、embedding 全空了幾個月沒人發現。

### 設計

一個檢查腳本，做兩件事：

**靜態檢查（build 時）：**
- 讀取 schema.ts 的所有表和欄位
- 排除有 default 值的欄位（createdAt、id 等不需要手動寫入的）
- 對每個需要手動寫入的欄位，grep 程式碼裡有沒有對應的寫入
- 沒有的報警

**動態檢查（連 DB）：**
- 對每個表，查每個欄位的填充率
- 跟預期閾值比對（例如 operations.intent 應該 > 80%）
- 低於閾值的報警

### 觸發時機

- 靜態檢查：npm run build 之後自動跑
- 動態檢查：手動執行，或整合到 health check

### 受影響的檔案

| 檔案 | 改動 |
|------|------|
| 新增 `scripts/check-schema-coverage.ts` | 靜態檢查腳本 |
| 新增 `scripts/check-data-integrity.ts` | 動態檢查腳本 |
| package.json | 新增 script 指令 |

---

## 解法三：Health Check 端點

### 現狀

沒有任何自動化的健康檢查。今天手動 query 才發現問題。

### 設計

新增 API 端點 `/api/health/data`，回傳結構化的資料完整性報告：

- 每個表的行數
- 每個關鍵欄位的填充率
- 異常標記（填充率低於閾值）
- 最近一次操作的時間（判斷系統是否還活著）

### 安全性

這個端點不能公開。需要 admin 權限或特定的 API key 才能存取。

### 擴展

可以整合到 Claude Code 的 /loop，定期跑一次。異常時通知。

### 受影響的檔案

| 檔案 | 改動 |
|------|------|
| 新增 `src/app/api/health/data/route.ts` | Health check API |

---

## 額外需修復的資料問題

以上三個解法是防止未來再發生的結構。但現有的已壞的資料也需要修：

| 問題 | 修法 |
|------|------|
| embedding 全空（0/143） | 查 memory-engine.ts 為什麼沒有產生向量，修好後對既有 143 筆補跑 embedding |
| app_user_id 全空（0/51） | 在 OAuth callback 流程加入取得用戶資訊的邏輯，既有的 51 筆需要用 token 重新查一次 |
| intent 6.4%（歷史資料） | 歷史資料無法回補，但解法一上線後新的操作都會有 |
| accounts.refresh_token 全空 | 確認 NextAuth 的 OAuth 設定有沒有要求 offline access |

---

## 執行順序

1. 解法一（單一出口）— 最優先，這是讓資料流不再斷裂的基礎
2. 修復 embedding + app_user_id — 解決現有的空欄位
3. 解法二（契約檢查）— 防止未來再出現 schema-code 不對齊
4. 解法三（health check）— 讓異常自動浮現
