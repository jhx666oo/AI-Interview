-- 每个岗位独立控制 AI 初筛通过后的业务筛选自动推送，默认关闭，灰度开启。
ALTER TABLE positions ADD COLUMN auto_business_screening_enabled INTEGER NOT NULL DEFAULT 0;
