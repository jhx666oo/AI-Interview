-- Add the Feishu OAuth refresh failure marker used by user serialization.
ALTER TABLE users ADD COLUMN feishu_token_failed_at TEXT;
