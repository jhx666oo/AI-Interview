ALTER TABLE resumes ADD COLUMN resume_received_at TEXT;
ALTER TABLE resumes ADD COLUMN resume_source TEXT DEFAULT 'unknown';
ALTER TABLE resumes ADD COLUMN resume_source_record_id TEXT DEFAULT '';
ALTER TABLE resumes ADD COLUMN resume_ingest_key TEXT DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_resumes_received_at ON resumes(resume_received_at);
CREATE INDEX IF NOT EXISTS idx_resumes_ingest_key ON resumes(resume_ingest_key);
CREATE INDEX IF NOT EXISTS idx_resumes_source_record ON resumes(resume_source, resume_source_record_id);
