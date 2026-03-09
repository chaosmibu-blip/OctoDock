# AgentDock 產品架構規格書

> **一個 MCP URL，讓任何 agent 都能用你所有的 App，而且越用越懂你。**

---

## 1. 產品定位

### 一句話描述
AgentDock 是用戶的數位行為脈絡層——讓任何 AI agent 都能存取同一份工具、同一份記憶，不論用戶使用哪個語言模型。

### 目標用戶
不懂程式、不懂英文，但重度依賴 AI agent（Claude、GPT 等）工作的人。

### 核心價值

| 價值層 | 說明 | 競品對比 |
|--------|------|----------|
| 第一層：一次串接 | 一個 MCP URL 搞定所有 App | Composio 類似但需寫程式 |
| 第二層：跨模型記憶 | 換 Claude→GPT 記憶不斷 | 無競品做這個 |
| 第三層：操作智慧 | 越用越懂用戶習慣 | Mem0 做記憶但不做工具操作 |
| 第四層：更完整的功能覆蓋 | 官方 MCP Server 只包 API 的 20-40%，AgentDock 按需覆蓋更多 | 官方 MCP 只挑最大公約數 |

### 市場定位（2026.03）

- GPT-5.4 的原生電腦操控不威脅 AgentDock：API 成功率 99% 毫秒級 vs 電腦操控 75% 秒級
- GPT-5.4 的工具搜尋機制驗證了 AgentDock 的方向：agent 面對太多工具需要智慧篩選
- 模型越強 → 越多人用 agent → AgentDock 需求越大
- 防禦力：跨模型記憶 + 非技術用戶定位 + 累積效應 + API 功能覆蓋率

---

## 2. 系統架構

```
用戶的 Agent（Claude / GPT / Gemini / 任何 MCP Client）
        │
        │ MCP 協議（Streamable HTTP）
        ▼
┌─────────────────────────────────────────────────┐
│              AgentDock Server                    │
│                                                 │
│  ① MCP 閘道層（認證 + 路由 + 速率限制）           │
│          ↓                                      │
│  ② 攔截記錄層（非同步操作日誌 + 記憶觸發）         │
│          ↓                                      │
│  ③ 認證代管層（Token 加密儲存 + 自動刷新）         │
│          ↓                                      │
│  ④ App 轉接層（Adapter Registry — 統一介面）      │
│          ↓                                      │
│  ⑤ 記憶引擎（偏好/模式/脈絡 + 智慧工具篩選）      │
│                                                 │
│  ┌─────────────────────────────────────────┐    │
│  │  PostgreSQL + pgvector                  │    │
│  │  users / connected_apps / operations /  │    │
│  │  memory / bot_configs                   │    │
│  └─────────────────────────────────────────┘    │
│                                                 │
│  ┌──────────────────────────────────────┐       │
│  │  Web 介面（Next.js）                  │       │
│  │  登入 / 授權 / Dashboard / 偏好設定   │       │
│  └──────────────────────────────────────┘       │
│                                                 │
│  ┌──────────────────────────────────────┐       │
│  │  Webhook 端點（Phase 3+）             │       │
│  │  LINE / Telegram 外部訊息接收         │       │
│  └──────────────────────────────────────┘       │
└─────────────────────────────────────────────────┘
        │
        │ REST API（各 App 的 OAuth + API）
        ▼
┌──────────────────────────────────────────────────┐
│  外部 App                                        │
│  Notion │ Gmail │ Threads │ Instagram │ LINE │ TG │
└──────────────────────────────────────────────────┘
```

### 技術棧

| 層級 | 技術 | 選擇理由 |
|------|------|----------|
| 語言 | TypeScript | 與 MIBU 專案一致 |
| MCP Server | @modelcontextprotocol/sdk | 官方 SDK，Streamable HTTP |
| Web 框架 | Next.js（App Router） | API + 前端一體化 |
| 資料庫 | PostgreSQL + pgvector | 關聯式 + 向量搜尋 |
| ORM | Drizzle ORM | 型別安全 + 輕量 |
| 用戶認證 | NextAuth.js | Google 登入 |
| Token 加密 | AES-256-GCM | 業界標準 |
| 部署 | Replit（MVP）→ Railway | 先快後穩 |

---

## 3. Adapter Registry（核心架構）

每個 App 是一個獨立的 Adapter 模組，實作統一介面。核心系統啟動時自動掃描 `src/adapters/` 資料夾、自動註冊。新增一個 App 只需要加一個檔案。

