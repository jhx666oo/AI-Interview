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
