/**
 * Columns read by the resume list that were introduced after the first D1
 * schema. `/api/init/status` applies these defensively for existing local
 * databases; duplicate-column errors are intentionally ignored there.
 */
export const RESUME_LIST_COMPATIBILITY_MIGRATIONS = [
  "ALTER TABLE resumes ADD COLUMN ai_evaluation TEXT",
  "ALTER TABLE resumes ADD COLUMN ocr_markdown TEXT",
  "ALTER TABLE resumes ADD COLUMN ocr_status TEXT DEFAULT 'none'",
  "ALTER TABLE resumes ADD COLUMN mineru_task_id TEXT DEFAULT ''",
  "ALTER TABLE resumes ADD COLUMN mineru_status TEXT DEFAULT ''",
  "ALTER TABLE resumes ADD COLUMN gender TEXT DEFAULT ''",
  "ALTER TABLE resumes ADD COLUMN birthday TEXT DEFAULT ''",
  "ALTER TABLE resumes ADD COLUMN education TEXT DEFAULT ''",
  "ALTER TABLE resumes ADD COLUMN work_experience TEXT DEFAULT ''",
  "ALTER TABLE resumes ADD COLUMN certifications TEXT DEFAULT ''",
  "ALTER TABLE resumes ADD COLUMN self_evaluation TEXT DEFAULT ''",
  "ALTER TABLE resumes ADD COLUMN updated_at TEXT DEFAULT ''",
] as const;

export async function ensureResumeListSchema(db: D1Database): Promise<void> {
  for (const sql of RESUME_LIST_COMPATIBILITY_MIGRATIONS) {
    try {
      await db.prepare(sql).run();
    } catch {
      // Existing databases commonly already have these columns.
    }
  }
}