### AppAdapter 介面

```typescript
// src/adapters/types.ts
export interface AppAdapter {
  name: string;                              // 'notion' | 'gmail' | ...
  displayName: Record<string, string>;       // { zh: 'Notion', en: 'Notion' }
  icon: string;

  authType: 'oauth2' | 'api_key' | 'bot_token';
  authConfig: OAuthConfig | ApiKeyConfig | BotTokenConfig;

  tools: ToolDefinition[];

  execute(toolName: string, params: any, token: string): Promise<ToolResult>;
  refreshToken?(refreshToken: string): Promise<TokenSet>;
}

type OAuthConfig = {
  type: 'oauth2';
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  authMethod: 'basic' | 'post';   // Notion 用 basic，Google/Meta 用 post
};

type ApiKeyConfig = {
  type: 'api_key';
  instructions: Record<string, string>;  // 多語系的設定教學
  validateEndpoint: string;              // 驗證 key 是否有效
};

type BotTokenConfig = {
  type: 'bot_token';
  instructions: Record<string, string>;
  setupWebhook: boolean;                 // 自動設定 webhook
};
```

### Registry 自動探索

```typescript
// src/mcp/registry.ts
const adapters = new Map<string, AppAdapter>();

export async function loadAdapters() {
  const files = readdirSync('./src/adapters')
    .filter(f => f !== 'types.ts' && f.endsWith('.ts'));
  for (const file of files) {
    const mod = await import(`../adapters/${file}`);
    const adapter = Object.values(mod).find(isAppAdapter);
    if (adapter) adapters.set(adapter.name, adapter);
  }
}

export function getAdapter(appName: string) { return adapters.get(appName); }
export function getAllAdapters() { return [...adapters.values()]; }
```

### 動態工具註冊（MCP Server 核心）

```typescript
// src/mcp/server.ts
function createServerForUser(user: User): McpServer {
  const server = new McpServer({ name: "agentdock", version: "1.0.0" });
  const connectedApps = await getConnectedApps(user.id);

  // 用 registry 自動匹配，不需要 if/else
  for (const appName of connectedApps) {
    const adapter = getAdapter(appName);
    if (!adapter) continue;
    for (const tool of adapter.tools) {
      server.tool(tool.name, tool.description, tool.inputSchema,
        async (params, extra) => {
          return executeWithMiddleware(user.id, tool.name, params,
            (p, token) => adapter.execute(tool.name, p, token));
        }
      );
    }
  }
  registerSystemTools(server, user.id);
  return server;
}
```

---

## 4. 資料庫設計

### 4.1 users

```sql
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  name          TEXT,
  mcp_api_key   TEXT UNIQUE NOT NULL,  -- 格式 ak_ + 隨機字串
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
```

MCP URL：`https://agentdock.app/mcp/{mcp_api_key}`

### 4.2 connected_apps

```sql
CREATE TABLE connected_apps (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  app_name        TEXT NOT NULL,             -- 來自 Adapter 的 name，不硬寫 enum
  auth_type       TEXT NOT NULL DEFAULT 'oauth2',  -- 'oauth2' | 'api_key' | 'bot_token'
  access_token    TEXT NOT NULL,             -- AES-256-GCM 加密
  refresh_token   TEXT,                      -- AES-256-GCM 加密
  token_expires_at TIMESTAMPTZ,
  scopes          TEXT[],
  app_user_id     TEXT,
  app_user_name   TEXT,
  status          TEXT DEFAULT 'active',     -- 'active' | 'expired' | 'revoked'
  config          JSONB DEFAULT '{}',        -- App 專屬額外設定
  connected_at    TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, app_name)
);
```

`app_name` 不使用 enum，由 Adapter Registry 在執行時驗證。
`config` 存各 App 專屬設定（如 LINE 的 channel_id），避免為每個 App 加欄位。

### 4.3 operations

```sql
CREATE TABLE operations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  task_id         UUID,
  source_agent    TEXT,                      -- 'claude' | 'gpt' | 'gemini' | 'other'
  app_name        TEXT NOT NULL,
  tool_name       TEXT NOT NULL,
  action          TEXT NOT NULL,
  params          JSONB,
  result          JSONB,
  intent          TEXT,                      -- agent 說明的操作目的
  success         BOOLEAN DEFAULT true,
  duration_ms     INTEGER,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_operations_user_time ON operations(user_id, created_at DESC);
CREATE INDEX idx_operations_user_app ON operations(user_id, app_name);
CREATE INDEX idx_operations_task ON operations(task_id) WHERE task_id IS NOT NULL;
```

