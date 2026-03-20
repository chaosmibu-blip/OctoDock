-- ============================================================
-- OctoDock 初始化 Schema
-- 此腳本在 docker compose up 時自動執行
-- ============================================================

-- 用戶表
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  image TEXT,
  email_verified TIMESTAMPTZ,
  mcp_api_key TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- NextAuth accounts（OAuth 登入用）
CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  refresh_token TEXT,
  access_token TEXT,
  expires_at INTEGER,
  token_type TEXT,
  scope TEXT,
  id_token TEXT,
  session_state TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_provider_account_idx ON accounts(provider, provider_account_id);

-- 已連結的 App
CREATE TABLE IF NOT EXISTS connected_apps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app_name TEXT NOT NULL,
  auth_type TEXT NOT NULL DEFAULT 'oauth2',
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expires_at TIMESTAMPTZ,
  scopes TEXT[],
  app_user_id TEXT,
  app_user_name TEXT,
  status TEXT DEFAULT 'active',
  config JSONB DEFAULT '{}',
  connected_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS connected_apps_user_app_idx ON connected_apps(user_id, app_name);

-- 操作記錄
CREATE TABLE IF NOT EXISTS operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id UUID,
  source_agent TEXT,
  app_name TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  action TEXT NOT NULL,
  params JSONB,
  result JSONB,
  intent TEXT,
  success BOOLEAN DEFAULT true,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_operations_user_time ON operations(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_operations_user_app ON operations(user_id, app_name);

-- 記憶表
CREATE TABLE IF NOT EXISTS memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  app_name TEXT,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  confidence REAL DEFAULT 0.5,
  source_count INTEGER DEFAULT 1,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS memory_user_category_key_idx ON memory(user_id, category, key);

-- Bot 對話記錄
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  platform_user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conversations_user_platform ON conversations(user_id, platform, platform_user_id, created_at);

-- 排程表
CREATE TABLE IF NOT EXISTS schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  cron_expression TEXT NOT NULL,
  timezone TEXT DEFAULT 'Asia/Taipei',
  action_type TEXT NOT NULL,
  action_config JSONB NOT NULL,
  is_active BOOLEAN DEFAULT true,
  last_run_at TIMESTAMPTZ,
  last_run_result JSONB,
  next_run_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_schedules_user ON schedules(user_id);
CREATE INDEX IF NOT EXISTS idx_schedules_next_run ON schedules(next_run_at) WHERE is_active = true;

-- 訂閱表
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'active',
  provider TEXT,
  provider_subscription_id TEXT,
  provider_customer_id TEXT,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_user_idx ON subscriptions(user_id);

-- ============================================================
-- OAuth Provider（U24：OctoDock 作為 OAuth Provider）
-- 讓 Claude Connectors Directory 等外部 AI 平台透過 OAuth 連接
-- ============================================================

-- OAuth 客戶端（例如 Claude by Anthropic）
CREATE TABLE IF NOT EXISTS oauth_clients (
  id TEXT PRIMARY KEY,                    -- 例如 "claude_connector"
  secret_hash TEXT NOT NULL,              -- SHA-256 hashed secret
  name TEXT NOT NULL,                     -- 顯示名稱
  redirect_uris TEXT[] NOT NULL,          -- 允許的 redirect URIs
  created_at TIMESTAMPTZ DEFAULT now()
);

-- OAuth authorization codes（短命，10 分鐘過期，使用後標記 used）
CREATE TABLE IF NOT EXISTS oauth_codes (
  code TEXT PRIMARY KEY,                  -- 隨機產生
  client_id TEXT NOT NULL REFERENCES oauth_clients(id),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'mcp',
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- OAuth access/refresh tokens
CREATE TABLE IF NOT EXISTS oauth_tokens (
  access_token TEXT PRIMARY KEY,          -- oat_ prefix
  refresh_token TEXT NOT NULL UNIQUE,     -- ort_ prefix
  client_id TEXT NOT NULL REFERENCES oauth_clients(id),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL DEFAULT 'mcp',
  expires_at TIMESTAMPTZ NOT NULL,        -- 1 小時
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_user ON oauth_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_refresh ON oauth_tokens(refresh_token);

-- Bot 設定
CREATE TABLE IF NOT EXISTS bot_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  platform_bot_id TEXT NOT NULL,
  credentials TEXT NOT NULL,
  system_prompt TEXT,
  llm_provider TEXT DEFAULT 'claude',
  llm_api_key TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);
