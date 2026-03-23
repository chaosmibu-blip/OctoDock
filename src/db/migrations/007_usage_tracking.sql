-- 007: 建立 usage_tracking 表（MCP tool call 用量追蹤）
-- schema.ts 有定義但缺 migration，導致 production DB 查詢失敗

CREATE TABLE IF NOT EXISTS usage_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  tool_call_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 每個用戶每月只有一筆記錄（upsert 用）
CREATE UNIQUE INDEX IF NOT EXISTS usage_tracking_user_month_idx
  ON usage_tracking (user_id, month);
