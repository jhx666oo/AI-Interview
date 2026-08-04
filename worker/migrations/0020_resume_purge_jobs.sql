CREATE TABLE IF NOT EXISTS resume_purge_jobs (
  id TEXT PRIMARY KEY,
  resume_id TEXT NOT NULL UNIQUE,
  purge_type TEXT NOT NULL DEFAULT 'normal' CHECK (purge_type IN ('normal','privacy')),
  actor_user_id TEXT NOT NULL,
  reason TEXT,
  not_before TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (resume_id) REFERENCES resumes(id)
);
CREATE INDEX IF NOT EXISTS idx_resume_purge_jobs_status ON resume_purge_jobs(status);
CREATE INDEX IF NOT EXISTS idx_resume_purge_jobs_not_before ON resume_purge_jobs(not_before) WHERE status = 'pending';
