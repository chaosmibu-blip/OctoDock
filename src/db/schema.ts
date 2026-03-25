import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  boolean,
  integer,
  real,
} from "drizzle-orm/pg-core";

// ============================================================
// 4.1 users
// ============================================================
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  image: text("image"),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  mcpApiKey: text("mcp_api_key").unique(), // ak_ + random, generated on first login
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ============================================================
// NextAuth accounts (OAuth provider links for user login)
// ============================================================
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [
    uniqueIndex("accounts_provider_account_idx").on(
      table.provider,
      table.providerAccountId,
    ),
  ],
);

// ============================================================
// 4.2 connected_apps
// ============================================================
export const connectedApps = pgTable(
  "connected_apps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    appName: text("app_name").notNull(),
    authType: text("auth_type").notNull().default("oauth2"), // 'oauth2' | 'api_key' | 'bot_token'
    accessToken: text("access_token").notNull(), // AES-256-GCM encrypted
    refreshToken: text("refresh_token"), // AES-256-GCM encrypted
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    scopes: text("scopes").array(),
    appUserId: text("app_user_id"),
    appUserName: text("app_user_name"),
    status: text("status").default("active"), // 'active' | 'expired' | 'revoked'
    config: jsonb("config").default({}), // App-specific settings
    connectedAt: timestamp("connected_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex("connected_apps_user_app_idx").on(table.userId, table.appName),
  ],
);

// ============================================================
// 4.3 operations
// ============================================================
export const operations = pgTable(
  "operations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    agentInstanceId: text("agent_instance_id"), // 區分同類型下的不同 Agent 實例（從 header 提取）
    appName: text("app_name").notNull(),
    toolName: text("tool_name").notNull(),
    action: text("action").notNull(),
    params: jsonb("params"),
    intent: text("intent"), // octodock_do 的 intent 參數
    difficulty: text("difficulty"), // octodock_help 的 difficulty 參數
    result: jsonb("result"),
    success: boolean("success").default(true),
    durationMs: integer("duration_ms"),
    parentOperationId: uuid("parent_operation_id"), // 事件圖譜：這個操作是因為哪個操作觸發的
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_operations_user_time").on(table.userId, table.createdAt),
    index("idx_operations_user_app").on(table.userId, table.appName),
  ],
);

// ============================================================
// 4.4 memory
// ============================================================
export const memory = pgTable(
  "memory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    category: text("category").notNull(), // 'preference' | 'pattern' | 'context'
    appName: text("app_name"), // NULL = cross-app memory
    key: text("key").notNull(),
    value: text("value").notNull(),
    confidence: real("confidence").default(0.5),
    sourceCount: integer("source_count").default(1),
    // embedding vector(1536) — added via SQL migration: src/db/migrations/001_pgvector.sql
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex("memory_user_category_key_idx").on(
      table.userId,
      table.category,
      table.key,
    ),
  ],
);

// ============================================================
// 4.5 conversations (Phase 4)
// ============================================================
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    platform: text("platform").notNull(), // 'line' | 'telegram'
    platformUserId: text("platform_user_id").notNull(), // external user's ID on the platform
    role: text("role").notNull(), // 'user' | 'assistant'
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_conversations_user_platform").on(
      table.userId,
      table.platform,
      table.platformUserId,
      table.createdAt,
    ),
  ],
);

// ============================================================
// 4.6 subscriptions（Phase 6：訂閱管理）
// 記錄用戶的付費方案、付款來源、到期時間
// 支援三種付款渠道：Paddle（網站）、IAP（iOS）、ECPay（台灣企業）
// ============================================================
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    plan: text("plan").notNull().default("free"), // 'free' | 'pro' | 'team'
    status: text("status").notNull().default("active"), // 'active' | 'past_due' | 'cancelled' | 'expired'
    provider: text("provider"), // 'paddle' | 'iap' | 'ecpay' | null(free)
    providerSubscriptionId: text("provider_subscription_id"), // 付款平台的訂閱 ID
    providerCustomerId: text("provider_customer_id"), // 付款平台的客戶 ID
    currentPeriodStart: timestamp("current_period_start", { withTimezone: true }),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex("subscriptions_user_idx").on(table.userId),
  ],
);

