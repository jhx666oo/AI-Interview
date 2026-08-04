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
