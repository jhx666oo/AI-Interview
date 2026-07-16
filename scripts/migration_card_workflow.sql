-- 小七全功能 Worker 集成迁移
-- resume_screening_queue 添加飞书卡片相关字段

ALTER TABLE resume_screening_queue ADD COLUMN feishu_card_msg_id TEXT;
ALTER TABLE resume_screening_queue ADD COLUMN feishu_processed_at TEXT;
ALTER TABLE resume_screening_queue ADD COLUMN file_path TEXT;
