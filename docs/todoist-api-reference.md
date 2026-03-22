# Todoist API 規格

## 認證
- **方式**：Personal API Token（Bearer token）
- **取得方式**：`https://app.todoist.com/prefs/integrations` → API token
- **Token 有效期**：永不過期
- **Header**：`Authorization: Bearer {token}`
- **驗證端點**：`GET https://api.todoist.com/rest/v2/projects`（成功 = token 有效）

## 免費額度
- **方案**：免費方案即可使用 API
- **速率限制**：未公開明確數字，但有 HTTP 429 + `retry_after` 機制
- **每日配額**：無已知硬限制

## API 端點（REST API v2）

Base URL: `https://api.todoist.com/rest/v2`

### Projects
| Method | Path | 說明 |
|--------|------|------|
| GET | `/projects` | 列出所有專案 |
| GET | `/projects/{id}` | 取得單一專案 |
| POST | `/projects` | 建立專案 |
| POST | `/projects/{id}` | 更新專案 |
| DELETE | `/projects/{id}` | 刪除專案 |

### Tasks
| Method | Path | 說明 |
|--------|------|------|
| GET | `/tasks` | 列出任務（支援 filter） |
| GET | `/tasks/{id}` | 取得單一任務 |
| POST | `/tasks` | 建立任務 |
| POST | `/tasks/{id}` | 更新任務 |
| DELETE | `/tasks/{id}` | 刪除任務 |
| POST | `/tasks/{id}/close` | 完成任務 |
| POST | `/tasks/{id}/reopen` | 重新開啟任務 |

### Sections
| Method | Path | 說明 |
|--------|------|------|
| GET | `/sections` | 列出區段（需 project_id） |
| POST | `/sections` | 建立區段 |
| POST | `/sections/{id}` | 更新區段 |
| DELETE | `/sections/{id}` | 刪除區段 |

### Comments
| Method | Path | 說明 |
|--------|------|------|
| GET | `/comments` | 列出留言（需 task_id 或 project_id） |
| POST | `/comments` | 建立留言 |
| POST | `/comments/{id}` | 更新留言 |
| DELETE | `/comments/{id}` | 刪除留言 |

### Labels
| Method | Path | 說明 |
|--------|------|------|
| GET | `/labels` | 列出所有標籤 |
| POST | `/labels` | 建立標籤 |
| POST | `/labels/{id}` | 更新標籤 |
| DELETE | `/labels/{id}` | 刪除標籤 |

### Quick Add
| Method | Path | 說明 |
|--------|------|------|
| POST | `/quick_add` | 自然語言快速新增（解析日期、專案、標籤） |
