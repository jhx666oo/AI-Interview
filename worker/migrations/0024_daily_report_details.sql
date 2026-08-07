-- Add candidate_details column to daily_reports for storing per-person candidate data
ALTER TABLE daily_reports ADD COLUMN candidate_details TEXT;
