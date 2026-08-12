-- D1 Schema for ai-interview (SQLite)
-- Adapted from PostgreSQL models

-- Users
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  hashed_password TEXT NOT NULL,
  plain_password TEXT DEFAULT '',
  full_name TEXT,
  role TEXT DEFAULT 'hr',
  is_active INTEGER DEFAULT 1,
  feishu_token TEXT DEFAULT '',
  feishu_open_id TEXT DEFAULT '',
  feishu_name TEXT DEFAULT '',
  feishu_refresh_token TEXT DEFAULT '',
  feishu_token_expires_at INTEGER DEFAULT 0,
  feishu_token_failed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Positions
CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  requirements TEXT,
  salary_range TEXT,
  location TEXT,
  department TEXT,
  status TEXT DEFAULT 'open',
  urgency TEXT DEFAULT 'medium',
  position_type TEXT DEFAULT 'full_time',
  headcount INTEGER DEFAULT 1,
  hiring_manager_id TEXT,
  responsible_person TEXT DEFAULT '',
  primary_interviewer TEXT DEFAULT '',
  secondary_interviewer TEXT DEFAULT '',
  personalized_requirements TEXT DEFAULT '',
  capability_dimensions TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Question Banks
CREATE TABLE IF NOT EXISTS question_banks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT DEFAULT 'technical',
  difficulty TEXT DEFAULT 'intermediate',
  tags TEXT,
  questions TEXT,
  source_file TEXT,
  position_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Resumes
