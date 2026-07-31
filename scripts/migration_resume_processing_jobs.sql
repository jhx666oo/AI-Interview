CREATE TABLE IF NOT EXISTS resume_processing_jobs (
  id TEXT PRIMARY KEY,
  resume_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  step TEXT NOT NULL CHECK (step IN ('extracting_text', 'extracting_fields', 'screening', 'syncing_feishu')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (resume_id) REFERENCES resumes(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_resume_jobs_one_active
  ON resume_processing_jobs(resume_id)
  WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS idx_resume_jobs_status_updated
  ON resume_processing_jobs(status, updated_at DESC);
