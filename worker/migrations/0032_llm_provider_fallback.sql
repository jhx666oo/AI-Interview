-- Migration 0032: 支持 AI 模型多配置降级（最多 4 组，优先级从上到下）
-- 在 system_configs 增加 llm2_* / llm3_* / llm4_* 三组配置列，与已有 llm_* 第一组对齐。

ALTER TABLE system_configs ADD COLUMN llm2_base_url TEXT;
ALTER TABLE system_configs ADD COLUMN llm2_model TEXT;
ALTER TABLE system_configs ADD COLUMN llm2_api_key TEXT;
ALTER TABLE system_configs ADD COLUMN llm3_base_url TEXT;
ALTER TABLE system_configs ADD COLUMN llm3_model TEXT;
ALTER TABLE system_configs ADD COLUMN llm3_api_key TEXT;
ALTER TABLE system_configs ADD COLUMN llm4_base_url TEXT;
ALTER TABLE system_configs ADD COLUMN llm4_model TEXT;
ALTER TABLE system_configs ADD COLUMN llm4_api_key TEXT;
