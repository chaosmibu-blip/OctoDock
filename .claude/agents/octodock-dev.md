# OctoDock 開發指南

OctoDock 是一個面向非技術用戶的基礎設施產品。用戶只需設定一個 MCP URL，就能讓任何 AI agent 操作所有已授權的 App，並且擁有跨 agent 共享的操作記憶。

## 產品定位

- **服務對象**：不懂程式、不懂英文，但重度依賴 AI agent 工作的人
- **核心價值**：一次串接全部能用 + 跨模型共享記憶 + 越用越懂你
- **競品差異**：Composio 服務開發者（需寫程式），OctoDock 服務終端用戶（只需貼 URL）

## 技術棧

| 層級 | 技術 | 原因 |
|------|------|------|
| 語言 | TypeScript | 與創辦人熟悉的 MIBU 專案一致 |
| MCP Server | @modelcontextprotocol/sdk | 官方 SDK，Streamable HTTP |
| Web 框架 | Next.js (App Router) | API + 前端一體化 |
| 資料庫 | PostgreSQL + pgvector | 關聯式 + 向量搜尋 |
| ORM | Drizzle ORM | 型別安全 + 輕量 |
| 用戶認證 | NextAuth.js | 簡化登入流程 |
| Token 加密 | AES-256-GCM | 業界標準加密 |
| 部署 | Replit（MVP）→ Railway | 先快後穩 |

## 語言策略（極重要）

| 對象 | 語言 | 原因 |
|------|------|------|
| 用戶介面 | 多語系（預設繁中） | 符合用戶語言 |
| MCP 工具名稱 | 英文 | 模型解析用，英文理解最佳 |
| MCP 工具描述 | 英文 | 模型據此判斷何時使用工具 |
| 錯誤訊息 | 雙語 | 英文代碼 + 用戶語言描述 |
| Agent 回應 | 用戶語言 | Agent 自動根據對話語言回應 |

## 資料庫 Schema

完整的 SQL schema 在 `src/db/schema.ts`。

核心四表：
- **users** — 用戶帳號 + mcp_api_key（agent 連線用）
- **connected_apps** — 已授權的 App + 加密 token
- **operations** — 每次工具呼叫的完整記錄（操作日誌）
- **memory** — 用戶的跨 agent 記憶（偏好 / 模式 / 脈絡）

## MCP 端點設計

單一入口：`https://octodock.app/mcp/{user_mcp_api_key}`

Agent 連上後，OctoDock 根據 api_key 辨識用戶，回傳該用戶已授權的所有工具。工具命名格式：`{app}_{action}`（如 `notion_create_page`）。

## 已上線的 App（16 個）

Notion, Gmail, Google Calendar, Google Drive, Google Sheets, Google Tasks, Google Docs, YouTube, GitHub, LINE, Telegram, Discord, Slack, Threads, Instagram, Canva

總計 200+ actions，透過 `octodock_do` + `octodock_help` 雙工具模型統一存取。

## 請求處理流程（MCP 管線）

每次 `octodock_do` 呼叫的處理順序：
1. 認證 — 從 URL 的 api_key 辨識用戶
2. 權限檢查 — 確認用戶已連結對應 App
3. 參數防呆（J3 param-guard）— 格式攔截 / UUID 補全 / 查詢語法轉換
4. Dry-run 檢查（C6）— 破壞性操作可預覽不執行
5. Pre-context（C1+C4）— 操作前查目標現狀 + 命名慣例推斷
6. Token 檢查 + 自動刷新（B2 refresh lock）
7. Circuit breaker 檢查（B4）— 上游 API 連續失敗時斷路
8. Rate limit 檢查（B3）— 全域 + per-action 高風險限制
9. 執行 — adapter.execute() 呼叫上游 API
10. 記錄 — 寫入 operations 表（非同步，不阻塞）
11. Post-check（C2+C3）— 歷史基線比對 + 修正 pattern 偵測
12. SOP 偵測 — 重複序列靜默自動存 SOP
13. 操作鏈建議（E1）+ 跨 App 關聯（E4）
14. 回傳壓縮（F2 compressIfNeeded）— 超長回傳自動截斷 + ref ID
15. 回傳結果

## 專案結構

