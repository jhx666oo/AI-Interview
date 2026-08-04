CREATE TABLE IF NOT EXISTS resume_artifacts (
  id TEXT PRIMARY KEY,
  resume_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('pdf','ocr','ai_analysis','interview_report','search_document')),
  object_key TEXT NOT NULL,
  bucket TEXT NOT NULL DEFAULT 'ai-interview-resume-artifacts',
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  content_sha256 TEXT,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','available','expired','deleted','failed')),
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_resume_artifacts_resume_id ON resume_artifacts(resume_id);
CREATE INDEX IF NOT EXISTS idx_resume_artifacts_type_status ON resume_artifacts(type, status);
CREATE INDEX IF NOT EXISTS idx_resume_artifacts_object_key ON resume_artifacts(object_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_resume_artifacts_resume_type_version ON resume_artifacts(resume_id, type, version);

-- 追踪哪个 artifact 是当前有效的（每个 type 最多一个 current 为 true）
ALTER TABLE resume_artifacts ADD COLUMN is_current INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_resume_artifacts_current ON resume_artifacts(resume_id, type, is_current) WHERE is_current = 1;
