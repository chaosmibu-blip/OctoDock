-- 010: stored_results.user_id 從 text 改為 uuid，並加外鍵約束
-- 修正與其他表（皆使用 uuid）不一致的問題

-- 先移除舊的 index（因為欄位類型要變）
DROP INDEX IF EXISTS idx_stored_results_user;

-- 將 user_id 欄位從 text 轉為 uuid
ALTER TABLE stored_results
  ALTER COLUMN user_id TYPE uuid USING user_id::uuid;

-- 加上外鍵約束，刪除用戶時一併清除暫存結果
ALTER TABLE stored_results
  ADD CONSTRAINT stored_results_user_id_users_id_fk
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- 重建 index
CREATE INDEX idx_stored_results_user ON stored_results(user_id);
