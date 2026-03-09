# App 認證串接開發指南

本指南涵蓋 AgentDock 支援的三種認證方式：OAuth 2.0、API Key、Bot Token。不論哪種方式，token 都用 AES-256-GCM 加密儲存，核心的加密/解密/管理邏輯完全共用。

## 三種認證方式

### OAuth 2.0（Notion、Gmail、Meta 系列）
用戶點「連結」→ 跳轉到 App 的授權頁面 → 同意 → 跳回 AgentDock → 自動拿到 token。
用戶完全不需要看到任何技術細節。

### API Key（LINE Messaging API）
用戶需要到 LINE Developers Console 建立 channel，手動複製 Channel Access Token 貼到 AgentDock。
AgentDock 在 Dashboard 上提供圖文步驟教學。Token 加密後存入 connected_apps。

### Bot Token（Telegram Bot）
用戶跟 @BotFather 對話拿到 Bot Token，貼到 AgentDock。
AgentDock 自動呼叫 Telegram API 設定 Webhook URL。Token 一樣加密儲存。

```typescript
// 定義在 AppAdapter 介面中
type AuthConfig = 
  | { type: 'oauth2'; authorizeUrl: string; tokenUrl: string; scopes: string[]; authMethod: 'basic' | 'post' }
  | { type: 'api_key'; instructions: Record<string, string>; validateEndpoint: string }
  | { type: 'bot_token'; instructions: Record<string, string>; setupWebhook: boolean };
```

## OAuth 2.0 標準流程

```
1. AgentDock 前端 → 產生授權 URL → 重新導向用戶到 App 的授權頁
2. 用戶在 App 的頁面上點「允許」
3. App 把用戶導回 AgentDock 的 callback URL，帶著 authorization code
4. AgentDock 後端用 code 向 App 換取 access_token + refresh_token
5. AgentDock 加密儲存 token
```

## Token 加密（AES-256-GCM）

所有 token 必須加密後才能存入資料庫。絕對不能有明文 token 出現在日誌、回應、錯誤訊息中。

```typescript
// src/lib/crypto.ts
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const KEY = Buffer.from(process.env.TOKEN_ENCRYPTION_KEY!, "hex"); // 32 bytes

export function encrypt(plaintext: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, KEY, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

export function decrypt(ciphertext: string): string {
  const [ivHex, authTagHex, encrypted] = ciphertext.split(":");
  const decipher = createDecipheriv(ALGORITHM, KEY, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
```

產生加密金鑰：`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

## Token 自動刷新

```typescript
// src/services/token-manager.ts
export async function getValidToken(userId: string, appName: string): Promise<string> {
  const app = await db.query.connectedApps.findFirst({
    where: and(eq(connectedApps.userId, userId), eq(connectedApps.appName, appName)),
  });

  if (!app) throw new AppNotConnectedError(appName);
  if (app.status !== "active") throw new AppNotConnectedError(appName);

  const now = Date.now();
  const expiresAt = app.tokenExpiresAt?.getTime() ?? Infinity;

  // token 在 5 分鐘內會過期 → 自動刷新
  if (expiresAt - now < 5 * 60 * 1000 && app.refreshToken) {
    const newTokens = await refreshToken(appName, decrypt(app.refreshToken));
    await db.update(connectedApps).set({
      accessToken: encrypt(newTokens.access_token),
      refreshToken: newTokens.refresh_token ? encrypt(newTokens.refresh_token) : app.refreshToken,
      tokenExpiresAt: new Date(now + newTokens.expires_in * 1000),
      updatedAt: new Date(),
    }).where(eq(connectedApps.id, app.id));
    return newTokens.access_token;
  }

  return decrypt(app.accessToken);
}
```

## 各 App 串接細節

每個 App 的 OAuth 細節不同，詳見 `references/` 中的對應文件：
- `references/notion-oauth.md` — Notion OAuth 流程
- `references/google-oauth.md` — Google (Gmail/Drive/Calendar) OAuth 流程
- `references/meta-oauth.md` — Meta (Threads/Instagram) OAuth 流程

## 通用 OAuth 服務架構

```typescript
// src/services/oauth/base.ts
export interface OAuthProvider {
  name: string;
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: string[];
  redirectUri: string;
}

