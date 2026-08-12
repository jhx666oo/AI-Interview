-- Add scope and total_count columns to resume_reprocess_batches
ALTER TABLE resume_reprocess_batches ADD COLUMN scope TEXT NOT NULL DEFAULT 'all';
ALTER TABLE resume_reprocess_batches ADD COLUMN total_count INTEGER NOT NULL DEFAULT 0;

-- Per-resume batch progress table
CREATE TABLE IF NOT EXISTS resume_reprocess_batch_items (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  resume_id TEXT NOT NULL,
  job_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'queued', 'running', 'completed', 'failed', 'skipped')),
  step TEXT,
  candidate_name TEXT,
  skip_reason TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (batch_id) REFERENCES resume_reprocess_batches(id),
  FOREIGN KEY (resume_id) REFERENCES resumes(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_resume_reprocess_items_batch_resume
  ON resume_reprocess_batch_items(batch_id, resume_id);

CREATE INDEX IF NOT EXISTS idx_resume_reprocess_items_batch_status
  ON resume_reprocess_batch_items(batch_id, status);

CREATE INDEX IF NOT EXISTS idx_resume_reprocess_items_resume_updated
  ON resume_reprocess_batch_items(resume_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_resume_reprocess_items_job
  ON resume_reprocess_batch_items(job_id);
