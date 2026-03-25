-- 事件圖譜：操作因果關聯欄位
-- 記錄「這個操作是因為哪個操作觸發的」
ALTER TABLE operations ADD COLUMN IF NOT EXISTS parent_operation_id UUID REFERENCES operations(id);
CREATE INDEX IF NOT EXISTS idx_operations_parent ON operations(parent_operation_id) WHERE parent_operation_id IS NOT NULL;
