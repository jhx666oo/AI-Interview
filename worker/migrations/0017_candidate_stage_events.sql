CREATE TABLE IF NOT EXISTS candidate_stage_events (
  id TEXT PRIMARY KEY,
  resume_id TEXT NOT NULL,
  position_id TEXT,
  stage TEXT NOT NULL CHECK (stage IN (
    'resume_received','ai_screened','hr_approved','hr_rejected',
    'interview_scheduled','interview_completed','interview_passed','interview_failed',
    'offer_sent','offer_accepted','offer_rejected','hired','candidate_withdrawn'
  )),
  action TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  actor_user_id TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  dedupe_key TEXT NOT NULL UNIQUE,
  metadata_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_candidate_stage_events_resume ON candidate_stage_events(resume_id, stage);
CREATE INDEX IF NOT EXISTS idx_candidate_stage_events_occurred ON candidate_stage_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_candidate_stage_events_position ON candidate_stage_events(position_id, occurred_at);

CREATE TABLE IF NOT EXISTS recruitment_event_outbox (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  event_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','sent','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT
);
