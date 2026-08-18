-- Real Excel archives for the recruiting dashboard. JSON dashboard snapshots remain
-- the source for rendering/sharing; this table stores the downloadable workbook.
CREATE TABLE IF NOT EXISTS dashboard_excel_archives (
  id TEXT PRIMARY KEY,
  snapshot_date TEXT NOT NULL,
  file_type TEXT NOT NULL DEFAULT 'dashboard',
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  file_size INTEGER NOT NULL,
  content_base64 TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  generated_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboard_excel_archives_date_type
  ON dashboard_excel_archives(snapshot_date, file_type);
CREATE INDEX IF NOT EXISTS idx_dashboard_excel_archives_date
  ON dashboard_excel_archives(snapshot_date DESC);