// ============================================================
// 4.8 stored_results（回傳壓縮：大回傳暫存區）
// 超過 3000 字元的操作回傳會被截斷，完整內容存在這裡
// AI 用 get_stored(ref) 按需取用，24 小時後自動過期
// ============================================================
export const storedResults = pgTable(
  "stored_results",
  {
    id: text("id").primaryKey(), // nanoid 12 碼
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }), // 改為 uuid 並加外鍵約束，與其他表一致
    appName: text("app_name").notNull(),
    action: text("action").notNull(),
    content: text("content").notNull(), // 完整的回傳內容
    contentLength: integer("content_length").notNull(),
    summary: text("summary").notNull(), // 摘要（前 N 行 + 後 N 行）
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }), // 過期自動清理
  },
  (table) => [
    index("idx_stored_results_user").on(table.userId),
    index("idx_stored_results_expires").on(table.expiresAt),
  ],
);

// ============================================================
// 4.9 bot_configs (Phase 3+)
// ============================================================
// ============================================================
// 4.10 OAuth Provider tables（U24：OctoDock 作為 OAuth Provider）
// 讓 Claude Connectors Directory 等外部 AI 平台透過 OAuth 連接
// ============================================================

/** OAuth 客戶端（例如 Claude by Anthropic） */
export const oauthClients = pgTable("oauth_clients", {
  id: text("id").primaryKey(), // 例如 "claude_connector"
  secretHash: text("secret_hash").notNull(), // bcrypt hashed secret
  name: text("name").notNull(), // 顯示名稱
  redirectUris: text("redirect_uris").array().notNull(), // 允許的 redirect URIs
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

/** OAuth authorization codes（短命，使用後即刪） */
export const oauthCodes = pgTable("oauth_codes", {
  code: text("code").primaryKey(), // 隨機產生
  clientId: text("client_id").notNull().references(() => oauthClients.id),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  redirectUri: text("redirect_uri").notNull(),
  scope: text("scope").notNull().default("mcp"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), // 10 分鐘
  used: boolean("used").default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

/** OAuth access/refresh tokens */
export const oauthTokens = pgTable(
  "oauth_tokens",
  {
    accessToken: text("access_token").primaryKey(),
    refreshToken: text("refresh_token").notNull().unique(),
    clientId: text("client_id").notNull().references(() => oauthClients.id),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    scope: text("scope").notNull().default("mcp"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), // 1 小時
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_oauth_tokens_user").on(table.userId),
    index("idx_oauth_tokens_refresh").on(table.refreshToken),
  ],
);

export const botConfigs = pgTable("bot_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(), // 'line' | 'telegram'
  platformBotId: text("platform_bot_id").notNull(),
  credentials: text("credentials").notNull(), // AES-256-GCM encrypted
  systemPrompt: text("system_prompt"),
  llmProvider: text("llm_provider").default("claude"),
  llmApiKey: text("llm_api_key"), // encrypted, user-provided
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// 4.11 feedback（用戶反饋記錄）
export const feedback = pgTable("feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  category: text("category").notNull(), // 'bug' | 'feature' | 'app_request' | 'other'
  content: text("content").notNull(),
  email: text("email"), // 用戶提供的聯絡 email（可選）
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
}, (table) => [
  index("idx_feedback_user").on(table.userId),
]);

// ============================================================
// 4.12 usage_tracking（MCP tool call 用量追蹤）
// Free 用戶每月 1,000 次 MCP tool call 上限
// Pro 用戶無限次
// ============================================================
export const usageTracking = pgTable(
  "usage_tracking",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    month: text("month").notNull(), // yyyy-mm 格式，例如 "2026-03"
    toolCallCount: integer("tool_call_count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    uniqueIndex("usage_tracking_user_month_idx").on(table.userId, table.month),
  ],
);

// ============================================================
// 4.8 app_submissions（開發者入口：App 請求 + Adapter 提交）
// 不需要登入，匿名提交，用 email 聯絡
// ============================================================
export const appSubmissions = pgTable(
  "app_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(), // 'request'（許願 App）| 'submit'（提交 Adapter）
    appName: text("app_name").notNull(), // App 名稱
    email: text("email").notNull(), // 聯絡 email
    // request 專用
    reason: text("reason"), // 為什麼想要這個 App
    // submit 專用
    apiDocsUrl: text("api_docs_url"), // API 文件 URL
    authType: text("auth_type"), // 'oauth_own' | 'api_key' | 'oauth_octodock'
    authDetails: text("auth_details"), // OAuth URL/scopes 或連接說明
    adapterSpec: text("adapter_spec"), // AI 生成的 adapter 規格
    // 共用
    status: text("status").notNull().default("pending"), // 'pending' | 'reviewed' | 'accepted' | 'rejected'
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_app_submissions_status").on(table.status),
  ],
);
