ALTER TABLE resume_processing_jobs ADD COLUMN ai_provider TEXT;
ALTER TABLE resume_processing_jobs ADD COLUMN ai_model TEXT;
ALTER TABLE resume_processing_jobs ADD COLUMN ai_attempt INTEGER;
ALTER TABLE resume_processing_jobs ADD COLUMN ai_response_chars INTEGER;
ALTER TABLE resume_processing_jobs ADD COLUMN ai_error_stage TEXT;
