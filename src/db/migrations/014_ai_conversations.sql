-- AI 對話紀錄表：記錄兩個 AI 服務之間的多輪對話
CREATE TABLE IF NOT EXISTS ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL,           -- 同一場對話共用的 ID
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  initiator_app TEXT NOT NULL,             -- 發起方 AI（例如 "openai"）
  partner_app TEXT NOT NULL,               -- 對話方 AI（例如 "anthropic"）
  round INTEGER NOT NULL,                  -- 第幾輪
  speaker TEXT NOT NULL,                   -- 這輪的發言者（app name）
  content TEXT NOT NULL,                   -- 發言內容
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引：按對話 ID 查詢所有輪次
CREATE INDEX IF NOT EXISTS idx_ai_conversations_conv_id ON ai_conversations(conversation_id);
-- 索引：按用戶查詢對話歷史
CREATE INDEX IF NOT EXISTS idx_ai_conversations_user ON ai_conversations(user_id, created_at);
