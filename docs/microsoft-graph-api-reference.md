# Microsoft Graph API Reference (Word / Excel / PowerPoint)

> OctoDock Adapter 開發用 API 規格文件
> 研究日期：2026-03-22

## 目錄

1. [總覽與架構決策](#總覽與架構決策)
2. [認證（OAuth 2.0）](#認證oauth-20)
3. [免費額度與定價](#免費額度與定價)
4. [速率限制](#速率限制)
5. [Excel API（最成熟）](#excel-api最成熟)
6. [Word API（受限）](#word-api受限)
7. [PowerPoint API（受限）](#powerpoint-api受限)
8. [Node.js SDK](#nodejs-sdk)
9. [OctoDock Adapter 設計建議](#octodock-adapter-設計建議)
10. [已知限制與地雷](#已知限制與地雷)

---

## 總覽與架構決策

Microsoft Graph API 是 Microsoft 365 的統一 REST API 閘道。Word、Excel、PowerPoint 檔案都存在 OneDrive / SharePoint 中，透過 DriveItem API 存取。

**關鍵發現：三個產品的 API 成熟度差異極大。**

| 產品 | Graph API 成熟度 | 內容級操作 | 建議策略 |
|------|-----------------|-----------|---------|
| **Excel** | 成熟（GA） | 完整 CRUD（cells、ranges、tables、charts、formulas） | 直接用 Graph REST API |
| **Word** | 僅檔案級 | 無法直接讀寫段落/文字，只能下載/上傳二進位流 | Graph（檔案管理）+ `docx` npm（內容操作） |
| **PowerPoint** | 僅檔案級 | 同 Word，無 slide 級 API | Graph（檔案管理）+ `officegen`/`pptxgenjs` npm（內容操作） |

**一個 Azure AD App 可以同時處理三個產品。** 它們共用同一組 OAuth scopes（`Files.ReadWrite`），因為底層都是 OneDrive/SharePoint 檔案操作。

---

## 認證（OAuth 2.0）

### Azure AD App Registration（一次設定，三產品共用）

1. 前往 [Azure Portal](https://portal.azure.com) > Microsoft Entra ID > App registrations > New registration
2. 設定 Redirect URI（Web 類型）：`https://octo-dock.com/api/auth/callback/microsoft`
3. 在 Certificates & secrets 建立 Client secret
4. 在 API permissions 加入所需權限

### OAuth 2.0 Authorization Code Flow

**授權端點：**
```
GET https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize
```

**Token 端點：**
```
POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token
```

**Tenant 值：**
- `common` — 同時支援個人帳號和工作/學校帳號
- `organizations` — 僅工作/學校帳號
- `consumers` — 僅個人 Microsoft 帳號

**建議用 `common` 以支援最廣的用戶群。**

### 必要 Scopes

```
offline_access          # 取得 refresh token（必要）
Files.ReadWrite         # 讀寫 OneDrive 檔案（Word/Excel/PPT 都需要）
Files.ReadWrite.All     # 讀寫所有可存取的檔案（含 SharePoint）
Sites.ReadWrite.All     # SharePoint 網站檔案存取（選用）
User.Read               # 基本用戶資訊（建議加）
```

**最小可行 scopes：** `offline_access Files.ReadWrite User.Read`

### Refresh Token 機制

- 授權時必須包含 `offline_access` scope 才會回傳 refresh token
- Access token 有效期約 3600 秒（1 小時）
- Refresh token 長期有效，每次使用會回傳新的 refresh token（滾動更新）
- Refresh 端點同 token 端點，`grant_type=refresh_token`

**Refresh 請求範例：**
```
POST https://login.microsoftonline.com/common/oauth2/v2.0/token
Content-Type: application/x-www-form-urlencoded

client_id={app_id}
&scope=Files.ReadWrite User.Read offline_access
&refresh_token={refresh_token}
&grant_type=refresh_token
&client_secret={client_secret}
```

### 環境變數（OctoDock）

```
MICROSOFT_CLIENT_ID=     # Azure AD App (client) ID
MICROSOFT_CLIENT_SECRET= # Client secret
```

Google 系共用 `GOOGLE_CLIENT_ID`，Microsoft 系共用 `MICROSOFT_CLIENT_ID`。在 `oauth-env.ts` 中統一映射。

---

## 免費額度與定價

### Graph API 本身免費

Microsoft Graph API **不收費**。費用在用戶的 Microsoft 365 訂閱上：

| 方案 | 價格（美金/月） | OneDrive 空間 | 包含 App |
|------|---------------|-------------|---------|
| Microsoft 365 Basic | $1.99 | 100 GB | Web 版 Office |
| Microsoft 365 Personal | $6.99 | 1 TB | 完整桌面版 Office |
| Microsoft 365 Family | $9.99 | 6 TB | 最多 6 人 |
| Microsoft 365 Business Basic | $6.00/user | 1 TB/user | Web + Mobile |
| Microsoft 365 Business Standard | $12.50/user | 1 TB/user | 完整桌面版 |

### 開發者測試

- **Microsoft 365 Developer Program**：提供免費 E5 sandbox（25 licenses）
- 2025 年起限制加入資格：需有 Visual Studio 訂閱或 Partner Program 資格
- Sandbox 每 90 天自動續期（需有開發活動）

### 對 OctoDock 用戶的影響

用戶必須有 Microsoft 365 帳號（個人或企業）。免費的 Microsoft 帳號（outlook.com）也可以存取 OneDrive 上的檔案（5 GB 免費空間），但某些進階 API 功能可能受限。

**重要：Excel REST API 目前只支援 OneDrive for Business / SharePoint 上的檔案，不支援個人 OneDrive（consumer）上的檔案。**

---

## 速率限制

### 全域限制

| 範圍 | 限制 |
|------|------|
| 所有 API，per app，跨所有 tenant | **130,000 requests / 10 秒** |

### Excel API 專屬限制

| 範圍 | 限制 |
|------|------|
| Per app，跨所有 tenant | **5,000 requests / 10 秒** |
| Per app，per tenant | **1,500 requests / 10 秒** |

### OneDrive / SharePoint 限制

未公開精確數字，參考 SharePoint throttling 文件。一般觀察：
- 約 **600 requests / 分鐘 / user**
- 大量檔案操作建議用 batch API

### Throttling 行為

- 超過限制回傳 `429 Too Many Requests`
- Response header 包含 `Retry-After`（秒數）
- 使用 token bucket 演算法計算
- **2025/09/30 起**：per-app/per-user/per-tenant 限制降為 per-tenant 總額的一半

### OctoDock Adapter 應對策略

1. 遵守 `Retry-After` header
2. Excel 操作使用 session 模式（減少重複的 workbook 開啟成本）
3. 寫入操作不要並行，用佇列序列處理
4. 搭配 circuit-breaker middleware

---

## Excel API（最成熟）

Excel 是三個產品中 API 最完整的，有專屬的 workbook REST API，支援 cell 級別的 CRUD 操作。

### Base URL

```
https://graph.microsoft.com/v1.0/me/drive/items/{item-id}/workbook/
https://graph.microsoft.com/v1.0/me/drive/root:/{path}:/workbook/
```

### 支援的檔案格式

**僅支援 Office Open XML (.xlsx)**。不支援 .xls（舊格式）。

### Session 管理

Excel API 建議使用 session 模式提升效率：

```
POST .../workbook/createSession
Body: { "persistChanges": true }
→ 回傳 session-id，後續請求帶 header: workbook-session-id: {session-id}
```

- **Persistent session**：變更會存檔。約 5 分鐘閒置後過期。
- **Non-persistent session**：變更不存檔（用於分析/計算）。約 7 分鐘閒置後過期。
- **Sessionless**：不帶 session header，每次請求獨立。效率最低但最簡單。

### 完整 API 端點列表

#### Worksheet 操作
| 操作 | Method | Endpoint |
|------|--------|----------|
| 列出工作表 | GET | `.../workbook/worksheets` |
| 取得工作表 | GET | `.../workbook/worksheets/{name}` |
| 新增工作表 | POST | `.../workbook/worksheets` |
| 更新工作表 | PATCH | `.../workbook/worksheets/{name}` |
| 刪除工作表 | DELETE | `.../workbook/worksheets/{id}` |

#### Range 操作（讀寫儲存格）
| 操作 | Method | Endpoint |
|------|--------|----------|
| 讀取 range | GET | `.../worksheets/{name}/range(address='A1:B2')` |
| 寫入 range | PATCH | `.../worksheets/{name}/range(address='A1:B2')` |
| 讀取單一 cell | GET | `.../worksheets/{name}/cell(row=0,column=0)` |
| 取得已使用範圍 | GET | `.../worksheets/{name}/usedRange` |
| 排序 range | POST | `.../worksheets/{name}/usedRange/sort/apply` |

**Range 回傳格式（JSON）：**
```json
{
  "address": "Sheet1!A1:B2",
  "values": [["Hello", 42], ["World", 99]],
  "formulas": [["", "=SUM(A1:A2)"], ["", ""]],
  "numberFormat": [["General", "General"], ["General", "General"]],
  "text": [["Hello", "42"], ["World", "99"]]
}
```

#### Table 操作
| 操作 | Method | Endpoint |
|------|--------|----------|
| 列出表格 | GET | `.../worksheets/{name}/tables` |
| 建立表格 | POST | `.../tables/add` |
| 更新表格 | PATCH | `.../tables/{id}` |
| 刪除表格 | DELETE | `.../tables/{id}` |
| 列出列 | GET | `.../tables/{id}/rows` |
| 新增列 | POST | `.../tables/{id}/rows/add` |
| 刪除列 | DELETE | `.../tables/{id}/rows/$/itemAt(index={n})` |
| 列出欄 | GET | `.../tables/{id}/columns` |
| 新增欄 | POST | `.../tables/{id}/columns` |
| 刪除欄 | DELETE | `.../tables/{id}/columns/{id}` |
| 排序 | POST | `.../tables/{id}/sort/apply` |
| 篩選 | POST | `.../tables/{id}/columns({id})/filter/apply` |
| 清除篩選 | POST | `.../tables/{id}/columns({id})/filter/clear` |
| 轉為 range | POST | `.../tables/{id}/convertToRange` |

#### Chart 操作
| 操作 | Method | Endpoint |
|------|--------|----------|
| 列出圖表 | GET | `.../worksheets/{name}/charts` |
| 建立圖表 | POST | `.../worksheets/{name}/charts/Add` |
| 更新圖表 | PATCH | `.../charts/{id}` |
| 取得圖表圖片 | GET | `.../charts/{id}/Image(width=0,height=0,fittingMode='fit')` |
| 設定數據源 | POST | `.../charts/{id}/setData` |

**建立圖表範例：**
```json
POST .../charts/Add
{ "type": "ColumnClustered", "sourcedata": "A1:C4", "seriesby": "Auto" }
```

#### Named Items
| 操作 | Method | Endpoint |
|------|--------|----------|
| 列出命名範圍 | GET | `.../workbook/names` |

#### Workbook Functions（300+ 函式）
| 操作 | Method | Endpoint |
|------|--------|----------|
| 執行函式 | POST | `.../workbook/functions/{functionName}` |

**範例（VLOOKUP）：**
```json
POST .../workbook/functions/vlookup
{
  "lookupValue": "pear",
  "tableArray": {"Address": "Sheet1!B2:C7"},
  "colIndexNum": 2,
  "rangeLookup": false
}
```

#### Pivot Tables
| 操作 | Method | Endpoint |
|------|--------|----------|
| 列出樞紐分析表 | GET | `.../worksheets/{name}/pivotTables` |
| 重新整理樞紐分析表 | POST | `.../pivotTables/{id}/refresh` |
| 重新整理所有樞紐分析表 | POST | `.../worksheets/{name}/pivotTables/refreshAll` |

**注意：只能列出和重新整理（refresh），不能透過 API 建立新的 pivot table。**

### Excel 的回答（Specific Questions）

| 問題 | 答案 |
|------|------|
| 可以讀寫 cells/ranges/sheets？ | 完全可以，這是 Excel API 的核心功能 |
| 可以設定 formulas？ | 可以，寫入 range 時用 `formulas` 欄位 |
| 可以建立 charts？ | 可以，支援建立、更新、取得圖片 |
| 可以管理 pivot tables？ | 部分支援：可列出、可 refresh，但不能建立新的 |
| Cell limit per request？ | 無硬性上限，但超過 5M cells 的 range 部分屬性會回傳 null。建議分批處理大範圍 |

---

## Word API（受限）

### 核心限制

**Microsoft Graph API 沒有 Word 文件的內容級 API。** 無法直接讀取段落、插入文字、做 find/replace、管理 headers/footers。

只有**檔案級操作**：下載、上傳、轉換格式、管理 metadata。

### 可用的 API 端點

#### 檔案操作（透過 DriveItem API）
| 操作 | Method | Endpoint |
|------|--------|----------|
| 列出檔案 | GET | `/me/drive/root/children` |
| 搜尋檔案 | GET | `/me/drive/root/search(q='keyword')` |
| 下載檔案 | GET | `/me/drive/items/{id}/content` |
| 上傳檔案（< 4MB） | PUT | `/me/drive/items/{id}/content` |
| 上傳檔案（< 250MB） | PUT | `/me/drive/root:/{path}:/content` |
| 大檔上傳（> 4MB） | POST | `/me/drive/items/{id}/createUploadSession` |
| 刪除檔案 | DELETE | `/me/drive/items/{id}` |
| 複製檔案 | POST | `/me/drive/items/{id}/copy` |
| 移動/重命名 | PATCH | `/me/drive/items/{id}` |
| 取得 metadata | GET | `/me/drive/items/{id}` |

#### 格式轉換
| 操作 | Method | Endpoint |
|------|--------|----------|
| 轉 PDF | GET | `/me/drive/items/{id}/content?format=pdf` |

**支援的來源格式轉 PDF：** doc, docx, dot, dotx, dotm, epub, htm, html, md, odt, rtf, ppt, pptx, xls, xlsx 等

### Word 的 Workaround（下載→處理→上傳）

由於 Graph API 只回傳二進位流，需要搭配 Node.js 函式庫：

1. **下載 .docx 檔案**（Graph API `GET .../content`）
2. **用 Node.js 函式庫處理內容**
3. **上傳回去**（Graph API `PUT .../content`）

**推薦的 Node.js 函式庫：**

| 函式庫 | 用途 | 星數 |
|--------|------|------|
| [`docx`](https://www.npmjs.com/package/docx) | 建立新 .docx（從頭寫） | 3.5k+ |
| [`mammoth`](https://www.npmjs.com/package/mammoth) | .docx → HTML / 純文字（讀取） | 4.5k+ |
| [`docxtemplater`](https://www.npmjs.com/package/docxtemplater) | 基於模板修改 .docx（讀+改） | 2.5k+ |

**建議組合：**
- 讀取內容：`mammoth`（轉 HTML 或純文字，給 AI 看很友善）
- 建立新檔：`docx`（功能最完整）
- 基於模板修改：`docxtemplater`

### Word 的回答（Specific Questions）

| 問題 | 答案 |
|------|------|
| 可以讀寫文件內容？ | 不能直接透過 Graph API。需下載→用函式庫解析→修改→上傳 |
| 內容回傳格式？ | 二進位流（.docx = OOXML zip）。可用 mammoth 轉成 HTML 或純文字 |
| 可以建立新文件？ | Graph API 可上傳空 .docx。用 `docx` npm 從頭建立內容 |
| Find/replace, 圖片, headers/footers？ | Graph API 不支援。需用 `docxtemplater` 或 `docx` 函式庫 |

---

## PowerPoint API（受限）

### 核心限制

**同 Word，Microsoft Graph API 沒有 PowerPoint 的 slide 級 API。** 無法直接讀取 slide 內容、新增文字/圖片/形狀。

只有**檔案級操作**（同 Word 的 DriveItem API）。

### 可用的 API 端點

與 Word 完全相同（都是 DriveItem API），參見上方 Word 的檔案操作端點。

### PowerPoint 的 Workaround

同 Word 策略：下載→處理→上傳。

**推薦的 Node.js 函式庫：**

| 函式庫 | 用途 |
|--------|------|
| [`pptxgenjs`](https://www.npmjs.com/package/pptxgenjs) | 建立新簡報（功能最完整，支援文字/圖片/形狀/表格/圖表） |
| [`officegen`](https://www.npmjs.com/package/officegen) | 建立 .pptx/.docx/.xlsx（較舊，功能較少） |

**注意：** 讀取/解析現有 .pptx 的 Node.js 函式庫生態較弱。可能需要用 `jszip` 解壓 .pptx（本質是 zip）再解析 XML。

### PowerPoint 的回答（Specific Questions）

| 問題 | 答案 |
|------|------|
| 可以讀寫 slides？ | 不能直接透過 Graph API。需下載→函式庫處理→上傳 |
| 可以加文字/圖片/形狀？ | 只能透過 `pptxgenjs` 等函式庫在 Node.js 處理 |
| 可以從頭建立？ | 可以，用 `pptxgenjs`，然後上傳到 OneDrive |
| API 成熟度？ | 最低。Graph API 只有檔案級操作，slide 級操作完全沒有 |

---

## Node.js SDK

### 兩個 SDK 選擇

#### 1. `@microsoft/microsoft-graph-client`（穩定，推薦）
```bash
npm install @microsoft/microsoft-graph-client
npm install -D @microsoft/microsoft-graph-types
```

```typescript
import { Client } from "@microsoft/microsoft-graph-client";

// 用 access token 初始化
const client = Client.init({
  authProvider: (done) => {
    done(null, accessToken);
  },
});

// 讀取檔案列表
const files = await client.api("/me/drive/root/children").get();

// 讀取 Excel range
const range = await client
  .api(`/me/drive/items/${itemId}/workbook/worksheets/Sheet1/range(address='A1:C10')`)
  .get();

// 寫入 Excel range
await client
  .api(`/me/drive/items/${itemId}/workbook/worksheets/Sheet1/range(address='A1:B2')`)
  .patch({ values: [["Name", "Score"], ["Alice", 95]] });
```

#### 2. `@microsoft/msgraph-sdk`（新版，模組化）
```bash
npm install @microsoft/msgraph-sdk @microsoft/msgraph-sdk-drives
```

新版 SDK 用模組化設計，按 API 路徑拆分 npm 套件。但套件體積較大、文件較少。

**OctoDock 建議用 `@microsoft/microsoft-graph-client`：** 更穩定、文件更多、社群更活躍。OctoDock 的其他 adapter 也是直接呼叫 REST API 而非用 SDK 的 fluent API，保持一致性。

### 實際上不需要 SDK

OctoDock 的 adapter 模式是直接用 `fetch` 呼叫 REST API（與其他 adapter 一致），不需要安裝 Microsoft Graph SDK。只需要：

```typescript
const response = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${itemId}/workbook/worksheets`, {
  headers: {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  },
});
```

---

## OctoDock Adapter 設計建議

### 架構：拆成 3 個 Adapter 或 1 個？

**建議拆成 3 個獨立 Adapter：** `microsoft-word.ts`、`microsoft-excel.ts`、`microsoft-powerpoint.ts`

理由：
1. Excel 的 API 遠比 Word/PPT 豐富，actionMap 差異大
2. 用戶可能只連 Excel 不連 Word
3. 符合 OctoDock「一個 App = 一個 Adapter」的架構

但 **OAuth 共用一個連線**（三個 Adapter 共用同一個 Microsoft 帳號的 token）。在 `oauth-env.ts` 中映射：

```typescript
"microsoft-word": { clientId: "MICROSOFT_CLIENT_ID", clientSecret: "MICROSOFT_CLIENT_SECRET" },
"microsoft-excel": { clientId: "MICROSOFT_CLIENT_ID", clientSecret: "MICROSOFT_CLIENT_SECRET" },
"microsoft-powerpoint": { clientId: "MICROSOFT_CLIENT_ID", clientSecret: "MICROSOFT_CLIENT_SECRET" },
```

### 建議的 Action Map

#### microsoft-excel
```typescript
actionMap: {
  // Workbook / File
  "list-files": "List Excel files in OneDrive",
  "search-files": "Search Excel files",

  // Worksheet
  "list-sheets": "List worksheets in a workbook",
  "create-sheet": "Create a new worksheet",
  "delete-sheet": "Delete a worksheet",

  // Range / Cells
  "read-range": "Read cell values from a range",
  "write-range": "Write values to a range",
  "read-cell": "Read a single cell",

  // Table
  "list-tables": "List tables in a worksheet",
  "create-table": "Create a new table",
  "add-rows": "Add rows to a table",
  "delete-rows": "Delete rows from a table",

  // Chart
  "list-charts": "List charts in a worksheet",
  "create-chart": "Create a chart from data range",

  // Functions
  "run-function": "Execute an Excel function (300+ supported)",

  // Pivot Tables
  "list-pivots": "List pivot tables",
  "refresh-pivots": "Refresh pivot table data",
}
```

#### microsoft-word
```typescript
actionMap: {
  "list-files": "List Word documents in OneDrive",
  "search-files": "Search Word documents",
  "read-document": "Read document content as text/HTML",
  "create-document": "Create a new Word document",
  "update-document": "Update document content",
  "delete-file": "Delete a Word document",
  "convert-pdf": "Convert Word document to PDF",
  "get-metadata": "Get document metadata",
}
```

#### microsoft-powerpoint
```typescript
actionMap: {
  "list-files": "List PowerPoint files in OneDrive",
  "search-files": "Search PowerPoint files",
  "read-presentation": "Read presentation content",
  "create-presentation": "Create a new presentation",
  "delete-file": "Delete a presentation",
  "convert-pdf": "Convert presentation to PDF",
  "get-metadata": "Get presentation metadata",
}
```

### formatResponse 建議

- **Excel range**：轉成 Markdown 表格（AI 友善）
- **Word 內容**：用 mammoth 轉成 Markdown 或純文字
- **PowerPoint**：列出 slide 標題和文字內容

---

## 已知限制與地雷

### 重大限制

1. **Excel API 不支援個人 OneDrive（consumer）**：只支援 OneDrive for Business 和 SharePoint。個人用戶的 Excel 檔案無法用 workbook API 操作（只能下載/上傳）。

2. **Word/PPT 沒有內容級 API**：Graph API 只能做檔案管理。要讀寫內容必須搭配第三方函式庫。

3. **Excel session 過期**：Persistent session 約 5 分鐘閒置過期，non-persistent 約 7 分鐘。需要在 adapter 層處理 session 過期重建。

4. **大檔上傳限制**：PUT 簡單上傳最大 250 MB。超過需用 upload session（resumable upload）。

5. **Unbounded range 不能寫入**：不能用 `A:A` 這種不指定行列的 range 做寫入操作。

6. **格式轉換有限**：只支援轉 PDF（從 docx/pptx/xlsx）和轉 HTML（只從 loop/fluid/wbtx）。不支援反向轉換（如 PDF → DOCX）。

7. **併發寫入危險**：Excel API 不建議對同一 workbook 並行寫入，會造成 throttling、timeout、merge conflict。應序列化寫入請求。

### Gotchas

- Excel chart/worksheet ID 包含 `{` 和 `}`，必須 URL encode（`%7B` 和 `%7D`）
- Range 的 `values` 回傳值是 2D array，即使只有一個 cell
- `null` 值在 range 更新中表示「不更新此 cell」（保留原值），不是清除
- 空值用 `""` 表示，不是 `null`
- 設定 `formulas` 時值要包含 `=` 前綴（如 `"=SUM(A1:A10)"`）
- Workbook functions endpoint 支援 300+ 函式，但參數格式是 JSON 不是 Excel 語法

### 安全注意事項

- Access token 有效期短（約 1 小時），refresh token 長期有效
- Client secret 絕對不能外洩（存在 server side）
- Token 存儲必須加密（與 OctoDock 現有的 AES-256-GCM 加密機制一致）

---

## 參考資料

- [Working with Excel in Microsoft Graph](https://learn.microsoft.com/en-us/graph/api/resources/excel?view=graph-rest-1.0)
- [Excel workbooks and charts API overview](https://learn.microsoft.com/en-us/graph/excel-concept-overview)
- [Best practices for working with the Excel API](https://learn.microsoft.com/en-us/graph/workbook-best-practice)
- [Get access on behalf of a user](https://learn.microsoft.com/en-us/graph/auth-v2-user)
- [Microsoft Graph permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference)
- [Microsoft Graph throttling limits](https://learn.microsoft.com/en-us/graph/throttling-limits)
- [Microsoft Graph throttling guidance](https://learn.microsoft.com/en-us/graph/throttling)
- [Convert to other formats](https://learn.microsoft.com/en-us/graph/api/driveitem-get-content-format?view=graph-rest-1.0)
- [Upload small files](https://learn.microsoft.com/en-us/graph/api/driveitem-put-content?view=graph-rest-1.0)
- [OneDrive file storage API overview](https://learn.microsoft.com/en-us/graph/onedrive-concept-overview)
- [Microsoft identity platform OAuth 2.0 authorization code flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)
- [How to use Graph API to edit Word or PowerPoint content](https://learn.microsoft.com/en-us/answers/questions/1615922/how-to-use-graph-api-to-edit-word-or-powerpoint-co)
- [@microsoft/microsoft-graph-client npm](https://www.npmjs.com/package/@microsoft/microsoft-graph-client)
- [Microsoft Graph JavaScript SDK GitHub](https://github.com/microsoftgraph/msgraph-sdk-javascript)
- [docx npm (Word document generation)](https://www.npmjs.com/package/docx)
- [mammoth npm (DOCX to HTML)](https://www.npmjs.com/package/mammoth)
- [pptxgenjs npm (PowerPoint generation)](https://www.npmjs.com/package/pptxgenjs)
