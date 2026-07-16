-- 人才库飞书同步迁移

ALTER TABLE talent_pool ADD COLUMN feishu_record_id TEXT;
ALTER TABLE talent_pool ADD COLUMN feishu_synced_at TEXT;
ALTER TABLE talent_pool ADD COLUMN age TEXT;
ALTER TABLE talent_pool ADD COLUMN gender TEXT;
ALTER TABLE talent_pool ADD COLUMN city TEXT;
ALTER TABLE talent_pool ADD COLUMN position_applied TEXT;
ALTER TABLE talent_pool ADD COLUMN ai_evaluation TEXT;

CREATE INDEX IF NOT EXISTS idx_talent_pool_feishu_record_id ON talent_pool(feishu_record_id);
