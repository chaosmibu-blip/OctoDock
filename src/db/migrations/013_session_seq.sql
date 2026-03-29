-- 通用 Session 機制：讓多次 octodock_do 呼叫能歸屬同一個任務
-- sessionSeq: 自動遞增數字，AI 透過 intent 尾部 +N 引用
-- sessionId: 同 session 共用的 UUID，用於查詢和分組

-- 建立 sequence（獨立於主鍵，專門給 session 編號用）
CREATE SEQUENCE IF NOT EXISTS operations_session_seq_seq START 1;

-- 新增欄位
ALTER TABLE operations ADD COLUMN IF NOT EXISTS session_seq INTEGER DEFAULT nextval('operations_session_seq_seq');
ALTER TABLE operations ADD COLUMN IF NOT EXISTS session_id UUID;

-- 索引：按 session 分組查詢
CREATE INDEX IF NOT EXISTS idx_operations_session_id ON operations(session_id) WHERE session_id IS NOT NULL;
-- 索引：按 session_seq 查找（AI 帶 +N 時需要快速定位）
CREATE INDEX IF NOT EXISTS idx_operations_session_seq ON operations(session_seq) WHERE session_seq IS NOT NULL;
