-- 简历初筛自动化系统集成

CREATE TABLE IF NOT EXISTS resume_screening_queue (
  id TEXT PRIMARY KEY,
  resume_id TEXT,
  candidate_name TEXT NOT NULL,
  position_applied TEXT,
  mapped_position TEXT,
  city TEXT,
  ai_analysis TEXT,
  ai_result TEXT DEFAULT 'pending',
  match_score REAL DEFAULT 0,
  risk_points TEXT,
  match_reasons TEXT,
  interview_questions TEXT,
  strengths TEXT,
  age TEXT,
  gender TEXT,
  education TEXT,
  file_name TEXT,
  email_subject TEXT,
  status TEXT DEFAULT 'pending',
  batch_num INTEGER DEFAULT 1,
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS position_mappings (
  id TEXT PRIMARY KEY,
  raw_name TEXT NOT NULL,
  mapped_name TEXT NOT NULL,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS capability_dimensions (
  id TEXT PRIMARY KEY,
  position_name TEXT NOT NULL,
  dimension_name TEXT,
  definition TEXT,
  behavior TEXT,
  full_text TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS daily_reports (
  id TEXT PRIMARY KEY,
  report_date TEXT NOT NULL,
  report_type TEXT DEFAULT 'progress',
  title TEXT,
  content TEXT,
  stats TEXT,
  status TEXT DEFAULT 'generated',
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS recruitment_tasks (
  id TEXT PRIMARY KEY,
  requisition_id TEXT,
  position_name TEXT NOT NULL,
  department TEXT,
  city TEXT,
  target_count INTEGER DEFAULT 1,
  status TEXT DEFAULT 'recruiting',
  interviewers TEXT,
  responsible_person TEXT,
  created_at TEXT,
  updated_at TEXT
);
