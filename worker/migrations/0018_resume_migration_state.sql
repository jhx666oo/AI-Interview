CREATE TABLE IF NOT EXISTS resume_migration_state (
  resume_id TEXT PRIMARY KEY,
  source_columns TEXT NOT NULL DEFAULT '{}',
  source_sha256 TEXT,
  target_artifact_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','migrating','verified','failed','cleaned')),
  failure_reason TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (resume_id) REFERENCES resumes(id)
);
CREATE INDEX IF NOT EXISTS idx_resume_migration_status ON resume_migration_state(status);
