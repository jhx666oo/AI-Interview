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
  hr_review TEXT,
  status TEXT DEFAULT 'pending_screening',
  stage TEXT DEFAULT 'new',
  other_position_matches TEXT,
  reject_reason_category TEXT,
  reject_reason_detail TEXT,
  rejected_at TEXT,
  rejected_by TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_resumes_email ON resumes(email);
CREATE INDEX IF NOT EXISTS idx_resumes_position ON resumes(position_id);

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
  content TEXT,
  file_name TEXT,
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
  id TEXT PRIMARY KEY,
  resume_id TEXT NOT NULL,
  position_id TEXT,
  candidate_name TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  work_verification TEXT,
  education_verification TEXT,
  reference_check TEXT,
  criminal_check TEXT,
  overall_result TEXT,
  conducted_by TEXT,
  conducted_at TEXT,
  report_path TEXT,
  notes TEXT,
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