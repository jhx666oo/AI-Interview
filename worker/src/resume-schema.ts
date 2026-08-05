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

/**
 * Prefer the structured Task 2 evaluation over legacy scalar columns when
 * building API responses. No new D1 column is needed: these are display-only
 * fields stored in ai_evaluation JSON.
 */
export function exposeStructuredEvaluation(item: Record<string, any>): void {
  let evaluation = item.ai_evaluation;
  if (typeof evaluation === 'string') {
    try { evaluation = JSON.parse(evaluation); } catch { return; }
  }
  if (!evaluation || typeof evaluation !== 'object' || Array.isArray(evaluation)) return;

  item.ai_evaluation = evaluation;
  if (Object.prototype.hasOwnProperty.call(evaluation, 'weighted_score')) {
    item.weighted_score = evaluation.weighted_score;
    item.match_score = evaluation.weighted_score;
  }
  if (Object.prototype.hasOwnProperty.call(evaluation, 'gate_results')) {
    item.gate_results = evaluation.gate_results;
  }
  if (Object.prototype.hasOwnProperty.call(evaluation, 'screening_reason')) {
    item.screening_reason = evaluation.screening_reason;
  }
  if (Object.prototype.hasOwnProperty.call(evaluation, 'screening_result')) {
    item.screening_result = evaluation.screening_result;
  }
}

export async function ensureResumeListSchema(db: D1Database): Promise<void> {
  for (const sql of RESUME_LIST_COMPATIBILITY_MIGRATIONS) {
    try {
      await db.prepare(sql).run();
    } catch {
      // Existing databases commonly already have these columns.
    }
  }
}
