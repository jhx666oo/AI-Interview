-- 面试前30分钟提醒（面试官）已发送标记：避免 cron 重复提醒同一场面试
ALTER TABLE interviews ADD COLUMN interview_reminder_sent_at TEXT;
CREATE INDEX IF NOT EXISTS idx_interviews_reminder ON interviews(status, interview_reminder_sent_at);
