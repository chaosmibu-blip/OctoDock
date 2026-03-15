---
name: Adapter 品質檢查清單
description: 開發或審查 App Adapter 時自動檢查的品質基準線
---

# Adapter 品質檢查清單

開發新的 App Adapter 或修改現有 Adapter 時，**必須**通過以下檢查。
這些規則來自 Notion adapter 實戰踩坑的經驗，是所有 adapter 的通用基準線。

## G1：回傳格式 — 不准丟 raw JSON 給 AI

**規則**：所有 read 類 action 必須實作 `formatResponse()`，把 API raw JSON 轉成 AI 友善格式。

**為什麼**：
- API raw JSON 體積是精簡格式的 5-10 倍（浪費 tokens）
- AI 要額外推理能力去解析巢狀 JSON，而不是理解內容
- 跨 App 操作時 context window 更容易爆掉

**怎麼做**：
1. 在 adapter export 加上 `formatResponse(action, rawData)` 方法
2. 對每個 read 類 action，轉成最適合的格式：
   - Notion → Markdown
   - Gmail → 純文字信件（From/To/Subject/Body）
   - Calendar → 簡化事件列表
   - LINE → 純文字對話記錄
3. server.ts 會自動呼叫，不需要改核心系統

**自檢**：呼叫 `octodock_do(app, action:"get_xxx")` 後，回傳是 JSON 還是人類可讀格式？

## G2：CRUD 完整閉環 — 有「內容」就要有完整的建/讀/改/刪

**規則**：凡是有「文件/內容/訊息」概念的 resource，adapter 必須提供完整 CRUD。

**為什麼**：
- 只能 Create 不能 Update = 只能寫新頁不能改舊頁的筆記本
- 記憶庫、文件協作、任務追蹤都需要「改」的能力

**怎麼做**：
- 如果 API 有原生的 Update Content endpoint → 直接用
- 如果沒有（像 Notion）→ adapter 層組合操作：
  - `replace_content` = 刪除所有 blocks → 重新寫入
  - 或 `update_content` = 搜尋匹配 blocks → PATCH 更新

**自檢**：列出 adapter 的所有 action，對每個 resource 檢查 C/R/U/D 四個是否齊全。

## G3：輸入輸出格式對稱 — 讀出來可以直接改完寫回去

**規則**：read action 的輸出格式 = write action 的輸入格式。

**為什麼**：
- 如果 create 吃 Markdown 但 get 吐 JSON，AI 要額外做格式轉換
- 理想狀態：AI 讀出來 → 改一下 → 直接寫回去，不用轉格式

**怎麼做**：
- Notion：寫入用 Markdown（markdownToBlocks），讀取也回 Markdown（blocksToMarkdown）
- Gmail：寫入用 { to, subject, body }，讀取也回 { from, to, subject, body }
- 不要某邊用 JSON 某邊用純文字

**自檢**：把 `get_xxx` 的回傳值直接當 `create_xxx` 或 `update_xxx` 的輸入，能不能直接用？

## G4：回傳大小控制 — 自動壓縮，adapter 不用管

**規則**：所有回傳自動經過 `compressIfNeeded()` 處理。超過 3000 字元的回傳會被截斷並存入暫存區（stored_results 表）。

**為什麼**：
- 一個 700 行原始碼檔案 = 8,000-10,000 tokens，直接塞進 context window 會浪費
- 壓縮後只佔 ~800 tokens（前 30 行 + 後 10 行摘要 + ref ID）
- AI 需要特定段落時用 `get_stored(ref, lines:"50-100")` 按需取用

**怎麼做**：
- **Adapter 開發者不需要手動處理**，這是核心系統層面的通用保護
- `server.ts` 在 `formatResponse()` 之後自動呼叫 `compressIfNeeded()`
- 暫存 24 小時後自動過期清理

**自檢**：呼叫一個會回傳大量內容的 action（如 get_file），確認回傳被截斷且附有 ref ID。

## 快速開發流程

新增一個 App adapter 時：

1. 先寫 `execute()`（核心 API 呼叫）
2. 加 `actionMap` 和 `getSkill()`（do + help 架構）
3. **馬上寫 `formatResponse()`**（不要等之後再補）
4. 檢查 CRUD 完整性（有內容的 resource 要四件套）
5. 測試 I/O 對稱性
