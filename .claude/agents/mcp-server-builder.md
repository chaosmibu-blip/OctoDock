# MCP Server 開發指南

用 Anthropic 官方的 @modelcontextprotocol/sdk（TypeScript）建立 MCP Server 的標準流程。這份指南涵蓋從初始化到部署的完整步驟。

## 前置工作

```bash
npm install @modelcontextprotocol/sdk zod
```

SDK 提供三種 transport：
- **stdio** — 本地命令列，適合 Claude Desktop 等桌面 client
- **SSE (Server-Sent Events)** — HTTP 長連線，舊版遠端方案
- **Streamable HTTP** — 最新標準，單一 URL 端點，推薦用於遠端部署

AgentDock 使用 Streamable HTTP，因為用戶只需貼一個 URL。

## 核心概念

MCP Server 對外暴露三種東西：
- **Tools** — agent 可以呼叫的功能（最常用）
- **Resources** — agent 可以讀取的資料
- **Prompts** — 預定義的 prompt 模板

AgentDock 只用 Tools。

## 建立 Server（Streamable HTTP）

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

// 1. 建立 server 實例
const server = new McpServer({
  name: "agentdock",
  version: "1.0.0",
});

// 2. 註冊工具
server.tool(
  "notion_create_page",                              // 工具名稱
  "Create a new page in user's Notion workspace",    // 描述（英文）
  {                                                   // 輸入 schema（用 zod）
    title: z.string().describe("Page title"),
    content: z.string().optional().describe("Page content in Markdown"),
    parent_id: z.string().optional().describe("Parent page or database ID"),
  },
  async (params, extra) => {                          // 處理函式
    // extra.meta 可以拿到 agent 傳的 metadata
    // 實際呼叫 Notion API 的邏輯
    const result = await notionAdapter.createPage(userId, params);
    
    return {
      content: [
        { type: "text", text: JSON.stringify(result) }
      ],
    };
  }
);

// 3. 設定 HTTP 端點（在 Next.js API Route 或 Express 中）
// 見下方「與 Next.js 整合」
```

## 工具定義的最佳實踐

### 命名
- 格式：`{app}_{action}`，全小寫底線分隔
- 範例：`notion_create_page`, `gmail_send`, `threads_publish`
- 系統工具用 `agentdock_` 前綴

### 描述（description）
- 一律英文（模型理解最佳）
- 第一句講「做什麼」
- 如果有前置步驟，在描述中說明（如「Use notion_search first if unsure about parent_id」）
- 提及 agentdock_memory_query 讓 agent 知道可以查記憶

### 輸入 Schema
- 用 zod 定義，SDK 會自動轉成 JSON Schema
- `.describe()` 描述每個欄位，一律英文
- 必填欄位不加 `.optional()`，選填加 `.optional()`
- enum 用 `z.enum([...])`

### 回傳格式
- 一律回傳 `{ content: [{ type: "text", text: "..." }] }`
- 成功時回傳結構化的 JSON 字串
- 失敗時 throw error 或回傳 `isError: true`

```typescript
// 成功
return {
  content: [{ type: "text", text: JSON.stringify({ 
    page_id: "xxx", 
    url: "https://notion.so/xxx",
    title: "週報" 
  })}],
};

// 失敗
return {
  content: [{ type: "text", text: "Notion is not connected. Please connect Notion at https://agentdock.app/dashboard (NOTION_NOT_CONNECTED)" }],
  isError: true,
};
```

## 與 Next.js App Router 整合

```typescript
// src/app/mcp/[apiKey]/route.ts
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export async function POST(
  request: Request,
  { params }: { params: { apiKey: string } }
) {
  // 1. 從 URL 辨識用戶
  const user = await getUserByApiKey(params.apiKey);
  if (!user) {
    return new Response("Invalid API key", { status: 401 });
  }

  // 2. 建立 transport 處理這次請求
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });

  // 3. 根據用戶已連結的 App 動態註冊工具
  const server = createServerForUser(user);

  // 4. 連接 server 和 transport
  await server.connect(transport);

  // 5. 處理請求
  return transport.handleRequest(request);
}

// GET 端點用於 SSE（某些 client 需要）
export async function GET(request: Request, { params }: { params: { apiKey: string } }) {
  // 類似 POST 但回傳 SSE stream
}
```

## 動態工具註冊

AgentDock 的關鍵特性：不是所有用戶看到同樣的工具。如果用戶只連結了 Notion，就只顯示 Notion 工具。

使用 Adapter Registry 模式，核心系統不需要知道有哪些 App 存在：

```typescript
// src/mcp/registry.ts — 啟動時自動掃描 adapters 資料夾
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

// src/mcp/server.ts — 根據用戶的已連結 App 動態註冊工具
function createServerForUser(user: User): McpServer {
  const server = new McpServer({ name: "agentdock", version: "1.0.0" });
  
  const connectedApps = await getConnectedApps(user.id);
  
  // 用 registry 自動匹配，不需要 if/else
  for (const appName of connectedApps) {
    const adapter = getAdapter(appName);
    if (!adapter) continue;
    
    for (const tool of adapter.tools) {
      server.tool(
        tool.name,
        tool.description,
        tool.inputSchema,
        async (params, extra) => {
          return executeWithMiddleware(user.id, tool.name, params, 
            (p, token) => adapter.execute(tool.name, p, token)
          );
        }
      );
    }
  }
  
  // 系統工具永遠註冊
  registerSystemTools(server, user.id);
  
  return server;
}
```

這樣做的好處：新增 App 時只需在 `src/adapters/` 加一個檔案，`server.ts` 和 `registry.ts` 完全不用改。

## 中介層模式（Middleware Pattern）

在每個工具的處理函式中，依序執行：

```typescript
async function executeWithMiddleware(
  userId: string,
  toolName: string,
  params: any,
  handler: Function
) {
  const startTime = Date.now();
  
  try {
    // 1. Token 檢查 + 自動刷新
    const token = await tokenManager.getValidToken(userId, getAppFromTool(toolName));
    
    // 2. 執行實際操作
    const result = await handler(params, token);
    
    // 3. 非同步記錄（不 await，不阻塞回傳）
    operationLogger.log({
      userId, toolName, params, result,
      success: true,
      durationMs: Date.now() - startTime,
    }).catch(console.error); // 記錄失敗不影響主流程
    
    return result;
  } catch (error) {
    // 記錄失敗操作
    operationLogger.log({
      userId, toolName, params,
      result: { error: error.message },
      success: false,
      durationMs: Date.now() - startTime,
    }).catch(console.error);
    
    throw error;
  }
}
```

## 測試 MCP Server

### 用 MCP Inspector
```bash
npx @modelcontextprotocol/inspector
```
填入你的 server URL，可以互動式測試每個工具。

### 用 curl 測試 Streamable HTTP
```bash
curl -X POST https://agentdock.app/mcp/ak_xxx \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/list",
    "id": 1
  }'
```

## 常見問題

- **工具太多導致 agent 選擇困難**：控制在 30 個以內。用清楚的描述區分相似工具。
- **agent 不使用某個工具**：通常是 description 寫得不好。先用 Inspector 確認工具有被列出來，再調整描述。
- **Streamable HTTP 連不上**：確認 CORS 設定允許 agent client 的 origin。Next.js 需要設定 response headers。
- **大回應被截斷**：MCP 沒有硬性限制，但 agent 的 context window 有。回傳精簡的結果，不要塞整個 API 回應。
