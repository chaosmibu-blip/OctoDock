# Skill: setup-notion

引導用戶完成 Notion OAuth 整合設定。

## 觸發條件
用戶輸入 `/setup-notion` 或詢問如何設定 Notion。

## 執行步驟

### Step 1: 建立 Notion Public Integration

引導用戶前往 https://www.notion.so/my-integrations 建立整合。

需要填寫的欄位：

| 欄位 | 建議值 | 說明 |
|------|--------|------|
| Integration name | `OctoDock` | 用戶授權時看到的名稱 |
| Icon | `public/icon-512.png` | 512x512 PNG，專案內已有 |
| Associated workspace | 用戶自己的工作區 | 僅影響開發/測試，其他用戶透過 OAuth 連自己的工作區 |
| Company name | `OctoDock` | |
| Website | `https://octo-dock.com` | OctoDock 部署網址 |
| Tagline | `One MCP URL for all your apps` | |
| Privacy Policy URL | `https://octo-dock.com` | MVP 先填首頁 |
| Terms of Use URL | `https://octo-dock.com` | MVP 先填首頁 |
| Email | 用戶的 email | 開發者聯絡信箱 |
| Redirect URIs | `https://octo-dock.com/callback/notion` | **必須完全一致**，含 https 協定 |
| Notion URL for optional template | （留空） | |

點 **Create** 建立。

### Step 2: 取得 OAuth 憑證

建立後進入整合設定頁面：

1. 複製 **OAuth client ID**
2. 複製 **OAuth client secret** — ⚠️ **只顯示一次！**

### Step 3: 設定 Capabilities

確認勾選：
- ✅ Read content
- ✅ Update content
- ✅ Insert content
- ✅ Read comments
- ✅ Create comments
- ✅ Read user information（包含 email）

### Step 4: 設定環境變數

在 Replit Secrets 加入：
- `NOTION_OAUTH_CLIENT_ID` = 複製的 Client ID
- `NOTION_OAUTH_CLIENT_SECRET` = 複製的 Client Secret

### Step 5: 重新部署

```bash
npm run build
```

然後 Republish。

### Step 6: 測試連結

1. 前往 Dashboard（`https://octo-dock.com/dashboard`）
2. 點 Notion 的 **「連結」** 按鈕
3. 跳轉到 Notion 授權頁面
4. 選擇要分享的頁面
5. 點 **Allow access**
6. 跳回 Dashboard，Notion 顯示「已連結」

### 常見問題

**Q: 按連結後出現錯誤？**
- 確認 Redirect URI 完全一致：`https://octo-dock.com/callback/notion`
- 確認 `NOTION_OAUTH_CLIENT_ID` 和 `NOTION_OAUTH_CLIENT_SECRET` 已設定且正確
- 確認已重新部署

**Q: 連結成功但 API 讀不到頁面？**
- Notion 只允許存取用戶授權時選擇分享的頁面
- 用戶需要到 Notion 的 Settings → Connections 裡擴充分享範圍

**Q: Associated workspace 選了我的，其他用戶怎麼辦？**
- 不影響。每個用戶透過 OAuth 授權時，連接的是自己的工作區
- Associated workspace 只用於你的開發測試

## 相關文件
- 完整 API 參考：`docs/notion-api-reference.md`
- 環境設定指南：`docs/setup-guide.md`
- Notion Adapter 原始碼：`src/adapters/notion.ts`（18 個工具）

## OctoDock Notion 工具清單

| 類別 | 工具名稱 | 功能 |
|------|---------|------|
| 搜尋 | `notion_search` | 搜尋頁面和資料庫 |
| 頁面 | `notion_get_page` | 取得頁面內容 |
| | `notion_create_page` | 建立頁面 |
| | `notion_update_page` | 更新頁面屬性/圖示/封面 |
| | `notion_delete_page` | 刪除頁面（移到垃圾桶） |
| | `notion_get_page_property` | 取得單一屬性值 |
| 區塊 | `notion_get_block` | 取得單一區塊 |
| | `notion_get_block_children` | 取得子區塊列表 |
| | `notion_append_blocks` | 新增區塊到頁面 |
| | `notion_update_block` | 更新區塊內容 |
| | `notion_delete_block` | 刪除區塊 |
| 資料庫 | `notion_query_database` | 查詢資料庫（支援篩選/排序） |
| | `notion_create_database_item` | 在資料庫建立新項目 |
| | `notion_create_database` | 建立新資料庫 |
| | `notion_update_database` | 更新資料庫結構 |
| 留言 | `notion_create_comment` | 新增留言 |
| | `notion_get_comments` | 取得留言列表 |
| 用戶 | `notion_get_users` | 列出工作區用戶 |
