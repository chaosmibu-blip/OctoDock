---
name: 視覺設計與美學
description: 持續優化前端視覺品質的設計規範。每次修改或新增前端頁面時檢查，確保視覺一致性和專業質感。
---

# 視覺設計與美學

每次修改 `src/app/` 或 `src/components/` 時，除了 `ui-review.md` 的 16 層面檢查，還要過這份美學清單。

---

## 設計系統（shadcn/ui + OctoDock 品牌）

### 色彩

| 用途 | 色值 | 說明 |
|------|------|------|
| 品牌主色 | `--primary` (shadcn) | 按鈕、連結、強調 |
| 品牌綠 | `#0F6E56` / `#1D9E75` | OctoDock 識別色，用於成功狀態和品牌區塊 |
| 背景 | `#faf9f6` | 暖白，全站統一背景 |
| 卡片 | `white` | 內容區塊 |
| 文字主色 | `gray-900` | 標題 |
| 文字次色 | `gray-500` | 說明文字 |
| 文字輔助 | `gray-300` / `gray-400` | 提示、placeholder |
| 錯誤 | `red-500` | 錯誤訊息、危險操作 |
| 警告 | `amber-500` | 注意事項 |

**規則**：不隨手寫 hex 色碼。所有顏色從上表或 shadcn/ui 的 CSS 變數取用。

### 字級

| 層級 | Class | 用途 |
|------|-------|------|
| 頁面標題 | `text-xl font-bold` | 最多一個 |
| 區塊標題 | `text-sm font-semibold` | 卡片/區塊頭 |
| 正文 | `text-sm` | 主要內容 |
| 說明文字 | `text-xs` | 輔助資訊 |
| 微文字 | `text-[11px]` | 按鈕文字、標籤 |
| 極小文字 | `text-[10px]` | hint、提示 |

**規則**：同一層級的文字大小必須一致。標題 > 正文 > 說明的層級不能打亂。

### 間距

| 用途 | 值 | 說明 |
|------|-----|------|
| 頁面 padding | `px-4 py-6` | 最外層 |
| 區塊間距 | `space-y-5` | 主要區塊之間 |
| 卡片內距 | `p-4` | 卡片內部 |
| 元素間距 | `gap-2` / `gap-3` | 行內元素之間 |
| 按鈕內距 | `px-3 py-1.5` | 統一按鈕尺寸 |

**規則**：間距只用 Tailwind 的 spacing scale（0.5, 1, 1.5, 2, 3, 4, 5, 6），不用任意值。

### 圓角

| 用途 | Class |
|------|-------|
| 卡片/區塊 | `rounded-lg` |
| 按鈕 | `rounded-lg` |
| 輸入框 | `rounded-lg` |
| 頭像/圖示 | `rounded-full` |

**規則**：全站統一 `rounded-lg`，不混用 `rounded-md`、`rounded-xl`。

### 陰影與邊框

| 用途 | Class |
|------|-------|
| 已連接卡片 | `border border-gray-200` |
| 未連接卡片 | `border border-dashed border-gray-300` |
| 彈窗/Modal | `shadow-lg` |
| Hover 提升 | `hover:shadow-md transition-shadow` |

---

## 質感提升清單

每次修改前端頁面時，逐項檢查：

### 1. 過渡動畫
- [ ] 按鈕 hover 有 `transition-colors`（已有的不要移除）
- [ ] 頁面切換有淡入效果（`animate-fadein`）
- [ ] 展開/收合有過渡（不是突然出現/消失）
- [ ] Loading 狀態有 skeleton 或 spinner，不是空白等待

### 2. 視覺層次
- [ ] 頁面有明確的視覺焦點（CTA 按鈕最突出）
- [ ] 資訊有主次之分（重要的大且深色，次要的小且淺色）
- [ ] 留白充足（不擠、不空，呼吸感適中）
- [ ] 分組清楚（相關的靠近，不相關的用間距或分隔線區分）

### 3. 互動回饋
- [ ] 可點擊的元素有 hover 效果（顏色變化或陰影）
- [ ] 不可操作的元素有 `opacity-50 cursor-not-allowed`
- [ ] 操作成功有正向回饋（綠色提示、打勾動畫）
- [ ] 操作失敗有明確提示（紅色文字、說明原因和解法）

### 4. 空狀態設計
- [ ] 0 筆資料時不是空白一片，有說明文字和行動建議
- [ ] 新用戶首次進入有引導提示
- [ ] 錯誤頁面有返回路徑（不是死胡同）

### 5. 細節打磨
- [ ] icon 和文字垂直置中（`items-center`）
- [ ] 長文字有 `truncate` 或 `overflow-hidden`，不會撐破版面
- [ ] 數字有千分位或單位（`1,234` 不是 `1234`、`2.5KB` 不是 `2560`）
- [ ] 日期有格式化（`2026/03/22` 不是 ISO 字串）

---

## 使用 shadcn/ui 元件

**優先用 shadcn/ui 元件，不手寫基礎 UI：**

| 需求 | 用 shadcn/ui | 不要手寫 |
|------|-------------|---------|
| 按鈕 | `<Button>` | `<button className="px-3 py-1.5 bg-black...">` |
| 輸入框 | `<Input>` | `<input className="border rounded...">` |
| 卡片 | `<Card>` | `<div className="rounded-lg border...">` |
| 對話框 | `<Dialog>` | 手寫 modal |
| 下拉選單 | `<Select>` | `<select>` |
| Toast 提示 | `<Toast>` | 手寫 toast |

**規則**：新頁面必須用 shadcn/ui 元件。既有頁面在修改時逐步遷移，不用一次全改。

---

## 執行時機

| 觸發條件 | 動作 |
|----------|------|
| 新增頁面 | 必須用 shadcn/ui 元件 + 過完上面的清單 |
| 修改既有頁面 | 順手把碰到的元件升級成 shadcn/ui |
| 每次 commit 前 | 快速掃一遍質感清單的 5 個區塊 |
| 用戶反饋「不好看」 | 讀這份 skill，找到具體的改進項目 |
