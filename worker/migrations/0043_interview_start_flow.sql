-- 开始面试流程：飞书会议日程 + 候选人面试详情免登录链接 + 候选人邮件
ALTER TABLE interviews ADD COLUMN feishu_event_id TEXT DEFAULT '';
ALTER TABLE interviews ADD COLUMN invite_token_hash TEXT DEFAULT '';
ALTER TABLE interviews ADD COLUMN invite_expires_at TEXT;
ALTER TABLE interviews ADD COLUMN invite_email_sent_at TEXT;
