-- 開發者入口：App 請求 + Adapter 提交
CREATE TABLE IF NOT EXISTS app_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  app_name TEXT NOT NULL,
  email TEXT NOT NULL,
  reason TEXT,
  api_docs_url TEXT,
  auth_type TEXT,
  auth_details TEXT,
  adapter_spec TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_app_submissions_status ON app_submissions (status);
