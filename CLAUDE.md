# AgentDock

> 一個 MCP URL，讓任何 agent 都能用你所有的 App，而且越用越懂你。

## 你在做什麼

AgentDock 是一個面向非技術用戶的基礎設施產品。用戶只需設定一個 MCP URL，就能讓任何 AI agent 操作所有已授權的 App，並擁有跨 agent 共享的操作記憶。

## 技術棧

- **語言**：TypeScript
- **MCP Server**：@modelcontextprotocol/sdk（Streamable HTTP）
- **Web 框架**：Next.js（App Router）
- **資料庫**：PostgreSQL + pgvector
- **ORM**：Drizzle ORM
- **用戶認證**：NextAuth.js（Google 登入）
- **Token 加密**：AES-256-GCM
- **部署**：Replit（MVP）→ Railway

## 核心架構：Adapter Registry

每個 App 是一個獨立的 Adapter 模組（`src/adapters/*.ts`），實作統一的 `AppAdapter` 介面。核心系統啟動時自動掃描 adapters 資料夾、自動註冊。

**加一個新 App = 在 adapters/ 加一個檔案，核心系統不用改。**

## 開發原則

1. **治本優先**：修正問題根源，不在程式碼中打補丁
2. **最小權限**：每個 App 只申請必要的 OAuth scopes
3. **Token 絕不明文**：日誌、回應、錯誤訊息中絕不包含明文 token
4. **錯誤隔離**：一個 App 掛掉不影響其他 App
5. **非同步記錄**：操作記錄不阻塞主請求
6. **MCP 工具描述英文**：name 和 description 一律英文（模型理解最佳）
7. **用戶介面多語系**：Dashboard 等用戶看的介面預設繁中
8. **所有程式碼都要加註解**：每個函式、每個區塊都要有中文註解說明用途和邏輯

## 語言策略

| 對象 | 語言 |
|------|------|
| MCP 工具名稱 + 描述 | 英文 |
| 用戶介面 | 多語系（預設繁中） |
| 錯誤訊息 | 雙語：`「Notion 未連結 (NOTION_NOT_CONNECTED)」` |

## 文件索引

- **完整規格書**：`agentdock-spec.md`（資料庫 schema、OAuth 流程、工具定義、專案結構、環境變數）
- **開發指南**：`.claude/agents/agentdock-dev.md`（產品定位、Adapter Registry、開發階段、市場定位）
- **MCP 開發**：`.claude/agents/mcp-server-builder.md`（MCP Server 建置、工具定義最佳實踐）
- **認證開發**：`.claude/agents/oauth-integrator.md`（OAuth 2.0、API Key、Bot Token 三種認證方式）
