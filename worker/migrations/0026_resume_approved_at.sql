-- Record the exact explicit approval event used by immutable daily reports.
ALTER TABLE resumes ADD COLUMN approved_at TEXT;
