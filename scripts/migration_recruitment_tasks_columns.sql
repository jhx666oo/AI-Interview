-- 迁移：为 recruitment_tasks 表添加面试官/责任人/城市字段
-- 用于支撑"候选人入库自动通知面试官"功能（场景1）
-- 执行方式（远程）：npx wrangler d1 execute ai-interview-db --remote --file=scripts/migration_recruitment_tasks_columns.sql

ALTER TABLE recruitment_tasks ADD COLUMN interviewers TEXT DEFAULT '[]';
ALTER TABLE recruitment_tasks ADD COLUMN responsible_person TEXT DEFAULT '';
ALTER TABLE recruitment_tasks ADD COLUMN city TEXT DEFAULT '';
