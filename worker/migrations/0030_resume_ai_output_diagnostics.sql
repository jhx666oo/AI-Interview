ALTER TABLE resume_processing_jobs ADD COLUMN ai_finish_reason TEXT;
ALTER TABLE resume_processing_jobs ADD COLUMN ai_content_chars INTEGER;
ALTER TABLE resume_processing_jobs ADD COLUMN ai_reasoning_chars INTEGER;
ALTER TABLE resume_processing_jobs ADD COLUMN ai_response_shape TEXT;
ALTER TABLE resume_processing_jobs ADD COLUMN ai_format_attempt INTEGER;
ALTER TABLE resume_processing_jobs ADD COLUMN ai_repair_status TEXT;
