-- 同步本地 D1 schema：补齐 resumes 和 job_requisitions 缺失的列
-- 对比远程 D1 发现本地缺这些列（远程通过 ALTER 加过，本地/schema.sql 没同步）

-- resumes 表缺 6 列
ALTER TABLE resumes ADD COLUMN hard_requirement_result TEXT;
ALTER TABLE resumes ADD COLUMN capability_scores TEXT;
ALTER TABLE resumes ADD COLUMN three_layer_match TEXT;
ALTER TABLE resumes ADD COLUMN feishu_file_token TEXT;
ALTER TABLE resumes ADD COLUMN uploaded_at TEXT;
ALTER TABLE resumes ADD COLUMN updated_at TEXT;

-- job_requisitions 表缺 19 列
ALTER TABLE job_requisitions ADD COLUMN city TEXT DEFAULT '';
ALTER TABLE job_requisitions ADD COLUMN hard_requirements TEXT;
ALTER TABLE job_requisitions ADD COLUMN hr_interviewer TEXT;
ALTER TABLE job_requisitions ADD COLUMN biz_interviewer TEXT;
ALTER TABLE job_requisitions ADD COLUMN final_interviewer TEXT;
ALTER TABLE job_requisitions ADD COLUMN responsible_person TEXT;
ALTER TABLE job_requisitions ADD COLUMN capability_requirements TEXT;
ALTER TABLE job_requisitions ADD COLUMN feishu_record_id TEXT;
ALTER TABLE job_requisitions ADD COLUMN personalized_requirements TEXT;
ALTER TABLE job_requisitions ADD COLUMN reason TEXT;
ALTER TABLE job_requisitions ADD COLUMN notes TEXT;
ALTER TABLE job_requisitions ADD COLUMN department_3rd TEXT;
ALTER TABLE job_requisitions ADD COLUMN city_tier TEXT;
ALTER TABLE job_requisitions ADD COLUMN in_budget TEXT;
ALTER TABLE job_requisitions ADD COLUMN recruitment_account TEXT;
ALTER TABLE job_requisitions ADD COLUMN start_date TEXT;
ALTER TABLE job_requisitions ADD COLUMN end_date TEXT;
ALTER TABLE job_requisitions ADD COLUMN capability_dimensions TEXT;
ALTER TABLE job_requisitions ADD COLUMN name TEXT;
