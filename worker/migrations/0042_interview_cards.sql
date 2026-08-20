CREATE TABLE IF NOT EXISTS interview_cards (
  id TEXT PRIMARY KEY,
  token_hash TEXT UNIQUE NOT NULL,
  interview_id TEXT NOT NULL,
  resume_id TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  expires_at TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT,
  last_accessed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_interview_cards_interview ON interview_cards(interview_id);
CREATE INDEX IF NOT EXISTS idx_interview_cards_resume ON interview_cards(resume_id);
CREATE INDEX IF NOT EXISTS idx_interview_cards_active ON interview_cards(status, expires_at);
