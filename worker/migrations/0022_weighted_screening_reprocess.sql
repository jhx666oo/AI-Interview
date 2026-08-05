ALTER TABLE resume_screening_queue ADD COLUMN weighted_score REAL;
ALTER TABLE resume_screening_queue ADD COLUMN screening_result TEXT;
ALTER TABLE resume_screening_queue ADD COLUMN screening_reason TEXT DEFAULT '';
ALTER TABLE resume_screening_queue ADD COLUMN gate_results TEXT DEFAULT '{}';

CREATE TABLE IF NOT EXISTS resume_reprocess_batches (
  id TEXT PRIMARY KEY,
  owner TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  cursor TEXT,
  requested_count INTEGER NOT NULL DEFAULT 0,
  matched_count INTEGER NOT NULL DEFAULT 0,
  queued_count INTEGER NOT NULL DEFAULT 0,
  already_processing_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_resume_reprocess_one_active_owner
  ON resume_reprocess_batches(COALESCE(owner, ''))
  WHERE status IN ('queued', 'running');
