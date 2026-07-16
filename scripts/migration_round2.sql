-- Add round2 evaluation columns to interviews table
ALTER TABLE interviews ADD COLUMN evaluation2 TEXT;
ALTER TABLE interviews ADD COLUMN result2 TEXT DEFAULT 'pending';
ALTER TABLE interviews ADD COLUMN status2 TEXT DEFAULT 'pending';
