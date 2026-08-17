-- 动态 AI 模型配置：新增 llm_slots 列（JSON 数组）
-- 旧列 llm*/llm2*/llm3*/llm4* 保持兼容（read 仍支持，PUT 不再写入）
ALTER TABLE system_configs ADD COLUMN llm_slots TEXT;
