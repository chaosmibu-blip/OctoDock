-- 009: 移除 operations 表的 4 個廢棄欄位
-- task_id、intent、record_hash、source_agent 從未被寫入或讀取
-- idx_operations_task 索引因 task_id 永遠為 NULL，索引零列

-- 先移除依賴 task_id 的部分索引
DROP INDEX IF EXISTS idx_operations_task;

-- 移除 4 個廢棄欄位
ALTER TABLE operations
  DROP COLUMN IF EXISTS task_id,
  DROP COLUMN IF EXISTS intent,
  DROP COLUMN IF EXISTS record_hash,
  DROP COLUMN IF EXISTS source_agent;
