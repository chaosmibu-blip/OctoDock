# Notion API 完整參考文件

> AgentDock Notion Adapter 對應的所有 Notion API 端點，含備註與使用範例。

---

## 認證方式

Notion 使用 OAuth 2.0，token exchange 採 **Basic Auth**（`base64(client_id:client_secret)`）。

- Token **不會過期**（舊版整合），新版公開整合有 refresh_token
- Rate limit：**3 次/秒**（每 15 分鐘 2,700 次），超過回 429

---

## 1. 搜尋

### `notion_search` → `POST /v1/search`

搜尋工作區中所有已分享的頁面和資料庫。

**參數：**
| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `query` | string | 否 | 搜尋關鍵字（空 = 列出所有） |
| `filter` | object | 否 | `{ "property": "object", "value": "page" 或 "data_source" }` |
| `sort` | object | 否 | `{ "timestamp": "last_edited_time", "direction": "descending" }` |
| `page_size` | number | 否 | 每頁筆數 |
| `start_cursor` | string | 否 | 分頁游標 |

**範例：**
```json
POST /v1/search
{
  "query": "會議紀錄",
  "filter": { "property": "object", "value": "page" },
  "sort": { "direction": "descending", "timestamp": "last_edited_time" }
}
```

**備註：** 只能搜尋已與整合分享的頁面。搜尋結果不包含頁面內容，需用 `notion_get_page` 取得。

---

## 2. 頁面

### `notion_get_page` → `GET /v1/pages/{page_id}`

取得頁面屬性。AgentDock 同時呼叫 `/blocks/{page_id}/children` 取得內容。

**範例：**
```
GET /v1/pages/b55c9c91-384d-452b-81db-d1ef79372b75
```

**備註：** 超過 25 個參照的屬性會被截斷，需用 `notion_get_page_property` 單獨取。

---

### `notion_create_page` → `POST /v1/pages`

在頁面或資料庫下建立新頁面。

**參數：**
| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `parent` | object | 是 | `{ "page_id": "..." }` 或 `{ "database_id": "..." }` |
| `properties` | object | 是 | 頁面屬性（至少需要 title） |
| `children` | array | 否 | 頁面內容（Block 物件陣列，最多 100 個） |
| `icon` | object | 否 | 圖示 |
| `cover` | object | 否 | 封面圖片 |

**範例 — 建立在頁面下：**
```json
POST /v1/pages
{
  "parent": { "page_id": "b55c9c91..." },
  "properties": {
    "title": { "title": [{ "text": { "content": "新頁面" } }] }
  },
  "children": [
    {
      "type": "paragraph",
      "paragraph": {
        "rich_text": [{ "text": { "content": "這是內容" } }]
      }
    }
  ]
}
```

**範例 — 建立在資料庫下：**
```json
POST /v1/pages
{
  "parent": { "database_id": "d9824bdc..." },
  "properties": {
    "Name": { "title": [{ "text": { "content": "新項目" } }] },
    "Status": { "select": { "name": "進行中" } },
    "Priority": { "number": 1 }
  }
}
```

---

### `notion_update_page` → `PATCH /v1/pages/{page_id}`

更新頁面屬性、圖示、封面。

**可更新的欄位：**
- `properties` — 頁面屬性
- `icon` — `{ "emoji": "🔥" }` 或 `{ "external": { "url": "https://..." } }`
- `cover` — `{ "external": { "url": "https://..." } }`
- `in_trash` — 設為 `true` 移到垃圾桶
- `is_locked` — 鎖定/解鎖頁面（API 仍可更新）

**範例：**
```json
PATCH /v1/pages/b55c9c91...
{
  "properties": {
    "Name": { "title": [{ "text": { "content": "更新標題" } }] }
  },
  "icon": { "emoji": "📝" }
}
```

**備註：** Rollup 屬性無法更新。無法變更頁面的 parent。

---

### `notion_delete_page` → `PATCH /v1/pages/{page_id}`

將頁面移到垃圾桶（30 天內可還原）。

**範例：**
```json
PATCH /v1/pages/b55c9c91...
{
  "archived": true
}
```

---

### `notion_get_page_property` → `GET /v1/pages/{page_id}/properties/{property_id}`

