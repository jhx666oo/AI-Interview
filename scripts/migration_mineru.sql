-- MinerU OCR 接入迁移脚本
-- 执行：wrangler d1 execute ai-interview-db --local --file=scripts/migration_mineru.sql
--       （生产去掉 --local）
-- 说明：resumes 表新增 OCR 状态/原文字段与扩展结构化字段（对齐 TalentFlow AgentCandidateSchema）

ALTER TABLE resumes ADD COLUMN ocr_status TEXT DEFAULT 'none';        -- none/ocr_processing/ocr_done/ocr_failed
ALTER TABLE resumes ADD COLUMN ocr_markdown TEXT;                      -- MinerU 原始 Markdown 原文
ALTER TABLE resumes ADD COLUMN ocr_task_id TEXT;                      -- MinerU task_id（便于续轮询）

-- 扩展结构化字段（保留现有标准字段集，新增 TalentFlow 式数组/维度）
ALTER TABLE resumes ADD COLUMN gender TEXT;                           -- 男/女
ALTER TABLE resumes ADD COLUMN birthday TEXT;                        -- 出生年月，如 1990-01
ALTER TABLE resumes ADD COLUMN work_experience TEXT;                 -- JSON 数组
ALTER TABLE resumes ADD COLUMN education TEXT;                       -- JSON 数组
ALTER TABLE resumes ADD COLUMN certifications TEXT;                  -- JSON 数组（证书/资质）
ALTER TABLE resumes ADD COLUMN self_evaluation TEXT;                 -- 候选人自评/总结

-- parse_status 为纯字符串枚举，D1 无需改类型；
-- 新增取值：ocr_processing（OCR 解析中）/ ocr_done（OCR 完成并已结构化）/ ocr_failed（OCR 失败）
