-- 面试管理卡片链接：单个候选人面试情况汇总的免登录公开链接（固定 7 天有效）
-- 与业务筛选链接（resume_push_batches）同机制：只存 token 的 SHA-256 哈希，不存明文
-- token 由卡片 id 确定性派生（SHA-256('interview-card::' + id)），URL 稳定可查询
CREATE TABLE IF NOT EXISTS interview_card_links (
  id TEXT PRIMARY KEY,
  resume_id TEXT,
  candidate_name TEXT DEFAULT '',
  position_applied TEXT DEFAULT '',
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  expires_at TEXT NOT NULL,
  created_by TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  last_accessed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_interview_card_links_resume ON interview_card_links(resume_id, status);
CREATE INDEX IF NOT EXISTS idx_interview_card_links_expires ON interview_card_links(expires_at);
CREATE INDEX IF NOT EXISTS idx_interview_card_links_candidate ON interview_card_links(candidate_name, status);
