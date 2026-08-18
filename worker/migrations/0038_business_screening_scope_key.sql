-- 业务筛选固定业务范围链接：为 resume_push_batches 增加 scope_key（当前为面试官业务范围标识），
-- 同一 scope 的推送复用同一批次/链接；scope_key 为空的历史批次不受影响。
ALTER TABLE resume_push_batches ADD COLUMN scope_key TEXT DEFAULT NULL;
CREATE INDEX IF NOT EXISTS idx_resume_push_batches_scope_key ON resume_push_batches(scope_key, status, expires_at);
