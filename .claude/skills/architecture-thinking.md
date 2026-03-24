---
name: 架構思維
description: 當你修改 server.ts、types.ts、middleware、或任何核心模組時，檢查這次改動是否需要同步到其他層：改了 tool schema 的參數 → DB operations 表要有對應欄位；改了 param-guard 規則 → 確認所有 App 都適用還是只該針對特定 App；在 adapter 裡做了格式轉換 → 判斷該不該提升到 param-guard；加了新的提前返回路徑 → 確認有 logOperation 且帶齊所有欄位。
---

# 架構思維

## OctoDock 架構總覽

```
用戶的 AI（Claude/ChatGPT/Gemini）
        ↓ MCP（octodock_do / octodock_help）
┌─────────────────────────────────────────────┐
│  OctoDock MCP Server（server.ts）            │
│  ┌─────────┐  ┌──────────┐  ┌────────────┐ │
│  │ 參數轉換 │  │ 格式轉換  │  │ 錯誤引導   │ │
│  │ 名稱→ID  │  │ JSON→MD  │  │ API→人話   │ │
│  └────┬────┘  └────┬─────┘  └─────┬──────┘ │
│       ↓            ↓              ↓         │
│  ┌─────────────────────────────────────┐    │
│  │  AppAdapter 介面（types.ts）        │    │
│  │  必填：actionMap, getSkill,         │    │
│  │       formatResponse, formatError,  │    │
│  │       execute                       │    │
│  └────────────────┬────────────────────┘    │
│       ↓           ↓           ↓             │
│  ┌────────┐ ┌─────────┐ ┌──────────┐       │
│  │ Notion │ │ Gmail   │ │ GitHub   │ ...   │
│  │ 20 act │ │ 5 act   │ │ 10 act   │       │
│  └────────┘ └─────────┘ └──────────┘       │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │  共用服務                            │    │
│  │  memory-engine（記憶）               │    │
│  │  pattern-analyzer（行為偵測）         │    │
│  │  sop-detector（SOP 自動辨識）        │    │
│  │  plan-limits（方案分級）             │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │  前端                                │    │
│  │  dashboard-client.tsx（APP_KEYS）    │    │
│  │  i18n.tsx（多語系）                  │    │
│  │  oauth-env.ts（env 映射）           │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

## 碰到問題時的思考流程

**不要急著修。先問一個問題：「這是只有這個 App 會碰到的，還是所有 App 都會碰到的？」**

### 如果是通用問題 → 改架構

| 症狀 | 架構層的解法 | 改哪裡 |
|------|------------|--------|
| 某個 App 回傳 raw JSON | 不是加 formatResponse — 是確認 types.ts 有強制 required | types.ts + isAppAdapter |
| 某個 action 的 help 沒範例 | 不是加一段文字 — 是確認 getSkill 介面強制要有 action 級查詢 | types.ts |
| 新增 App 忘了同步前端 | 不是加 checklist — 是加 hook 自動提醒 | hooks/ |
| 某個 App 的錯誤訊息很爛 | 不是只改那個 App — 是確認 formatError 是 required | types.ts |
| 名稱解析只有 Notion 有 | 不是 Notion 專屬功能 — 是通用的 translateSimplifiedParams | server.ts |
| 記憶學習只有 Notion 有 | 不是 Notion 專屬 — 是通用的 learnFromResult | server.ts |

### 如果是 App 專屬問題 → 只改那個 adapter

| 症狀 | 只改 adapter |
|------|------------|
| Notion 的 blocks 轉 MD 有 bug | notion.ts 的 blocksToMarkdown |
| Gmail 的 base64 解碼壞了 | gmail.ts 的 decodeBody |
| LINE 的 reply token 過期提示不對 | line.ts 的 formatError |

## 架構演進的判斷標準

**同一個問題在第二個 App 出現時，就該提升到架構層。**

- 第 1 次在 Notion 碰到「回傳 raw JSON」→ 可以先在 Notion 修
- 第 2 次在 Gmail 也碰到 → **停下來，改 types.ts 把 formatResponse 設為必填**
- 之後所有新 App 自動被強制，不會再碰到

不要等第 3 次、第 4 次。第 2 次就該升級。

## 目前的架構強制機制

| 機制 | 怎麼強制 | 漏了會怎樣 |
|------|---------|-----------|
| AppAdapter 必填欄位 | TypeScript interface required | build 失敗 |
| isAppAdapter type guard | runtime 檢查 | adapter 不會被載入 |
| registry 明確 import | importAllAdapters() 清單 | 不會被載入 |
| post-commit hook | 偵測新增 adapter | 提醒前端同步 |

## 新增 App 時的最小工作量

因為架構已經把通用的都做好了，新增一個 App 只需要：

1. `src/adapters/xxx.ts` — 填 5 個必填方法
2. `src/mcp/registry.ts` — 加一行 import
3. 前端 3 個檔案 — APP_KEYS + i18n + oauth-env（hook 會提醒）
4. `.env.example` — 加環境變數
5. `.claude/skills/setup-xxx.md` — 操作手冊

不需要改 server.ts、types.ts、記憶引擎、SOP 系統。這些都是通用的。
