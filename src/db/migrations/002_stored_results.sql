-- 回傳壓縮：大回傳暫存區
-- 超過 3000 字元的操作回傳存在這裡，AI 用 get_stored 按需取用
CREATE TABLE IF NOT EXISTS stored_results (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  app_name TEXT NOT NULL,
  action TEXT NOT NULL,
  content TEXT NOT NULL,
  content_length INTEGER NOT NULL,
  summary TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_stored_results_user ON stored_results (user_id);
CREATE INDEX IF NOT EXISTS idx_stored_results_expires ON stored_results (expires_at);
