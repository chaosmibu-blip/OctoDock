# Gamma API Reference

> 研究日期：2026-03-19
> API 版本：v1.0 GA（2025-11-05 正式發布）
> 官方文件：https://developers.gamma.app

## 認證

- **方式**：API Key（非 OAuth）
- **Header**：`X-API-KEY: {api_key}`
- **取得方式**：Gamma 帳號 > Account Settings > API Keys
- **付費限制**：需 Pro（$18/月）以上方案，免費帳號無法使用 API

## Base URL

```
https://public-api.gamma.app/v1.0/
```

## Credit 計費

每次 API 呼叫消耗 credits，數量取決於 AI 模型和生成內容。Pro 方案每月 4,000 credits。

## 端點總覽

| 端點 | Method | 用途 |
|------|--------|------|
| `/generations` | POST | 從文字/prompt 生成簡報 |
| `/generations/{generationId}` | GET | 查詢生成狀態（非同步 polling） |
| `/generations/from-template` | POST | 從模板生成 |
| `/themes` | GET | 列出可用主題 |
| `/folders` | GET | 列出工作區資料夾 |

## 生成流程（非同步）

1. POST `/generations` → 取得 `generationId`
2. GET `/generations/{generationId}` → polling 每 5 秒
3. 狀態變為 `completed` → 取得結果 URL 和（可選）匯出檔案

## POST /generations

### 參數

| 參數 | 必填 | 說明 |
|------|------|------|
| `inputText` | ✅ | 內容文字（最多 ~400,000 字元） |
| `format` | ✅ | `presentation` / `document` / `social` |
| `textMode` | | `generate`（展開）/ `condense`（濃縮）/ `preserve`（保留原文） |
| `textOptions.amount` | | `brief` / `medium` / `detailed` / `extensive` |
| `textOptions.tone` | | 語調描述（僅 generate 模式） |
| `textOptions.audience` | | 目標受眾 |
| `textOptions.language` | | 輸出語言 |
| `numCards` | | 頁數/卡片數 |
| `dimensions` | | `fluid`（預設）/ `16x9` / `4x3` |
| `exportAs` | | `pdf` / `pptx` / `png`（每次一種） |
| `themeId` / `themeName` | | 主題選擇 |
| `folderIds` | | 目標資料夾 |
| `additionalInstructions` | | 額外生成指示 |
| `imageOptions.model` | | 圖片生成模型 |
| `sharingOptions.workspaceAccess` | | `noAccess` / `view` / `comment` / `edit` / `fullAccess` |

### 回傳

```json
{
  "generationId": "abc123",
  "status": "pending"
}
```

## GET /generations/{generationId}

### 回傳（completed）

```json
{
  "generationId": "abc123",
  "status": "completed",
  "url": "https://gamma.app/docs/xxx",
  "title": "My Presentation",
  "credits": {
    "deducted": 40,
    "remaining": 3960
  },
  "exportUrl": "https://..."
}
```

### 狀態值

- `pending` — 排隊中
- `in_progress` — 生成中
- `completed` — 完成
- `failed` — 失敗

## POST /generations/from-template

### 參數

| 參數 | 必填 | 說明 |
|------|------|------|
| `gammaId` | ✅ | 模板的 Gamma ID |
| `inputText` | | 內容 + 圖片 URL + 指示 |
| `exportAs` | | `pdf` / `pptx` / `png` |
| `folderIds` | | 目標資料夾 |

## GET /themes

列出工作區可用主題。回傳主題 ID 和名稱。

## GET /folders

列出工作區資料夾。回傳資料夾 ID 和名稱。

## Rate Limits

無硬性限制。收到 HTTP 429 時需聯繫 Gamma 支援。

## API 限制（不支援的功能）

- ❌ 列出既有簡報
- ❌ 取得簡報內容
- ❌ 編輯/更新簡報
- ❌ 刪除簡報
- ❌ 搜尋簡報

API 目前只支援「生成」和「匯出」，沒有 CRUD。