export function buildAuthorizeUrl(provider: OAuthProvider, state: string): string {
  const params = new URLSearchParams({
    client_id: provider.clientId,
    redirect_uri: provider.redirectUri,
    response_type: "code",
    scope: provider.scopes.join(" "),
    state, // 加密的 user_id，防 CSRF
  });
  return `${provider.authorizeUrl}?${params}`;
}

export async function exchangeCode(provider: OAuthProvider, code: string) {
  const response = await fetch(provider.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: provider.clientId,
      client_secret: provider.clientSecret,
      code,
      redirect_uri: provider.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!response.ok) throw new OAuthError(`Token exchange failed: ${response.status}`);
  return response.json();
}
```

## Callback 處理（Next.js App Router）

OAuth 的 callback 是通用的，靠 URL 參數 `[app]` 判斷是哪個 App。callback 路由會從 Adapter Registry 拿到對應的 authConfig 來處理，不需要為每個 App 寫獨立的 callback。

```typescript
// src/app/callback/[app]/route.ts
export async function GET(
  request: Request,
  { params }: { params: { app: string } }
) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  
  // 1. 驗證 state（解密出 user_id，防 CSRF）
  const userId = verifyState(state);
  
  // 2. 從 Adapter Registry 取得認證設定
  const adapter = getAdapter(params.app);
  if (!adapter || adapter.authConfig.type !== 'oauth2') {
    return new Response("Invalid app", { status: 400 });
  }
  
  // 3. 用 code 換 token（根據 authMethod 決定用 Basic Auth 或 POST body）
  const tokens = await exchangeCode(adapter.authConfig, code!);
  
  // 4. 加密儲存
  await db.insert(connectedApps).values({
    userId,
    appName: params.app,
    authType: 'oauth2',
    accessToken: encrypt(tokens.access_token),
    refreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
    tokenExpiresAt: tokens.expires_in 
      ? new Date(Date.now() + tokens.expires_in * 1000) 
      : null,
    scopes: adapter.authConfig.scopes,
    status: "active",
  }).onConflictDoUpdate({
    target: [connectedApps.userId, connectedApps.appName],
    set: {
      accessToken: encrypt(tokens.access_token),
      refreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : undefined,
      tokenExpiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : undefined,
      status: "active",
      updatedAt: new Date(),
    },
  });
  
  // 5. 導回 Dashboard
  return Response.redirect("https://agentdock.app/dashboard?connected=" + params.app);
}
```

## 常見錯誤處理

| 錯誤 | 原因 | 處理方式 |
|------|------|----------|
| 401 Unauthorized | token 過期或無效 | 自動刷新。刷新也失敗 → 標記 status='expired'，告訴 agent 請用戶重新授權 |
| 403 Forbidden | 權限不足 | 檢查 scopes 是否正確 |
| invalid_grant | refresh_token 也過期了 | 標記 status='expired'，用戶需重新授權 |
| rate_limited | API 呼叫太頻繁 | 實作指數退避重試（max 3 次） |

## 安全原則

1. **state 參數**：必須加密包含 user_id + 時間戳 + 隨機值，callback 時驗證，防止 CSRF
2. **redirect_uri**：必須精確匹配已註冊的 URL，不能有 wildcard
3. **最小權限**：只申請必要的 scopes
4. **token 輪替**：每次 refresh 時如果拿到新的 refresh_token，就替換舊的
5. **撤銷機制**：用戶中斷連結時，呼叫 App 的 revoke endpoint（如果有的話）
# Notion OAuth 串接

## 申請開發者帳號

1. 前往 https://www.notion.so/my-integrations
2. 點「New integration」
3. 類型選「Public」（因為要讓多個用戶授權）
4. 填入 redirect URI：`https://agentdock.app/callback/notion`
5. 拿到 OAuth client ID 和 OAuth client secret

