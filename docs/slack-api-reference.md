# Slack API 規格

## 認證
- 方式：OAuth 2.0（Bot Token）
- Authorize URL：`https://slack.com/oauth/v2/authorize`
- Token URL：`https://slack.com/api/oauth.v2.access`
- Auth Method：post（client_id + client_secret 作為 POST body）
- Token 有效期：Bot token 不會過期，但用戶可以撤銷
- Scopes（Bot Token）：
  - `channels:read` — 列出公開頻道
  - `channels:history` — 讀取公開頻道歷史訊息
  - `groups:read` — 列出私人頻道
  - `groups:history` — 讀取私人頻道歷史訊息
  - `im:read` — 列出 DM
  - `im:history` — 讀取 DM 歷史
  - `chat:write` — 發送訊息
  - `users:read` — 列出使用者
  - `reactions:read` — 讀取反應
  - `reactions:write` — 新增反應
  - `files:read` — 讀取檔案
  - `files:write` — 上傳檔案
  - `search:read` — 搜尋訊息/檔案
  - `pins:read` — 讀取釘選
  - `pins:write` — 釘選/取消釘選
  - `bookmarks:read` — 讀取書籤
  - `bookmarks:write` — 新增書籤
  - `channels:manage` — 建立/編輯頻道
  - `usergroups:read` — 讀取用戶群組

## 免費額度
- Slack API 無費用限制，免費
- Rate Limits 按 Tier：
  - Tier 1：1 req/min（最嚴格）
  - Tier 2：20 req/min
  - Tier 3：50 req/min
  - Tier 4：100 req/min
- 2025/05 變更：非 Marketplace 的商業分發 App，conversations.history/replies 降到 Tier 1
- OctoDock 不做商業分發（自用），不受此限

## API 端點

Base URL: `https://slack.com/api`

### conversations.list
- Method: GET
- 參數：types(public_channel,private_channel,im,mpim), limit, cursor
- 回傳：channels[], response_metadata.next_cursor
- Rate Limit: Tier 2

### conversations.history
- Method: GET
- 參數：channel, limit, cursor, oldest, latest
- 回傳：messages[]
- Rate Limit: Tier 3

### conversations.replies
- Method: GET
- 參數：channel, ts, limit, cursor
- 回傳：messages[]
- Rate Limit: Tier 3

### chat.postMessage
- Method: POST
- 參數：channel, text, thread_ts?, blocks?, mrkdwn?
- 回傳：message object
- Rate Limit: Tier 4 (但同一頻道 1 msg/sec)

### chat.update
- Method: POST
- 參數：channel, ts, text
- 回傳：message object

### chat.delete
- Method: POST
- 參數：channel, ts
- Rate Limit: Tier 3

### reactions.add
- Method: POST
- 參數：channel, timestamp, name
- Rate Limit: Tier 3

### reactions.get
- Method: GET
- 參數：channel, timestamp
- Rate Limit: Tier 3

### users.list
- Method: GET
- 參數：limit, cursor
- 回傳：members[]
- Rate Limit: Tier 2

### users.info
- Method: GET
- 參數：user
- 回傳：user object

### conversations.create
- Method: POST
- 參數：name, is_private?
- Rate Limit: Tier 2

### conversations.invite
- Method: POST
- 參數：channel, users (comma-separated)

### conversations.kick
- Method: POST
- 參數：channel, user

### conversations.setPurpose
- Method: POST
- 參數：channel, purpose

### conversations.setTopic
- Method: POST
- 參數：channel, topic

### conversations.archive
- Method: POST
- 參數：channel

### pins.add
- Method: POST
- 參數：channel, timestamp

### pins.remove
- Method: POST
- 參數：channel, timestamp

### pins.list
- Method: GET
- 參數：channel

### search.messages
- Method: GET
- 參數：query, count, page, sort, sort_dir
- 回傳：messages.matches[]
- Rate Limit: Tier 2
- 注意：需要 user token（search:read scope），bot token 不支援

### bookmarks.add
- Method: POST
- 參數：channel_id, title, type, link?

### bookmarks.list
- Method: GET
- 參數：channel_id