```
octodock/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── page.tsx            # 首頁
│   │   ├── dashboard/          # 主控台
│   │   ├── preferences/        # 偏好設定
│   │   ├── callback/[app]/     # OAuth 回調（通用，靠 URL 參數判斷 App）
│   │   ├── api/auth/           # NextAuth
│   │   └── api/webhook/[platform]/ # Bot Webhook 接收（Phase 3+）
│   ├── mcp/                    # MCP Server
│   │   ├── server.ts           # MCP 主入口（octodock_do + octodock_help）
│   │   ├── registry.ts         # Adapter 自動探索 + 註冊
│   │   ├── system-actions.ts   # System action（memory, SOP, batch_do, resolve_name 等）
│   │   ├── error-types.ts      # 統一錯誤分類
│   │   ├── error-hints.ts      # 錯誤說明 mapping
│   │   ├── response-formatter.ts # 統一回傳格式
│   │   └── middleware/         # 中介層
│   │       ├── logger.ts       # 取 token → 執行 → 記錄
│   │       ├── circuit-breaker.ts # Per-app 斷路器
│   │       ├── pre-context.ts  # 操作前查目標現狀
│   │       ├── post-check.ts   # 操作後基線比對
│   │       ├── action-chain.ts # 操作鏈建議 + 跨 App 關聯
│   │       └── param-guard.ts  # 參數防呆
│   ├── adapters/               # 每個 App 一個檔案，實作 AppAdapter 介面（16 個）
│   │   ├── notion.ts, gmail.ts, google-calendar.ts, google-drive.ts
│   │   ├── google-sheets.ts, google-tasks.ts, google-docs.ts, youtube.ts
│   │   ├── github.ts, line.ts, telegram.ts, discord.ts, slack.ts
│   │   ├── threads.ts, instagram.ts, canva.ts
│   │   └── types.ts            # AppAdapter 介面 + DoResult 定義
│   ├── services/               # 共用業務邏輯
│   │   ├── token-manager.ts    # 加密 / 解密 / 刷新（通用）
│   │   ├── memory-engine.ts    # 記憶引擎
│   │   ├── operation-logger.ts # 操作記錄
│   │   └── auto-reply.ts       # Bot 自動回覆引擎（Phase 4）
│   ├── db/                     # Drizzle schema + migrations
│   └── lib/                    # 共用工具（crypto, constants）
├── .env
├── drizzle.config.ts
├── next.config.js
└── package.json
```

## Adapter Registry 模式（核心架構）

這是支撐 OctoDock 擴展到大量 App 的關鍵設計。每個 App 是一個獨立的 Adapter 模組，實作統一介面。核心系統自動掃描、自動註冊、自動載入。

**新增一個 App 只需要做一件事**：在 `src/adapters/` 裡新增一個檔案。核心系統完全不用改。

### AppAdapter 介面

```typescript
// src/adapters/types.ts
export interface AppAdapter {
  // 基本資訊
  name: string;                    // 'notion' | 'gmail' | ...
  displayName: Record<string, string>; // { zh: '筆記', en: 'Notion' }
  icon: string;                    // emoji 或圖片 URL
  
  // 認證方式
  authType: 'oauth2' | 'api_key' | 'bot_token';
  authConfig: OAuthConfig | ApiKeyConfig | BotTokenConfig;
  
  // MCP 工具清單
  tools: ToolDefinition[];
  
  // 工具執行（統一入口）
  execute(toolName: string, params: any, token: string): Promise<ToolResult>;
  
  // token 刷新邏輯（各 App 不同）
  refreshToken?(refreshToken: string): Promise<TokenSet>;
}
```

### Adapter 範例（notion.ts）

```typescript
// src/adapters/notion.ts
import { AppAdapter } from './types';

export const notionAdapter: AppAdapter = {
  name: 'notion',
  displayName: { zh: 'Notion', en: 'Notion' },
  icon: '📝',
  
  authType: 'oauth2',
  authConfig: {
    authorizeUrl: 'https://api.notion.com/v1/oauth/authorize',
    tokenUrl: 'https://api.notion.com/v1/oauth/token',
    scopes: [],
    authMethod: 'basic',  // Notion 用 Basic Auth 換 token
    // refresh: null — Notion 的 token 不會過期
  },
  
  tools: [
    {
      name: 'notion_search',
      description: 'Search pages or databases in user\'s Notion workspace',
      inputSchema: { query: z.string(), ... },
    },
    // ... 其他工具
  ],
  
  async execute(toolName, params, token) {
    switch (toolName) {
      case 'notion_search':
        return await this.search(params, token);
      // ...
    }
  },
};
```

### Registry 自動探索

```typescript
// src/mcp/registry.ts
import { readdirSync } from 'fs';
import { AppAdapter } from '../adapters/types';

// 啟動時自動掃描 adapters 資料夾
const adapters = new Map<string, AppAdapter>();

export async function loadAdapters() {
  const files = readdirSync('./src/adapters')
    .filter(f => f !== 'types.ts' && f.endsWith('.ts'));
  
  for (const file of files) {
    const mod = await import(`../adapters/${file}`);
    // 每個檔案 export 一個符合 AppAdapter 介面的物件
    const adapter = Object.values(mod).find(isAppAdapter);
    if (adapter) adapters.set(adapter.name, adapter);
  }
}

export function getAdapter(appName: string) { return adapters.get(appName); }
export function getAllAdapters() { return [...adapters.values()]; }
```

