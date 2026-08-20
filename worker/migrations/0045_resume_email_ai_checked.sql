-- AI 提取邮箱的检查标记：记录最后一次 AI 尝试时间（成功或确认无邮箱都会写入），
-- 非空则跳过，避免对确认无邮箱的简历反复调用 LLM 浪费额度
ALTER TABLE resumes ADD COLUMN email_ai_checked_at TEXT;
CREATE INDEX IF NOT EXISTS idx_resumes_email_ai_checked ON resumes(email_ai_checked_at);
