-- 飞书多维表格同步：为 job_requisitions 表增加字段
-- 运行: npx wrangler d1 execute ai-interview-db --remote --file=scripts/migration_feishu_sync.sql

ALTER TABLE job_requisitions ADD COLUMN feishu_record_id TEXT;
ALTER TABLE job_requisitions ADD COLUMN department_3rd TEXT;
ALTER TABLE job_requisitions ADD COLUMN city TEXT;
ALTER TABLE job_requisitions ADD COLUMN start_date TEXT;
ALTER TABLE job_requisitions ADD COLUMN end_date TEXT;
ALTER TABLE job_requisitions ADD COLUMN reason TEXT;
ALTER TABLE job_requisitions ADD COLUMN notes TEXT;
ALTER TABLE job_requisitions ADD COLUMN in_budget TEXT;
ALTER TABLE job_requisitions ADD COLUMN responsible_person TEXT;
ALTER TABLE job_requisitions ADD COLUMN recruitment_account TEXT;
ALTER TABLE job_requisitions ADD COLUMN city_tier INTEGER;
ALTER TABLE job_requisitions ADD COLUMN hr_interviewer TEXT;
ALTER TABLE job_requisitions ADD COLUMN biz_interviewer TEXT;
ALTER TABLE job_requisitions ADD COLUMN final_interviewer TEXT;
ALTER TABLE job_requisitions ADD COLUMN capability_requirements TEXT;
ALTER TABLE job_requisitions ADD COLUMN capability_dimensions TEXT;
ALTER TABLE job_requisitions ADD COLUMN feishu_synced_at TEXT;
ALTER TABLE job_requisitions ADD COLUMN source TEXT DEFAULT 'manual';

-- 索引
CREATE INDEX IF NOT EXISTS idx_job_requisitions_feishu_record_id ON job_requisitions(feishu_record_id);
