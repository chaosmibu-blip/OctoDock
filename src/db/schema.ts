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
import { sql } from "drizzle-orm";

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
    taskId: uuid("task_id"),
    sourceAgent: text("source_agent"), // 'claude' | 'gpt' | 'gemini' | 'other'
    appName: text("app_name").notNull(),
    toolName: text("tool_name").notNull(),
    action: text("action").notNull(),
    params: jsonb("params"),
    result: jsonb("result"),
    intent: text("intent"),
    success: boolean("success").default(true),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => [
    index("idx_operations_user_time").on(table.userId, table.createdAt),
    index("idx_operations_user_app").on(table.userId, table.appName),
    index("idx_operations_task")
      .on(table.taskId)
      .where(sql`task_id IS NOT NULL`),
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
    // embedding vector(1536) — added via raw SQL migration when pgvector is enabled
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
// 4.5 bot_configs (Phase 3+)
// ============================================================
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
});
