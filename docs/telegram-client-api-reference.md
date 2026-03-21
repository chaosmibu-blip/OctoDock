# Telegram Client API (MTProto) 規格

## 認證
- **方式**：手機號碼 + 驗證碼 + 可選 2FA
- **憑證**：`TG_API_ID`（整數）+ `TG_API_HASH`（hex），從 [my.telegram.org](https://my.telegram.org) 取得
- **Session**：GramJS StringSession，加密存入 DB
- **Token 格式**：Base64 字串（包含 DC ID + auth key）

## 免費額度
- **費用**：完全免費
- **速率限制**：動態令牌桶，不公開具體數值。碰到 FLOOD_WAIT_X 需等 X 秒

## 套件
- **npm**：`telegram@2.26.x`（GramJS）
- **純 JS**：無 native 依賴
- **Session**：`telegram/sessions` → `StringSession`

## API 端點（OctoDock adapter 實作的 20 個）

### 對話
| Action | 對應方法 | 說明 |
|--------|---------|------|
| get_dialogs | client.getDialogs() | 取得對話列表 |
| get_history | client.getMessages() | 讀取聊天記錄 |
| search_messages | client.getMessages({ search }) | 搜尋訊息 |
| send_message | client.sendMessage() | 發送訊息 |
| read_history | client.markAsRead() | 標記已讀 |

### 聯絡人
| Action | 對應方法 | 說明 |
|--------|---------|------|
| get_contacts | contacts.GetContacts | 取得聯絡人列表 |
| search_contacts | contacts.Search | 搜尋聯絡人 |
| resolve_username | contacts.ResolveUsername | 解析 @username |

### 群組 / 頻道
| Action | 對應方法 | 說明 |
|--------|---------|------|
| join_channel | channels.JoinChannel / messages.ImportChatInvite | 加入頻道/群組 |
| leave_channel | channels.LeaveChannel | 離開頻道/群組 |
| get_participants | channels.GetParticipants | 取得成員列表 |
| create_channel | channels.CreateChannel | 建立頻道/群組 |
| get_channel_info | channels.GetFullChannel | 取得頻道/群組資訊 |

### 帳號
| Action | 對應方法 | 說明 |
|--------|---------|------|
| get_me | client.getMe() | 取得帳號資訊 |
| update_profile | account.UpdateProfile | 更新名稱/bio |
| get_privacy | account.GetPrivacy | 查看隱私設定 |

### 檔案
| Action | 對應方法 | 說明 |
|--------|---------|------|
| download_media | client.getMessages({ ids }) | 取得媒體資訊 |
| send_file | client.sendFile() | 發送檔案（最大 2GB） |

### 工具
| Action | 對應方法 | 說明 |
|--------|---------|------|
| get_folders | messages.GetDialogFilters | 取得資料夾列表 |
| forward_messages | client.forwardMessages() | 轉發訊息 |

## 常見錯誤碼
| 錯誤 | 說明 |
|------|------|
| SESSION_EXPIRED / AUTH_KEY_UNREGISTERED | Session 過期，需重新連接 |
| FLOOD_WAIT_X | 速率限制，等 X 秒 |
| PEER_ID_INVALID | 找不到用戶/頻道 |
| CHAT_WRITE_FORBIDDEN | 無發言權限 |
| USER_NOT_PARTICIPANT | 非成員 |
| PHONE_NUMBER_INVALID | 手機號碼格式錯誤 |
| PHONE_CODE_INVALID | 驗證碼錯誤 |
| SESSION_PASSWORD_NEEDED | 需要 2FA 密碼 |

## 風險
- 非官方 API 使用會被自動監控
- 大量自動化操作有封號風險
- 唯讀操作（讀記錄、搜尋）風險較低