取得頁面的單一屬性值。適用於超過 25 個參照的 rollup 或 relation。

**範例：**
```
GET /v1/pages/b55c9c91.../properties/title
```

---

## 3. 區塊（Blocks）

### `notion_get_block` → `GET /v1/blocks/{block_id}`

取得單一區塊物件。

**備註：** 區塊類型包括 paragraph、heading_1-3、bulleted_list_item、numbered_list_item、to_do、toggle、code、image、table、callout、quote、divider 等 30+ 種。

---

### `notion_get_block_children` → `GET /v1/blocks/{block_id}/children`

取得區塊或頁面的子區塊。頁面內容 = 頁面的子區塊。

**參數：**
| 參數 | 類型 | 說明 |
|------|------|------|
| `page_size` | number | 每頁筆數（最大 100） |
| `start_cursor` | string | 分頁游標 |

**備註：** 只回傳第一層子區塊。如果 `has_children: true`，需要遞迴呼叫。

---

### `notion_append_blocks` → `PATCH /v1/blocks/{block_id}/children`

在頁面或區塊末端新增內容。

**參數：**
| 參數 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `children` | array | 是 | Block 物件陣列（最多 100 個，最多 2 層巢狀） |
| `position` | object | 否 | 插入位置：`end`（預設）、`start`、`after_block` |

**範例 — 新增段落和清單：**
```json
PATCH /v1/blocks/page_id.../children
{
  "children": [
    {
      "type": "heading_2",
      "heading_2": {
        "rich_text": [{ "text": { "content": "新章節" } }]
      }
    },
    {
      "type": "bulleted_list_item",
      "bulleted_list_item": {
        "rich_text": [{ "text": { "content": "項目一" } }]
      }
    },
    {
      "type": "bulleted_list_item",
      "bulleted_list_item": {
        "rich_text": [{ "text": { "content": "項目二" } }]
      }
    }
  ]
}
```

**範例 — 新增程式碼區塊：**
```json
{
  "type": "code",
  "code": {
    "rich_text": [{ "text": { "content": "console.log('hello')" } }],
    "language": "javascript"
  }
}
```

---

### `notion_update_block` → `PATCH /v1/blocks/{block_id}`

更新區塊內容。

**範例 — 更新段落文字：**
```json
PATCH /v1/blocks/block_id...
{
  "paragraph": {
    "rich_text": [{ "text": { "content": "更新後的文字" } }]
  }
}
```

---

### `notion_delete_block` → `DELETE /v1/blocks/{block_id}`

刪除區塊（移到垃圾桶）。

---

## 4. 資料庫

### `notion_query_database` → `POST /v1/databases/{database_id}/query`

查詢資料庫，支援篩選和排序。

**篩選範例 — 多條件：**
```json
{
  "filter": {
    "and": [
      {
        "property": "Status",
        "select": { "equals": "進行中" }
      },
      {
        "property": "Priority",
        "number": { "greater_than": 3 }
      }
    ]
  },
  "sorts": [
    { "property": "Priority", "direction": "descending" }
  ],
  "page_size": 20
}
```

**篩選運算子（依屬性類型）：**

| 屬性類型 | 可用運算子 |
|---------|----------|
| text/rich_text | equals, does_not_equal, contains, does_not_contain, starts_with, ends_with, is_empty, is_not_empty |
| number | equals, does_not_equal, greater_than, less_than, greater_than_or_equal_to, less_than_or_equal_to |
| checkbox | equals |
| select | equals, does_not_equal |
| multi_select | contains, does_not_contain |
| date | equals, before, after, on_or_before, on_or_after, is_empty, is_not_empty |
| relation | contains, does_not_contain, is_empty, is_not_empty |

---

### `notion_create_database_item` → `POST /v1/pages`

在資料庫中建立新項目（本質是在資料庫下建立頁面）。

**範例：**
```json
POST /v1/pages
{
  "parent": { "database_id": "d9824bdc..." },
  "properties": {
    "Name": { "title": [{ "text": { "content": "新任務" } }] },
    "Status": { "select": { "name": "待處理" } },
    "Due Date": { "date": { "start": "2026-03-15" } },
    "Tags": { "multi_select": [{ "name": "重要" }, { "name": "緊急" }] },
    "Assignee": { "people": [{ "id": "user-id..." }] }
  }
}
```

