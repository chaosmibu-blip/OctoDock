# 開發者提交流程優化

## 目標
確保開發者能順利提交 Adapter spec：升級提示詞品質、加前端驗證、走一遍完整流程驗證。

## 影響範圍

1. `src/app/developers/developers-client.tsx` — 升級 buildPrompt + 加 JSON 驗證 + 加驗證錯誤提示
2. `src/lib/i18n.tsx` — 新增驗證相關的 i18n 字串（中/英）
3. `src/app/api/submissions/route.ts` — 後端也驗證 JSON 格式

## 執行步驟

### B. 升級提示詞
- buildPrompt 加入 AppAdapter 介面說明（精簡版，不貼完整 TypeScript）
- 加入一個真實 adapter 範例（用 Threads，最小且完整）
- 明確告訴 AI 要產出什麼格式、每個欄位的用途

### C. 加前端驗證
- 提交前嘗試 JSON.parse spec 欄位
- 解析成功後檢查必要結構（有 appName、有 actions 陣列、每個 action 有 name）
- 驗證失敗顯示具體錯誤訊息

### A. 走一遍驗證
- build 通過
- 手動檢查 prompt 輸出品質

## 驗證方式
- `npm run build` 通過
- 打開 /developers 頁面確認 UI 正常
- 複製產出的 prompt 確認品質
