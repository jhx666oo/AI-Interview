-- Migration 0023: Add file_sha256 column for resume deduplication
-- Prevents duplicate uploads by checking file hash before insert

ALTER TABLE resumes ADD COLUMN file_sha256 TEXT;
