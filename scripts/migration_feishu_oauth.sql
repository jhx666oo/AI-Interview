-- 飞书 OAuth 用户身份 Token 存储表
-- 运行: npx wrangler d1 execute ai-interview-db --remote --file=scripts/migration_feishu_oauth.sql

CREATE TABLE IF NOT EXISTS feishu_tokens (
  id TEXT PRIMARY KEY,
  user_email TEXT NOT NULL DEFAULT '',
  access_token TEXT NOT NULL DEFAULT '',
  refresh_token TEXT NOT NULL DEFAULT '',
  expires_at INTEGER NOT NULL DEFAULT 0,
  open_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_feishu_tokens_email ON feishu_tokens(user_email);
CREATE INDEX IF NOT EXISTS idx_feishu_tokens_expires ON feishu_tokens(expires_at);
