-- 011: 加回 intent 欄位 + 新增 difficulty 欄位
-- intent 在 009 被移除（當時未使用），現在 octodock_do 會傳入 intent 參數
-- difficulty 是新欄位，octodock_help 會傳入 difficulty 參數
-- 對應 CLAUDE.md 原則 #14：AI 輸入的每個欄位都要存進 DB

ALTER TABLE operations ADD COLUMN IF NOT EXISTS intent TEXT;
ALTER TABLE operations ADD COLUMN IF NOT EXISTS difficulty TEXT;
