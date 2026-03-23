-- 008: bot_configs 加 updated_at 欄位
-- 原 schema 缺 updated_at，PUT /api/bot-config 更新後無法追蹤修改時間

ALTER TABLE bot_configs
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 初始化：將現有記錄的 updated_at 設為 created_at
UPDATE bot_configs SET updated_at = created_at WHERE updated_at IS NULL;