## Provider 設定

```typescript
const notionProvider: OAuthProvider = {
  name: "notion",
  authorizeUrl: "https://api.notion.com/v1/oauth/authorize",
  tokenUrl: "https://api.notion.com/v1/oauth/token",
  clientId: process.env.NOTION_OAUTH_CLIENT_ID!,
  clientSecret: process.env.NOTION_OAUTH_CLIENT_SECRET!,
  scopes: [], // Notion 不用指定 scopes，權限由 integration 設定決定
  redirectUri: "https://agentdock.app/callback/notion",
};
```

## Notion OAuth 特殊注意事項

- Notion 的 token exchange 使用 **Basic Auth**，不是 POST body：
  ```typescript
  const response = await fetch("https://api.notion.com/v1/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(
        `${clientId}:${clientSecret}`
      ).toString("base64")}`,
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });
  ```

- Notion 的 access_token **不會過期**（沒有 refresh_token 機制）。但用戶可以隨時在 Notion 端撤銷。

- 回傳中包含 `workspace_id` 和 `workspace_name`，可以存到 `app_user_id` 和 `app_user_name`。

## Notion API 使用

所有 API 請求需要帶：
```
Authorization: Bearer {access_token}
Notion-Version: 2022-06-28
Content-Type: application/json
```
-e 
---

# Google OAuth 串接（Gmail / Drive / Calendar）

## 申請開發者帳號

1. 前往 https://console.cloud.google.com
2. 建立專案「AgentDock」
3. 啟用 API：Gmail API, Google Drive API, Google Calendar API
4. 設定 OAuth consent screen：
   - User type: External
   - App name: AgentDock
   - Scopes: 見下方
5. 建立 OAuth 2.0 Client ID（Web application）
   - Redirect URI: `https://agentdock.app/callback/gmail`
6. 拿到 client ID 和 client secret

## 重要：Google 的審核機制

- **測試模式（100 用戶以內）**：不需要審核，但只有你手動加入的 test users 能授權
- **發布模式**：需要 Google 審核。如果存取 Gmail 內容（非 metadata），需要通過**安全審核**，流程需要 4-6 週
- **MVP 策略**：先用測試模式，你自己是 test user。等有更多用戶時再申請審核。

## Provider 設定

```typescript
const googleProvider: OAuthProvider = {
  name: "gmail",
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  clientId: process.env.GMAIL_OAUTH_CLIENT_ID!,
  clientSecret: process.env.GMAIL_OAUTH_CLIENT_SECRET!,
  scopes: [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.compose",
  ],
  redirectUri: "https://agentdock.app/callback/gmail",
};
```

建議在 authorize URL 中額外加：
```typescript
params.set("access_type", "offline");  // 拿到 refresh_token
params.set("prompt", "consent");       // 強制顯示同意畫面（確保拿到 refresh_token）
```

## Google OAuth 特殊注意事項

- Google 只在**第一次授權**時回傳 refresh_token。如果用戶之前授權過又撤銷再重新授權，可能不會給 refresh_token。加 `prompt=consent` 可以解決。
- access_token 有效期約 1 小時。
- refresh_token 沒有明確的過期時間，但如果用戶在 Google 帳號設定中撤銷，就失效了。
- token exchange 用標準 POST body（不像 Notion 用 Basic Auth）。

## Refresh Token

```typescript
async function refreshGoogleToken(refreshToken: string) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_OAUTH_CLIENT_ID!,
      client_secret: process.env.GMAIL_OAUTH_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  return response.json();
  // 回傳 { access_token, expires_in, token_type }
  // 注意：refresh 時通常不會回傳新的 refresh_token
}
```

## Gmail API 使用

```
Authorization: Bearer {access_token}
```

搜尋：GET https://gmail.googleapis.com/gmail/v1/users/me/messages?q={query}
讀取：GET https://gmail.googleapis.com/gmail/v1/users/me/messages/{id}?format=full
寄送：POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send
  Body: { raw: base64url_encoded_email }

