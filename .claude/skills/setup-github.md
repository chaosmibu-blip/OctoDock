---
name: GitHub 操作手冊
description: GitHub App 的設定、維護、更新指南，以及幫助外部 AI 更好地操作 GitHub
---

# GitHub 操作手冊

## 設定

### Step 1: 建立 GitHub OAuth App

1. 前往 [GitHub Settings > Developer settings > OAuth Apps](https://github.com/settings/developers)
2. 點 **New OAuth App**
3. 填寫：
   - Application name: `OctoDock`
   - Homepage URL: `https://octo-dock.com`
   - Authorization callback URL: `https://octo-dock.com/callback/github`
4. 點 **Register application**
5. 複製 **Client ID**
6. 點 **Generate a new client secret**，複製 **Client Secret**

### Step 2: 設定環境變數

```
GITHUB_APP_OAUTH_CLIENT_ID=你的 Client ID
GITHUB_APP_OAUTH_CLIENT_SECRET=你的 Client Secret
```

### Step 3: 測試連結

Dashboard → GitHub → 連結 → 授權 → 測試 `list_repos`

## 維護

### Token 管理
- GitHub OAuth token **不會過期**（除非用戶撤銷）
- 用戶可在 GitHub Settings > Applications 撤銷
- Rate limit: 5000 requests/hour（認證後）

### 常見問題
- **404 Not Found**: repo 名稱拼錯或沒有存取權限（私有 repo 需要 `repo` scope）
- **403 Forbidden**: rate limit 超過或 token 權限不足
- **422 Validation Failed**: 建立 issue 時缺少必要參數

## AI 操作指南

### 10 個 Action

| Action | 說明 | 參數 |
|--------|------|------|
| list_repos | 列出用戶的 repo | sort?, per_page? |
| get_repo | 取得 repo 詳情 | owner, repo |
| search_code | 搜尋程式碼 | query |
| list_issues | 列出 issue | owner, repo, state? |
| create_issue | 建立 issue | owner, repo, title, body?, labels? |
| update_issue | 更新 issue | owner, repo, issue_number, title?, body?, state? |
| list_prs | 列出 PR | owner, repo, state? |
| get_pr | 取得 PR 詳情 | owner, repo, pull_number |
| create_comment | 留言 | owner, repo, issue_number, body |
| get_file | 讀取檔案 | owner, repo, path, ref? |

### 操作技巧
- `owner/repo` 格式：用 `list_repos` 先取得完整名稱
- `search_code` 查詢語法：`keyword repo:owner/repo path:src/ language:typescript`
- `get_file` 回傳的是純文字（已解碼 base64）
- `create_issue` 的 labels 是字串陣列：`["bug", "urgent"]`
- Issue 和 PR 共用編號系統，`create_comment` 對兩者都能用

### Scopes
- `repo` — 完整 repo 存取（含私有 repo）
- `read:user` — 讀取用戶資料

## 相關檔案
- Adapter: `src/adapters/github.ts`
- OAuth env: `GITHUB_APP_OAUTH_CLIENT_ID/SECRET`
