CREATE TABLE IF NOT EXISTS dashboard_share_links (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('all','divisions')),
  scope_ids TEXT NOT NULL DEFAULT '[]',
  expires_at TEXT,
  revoked_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dashboard_share_links_active
  ON dashboard_share_links(revoked_at, expires_at);