### 4.4 memory

```sql
CREATE TABLE memory (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  category        TEXT NOT NULL,             -- 'preference' | 'pattern' | 'context'
  app_name        TEXT,                      -- NULL = 跨 App 記憶
  key             TEXT NOT NULL,
  value           TEXT NOT NULL,
  confidence      REAL DEFAULT 0.5,
  source_count    INTEGER DEFAULT 1,
  embedding       vector(1536),
  last_used_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, category, key)
);

CREATE INDEX idx_memory_embedding ON memory
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

### 4.5 bot_configs（Phase 3+）

```sql
CREATE TABLE bot_configs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
  platform        TEXT NOT NULL,             -- 'line' | 'telegram'
  platform_bot_id TEXT NOT NULL,
  credentials     TEXT NOT NULL,             -- AES-256-GCM 加密
  system_prompt   TEXT,                      -- Bot 人設
  llm_provider    TEXT DEFAULT 'claude',
  llm_api_key     TEXT,                      -- 加密儲存，用戶自帶
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

---

## 5. 語言策略

| 對象 | 語言 | 原因 |
|------|------|------|
| 用戶介面 | 多語系（預設繁中） | 符合用戶語言 |
| MCP 工具名稱 | 英文 | 模型解析用 |
| MCP 工具描述 | 英文 | 模型據此判斷何時使用工具 |
| Agent 回應 | 用戶語言 | Agent 自動回應 |
| 錯誤訊息 | 雙語 | `「Notion 未連結 (NOTION_NOT_CONNECTED)」` |

---

## 6. 工具清單（34 個）

### Phase 1-2：24 個工具

**Notion（6）**：notion_search, notion_get_page, notion_create_page, notion_update_page, notion_query_database, notion_create_database_item

**Gmail（5）**：gmail_search, gmail_read, gmail_send, gmail_reply, gmail_draft

**Threads（5）**：threads_publish, threads_get_posts, threads_reply, threads_get_insights, threads_get_profile

**Instagram（5）**：instagram_publish, instagram_get_posts, instagram_reply_comment, instagram_get_comments, instagram_get_insights

**AgentDock 系統（3）**：agentdock_memory_query, agentdock_memory_store, agentdock_list_apps

### Phase 3：新增 10 個工具

**LINE Bot（5）**：line_send_message, line_broadcast, line_get_profile, line_get_followers, line_reply

**Telegram Bot（4）**：telegram_send_message, telegram_send_photo, telegram_get_updates, telegram_set_webhook

**AgentDock 系統（+1）**：agentdock_discover_tools（智慧工具篩選用，搜尋未載入的工具）

### 工具定義範例

```typescript
server.tool(
  "notion_create_page",
  "Create a new page in user's Notion workspace. Can specify parent page or database, title, and content. If no location is specified, use notion_search first to find a suitable parent.",
  {
    title: z.string().describe("Page title"),
    content: z.string().optional().describe("Page content in Markdown format"),
    parent_id: z.string().optional().describe("Parent page or database ID. Use notion_search first if unsure."),
  },
  async (params, extra) => { /* ... */ }
);
```

---

## 7. 三種認證方式

### OAuth 2.0（Notion、Gmail、Meta 系列）
用戶點「連結」→ 跳轉授權頁 → 同意 → 跳回 AgentDock → 自動拿到 token。

### API Key（LINE Messaging API）
用戶到 LINE Developers Console 建立 channel → 複製 Channel Access Token → 貼到 AgentDock。Dashboard 提供圖文教學。

### Bot Token（Telegram Bot）
用戶跟 @BotFather 對話拿 Bot Token → 貼到 AgentDock → AgentDock 自動設定 Webhook。

所有 token 統一用 AES-256-GCM 加密儲存。

### Token 加密

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
const ALGORITHM = "aes-256-gcm";
const KEY = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY!, "hex"); // 32 bytes

