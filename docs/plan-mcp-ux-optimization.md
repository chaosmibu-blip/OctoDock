# MCP 使用體驗優化規劃

## 1. 目標
修正 Notion 交辦文件中列出的 10 個 MCP 使用體驗問題（P0-P3）。

## 2. 影響範圍

| 檔案 | 任務 |
|------|------|
| `src/adapters/notion.ts` | N1: replace_content 保留子頁面、N2: 新增 archive_page |
| `src/adapters/types.ts` | G6: DoResult 加 affectedResources |
| `src/adapters/github.ts` | GH2: 目錄回傳精簡 |
| `src/mcp/server.ts` | G1: summary 含 parent 資訊、G5: suppress_suggestions |
| `src/mcp/middleware/pre-context.ts` | G2: 破壞性操作預檢、G3: 同名檢測 |

## 3. 執行順序
N1(P0) → G1(P0) → G2(P1) → N2(P1) → GH2(P2) → G3(P2) → G5(P3) → G6(P3)

## 4. 驗證
- npm run build 通過