注意：Gmail 的寄送需要把郵件編碼成 RFC 2822 格式再 base64url 編碼。
-e 
---

# Meta OAuth 串接（Threads + Instagram）

## 申請開發者帳號

1. 前往 https://developers.facebook.com
2. 建立 App，類型選「Business」
3. 在 App 設定中新增產品：Threads API + Instagram Graph API
4. 設定 OAuth redirect URI：`https://agentdock.app/callback/meta`
5. 拿到 App ID（= client_id）和 App Secret（= client_secret）

## Meta 審核機制

- **開發模式**：只有 App 的 admin/developer/tester 角色能授權，不需審核
- **正式模式**：需要 Meta 審核。需要準備隱私政策、使用說明、影片展示
- **MVP 策略**：先用開發模式測試。Phase 2 準備審核材料。
- **審核週期**：通常 2-4 週，可能需要來回修改

## 重要：Threads 和 Instagram 共用 Meta OAuth

一次 OAuth 授權可以同時取得 Threads 和 Instagram 的權限，只要在 scopes 中同時包含兩者。

## Provider 設定

```typescript
const metaProvider: OAuthProvider = {
  name: "meta",  // 內部用 meta，對用戶顯示為 Threads / Instagram
  authorizeUrl: "https://www.threads.net/oauth/authorize", // Threads 的 authorize URL
  tokenUrl: "https://graph.threads.net/oauth/access_token",
  clientId: process.env.META_OAUTH_CLIENT_ID!,
  clientSecret: process.env.META_OAUTH_CLIENT_SECRET!,
  scopes: [
    // Threads
    "threads_basic",
    "threads_content_publish",
    "threads_manage_replies",
    "threads_manage_insights",
    "threads_read_replies",
    // Instagram（如果要同時串接）
    // 需要走 Instagram Graph API 的 OAuth，authorize URL 不同
  ],
  redirectUri: "https://agentdock.app/callback/meta",
};
```

## 注意：Threads 和 Instagram 的 OAuth 入口不同

- **Threads**：authorize URL 是 `https://www.threads.net/oauth/authorize`
- **Instagram**：authorize URL 是 `https://www.facebook.com/dialog/oauth` 或 `https://api.instagram.com/oauth/authorize`

因此實際上可能需要分成兩次 OAuth flow，或使用 Facebook Login 統一入口。MVP 建議先只串 Threads（authorize URL 更簡單），Phase 2 再加 Instagram。

## Threads OAuth 特殊注意事項

- Threads 的 token exchange：
  ```typescript
  const response = await fetch("https://graph.threads.net/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
      code,
    }),
  });
  ```

- Threads 的 short-lived token 有效期約 1 小時。可以換成 long-lived token（60 天）：
  ```typescript
  const longLivedResponse = await fetch(
    `https://graph.threads.net/access_token?` +
    `grant_type=th_exchange_token&` +
    `client_secret=${clientSecret}&` +
    `access_token=${shortLivedToken}`
  );
  // 回傳 { access_token, token_type, expires_in: 5184000 }
  ```

- Long-lived token 可以 refresh（在過期前）：
  ```typescript
  const refreshResponse = await fetch(
    `https://graph.threads.net/refresh_access_token?` +
    `grant_type=th_refresh_token&` +
    `access_token=${longLivedToken}`
  );
  ```

- **建議流程**：拿到 short-lived → 立刻換成 long-lived → 儲存 long-lived → 定期 refresh

## Threads API 使用

```
Authorization: Bearer {access_token}
```

發文是兩步驟：
1. 建立 media container：POST https://graph.threads.net/{user_id}/threads
2. 發布：POST https://graph.threads.net/{user_id}/threads_publish

取得 user_id：GET https://graph.threads.net/me?fields=id,username&access_token=xxx

## 發文限制

- 每 24 小時 250 則貼文（含回覆）
- 可以用 GET /me/threads_publishing_limit 查詢剩餘額度
- 影片需要等待處理完成才能 publish（用 GET /{container_id}?fields=status 查詢狀態）