export function encrypt(plaintext: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, KEY, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

export function decrypt(ciphertext: string): string {
  const [ivHex, authTagHex, encrypted] = ciphertext.split(":");
  const decipher = createDecipheriv(ALGORITHM, KEY, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
```

### OAuth Callback（通用，從 Adapter Registry 取得設定）

```typescript
// src/app/callback/[app]/route.ts
export async function GET(request: Request, { params }: { params: { app: string } }) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const userId = verifyState(state);
  const adapter = getAdapter(params.app);
  if (!adapter || adapter.authConfig.type !== 'oauth2') {
    return new Response("Invalid app", { status: 400 });
  }

  const tokens = await exchangeCode(adapter.authConfig, code!);

  await db.insert(connectedApps).values({
    userId, appName: params.app, authType: 'oauth2',
    accessToken: encrypt(tokens.access_token),
    refreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
    tokenExpiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null,
    scopes: adapter.authConfig.scopes, status: "active",
  }).onConflictDoUpdate({
    target: [connectedApps.userId, connectedApps.appName],
    set: { accessToken: encrypt(tokens.access_token), status: "active", updatedAt: new Date() },
  });

  return Response.redirect("https://agentdock.app/dashboard?connected=" + params.app);
}
```

### 各 App OAuth 特殊事項

**Notion**：token exchange 用 Basic Auth（`Authorization: Basic base64(client_id:client_secret)`）。Token 不會過期，沒有 refresh_token。

**Google（Gmail）**：authorize URL 要加 `access_type=offline` + `prompt=consent` 才能拿到 refresh_token。access_token 有效期約 1 小時。

**Meta（Threads/Instagram）**：short-lived token 換 long-lived token（60 天）再定期 refresh。Threads 和 Instagram authorize URL 不同，MVP 先串 Threads。

---

## 8. 請求處理流程

```
Agent 呼叫工具
  → ① 閘道層：從 URL 的 api_key 辨識用戶
  → ② 攔截層：標記 task_id、記錄意圖
  → ③ 認證層：確認用戶已連結對應 App，取出有效 token
  → ④ 轉接層：adapter.execute(toolName, params, token)
  → ⑤ 回傳結果
  → ⑥ 非同步：寫入 operations 表 + 觸發記憶更新
```

中介層模式（每個工具呼叫共用）：

```typescript
async function executeWithMiddleware(userId, toolName, params, handler) {
  const startTime = Date.now();
  try {
    const token = await tokenManager.getValidToken(userId, getAppFromTool(toolName));
    const result = await handler(params, token);
    operationLogger.log({ userId, toolName, params, result, success: true,
      durationMs: Date.now() - startTime }).catch(console.error);
    return result;
  } catch (error) {
    operationLogger.log({ userId, toolName, params, result: { error: error.message },
      success: false, durationMs: Date.now() - startTime }).catch(console.error);
    throw error;
  }
}
```

---

## 9. 智慧工具篩選（Phase 3 記憶引擎功能）

MCP 的已知瓶頸：工具描述全部塞進 context，30 個工具約吃 10K tokens，100 個工具約 35K tokens。

AgentDock 的解法：不把所有工具都塞給 agent，根據記憶動態篩選。

```
Agent 連上 AgentDock，用戶有 60 個工具
  → 根據對話意圖 + 歷史操作模式 + 當前脈絡
  → 只回傳最相關的 8-12 個工具
  → 其餘以一句話帶過，agent 需要時呼叫 agentdock_discover_tools 展開
```

所需零件已在架構中：pgvector（語意匹配）、memory 表（用戶模式）、operations 表（歷史操作頻率）。

---

## 10. Bot 架構（Phase 3-4）

Bot（LINE / Telegram）有兩個方向：

**Phase 3 — Agent 主動操作 Bot（跟其他 App 一樣）**：agent 呼叫 `line_send_message` 等工具發訊息。不改架構。

**Phase 4 — 外部訊息進來，AgentDock 自動回覆（新架構）**：

```
外部用戶 → LINE/TG → Webhook → AgentDock
  → 查 bot_configs 找到所屬用戶
  → 查記憶和偏好
  → 呼叫 LLM API 產生回覆（用戶自帶 API key）
  → 透過 LINE/TG API 回覆
  → 記錄到 operations
```

Webhook 端點：`src/app/api/webhook/[platform]/route.ts`

---

## 11. 專案結構

```
agentdock/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── page.tsx                  # 首頁
│   │   ├── dashboard/                # 主控台
│   │   ├── preferences/              # 偏好設定
│   │   ├── callback/[app]/route.ts   # OAuth 回調（通用）
│   │   ├── api/auth/                 # NextAuth
│   │   └── api/webhook/[platform]/   # Bot Webhook（Phase 3+）
│   ├── mcp/                          # MCP Server
│   │   ├── server.ts                 # 主入口（不含任何 App 邏輯）
│   │   ├── registry.ts              # Adapter 自動探索 + 註冊
│   │   └── middleware/              # 認證、日誌、記憶注入
│   ├── adapters/                     # 每個 App 一個檔案
│   │   ├── types.ts                 # AppAdapter 介面定義
│   │   ├── notion.ts
│   │   ├── gmail.ts
│   │   ├── threads.ts
│   │   ├── instagram.ts
│   │   ├── line.ts                  # Phase 3
│   │   └── telegram.ts             # Phase 3
│   ├── services/
│   │   ├── token-manager.ts         # 加密 / 解密 / 刷新（通用）
│   │   ├── memory-engine.ts         # 記憶引擎
│   │   ├── operation-logger.ts      # 操作記錄
│   │   └── auto-reply.ts           # Bot 自動回覆（Phase 4）
│   ├── db/
│   │   ├── schema.ts               # Drizzle schema
│   │   ├── migrations/
│   │   └── index.ts
│   └── lib/
│       ├── crypto.ts               # AES-256 加密/解密
│       └── constants.ts
├── .env
├── drizzle.config.ts
├── next.config.js
├── package.json
└── CLAUDE.md                       # Claude Code 指令
```

---

## 12. 環境變數

```env
DATABASE_URL=postgresql://...
NEXTAUTH_SECRET=...
NEXTAUTH_URL=https://agentdock.app
GOOGLE_CLIENT_ID=...               # AgentDock 登入用
GOOGLE_CLIENT_SECRET=...
TOKEN_ENCRYPTION_KEY=...            # 32 bytes hex，node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# App OAuth credentials
NOTION_OAUTH_CLIENT_ID=...
NOTION_OAUTH_CLIENT_SECRET=...
GMAIL_OAUTH_CLIENT_ID=...          # 注意：跟登入用的是不同的 credentials
GMAIL_OAUTH_CLIENT_SECRET=...
META_OAUTH_CLIENT_ID=...
META_OAUTH_CLIENT_SECRET=...
```

---

## 13. 開發階段

### Phase 1：能連（4-6 週）
- 專案初始化（Next.js + PostgreSQL + Drizzle）
- 資料庫 schema（users, connected_apps, operations, memory）
- Adapter Registry 架構 + AppAdapter 介面
- 用戶登入（NextAuth.js + Google 登入）
- Notion Adapter（OAuth + 6 個工具）
- Gmail Adapter（OAuth + 5 個工具）
- MCP Server（Streamable HTTP）
- Dashboard（MCP URL + 連結 App）
- 操作記錄基礎建設

**里程碑：你自己能用 Claude 透過 AgentDock 操作 Notion 和 Gmail。**

### Phase 2：社群 + 記憶（4-6 週）
- Meta OAuth（Threads + Instagram）
- Threads Adapter（5 個工具）
- Instagram Adapter（5 個工具）
- 記憶系統 MVP（memory_query + memory_store）
- 偏好設定頁面
- Token 自動刷新 + 錯誤處理

**里程碑：四 App 全通 + 跨 agent 記憶可用。**

### Phase 3：Bot 串接 + 智慧化（6-8 週）
- LINE Bot Adapter（api_key 認證 + 5 個工具）
- Telegram Bot Adapter（bot_token 認證 + 4 個工具）
- Webhook 接收端點
- 自動偏好歸納（操作記錄 → 記憶）
- pgvector 語意搜尋上線
- 智慧工具篩選（agentdock_discover_tools）
- 開放 beta 測試

**里程碑：Bot 可被 agent 操作 + 系統越用越懂你 + 第一批外部用戶。**

### Phase 4：Bot 自動回覆 + 擴展（6-8 週）
- Bot 自動回覆引擎（AgentDock 呼叫 LLM）
- 對話歷史管理
- Bot 人設系統
- LLM 費用機制（用戶自帶 API key）
- 更多 App（Drive、Calendar、Facebook 等）

**里程碑：Bot 7×24 自動回覆 + 完整商業化準備。**

---

## 14. 安全設計

- Token 全部 AES-256-GCM 加密儲存，明文絕不出現在日誌或回應中
- MCP API key 只在 HTTPS 上傳輸
- 每個 App 只申請最小必要權限
- OAuth state 參數加密（user_id + 時間戳 + 隨機值），防 CSRF
- 用戶可隨時撤銷任何 App 的授權
- 操作記錄中不儲存敏感資料（郵件內容只存摘要）
- Rate limiting 防 agent 打爆 App 的 API 限制
- 錯誤隔離：一個 App 掛不影響其他 App
