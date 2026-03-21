# OctoDock Channel Plugin 開發規劃

## 1. 目標

開發 Claude Code Channel Plugin + 後端事件推送 endpoint，讓 OctoDock 的 App 事件能主動推進 Claude Code session。同時修正 Notion 交辦文件中的 8 項瑕疵。

## 2. 影響範圍

### 文件修正（Notion）
- `交辦：OctoDock Channel Plugin 開發` — 修正 8 項瑕疵

### 後端新增
| 檔案 | 說明 |
|------|------|
| `src/app/api/events/[apiKey]/route.ts` | SSE 事件推送 endpoint |
| `src/mcp/events/event-bus.ts` | 事件匯流排：接收 webhook/操作事件 → 廣播給 SSE 連線 |
| `src/mcp/events/types.ts` | 事件 JSON schema 定義 |
| `src/db/schema.ts` | 新增 `event_subscriptions` 表（追蹤用戶訂閱的事件類型） |

### Plugin 新增（獨立目錄）
| 檔案 | 說明 |
|------|------|
| `plugins/channel/src/index.ts` | Channel Plugin 主程式（~80 行） |
| `plugins/channel/src/reply-tool.ts` | reply tool — 讓 Claude Code 透過 OctoDock 回覆 |
| `plugins/channel/package.json` | Plugin 依賴（@modelcontextprotocol/sdk, eventsource） |
| `plugins/channel/tsconfig.json` | TypeScript 設定 |
| `plugins/channel/.claude-plugin/plugin.json` | Plugin metadata |
| `plugins/channel/.mcp.json` | MCP server 設定 |
| `plugins/channel/README.md` | 使用說明 |

### 現有檔案修改
| 檔案 | 說明 |
|------|------|
| `src/app/api/webhook/[platform]/route.ts` | webhook 收到事件後發送到 event-bus |
| `package.json` | workspace 設定（如果用 monorepo） |

## 3. 執行步驟

### Phase 1：修正 Notion 文件（可與 Phase 2 並行）
1. 更新 Notion 頁面，修正 8 項瑕疵

### Phase 2：後端事件推送
1. 定義事件 schema（`events/types.ts`）
2. 實作事件匯流排（`events/event-bus.ts`）
3. 實作 SSE endpoint（`api/events/[apiKey]/route.ts`）
4. 修改 webhook handler，接入 event-bus

### Phase 3：Channel Plugin
1. 建立 plugin 目錄結構
2. 實作 Channel Plugin 主程式
3. 實作 reply tool
4. 編譯 + 本地測試

## 4. 驗證方式

- `npm run build` 通過
- SSE endpoint 可用 `curl` 測試連線
- Plugin 可用 `--dangerously-load-development-channels` 本地測試
- webhook 進來的事件能推到 SSE 連線

## 5. 風險

- **無破壞性變更**：全部是新增檔案 + endpoint
- **不需 DB migration**：event subscription 可先用記憶體管理，不急著加表
- **Channels API 仍在 research preview**：API 可能變動，但核心概念（stdio + notification）穩定
- **SSE 連線管理**：需處理斷線重連、連線清理，避免記憶體洩漏
