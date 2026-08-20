-- 面试自动化闭环基础字段：日程、版本、取消原因与可靠重试状态
ALTER TABLE interviews ADD COLUMN candidate_email TEXT DEFAULT '';
ALTER TABLE interviews ADD COLUMN scheduled_start_at TEXT;
ALTER TABLE interviews ADD COLUMN scheduled_end_at TEXT;
ALTER TABLE interviews ADD COLUMN duration_minutes INTEGER NOT NULL DEFAULT 60;
ALTER TABLE interviews ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai';
ALTER TABLE interviews ADD COLUMN schedule_status TEXT NOT NULL DEFAULT 'not_ready';
ALTER TABLE interviews ADD COLUMN calendar_id TEXT DEFAULT '';
ALTER TABLE interviews ADD COLUMN calendar_event_id TEXT DEFAULT '';
ALTER TABLE interviews ADD COLUMN meeting_url TEXT DEFAULT '';
ALTER TABLE interviews ADD COLUMN previous_interview_id TEXT;
ALTER TABLE interviews ADD COLUMN next_interview_id TEXT;
ALTER TABLE interviews ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE interviews ADD COLUMN last_error_code TEXT DEFAULT '';
ALTER TABLE interviews ADD COLUMN last_error_message TEXT DEFAULT '';
ALTER TABLE interviews ADD COLUMN cancel_reason TEXT DEFAULT '';
ALTER TABLE interviews ADD COLUMN cancelled_by TEXT DEFAULT '';
ALTER TABLE interviews ADD COLUMN cancelled_at TEXT;

CREATE TABLE IF NOT EXISTS interview_automation_jobs (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  resume_id TEXT,
  interview_id TEXT,
  action TEXT NOT NULL CHECK (action IN (
    'auto_business_screening','create_next_round','schedule','reschedule','cancel',
    'notify_interviewer','notify_candidate','advance'
  )),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','partial','failed','cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_retry_at TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL DEFAULT '{}',
  error_code TEXT DEFAULT '',
  error_message TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_interview_jobs_status_retry ON interview_automation_jobs(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_interview_jobs_interview ON interview_automation_jobs(interview_id, created_at);

CREATE TABLE IF NOT EXISTS interview_notifications (
  id TEXT PRIMARY KEY,
  interview_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('feishu_card','feishu_file','email')),
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('primary_interviewer','secondary_interviewer','candidate','hr')),
  recipient_id TEXT NOT NULL DEFAULT '',
  template_key TEXT NOT NULL CHECK (template_key IN ('scheduled','reminder_30m','rescheduled','cancelled')),
  interview_version INTEGER NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed','skipped','cancelled')),
  external_message_id TEXT DEFAULT '',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT DEFAULT '',
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_interview_notifications_interview ON interview_notifications(interview_id, created_at);
CREATE INDEX IF NOT EXISTS idx_interview_notifications_status ON interview_notifications(status, updated_at);

-- 将旧的飞书字段一次性映射到稳定命名，保留双写兼容旧前端与历史数据。
UPDATE interviews
SET calendar_event_id = COALESCE(NULLIF(calendar_event_id, ''), feishu_event_id, ''),
    meeting_url = COALESCE(NULLIF(meeting_url, ''), meeting_link, '')
WHERE COALESCE(feishu_event_id, '') <> '' OR COALESCE(meeting_link, '') <> '';
