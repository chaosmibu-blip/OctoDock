-- A1: 新增 agent_instance_id，區分同類型下的不同 Agent 實例
ALTER TABLE operations ADD COLUMN IF NOT EXISTS agent_instance_id VARCHAR;

-- A3: 預留 record_hash 欄位，未來 audit trail 防竄改用
ALTER TABLE operations ADD COLUMN IF NOT EXISTS record_hash VARCHAR(64);