CREATE TABLE IF NOT EXISTS resumes (
  id TEXT PRIMARY KEY,
  candidate_name TEXT,
  contact TEXT,
  email TEXT,
  position_id TEXT,
  position_applied TEXT DEFAULT '',
  mapped_position TEXT DEFAULT '',
  file_path TEXT,
  raw_text TEXT,
  resume_markdown TEXT,
  parsed_data TEXT,
  match_score INTEGER,
  parse_status TEXT DEFAULT 'processing',
  parse_error TEXT,
  parsed_at TEXT,
  screening_result TEXT DEFAULT 'pending',
  ai_review TEXT,
  ai_evaluation TEXT,
  hr_review TEXT,
  status TEXT DEFAULT 'pending_screening',
  stage TEXT DEFAULT 'new',
  other_position_matches TEXT,
  reject_reason_category TEXT,
  reject_reason_detail TEXT,
  approved_at TEXT,
  rejected_at TEXT,
  rejected_by TEXT,
  -- MinerU OCR 接入扩展字段
  ocr_status TEXT DEFAULT 'none',        -- none/ocr_processing/ocr_done/ocr_failed
  ocr_markdown TEXT,                      -- MinerU 原始 Markdown 原文
  ocr_task_id TEXT,                       -- MinerU task_id（便于续轮询）
  gender TEXT,                            -- 男/女
  birthday TEXT,                          -- 出生年月，如 1990-01
  work_experience TEXT,                   -- JSON 数组
  education TEXT,                         -- JSON 数组
  certifications TEXT,                    -- JSON 数组（证书/资质）
  self_evaluation TEXT,                   -- 候选人自评/总结
  hard_requirement_result TEXT DEFAULT '',
  capability_scores TEXT DEFAULT '{}',
  three_layer_match TEXT DEFAULT '{}',
  feishu_file_token TEXT DEFAULT '',
  uploaded_at TEXT DEFAULT '',
  mineru_task_id TEXT DEFAULT '',
  mineru_status TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_resumes_email ON resumes(email);
CREATE INDEX IF NOT EXISTS idx_resumes_position ON resumes(position_id);

-- Durable Resume Processing Jobs
CREATE TABLE IF NOT EXISTS resume_processing_jobs (
  id TEXT PRIMARY KEY,
  resume_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  step TEXT NOT NULL CHECK (step IN ('extracting_text', 'extracting_fields', 'screening', 'syncing_feishu')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_message TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (resume_id) REFERENCES resumes(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_resume_jobs_one_active
  ON resume_processing_jobs(resume_id)
  WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS idx_resume_jobs_status_updated
  ON resume_processing_jobs(status, updated_at DESC);

-- Bounded coordinator state for all-history weighted re-evaluation
CREATE TABLE IF NOT EXISTS resume_reprocess_batches (
  id TEXT PRIMARY KEY,
  owner TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
  scope TEXT NOT NULL DEFAULT 'all',
  total_count INTEGER NOT NULL DEFAULT 0,
  cursor TEXT,
  requested_count INTEGER NOT NULL DEFAULT 0,
  matched_count INTEGER NOT NULL DEFAULT 0,
  queued_count INTEGER NOT NULL DEFAULT 0,
  already_processing_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_resume_reprocess_one_active_owner
  ON resume_reprocess_batches(COALESCE(owner, ''))
  WHERE status IN ('queued', 'running');

-- Per-resume batch progress tracking
CREATE TABLE IF NOT EXISTS resume_reprocess_batch_items (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  resume_id TEXT NOT NULL,
  job_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'queued', 'running', 'completed', 'failed', 'skipped')),
  step TEXT,
  candidate_name TEXT,
  skip_reason TEXT,
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (batch_id) REFERENCES resume_reprocess_batches(id),
  FOREIGN KEY (resume_id) REFERENCES resumes(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_resume_reprocess_items_batch_resume
  ON resume_reprocess_batch_items(batch_id, resume_id);
CREATE INDEX IF NOT EXISTS idx_resume_reprocess_items_batch_status
  ON resume_reprocess_batch_items(batch_id, status);
CREATE INDEX IF NOT EXISTS idx_resume_reprocess_items_resume_updated
  ON resume_reprocess_batch_items(resume_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_resume_reprocess_items_job
  ON resume_reprocess_batch_items(job_id);

-- Department Reviews
CREATE TABLE IF NOT EXISTS department_reviews (
  id TEXT PRIMARY KEY,
  resume_id TEXT NOT NULL,
  reviewer_id TEXT NOT NULL,
  technical_score INTEGER,
  experience_score INTEGER,
  overall_score INTEGER,
  recommendation TEXT,
  comment TEXT,
  is_completed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Interviews
CREATE TABLE IF NOT EXISTS interviews (
  id TEXT PRIMARY KEY,
  resume_id TEXT,
  position_id TEXT,
  interviewer_id TEXT,
  interviewer TEXT,
  round INTEGER DEFAULT 1,
  interview_time TEXT,
  started_at TEXT,
  interview_type TEXT DEFAULT 'onsite',
  interview_category TEXT DEFAULT 'technical',
  interview_location TEXT,
  meeting_link TEXT,
  questions TEXT,
  scores TEXT,
  comments TEXT,
  total_score INTEGER,
  panel_members TEXT,
  audio_records TEXT,
  transcripts TEXT,
  result TEXT DEFAULT 'pending',
  evaluation TEXT,
  evaluation2 TEXT,
  result2 TEXT DEFAULT 'pending',
  status2 TEXT DEFAULT 'pending',
  suggestion TEXT,
  status TEXT DEFAULT 'scheduled',
  feishu_record_id TEXT DEFAULT '',
  primary_interviewer TEXT DEFAULT '',
  secondary_interviewer TEXT DEFAULT '',
  candidate_name TEXT DEFAULT '',
  position_applied TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);

-- Interview Panels
CREATE TABLE IF NOT EXISTS interview_panels (
  id TEXT PRIMARY KEY,
  interview_id TEXT,
  interviewer_id TEXT,
  scores TEXT,
  comments TEXT,
  audio_records TEXT,
  transcripts TEXT,
  total_score INTEGER,
  is_submitted INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Offers
CREATE TABLE IF NOT EXISTS offers (
  id TEXT PRIMARY KEY,
  resume_id TEXT NOT NULL,
  position_id TEXT NOT NULL,
  candidate_name TEXT NOT NULL,
  candidate_email TEXT NOT NULL,
  salary_monthly REAL,
  salary_annual REAL,
  salary_structure TEXT,
  position_title TEXT NOT NULL,
  department TEXT,
  report_to TEXT,
  work_location TEXT,
  work_hours TEXT,
  onboard_date TEXT,
  probation_months INTEGER DEFAULT 3,
  benefits TEXT,
  bonus TEXT,
  special_terms TEXT,
  notes TEXT,
  valid_until TEXT,
  status TEXT DEFAULT 'draft',
  token TEXT,
  sent_at TEXT,
  accepted_at TEXT,
  rejected_at TEXT,
  rejected_reason TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  created_by TEXT
);

-- Offer Templates
CREATE TABLE IF NOT EXISTS offer_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  position_id TEXT,
  salary_monthly REAL,
  salary_annual REAL,
  salary_structure TEXT,
  department TEXT,
  report_to TEXT,
  work_location TEXT,
  work_hours TEXT,
  probation_months INTEGER DEFAULT 3,
  benefits TEXT,
  bonus TEXT,
  special_terms TEXT,
  notes TEXT,
  valid_days INTEGER DEFAULT 7,
  is_default INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  created_by TEXT
);

-- Coding Tests
CREATE TABLE IF NOT EXISTS coding_tests (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  test_type TEXT DEFAULT 'algorithm',
  difficulty TEXT DEFAULT 'intermediate',
  language TEXT DEFAULT 'javascript',
  starter_code TEXT,
  test_cases TEXT,
  time_limit_ms INTEGER DEFAULT 3000,
  memory_limit_mb INTEGER DEFAULT 256,
  public_token TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'draft',
  question_bank_id TEXT,
  questions TEXT,
  question_generation_status TEXT DEFAULT 'pending',
  duration_minutes INTEGER DEFAULT 60,
  created_by TEXT,
  resume_id TEXT,
  position_id TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Coding Submissions
CREATE TABLE IF NOT EXISTS coding_submissions (
  id TEXT PRIMARY KEY,
  coding_test_id TEXT,
  candidate_name TEXT,
  candidate_email TEXT,
  language TEXT,
  code TEXT,
  answers TEXT,
  run_result TEXT,
  passed INTEGER DEFAULT 0,
  score INTEGER DEFAULT 0,
  ai_evaluation TEXT,
  status TEXT DEFAULT 'draft',
  created_at TEXT DEFAULT (datetime('now')),
  submitted_at TEXT,
  evaluated_at TEXT
);

-- System Configs
CREATE TABLE IF NOT EXISTS system_configs (
  id TEXT PRIMARY KEY,
  llm_provider TEXT DEFAULT 'dashscope',
  llm_base_url TEXT,
  llm_api_key TEXT,
  llm_model TEXT,
  llm_temperature REAL DEFAULT 0.2,
  llm_max_tokens INTEGER,
  smtp_host TEXT,
  smtp_port INTEGER DEFAULT 465,
  smtp_username TEXT,
  smtp_password TEXT,
  mail_from TEXT,
  mail_from_name TEXT DEFAULT '招聘系统',
  mail_enabled INTEGER DEFAULT 0,
  frontend_url TEXT DEFAULT 'http://localhost:5173',
  prompt_configs TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Job Requisitions
CREATE TABLE IF NOT EXISTS job_requisitions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  department TEXT NOT NULL,
  headcount INTEGER DEFAULT 1,
  employment_type TEXT DEFAULT 'full_time',
  salary_range TEXT,
  budget REAL,
  urgency TEXT DEFAULT 'medium',
  expected_date TEXT,
  description TEXT,
  requirements TEXT,
  reporting_to TEXT,
  requested_by TEXT,
  position_id TEXT,
  status TEXT DEFAULT 'draft',
  approved_by TEXT,
  approved_at TEXT,
  rejection_reason TEXT,
  channel_plan TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Recruitment Channels
CREATE TABLE IF NOT EXISTS recruitment_channels (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  channel_type TEXT DEFAULT 'job_platform',
  position_id TEXT,
  url TEXT,
  contact TEXT,
  cost REAL DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  resumes_count INTEGER DEFAULT 0,
  hired_count INTEGER DEFAULT 0,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Talent Pool
CREATE TABLE IF NOT EXISTS talent_pool (
  id TEXT PRIMARY KEY,
  resume_id TEXT,
  candidate_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  current_title TEXT,
  skills TEXT,
  experience_years INTEGER,
  education TEXT,
  expected_salary TEXT,
  source TEXT,
  tags TEXT,
  status TEXT DEFAULT 'available',
  notes TEXT,
  last_contacted_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Daily Reports
CREATE TABLE IF NOT EXISTS daily_reports (
  id TEXT PRIMARY KEY,
  report_date TEXT NOT NULL,
  total_resumes INTEGER DEFAULT 0,
  pending_screening INTEGER DEFAULT 0,
  approved INTEGER DEFAULT 0,
  rejected INTEGER DEFAULT 0,
  total_interviews INTEGER DEFAULT 0,
  total_offers INTEGER DEFAULT 0,
  total_onboarding INTEGER DEFAULT 0,
  ai_summary TEXT,
  stats TEXT,
  candidate_details TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- System Configs
CREATE TABLE IF NOT EXISTS system_configs (
  id TEXT PRIMARY KEY,
  prompt_configs TEXT,
  mail_config TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Resume Files (PDF 缓存)
CREATE TABLE IF NOT EXISTS resume_files (
  id TEXT PRIMARY KEY,
  kv_key TEXT,
  content TEXT,
  file_name TEXT,
  file_size INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

-- AI Usage
CREATE TABLE IF NOT EXISTS ai_usage (
  date TEXT PRIMARY KEY,
  total_tokens INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Settings
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Background Checks
CREATE TABLE IF NOT EXISTS background_checks (
  id TEXT PRIMARY KEY,
  resume_id TEXT,
  candidate_name TEXT,
  status TEXT DEFAULT 'pending',
  result TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
-- Onboarding Records
CREATE TABLE IF NOT EXISTS onboarding_records (
  id TEXT PRIMARY KEY,
  resume_id TEXT NOT NULL,
  position_id TEXT,
  offer_id TEXT,
  candidate_name TEXT NOT NULL,
  employee_id TEXT,
  onboard_date TEXT,
  department TEXT,
  position_title TEXT,
  contract_signed INTEGER DEFAULT 0,
  contract_type TEXT DEFAULT 'fixed_term',
  documents TEXT,
  accounts_created INTEGER DEFAULT 0,
  equipment_assigned INTEGER DEFAULT 0,
  mentor_id TEXT,
  orientation_completed INTEGER DEFAULT 0,
  orientation_date TEXT,
  status TEXT DEFAULT 'pending',
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Probation Records
CREATE TABLE IF NOT EXISTS probation_records (
  id TEXT PRIMARY KEY,
  onboarding_id TEXT,
  resume_id TEXT,
  position_id TEXT,
  employee_name TEXT NOT NULL,
  employee_id TEXT,
  probation_start TEXT,
  probation_end TEXT,
  probation_months INTEGER DEFAULT 3,
  monthly_reviews TEXT,
  final_assessment TEXT,
  result TEXT DEFAULT 'pending',
  confirmed_at TEXT,
  confirmed_by TEXT,
  new_title TEXT,
  salary_adjustment REAL,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Workflows
CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'draft',
  graph TEXT,
  variables TEXT,
  trigger_type TEXT DEFAULT 'manual',
  trigger_config TEXT,
  is_template INTEGER DEFAULT 0,
  is_system INTEGER DEFAULT 0,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  published_at TEXT
);

-- Position Mappings (岗位名映射)
CREATE TABLE IF NOT EXISTS position_mappings (
  id TEXT PRIMARY KEY,
  raw_names TEXT,
  raw_name TEXT,
  mapped_name TEXT,
  responsible_person TEXT,
  interviewers TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Workflow Nodes
CREATE TABLE IF NOT EXISTS workflow_nodes (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  node_type TEXT NOT NULL,
  name TEXT,
  description TEXT,
  position_x REAL DEFAULT 0,
  position_y REAL DEFAULT 0,
  config TEXT,
  input_schema TEXT,
  output_schema TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Workflow Edges
CREATE TABLE IF NOT EXISTS workflow_edges (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  edge_id TEXT NOT NULL,
  source_node_id TEXT NOT NULL,
  target_node_id TEXT NOT NULL,
  source_handle TEXT,
  target_handle TEXT,
  condition TEXT,
  label TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Workflow Executions
CREATE TABLE IF NOT EXISTS workflow_executions (
  id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  trigger_type TEXT DEFAULT 'manual',
  triggered_by TEXT,
  input_data TEXT,
  output_data TEXT,
  variables TEXT,
  current_node_id TEXT,
  executed_nodes TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Workflow Node Executions
CREATE TABLE IF NOT EXISTS workflow_node_executions (
  id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  node_type TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  input_data TEXT,
  output_data TEXT,
  error_message TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Interviewer Mappings (可编辑的面试官 open_id 映射表)
CREATE TABLE IF NOT EXISTS interviewer_mappings (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  open_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Capability Dimensions
CREATE TABLE IF NOT EXISTS capability_dimensions (
  id TEXT PRIMARY KEY,
  position_name TEXT NOT NULL,
  dimensions_json TEXT DEFAULT '[]',
  personalized_requirements TEXT DEFAULT '',
  full_text TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Recruitment Tasks
-- 面试提醒功能依赖：interviewers(JSON数组)、responsible_person、city
-- 数据来源：从飞书多维表格招聘任务表(requisitionTableId)同步
CREATE TABLE IF NOT EXISTS recruitment_tasks (
  id TEXT PRIMARY KEY,
  position_name TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  assignee TEXT DEFAULT '',
  due_date TEXT,
  notes TEXT DEFAULT '',
  interviewers TEXT DEFAULT '[]',      -- JSON数组，面试官姓名 ["张三","李四"]
  responsible_person TEXT DEFAULT '',   -- 责任人姓名
  city TEXT DEFAULT '',                 -- 招聘城市
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- JD Versions (v2.0 全需求重构 - JD 管理独立模块)
CREATE TABLE IF NOT EXISTS jd_versions (
  id TEXT PRIMARY KEY,
  position_id TEXT NOT NULL,
  description TEXT NOT NULL,
  requirements TEXT,
  version_number INTEGER DEFAULT 1,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- ==================== 索引优化 ====================
-- interviews 高频查询字段
CREATE INDEX IF NOT EXISTS idx_interviews_position ON interviews(position_id);
CREATE INDEX IF NOT EXISTS idx_interviews_interviewer ON interviews(interviewer_id);
CREATE INDEX IF NOT EXISTS idx_interviews_status ON interviews(status);
CREATE INDEX IF NOT EXISTS idx_interviews_resume ON interviews(resume_id);
CREATE INDEX IF NOT EXISTS idx_interviews_created ON interviews(created_at DESC);

-- offers 高频查询字段
CREATE INDEX IF NOT EXISTS idx_offers_position ON offers(position_id);
CREATE INDEX IF NOT EXISTS idx_offers_status ON offers(status);
CREATE INDEX IF NOT EXISTS idx_offers_resume ON offers(resume_id);
CREATE INDEX IF NOT EXISTS idx_offers_created ON offers(created_at DESC);

-- onboarding_records 高频查询字段
CREATE INDEX IF NOT EXISTS idx_onboarding_position ON onboarding_records(position_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_status ON onboarding_records(status);
CREATE INDEX IF NOT EXISTS idx_onboarding_resume ON onboarding_records(resume_id);

-- probation_records
CREATE INDEX IF NOT EXISTS idx_probation_status ON probation_records(result);
CREATE INDEX IF NOT EXISTS idx_probation_onboarding ON probation_records(onboarding_id);

-- resumes 补充索引
CREATE INDEX IF NOT EXISTS idx_resumes_status ON resumes(status);
CREATE INDEX IF NOT EXISTS idx_resumes_stage ON resumes(stage);
CREATE INDEX IF NOT EXISTS idx_resumes_created ON resumes(created_at DESC);

-- positions
CREATE INDEX IF NOT EXISTS idx_positions_status ON positions(status);
CREATE INDEX IF NOT EXISTS idx_positions_department ON positions(department);

-- job_requisitions
CREATE INDEX IF NOT EXISTS idx_requisitions_status ON job_requisitions(status);
CREATE INDEX IF NOT EXISTS idx_requisitions_created ON job_requisitions(created_at DESC);

-- department_reviews
CREATE INDEX IF NOT EXISTS idx_dept_reviews_resume ON department_reviews(resume_id);

-- background_checks
CREATE INDEX IF NOT EXISTS idx_bg_checks_resume ON background_checks(resume_id);
CREATE INDEX IF NOT EXISTS idx_bg_checks_status ON background_checks(status);

-- coding_tests
CREATE INDEX IF NOT EXISTS idx_coding_tests_resume ON coding_tests(resume_id);
CREATE INDEX IF NOT EXISTS idx_coding_tests_position ON coding_tests(position_id);

-- coding_submissions
CREATE INDEX IF NOT EXISTS idx_coding_submissions_test ON coding_submissions(coding_test_id);

-- interview_panels
CREATE INDEX IF NOT EXISTS idx_panels_interview ON interview_panels(interview_id);

-- talent_pool
CREATE INDEX IF NOT EXISTS idx_talent_status ON talent_pool(status);
CREATE INDEX IF NOT EXISTS idx_talent_email ON talent_pool(email);

-- recruitment_channels
CREATE INDEX IF NOT EXISTS idx_channels_position ON recruitment_channels(position_id);

-- position_mappings
CREATE INDEX IF NOT EXISTS idx_position_mappings_raw ON position_mappings(raw_name);

-- capability_dimensions
CREATE INDEX IF NOT EXISTS idx_capability_dims_position ON capability_dimensions(position_name);

-- recruitment_tasks
CREATE INDEX IF NOT EXISTS idx_recruit_tasks_status ON recruitment_tasks(status);

-- jd_versions
CREATE INDEX IF NOT EXISTS idx_jd_versions_position ON jd_versions(position_id);

-- workflow_executions
CREATE INDEX IF NOT EXISTS idx_workflow_exec_workflow ON workflow_executions(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_exec_status ON workflow_executions(status);

-- workflow_node_executions
CREATE INDEX IF NOT EXISTS idx_workflow_node_exec_execution ON workflow_node_executions(execution_id);
-- ==================== resume_screening_queue (初筛队列，修复缺表 2026-07-24) ====================
CREATE TABLE IF NOT EXISTS resume_screening_queue (
  id TEXT PRIMARY KEY,
  resume_id TEXT,
  candidate_name TEXT DEFAULT '未知',
  position_applied TEXT DEFAULT '',
  mapped_position TEXT DEFAULT '',
  city TEXT DEFAULT '',
  ai_analysis TEXT DEFAULT '',
  ai_result TEXT DEFAULT 'pending',
  match_score REAL DEFAULT 0,
  weighted_score REAL,
  screening_result TEXT,
  screening_reason TEXT DEFAULT '',
  gate_results TEXT DEFAULT '{}',
  risk_points TEXT DEFAULT '',
  match_reasons TEXT DEFAULT '',
  interview_questions TEXT DEFAULT '',
  strengths TEXT DEFAULT '',
  age TEXT DEFAULT '',
  gender TEXT DEFAULT '',
  education TEXT DEFAULT '',
  file_name TEXT DEFAULT '',
  email_subject TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
  batch_num INTEGER DEFAULT 1,
  reviewed_by TEXT DEFAULT '',
  reviewed_at TEXT DEFAULT '',
  feishu_processed_at TEXT DEFAULT '',
  created_at TEXT,
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_screening_status ON resume_screening_queue(status);
CREATE INDEX IF NOT EXISTS idx_screening_created ON resume_screening_queue(created_at);
CREATE INDEX IF NOT EXISTS idx_screening_resume ON resume_screening_queue(resume_id);

-- 操作日志表（2026-07-29 日志埋点改造）：核心业务链路结构化审计日志
CREATE TABLE IF NOT EXISTS operation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,           -- 操作类型: resume.create / interview.create / interview.notify / feishu.sync / interview.evaluate 等
  entity_type TEXT,               -- 实体类型: resume / interview / recruitment_task ...
  entity_id TEXT,                 -- 实体 ID
  actor TEXT,                     -- 操作人（email 或 system/cron）
  status TEXT DEFAULT 'success',  -- success / failure
  detail TEXT,                    -- 附加信息（JSON 或文本）
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oplogs_action ON operation_logs(action);
CREATE INDEX IF NOT EXISTS idx_oplogs_entity ON operation_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_oplogs_created ON operation_logs(created_at);

-- Shareable recruiting dashboard links. Tokens are stored as SHA-256 hashes only.
CREATE TABLE IF NOT EXISTS dashboard_snapshots (
  id TEXT PRIMARY KEY,
  snapshot_date TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  generated_at TEXT NOT NULL,
  generated_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dashboard_snapshots_date ON dashboard_snapshots(snapshot_date DESC);
CREATE TRIGGER IF NOT EXISTS prevent_dashboard_snapshot_update
BEFORE UPDATE ON dashboard_snapshots
BEGIN
  SELECT RAISE(ABORT, 'dashboard snapshot is immutable');
END;
CREATE TRIGGER IF NOT EXISTS prevent_dashboard_snapshot_delete
BEFORE DELETE ON dashboard_snapshots
BEGIN
  SELECT RAISE(ABORT, 'dashboard snapshot is immutable');
END;

CREATE TABLE IF NOT EXISTS dashboard_share_links (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  scope_type TEXT NOT NULL CHECK (scope_type IN ('all','divisions')),
  scope_ids TEXT NOT NULL DEFAULT '[]',
  expires_at TEXT,
  revoked_at TEXT,
  data_mode TEXT NOT NULL DEFAULT 'live',
  snapshot_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dashboard_share_links_active
  ON dashboard_share_links(revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_dashboard_share_links_snapshot ON dashboard_share_links(snapshot_id);

-- 0011_resume_artifacts
CREATE TABLE IF NOT EXISTS resume_artifacts (
  id TEXT PRIMARY KEY,
  resume_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('pdf','ocr','ai_analysis','interview_report','search_document')),
  object_key TEXT NOT NULL,
  bucket TEXT NOT NULL DEFAULT 'ai-interview-resume-artifacts',
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  content_sha256 TEXT,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','available','expired','deleted','failed')),
  expires_at TEXT,
  is_current INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_resume_artifacts_resume_id ON resume_artifacts(resume_id);
CREATE INDEX IF NOT EXISTS idx_resume_artifacts_type_status ON resume_artifacts(type, status);
CREATE INDEX IF NOT EXISTS idx_resume_artifacts_object_key ON resume_artifacts(object_key);
CREATE UNIQUE INDEX IF NOT EXISTS idx_resume_artifacts_resume_type_version ON resume_artifacts(resume_id, type, version);
CREATE INDEX IF NOT EXISTS idx_resume_artifacts_current ON resume_artifacts(resume_id, type, is_current) WHERE is_current = 1;

-- 0012_resume_upload_sessions
CREATE TABLE IF NOT EXISTS resume_upload_sessions (
  id TEXT PRIMARY KEY,
  resume_id TEXT NOT NULL UNIQUE,
  pdf_artifact_id TEXT NOT NULL,
  text_artifact_id TEXT,
  created_by TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  expected_pdf_size INTEGER NOT NULL CHECK (expected_pdf_size > 0),
  expected_pdf_sha256 TEXT NOT NULL,
  expected_text_size INTEGER,
  expected_text_sha256 TEXT,
  status TEXT NOT NULL CHECK (status IN ('initiated','completed','expired','failed')),
  error_code TEXT,
  job_id TEXT,
  completed_at TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_resume_upload_sessions_status ON resume_upload_sessions(status);
CREATE INDEX IF NOT EXISTS idx_resume_upload_sessions_expiry ON resume_upload_sessions(expires_at) WHERE status = 'initiated';

-- 0013_resume_text_state
CREATE TABLE IF NOT EXISTS resume_text_state (
  resume_id TEXT PRIMARY KEY,
  raw_text_source TEXT CHECK (raw_text_source IN ('r2','legacy_d1','none')),
  ocr_text_source TEXT CHECK (ocr_text_source IN ('r2','legacy_d1','none')),
  analysis_source TEXT CHECK (analysis_source IN ('r2','legacy_d1','none')),
  raw_text_artifact_id TEXT,
  ocr_artifact_id TEXT,
  analysis_artifact_id TEXT,
  migration_status TEXT DEFAULT 'pending' CHECK (migration_status IN ('pending','migrated','verified','cleaned')),
  migrated_at TEXT,
  verified_at TEXT,
  FOREIGN KEY (resume_id) REFERENCES resumes(id)
);

-- 0015_resume_search_state
CREATE TABLE IF NOT EXISTS resume_search_state (
  resume_id TEXT PRIMARY KEY,
  search_doc_version INTEGER NOT NULL DEFAULT 0,
  search_doc_artifact_id TEXT,
  index_status TEXT NOT NULL DEFAULT 'pending' CHECK (index_status IN ('pending','indexed','failed','deleted')),
  last_indexed_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (resume_id) REFERENCES resumes(id)
);

-- 0017_candidate_stage_events
CREATE TABLE IF NOT EXISTS candidate_stage_events (
  id TEXT PRIMARY KEY,
  resume_id TEXT NOT NULL,
  position_id TEXT,
  stage TEXT NOT NULL CHECK (stage IN (
    'resume_received','ai_screened','hr_approved','hr_rejected',
    'interview_scheduled','interview_completed','interview_passed','interview_failed',
    'offer_sent','offer_accepted','offer_rejected','hired','candidate_withdrawn'
  )),
  action TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  actor_user_id TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  dedupe_key TEXT NOT NULL UNIQUE,
  metadata_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_candidate_stage_events_resume ON candidate_stage_events(resume_id, stage);
CREATE INDEX IF NOT EXISTS idx_candidate_stage_events_occurred ON candidate_stage_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_candidate_stage_events_position ON candidate_stage_events(position_id, occurred_at);

CREATE TABLE IF NOT EXISTS recruitment_event_outbox (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT NOT NULL UNIQUE,
  event_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','sent','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT
);

-- 0018_resume_migration_state
CREATE TABLE IF NOT EXISTS resume_migration_state (
  resume_id TEXT PRIMARY KEY,
  source_columns TEXT NOT NULL DEFAULT '{}',
  source_sha256 TEXT,
  target_artifact_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','migrating','verified','failed','cleaned')),
  failure_reason TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (resume_id) REFERENCES resumes(id)
);
CREATE INDEX IF NOT EXISTS idx_resume_migration_status ON resume_migration_state(status);

-- 0020_resume_purge_jobs
CREATE TABLE IF NOT EXISTS resume_purge_jobs (
  id TEXT PRIMARY KEY,
  resume_id TEXT NOT NULL UNIQUE,
  purge_type TEXT NOT NULL DEFAULT 'normal' CHECK (purge_type IN ('normal','privacy')),
  actor_user_id TEXT NOT NULL,
  reason TEXT,
  not_before TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (resume_id) REFERENCES resumes(id)
);
CREATE INDEX IF NOT EXISTS idx_resume_purge_jobs_status ON resume_purge_jobs(status);
CREATE INDEX IF NOT EXISTS idx_resume_purge_jobs_not_before ON resume_purge_jobs(not_before) WHERE status = 'pending';
