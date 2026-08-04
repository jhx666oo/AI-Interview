CREATE TABLE IF NOT EXISTS resume_upload_sessions (
  id TEXT PRIMARY KEY,
  resume_id TEXT NOT NULL UNIQUE,
  pdf_artifact_id TEXT NOT NULL,
  text_artifact_id TEXT,
  created_by TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  expected_pdf_size INTEGER NOT NULL CHECK (expected_pdf_size > 0),
  expected_pdf_sha256 TEXT NOT NULL,
  expected_text_size INTEGER,
  expected_text_sha256 TEXT,
  status TEXT NOT NULL CHECK (status IN ('initiated','completed','expired','failed')),
  error_code TEXT,
  job_id TEXT,
  completed_at TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_resume_upload_sessions_status ON resume_upload_sessions(status);
CREATE INDEX IF NOT EXISTS idx_resume_upload_sessions_expiry ON resume_upload_sessions(expires_at) WHERE status = 'initiated';
