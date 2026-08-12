-- Resume additive columns are applied through the guarded code-side compatibility
-- migration path because this SQLite target does not support
-- ALTER TABLE ... ADD COLUMN IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS resume_push_batches (
  id TEXT PRIMARY KEY,
  interviewer_id TEXT,
  interviewer_name TEXT NOT NULL,
  interviewer_open_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'revoked', 'expired')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_sent_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_resume_push_batches_token_hash
  ON resume_push_batches(token_hash);

CREATE INDEX IF NOT EXISTS idx_resume_push_batches_status
  ON resume_push_batches(status, expires_at);

CREATE TABLE IF NOT EXISTS resume_push_batch_items (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  resume_id TEXT NOT NULL,
  position_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'passed', 'rejected')),
  remark TEXT,
  processed_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (batch_id) REFERENCES resume_push_batches(id),
  FOREIGN KEY (resume_id) REFERENCES resumes(id),
  FOREIGN KEY (position_id) REFERENCES positions(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_resume_push_batch_items_batch_resume
  ON resume_push_batch_items(batch_id, resume_id);

CREATE INDEX IF NOT EXISTS idx_resume_push_batch_items_batch_status
  ON resume_push_batch_items(batch_id, status);

CREATE INDEX IF NOT EXISTS idx_resume_push_batch_items_resume_status
  ON resume_push_batch_items(resume_id, status);
