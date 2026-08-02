CREATE TABLE IF NOT EXISTS dashboard_snapshots (
  id TEXT PRIMARY KEY,
  snapshot_date TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  generated_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dashboard_snapshots_date ON dashboard_snapshots(snapshot_date DESC);
CREATE TRIGGER IF NOT EXISTS prevent_dashboard_snapshot_update
BEFORE UPDATE ON dashboard_snapshots
BEGIN
  SELECT RAISE(ABORT, 'dashboard snapshot is immutable');
END;
CREATE TRIGGER IF NOT EXISTS prevent_dashboard_snapshot_delete
BEFORE DELETE ON dashboard_snapshots
BEGIN
  SELECT RAISE(ABORT, 'dashboard snapshot is immutable');
END;
ALTER TABLE dashboard_share_links ADD COLUMN data_mode TEXT NOT NULL DEFAULT 'live';
ALTER TABLE dashboard_share_links ADD COLUMN snapshot_id TEXT;
CREATE INDEX IF NOT EXISTS idx_dashboard_share_links_snapshot ON dashboard_share_links(snapshot_id);
