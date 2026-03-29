# 規劃文件：通用 Session + AI Adapter + AI 對話

## 1. 目標

實現三項新功能：
1. **通用 Session 機制** — 利用 operations 表新增的自動遞增欄位，讓 AI 透過 intent 欄位帶 `+數字` 關聯同一任務的多次呼叫
2. **AI 語言模型 Adapter** — OpenAI / Anthropic / Google Gemini 三家 AI 服務，每家支援 OAuth 訂閱制 + API Key 兩種連接方式
3. **AI 對話功能** — 兩個 AI 服務自動多輪對話，OctoDock 主動驅動

## 2. 影響範圍

### 後端

| 檔案 | 改動 |
|------|------|
| `src/db/schema.ts` | operations 表新增 `sessionSeq` 自動遞增欄位 + `sessionId` 欄位；新增 `aiConversations` 表 |
| `src/db/migrations/013_session_seq.sql` | 新增 sessionSeq sequence + 欄位 |
| `src/db/migrations/014_ai_conversations.sql` | AI 對話紀錄表 |
| `src/mcp/server.ts` | session 解析（從 intent 尾部 `+N` 提取 sessionSeq）、回傳時帶 session 引導文字 |
| `src/mcp/middleware/logger.ts` | logOperation 支援寫入 sessionSeq / sessionId |
| `src/adapters/openai.ts` | 新增：OpenAI adapter（send_message + converse） |
| `src/adapters/anthropic.ts` | 新增：Anthropic adapter（send_message + converse） |
| `src/adapters/google-gemini.ts` | 新增：Google Gemini adapter（send_message + converse） |
| `src/mcp/registry.ts` | 新增三個 AI adapter 的明確 import |
| `src/services/ai-conversation.ts` | 新增：AI 對話驅動引擎（多輪對話執行邏輯） |
| `src/lib/constants.ts` | 新增 AI 對話的預設輪數、歷史上限等常數 |

### 前端同步

| 檔案 | 改動 |
|------|------|
| `src/app/dashboard/dashboard-client.tsx` | APP_KEYS 新增三個 AI App |
| `src/lib/i18n.tsx` | 新增三個 AI App 的中英文描述 |
| `src/lib/oauth-env.ts` | 新增 OPENAI / ANTHROPIC / GOOGLE_GEMINI 的環境變數映射 |

### 不需要改

- octodock_do / octodock_help 的工具定義（不新增參數）
- 前端不需要對話介面

## 3. 執行步驟

### Phase 1: 通用 Session 機制

**可並行的步驟標記為 [P]**

1. DB schema + migration：operations 表新增 `sessionSeq`（自動遞增）和 `sessionId`（UUID，同 session 共用）
2. `server.ts`：解析 intent 尾部的 `+N` 格式
   - 有 `+N`：查 operations 表找 sessionSeq = N 的紀錄，取出 sessionId，本次操作寫入同一個 sessionId
   - 無 `+N`：新 session，讓 DB 自動分配 sessionSeq，用新 UUID 作為 sessionId
3. `server.ts` 回傳結果時附帶 session 引導文字
4. `logger.ts`：logOperation 支援 sessionSeq / sessionId 欄位

### Phase 2: AI 語言模型 Adapter [P — 三個 adapter 可並行]

5. 建立 `src/adapters/openai.ts`
   - authType: 支援 OAuth（Codex 訂閱制）+ API Key
   - actionMap: `send_message`, `converse`
   - execute: 呼叫 OpenAI Chat Completions API
6. 建立 `src/adapters/anthropic.ts` [P]
   - authType: 支援 setup-token 訂閱制 + API Key
   - actionMap: `send_message`, `converse`
   - execute: 呼叫 Anthropic Messages API
7. 建立 `src/adapters/google-gemini.ts` [P]
   - authType: 支援 OAuth（Gemini CLI）+ API Key
   - actionMap: `send_message`, `converse`
   - execute: 呼叫 Gemini API
8. 前端同步：APP_KEYS + i18n + oauth-env
9. Registry 新增三個 import

### Phase 3: AI 對話功能

10. 建立 `src/services/ai-conversation.ts` — 對話驅動引擎
    - 接收：發起方 AI adapter、對話方 AI adapter、主題、最多輪數
    - 執行：A→B→A→B... 循環呼叫
    - 每輪回送進度（透過 MCP progress notification）
    - 保留最近 10 輪歷史作為 context
    - 到達上限輪數停止，回傳最終結論
11. 三個 AI adapter 的 `converse` action 呼叫 ai-conversation 引擎
12. DB migration：AI 對話紀錄表（對話 ID、每輪內容、狀態）

### Phase 4: 驗證

13. Build 通過
14. 確認 session 機制正常運作
15. 確認 AI adapter 連接和基本訊息發送
16. 確認 AI 對話能正常多輪執行

## 4. 驗證方式

- `npm run build` 通過
- TypeScript 無新增錯誤
- Session：模擬兩次 octodock_do，第二次 intent 帶 `+N`，確認 sessionId 一致
- AI Adapter：模擬 send_message，確認 API 呼叫正確
- AI 對話：模擬 converse action，確認多輪對話流程完整

## 5. 風險

- **DB migration**：新增欄位和表，不影響現有資料（全部 nullable 或有預設值）
- **AI API 呼叫**：依賴用戶的 AI 帳號 token，需處理 token 過期和 rate limit
- **對話逾時**：多輪對話可能耗時較長，需控制單輪超時和總超時
- **OAuth 訂閱制登入**：Codex OAuth / Anthropic setup-token / Gemini CLI OAuth 的具體 OAuth 流程需要研究確認

## 6. 設計細節

### Session 機制

```
AI → octodock_do(intent: "把 Drive 文件搬到 Notion")
OctoDock → 執行，operations 記錄 sessionSeq=42, sessionId=uuid-xxx
回傳：{ok: true, data: "...", session: "如果下一次呼叫與這次相關，intent 請填 你的描述+42。如果不相關，intent 正常填寫即可。"}

AI → octodock_do(intent: "把內容建到 Notion+42")
OctoDock → 解析 +42，查 sessionSeq=42 的 sessionId=uuid-xxx，本次操作歸入同 session
```

### AI Adapter 認證方式

每個 AI 服務支援兩種連接方式，用戶在 Dashboard 選擇：
1. **訂閱制登入**（OAuth）：走 OAuth 流程取得用戶帳號的 token
2. **API Key**：用戶直接輸入 API Key

由於 Codex OAuth、Anthropic setup-token、Gemini CLI OAuth 的具體 OAuth 端點和流程尚未公開標準化，Phase 2 先實作 API Key 方式，OAuth 訂閱制方式留為架構預留（authConfig 已定義，待各平台 OAuth 端點確認後實作）。

### AI 對話 action

```
octodock_do(
  app: "openai",
  action: "converse",
  params: {
    partner: "anthropic",        // 對話對象（另一個已連結的 AI App）
    topic: "討論 React vs Vue",   // 對話主題
    max_rounds: 5                // 最多幾輪來回（必填，預設 5）
  },
  intent: "讓 OpenAI 和 Anthropic 討論前端框架"
)
```
