-- file_sha256 列迁移脚本
-- 执行：wrangler d1 execute ai-interview-db --remote --file=scripts/migration_file_sha256.sql
-- 用途：简历文件哈希去重，防止 mail_sync.py 并发上传重复文件

ALTER TABLE resumes ADD COLUMN file_sha256 TEXT;
CREATE INDEX IF NOT EXISTS idx_resumes_file_sha256 ON resumes(file_sha256);