---

### `notion_create_database` → `POST /v1/databases`

建立新資料庫。

**範例 — 建立任務資料庫：**
```json
POST /v1/databases
{
  "parent": { "page_id": "parent-page-id..." },
  "title": [{ "text": { "content": "任務清單" } }],
  "properties": {
    "Name": { "title": {} },
    "Status": {
      "select": {
        "options": [
          { "name": "待處理", "color": "red" },
          { "name": "進行中", "color": "yellow" },
          { "name": "完成", "color": "green" }
        ]
      }
    },
    "Priority": { "number": { "format": "number" } },
    "Due Date": { "date": {} },
    "Tags": {
      "multi_select": {
        "options": [
          { "name": "重要", "color": "red" },
          { "name": "緊急", "color": "orange" }
        ]
      }
    },
    "Assignee": { "people": {} },
    "Done": { "checkbox": {} }
  }
}
```

**備註：** Status 屬性目前無法透過 API 建立。

---

### `notion_update_database` → `PATCH /v1/databases/{database_id}`

更新資料庫標題、描述或欄位定義。

**範例 — 新增欄位：**
```json
PATCH /v1/databases/db-id...
{
  "properties": {
    "Email": { "email": {} },
    "URL": { "url": {} }
  }
}
```

---

## 5. 留言

### `notion_create_comment` → `POST /v1/comments`

在頁面或討論串中新增留言。

**範例 — 頁面級留言：**
```json
POST /v1/comments
{
  "parent": { "page_id": "page-id..." },
  "rich_text": [
    { "text": { "content": "這個頁面需要更新資料。" } }
  ]
}
```

**範例 — 回覆討論串：**
```json
POST /v1/comments
{
  "discussion_id": "discussion-id...",
  "rich_text": [
    { "text": { "content": "已更新完成！" } }
  ]
}
```

---

### `notion_get_comments` → `GET /v1/comments?block_id={block_id}`

列出頁面或區塊上的所有留言。

---

## 6. 用戶

### `notion_get_users` → `GET /v1/users`

列出工作區所有用戶。

**回傳範例：**
```json
{
  "results": [
    {
      "object": "user",
      "id": "user-id...",
      "type": "person",
      "name": "林聖堯",
      "avatar_url": "https://...",
      "person": { "email": "user@example.com" }
    }
  ]
}
```

---

## OAuth 2.0 設定流程

### 1. 建立 Public Integration

1. 前往 [Notion Integrations](https://www.notion.so/my-integrations)
2. 點 **New Integration** → 類型選 **Public**
3. 填入：
   - Integration name: `AgentDock`
   - Redirect URI: `https://octo-dock.com/callback/notion`
   - 勾選需要的 Capabilities（Read content, Update content, Insert content）
4. 建立後取得 **Client ID** 和 **Client Secret**

### 2. 設定環境變數

```
NOTION_OAUTH_CLIENT_ID=你的_client_id
NOTION_OAUTH_CLIENT_SECRET=你的_client_secret
```

### 3. 授權流程

```
用戶點「連結 Notion」
  → 跳轉: https://api.notion.com/v1/oauth/authorize
      ?owner=user
      &client_id={ID}
      &redirect_uri={URI}
      &response_type=code
      &state={encrypted_state}
  → 用戶選擇要分享的頁面
  → 跳回: /callback/notion?code={code}&state={state}
  → AgentDock 用 Basic Auth 換 token:
      POST /v1/oauth/token
      Authorization: Basic base64(client_id:client_secret)
      Body: { "grant_type": "authorization_code", "code": "...", "redirect_uri": "..." }
  → 儲存 access_token（AES-256-GCM 加密）
```

### 4. 重要備註

- Notion OAuth token **不會過期**（Internal Integration）
- Public Integration 有 refresh_token，可用 `grant_type: refresh_token` 刷新
- 用戶只會看到他選擇分享的頁面，未分享的頁面 API 看不到
- 每次授權用戶可以選擇額外分享更多頁面
