---
name: 前端審查清單
description: 16 層面完整前端審查：UI/UX（視覺、響應式、狀態、回饋、引導、a11y、i18n）+ 實作品質（效能、記憶體、React、安全、TS）+ 架構（頁面、導航、元件、資料流）
---

# 前端審查清單

修改或新增前端頁面時，逐項檢查以下 16 個層面。

---

# Part A：UI / UX

## 1. 視覺一致性

| 檢查項 | 怎麼查 | 常見問題 |
|--------|--------|----------|
| 色彩系統 | grep 所有 hex/rgb，確認只用設計系統定義的顏色 | 隨手寫的灰色 `#999` 和 `#9CA3AF` 混用 |
| 圓角 | grep `rounded`，確認統一用 `rounded-lg` | 同頁面混用 `rounded-md` 和 `rounded-lg` |
| 字級層級 | 標題 `text-sm font-semibold` > 正文 `text-xs` > 輔助 `text-[11px]` | 輔助文字比正文還大 |
| 按鈕樣式 | Primary（黑底白字）/ Secondary（border）/ Danger（紅色系）分清 | 同類按鈕樣式不同 |
| 間距 | 檢查 `space-y`、`gap`、`p`、`m` 是否同層級一致 | 卡片間距有的 `gap-3` 有的 `gap-4` |

## 2. 響應式 / 裝置適配

| 檢查項 | 怎麼查 | 修復方式 |
|--------|--------|----------|
| 三斷點 | 檢查 `sm:` `lg:` 前綴，DevTools 切 320px / 768px / 1280px | 加 responsive 前綴 |
| 文字溢出 | 長字串（email、URL）有沒有 `overflow-x-auto` 或 `truncate` | 加 `overflow-x-auto` 或 `break-all` |
| 觸控目標 | 手機上按鈕/連結的點擊區域至少 44×44px | 加 `min-h-[44px]` 或 padding |
| Flex 換行 | 橫排元素在小螢幕會不會擠爆 | 加 `flex-wrap` 或改成 `flex-col` |

## 3. 狀態完整性

每個元件/區塊都要考慮 **5 種狀態**：

| 狀態 | 檢查方式 |
|------|----------|
| **正常** | 有資料時的預期呈現 |
| **空** | 0 筆資料時顯示什麼（不能空白一片） |
| **載入中** | API 呼叫時有 loading indicator 嗎 |
| **錯誤** | 請求失敗時有錯誤提示嗎（不能靜默失敗） |
| **邊界值** | 超長文字、超多項目、特殊字元會不會爆版 |

## 4. 操作回饋

| 檢查項 | 標準 |
|--------|------|
| 按鈕點擊 | 立即視覺回饋（文字變化、顏色變化、spinner） |
| 成功/失敗 | 有 toast 或 inline 提示，不靠 console.log |
| 不可操作 | disabled 狀態有灰化 + `cursor-not-allowed` |
| 破壞性操作 | 有確認步驟（modal 或二次確認按鈕） |

## 5. 引導 / 可發現性

| 檢查項 | 標準 |
|--------|------|
| 新用戶首次體驗 | 進來就知道下一步要做什麼 |
| CTA 明確 | 主要行動按鈕視覺突出，不跟其他按鈕混 |
| 資訊層級 | 重要的不藏折疊裡，次要的不搶主要的版面 |
| 完成引導 | 操作完成後有正向回饋（不是做完就沒了） |

## 6. 無障礙（a11y）

| 檢查項 | 標準 |
|--------|------|
| 色彩對比 | 文字 vs 背景 ≥ 4.5:1（WCAG AA） |
| 鍵盤操作 | Tab 順序合理，Enter/Space 可觸發按鈕 |
| 語意標籤 | 按鈕用 `<button>` 不用 `<div onClick>`，連結用 `<a>` |
| 圖片 alt | 所有 `<Image>` / `<img>` 有 alt text |
| Focus 樣式 | 聚焦元素有可見的 outline 或 ring |

## 7. 多語系（i18n）

| 檢查項 | 怎麼查 |
|--------|--------|
| 翻譯完整 | 切英文看有沒有顯示 key 名稱（如 `dashboard.xxx`） |
| 長度適配 | 英文通常比中文長 30-50%，切換後排版不能爆 |
| 硬編碼文字 | grep JSX 中的中文/英文字串，確認都走 `t()` |
| 日期/數字格式 | 不同 locale 的日期格式（yyyy/MM/dd vs MM/dd/yyyy） |
| 中英文同步 | 用 `npm run check-sync` 驗證 key 一致性 |

---

# Part B：實作品質

## 8. 效能