### 為什麼這樣設計

1. **加新 App 不碰核心**：寫一個檔案 → 放進 adapters/ → 重啟 → 自動上線
2. **認證方式可擴展**：OAuth2（Notion、Gmail、Meta）、API Key（LINE）、Bot Token（Telegram）三種都支援，未來加新的認證方式只需擴充 authType
3. **工具呼叫統一入口**：核心系統只呼叫 `adapter.execute(toolName, params, token)`，不需要知道每個 App 內部怎麼實作
4. **錯誤隔離**：一個 Adapter 出錯不影響其他 Adapter

## 開發原則

1. **治本優先**：修正問題根源，不在程式碼中打補丁
2. **最小權限**：每個 App 只申請必要的 OAuth scopes
3. **Token 絕不明文**：日誌、回應、錯誤訊息中絕不包含明文 token
4. **錯誤隔離**：一個 App 掛掉不影響其他 App
5. **非同步記錄**：操作記錄不阻塞主請求
6. **工具描述英文**：MCP 工具的 name 和 description 一律英文

## 開發階段

- **Phase 1（能連）**：Notion + Gmail + MCP Server + Dashboard + 操作記錄
- **Phase 2（社群 + 記憶）**：Threads + Instagram + memory_query/store
- **Phase 3（Bot 串接 + 智慧化）**：LINE Bot + Telegram Bot 工具（agent 主動操作）+ Webhook 接收 + 自動偏好歸納 + pgvector + 智慧工具篩選 + beta 測試
- **Phase 4（Bot 自動回覆 + 擴展）**：Bot 自主回覆引擎（OctoDock 呼叫 LLM）+ 對話歷史 + Bot 人設 + LLM 費用機制 + 更多 App

## Bot 架構注意事項

Bot（LINE / Telegram）跟其他 App 有根本差異：其他 App 是 agent 主動操作，Bot 是外部訊息主動進來需要回覆。

- **Phase 3 的 Bot 工具**：跟其他 App 一樣，agent 主動呼叫 `line_send_message` 等工具發訊息。不改架構。
- **Phase 4 的自動回覆**：需要新增 Webhook 接收端點、bot_configs 資料表、LLM 呼叫引擎。OctoDock 在這個場景下不再只是工具橋梁，它自己變成了一個 agent。
- **LLM 費用**：Phase 1-3 不需要 OctoDock 付 LLM 費用（agent 是用戶自己的）。Phase 4 自動回覆需要 OctoDock 自己呼叫 LLM，費用處理：用戶自帶 API key 或 OctoDock 代付轉嫁到訂閱費。

## 市場定位（2026.03 更新）

- GPT-5.4 的原生電腦操控能力 **不威脅** OctoDock：API 呼叫成功率 99%、毫秒級；電腦操控成功率 75%、秒級。有 API 的 App 永遠該走 API。
- GPT-5.4 的工具搜尋機制 **驗證** OctoDock 的方向：agent 面對太多工具會出問題，需要智慧篩選。
- 各 App 官方 MCP Server 只包裝了 API 功能的 20-40%。OctoDock 自己寫 Adapter，可以根據用戶實際需求覆蓋更多功能。這是自建 Adapter 的核心價值。
- 模型越強 → 越多人用 agent → OctoDock 的需求越大。
- 防禦力：跨模型記憶（各家鎖定策略的解藥）+ 非技術用戶定位 + 累積效應。

## 智慧工具篩選（Phase 3 記憶引擎功能）

MCP 的已知瓶頸：所有工具的 name + description + schema 會塞進 context，工具越多 token 消耗越大。30 個工具約吃 10K tokens，100 個工具約吃 35K tokens。

OctoDock 的解法：不是把所有工具都塞給 agent，而是根據記憶動態篩選。

```
Agent 連上 OctoDock，用戶有 60 個工具
  → OctoDock 根據：
    1. agent 傳來的對話意圖
    2. 用戶的歷史操作模式（記憶引擎）
    3. 當前脈絡（最近在做什麼、現在星期幾）
  → 只回傳最相關的 8-12 個工具
  → 其餘工具以一句話帶過，agent 需要時呼叫 octodock_discover_tools 展開
```

這需要的零件全部已經在架構裡：pgvector（語意匹配意圖 vs 工具描述）、memory 表（用戶模式）、operations 表（歷史操作頻率）。Phase 3 記憶自動注入時一併實作。

## 完整規格

詳細的資料庫 schema → `src/db/schema.ts`，OAuth 流程 → `src/app/callback/[app]/route.ts`，工具定義 → `src/mcp/server.ts`
