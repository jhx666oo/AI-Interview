-- 0048：同一候选人同一轮只保留一条未取消面试。
-- 执行前必须先运行 scripts/audit_interview_rounds.sql，确认 active_count 均为 1。
CREATE UNIQUE INDEX IF NOT EXISTS idx_interviews_resume_round_active
ON interviews(resume_id, round)
WHERE COALESCE(resume_id, '') <> '' AND status <> 'cancelled';