| 檢查項 | 怎麼查 |
|--------|--------|
| 不必要的 re-render | state 拆太粗（一個 state 變動導致整頁重繪），缺 `useMemo`/`useCallback` |
| 大型 import | 整包 import library（`import lodash` 而不是 `import/get`） |
| 圖片未優化 | `<img>` 沒用 Next.js `<Image>`、沒設 width/height、沒 lazy loading |
| 列表缺穩定 key | `map()` 用 index 當 key，或 key 不穩定 |
| 不必要的 useEffect | 可以在 render 階段算出來的值卻用 useEffect + setState |

## 9. 記憶體洩漏

| 檢查項 | 怎麼查 |
|--------|--------|
| setTimeout 未清理 | `useEffect` 裡開 timer 但沒 return cleanup |
| fetch 未中止 | 元件 unmount 後 setState 還在跑（缺 AbortController 或 flag） |
| event listener 未移除 | `addEventListener` 沒有對應的 `removeEventListener` |
| setInterval 未清理 | 忘記在 cleanup 裡 clearInterval |

## 10. React 正確性

| 檢查項 | 怎麼查 |
|--------|--------|
| useEffect 依賴陣列 | 遺漏依賴（stale closure）或過度依賴（無限迴圈） |
| 條件式 Hook | Hook 放在 if/for 裡面（違反 Rules of Hooks） |
| 派生 state | 可以從 props/其他 state 算出來的值卻用 useState 存 |
| 非同步 setState | await 之後的 setState 沒考慮元件已 unmount |
| key 重複 | 同一層 children 有重複的 key 值 |

## 11. 安全性

| 檢查項 | 怎麼查 |
|--------|--------|
| XSS | `dangerouslySetInnerHTML`、未過濾的用戶輸入直接渲染 |
| 敏感資訊外洩 | API key、token 出現在前端程式碼或 console.log |
| CSRF | 變更操作（DELETE、POST）有沒有走認證 |
| 開放重定向 | `window.location.href = userInput` 沒有驗證 URL |

## 12. TypeScript 品質

| 檢查項 | 怎麼查 |
|--------|--------|
| `any` 型別 | grep `any`，應該用具體型別或 `unknown` |
| 型別斷言 | `as` 強轉而不做 runtime 檢查 |
| 可選鏈遺漏 | 可能是 undefined 的值沒用 `?.` |
| 未使用的變數/import | TypeScript 或 ESLint 警告 |

---

# Part C：架構

## 13. 頁面結構

| 檢查項 | 怎麼查 |
|--------|--------|
| SEO meta | 每個頁面有 `<title>`、`<meta description>`、Open Graph 標籤嗎 |
| Loading / Error 頁面 | `loading.tsx`、`error.tsx`、`not-found.tsx` 有沒有做 |
| Head 標籤 | favicon、viewport、charset 有沒有設 |
| SSR vs CSR | 該 server component 的有沒有不必要地標 `"use client"` |

## 14. 導航 / 路由

| 檢查項 | 怎麼查 |
|--------|--------|
| 死連結 | `<Link href="...">` 指向不存在的路由 |
| 未認證保護 | 需要登入的頁面有沒有 redirect 到登入頁 |
| 返回路徑 | 每個子頁面都能回到上一層（返回按鈕或麵包屑） |
| 活動狀態 | 目前所在頁面的 nav link 有 active 樣式嗎 |
| URL 一致性 | 同一個頁面有沒有多種 URL 可以到達（canonical） |

## 15. 元件設計

| 檢查項 | 標準 |
|--------|------|
| 重複程式碼 | 同樣的 UI 結構出現 2 次以上但沒抽元件 |
| Props 爆炸 | 單一元件超過 7 個 props，該拆分或用 context |
| 巨型元件 | 單一元件超過 300 行，該拆分 |
| 硬編碼 | 顏色、URL 散落各處而不是統一管理 |
| 職責混淆 | 元件同時處理 UI 渲染 + 資料取得 + 商業邏輯 |

## 16. 資料流

| 檢查項 | 怎麼查 |
|--------|--------|
| API 呼叫位置 | 應在 server component 或 route handler 取資料，不在 client 端打外部 API |
| 錯誤傳遞 | API 回傳的錯誤有沒有傳到 UI 層顯示 |
| 快取策略 | 頻繁讀取的資料有沒有用 `revalidate` 或 SWR |
| 樂觀更新 | 操作後是整頁 refresh 還是局部更新（哪個適合場景） |

---

# 執行流程

1. **讀取目標頁面及其相關元件的完整程式碼**
2. **Part A → B → C 逐層檢查**，每個層面記錄問題
3. **按嚴重度排序**：安全漏洞 > 功能壞掉 > 體驗差 > 程式碼品質
4. **列出問題清單 + 修復建議**，跟用戶確認後再改
5. **改完後用 `npx next build` 驗證**，確認沒有編譯錯誤
6. **用 `npm run check-sync` 驗證**前後端同步
