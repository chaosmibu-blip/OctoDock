# MCP 使用體驗優化 Round 2

## 影響範圍
| 檔案 | 任務 |
|------|------|
| `src/mcp/server.ts` | A: action alias |
| `src/mcp/response-formatter.ts` | B: HTML 清除, H: timestamp 轉換 |
| `src/mcp/middleware/param-guard.ts` | C: Drive auto-convert 智慧判斷 |
| `src/mcp/system-actions.ts` | E: batch_do partial, F: multi_search failedApps, G: find_tool 中文 |
