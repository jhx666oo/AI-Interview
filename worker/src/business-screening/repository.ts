import type {
  CreateResumePushBatchInput,
  CreateResumePushBatchItemInput,
  RecordBusinessScreeningDecisionInput,
  RecordBusinessScreeningDecisionResult,
  ResumePushBatchRow,
  ResumePushBatchStatus,
} from './types';

type Db = Pick<D1Database, 'prepare'>;

export const BUSINESS_SCREENING_RESUME_MIGRATIONS = [
  "ALTER TABLE resumes ADD COLUMN hr_disposition TEXT DEFAULT 'pending'",
  "ALTER TABLE resumes ADD COLUMN business_screening_status TEXT DEFAULT 'not_ready'",
  "ALTER TABLE resumes ADD COLUMN business_screening_remark TEXT DEFAULT ''",
  "ALTER TABLE resumes ADD COLUMN business_screened_at TEXT",
  "ALTER TABLE resumes ADD COLUMN business_screened_by TEXT DEFAULT ''",
  "ALTER TABLE resumes ADD COLUMN business_screening_batch_id TEXT DEFAULT ''",
] as const;

export const BUSINESS_SCREENING_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS resume_push_batches (
    id TEXT PRIMARY KEY,
    interviewer_id TEXT,
    interviewer_name TEXT NOT NULL,
    interviewer_open_id TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'revoked', 'expired')),
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_sent_at TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_resume_push_batches_token_hash
    ON resume_push_batches(token_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_resume_push_batches_status
    ON resume_push_batches(status, expires_at)`,
  `CREATE TABLE IF NOT EXISTS resume_push_batch_items (
    id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL,
    resume_id TEXT NOT NULL,
    position_id TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'passed', 'rejected')),
    remark TEXT,
    processed_at TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (batch_id) REFERENCES resume_push_batches(id),
    FOREIGN KEY (resume_id) REFERENCES resumes(id),
    FOREIGN KEY (position_id) REFERENCES positions(id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_resume_push_batch_items_batch_resume
    ON resume_push_batch_items(batch_id, resume_id)`,
  `CREATE INDEX IF NOT EXISTS idx_resume_push_batch_items_batch_status
    ON resume_push_batch_items(batch_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_resume_push_batch_items_resume_status
    ON resume_push_batch_items(resume_id, status)`,
] as const;

function isIgnorableMigrationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /duplicate column name/i.test(message);
}

export async function ensureBusinessScreeningSchema(db: Db): Promise<void> {
  for (const sql of BUSINESS_SCREENING_RESUME_MIGRATIONS) {
    try {
      await db.prepare(sql).run();
    } catch (error) {
      if (!isIgnorableMigrationError(error)) throw error;
    }
  }
  for (const sql of BUSINESS_SCREENING_SCHEMA_STATEMENTS) {
    await db.prepare(sql).run();
  }
}

export async function createResumePushBatch(
  db: Db,
  input: CreateResumePushBatchInput,
): Promise<void> {
  const createdAt = input.createdAt || new Date().toISOString();
  const status: ResumePushBatchStatus = input.status || 'active';
  await db.prepare(
    `INSERT INTO resume_push_batches
      (id, interviewer_id, interviewer_name, interviewer_open_id, token_hash, expires_at, status, created_by, created_at, last_sent_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    input.id,
    input.interviewerId || null,
    input.interviewerName,
    input.interviewerOpenId,
    input.tokenHash,
    input.expiresAt || null,
    status,
    input.createdBy,
    createdAt,
    input.lastSentAt || null,
  ).run();
}

export async function insertResumePushBatchItems(
  db: Db,
  items: CreateResumePushBatchItemInput[],
): Promise<void> {
  for (const item of items) {
    await db.prepare(
      `INSERT INTO resume_push_batch_items
        (id, batch_id, resume_id, position_id, status, remark, processed_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      item.id,
      item.batchId,
      item.resumeId,
      item.positionId || null,
      item.status || 'pending',
      item.remark || null,
      item.processedAt || null,
      item.createdAt || new Date().toISOString(),
    ).run();
  }
}

export async function markResumesPushed(
  db: Db,
  resumeIds: string[],
  batchId: string,
): Promise<void> {
  const timestamp = new Date().toISOString();
  for (const resumeId of resumeIds) {
    await db.prepare(
      `UPDATE resumes
          SET hr_disposition = 'pushed',
              business_screening_status = 'pending',
              business_screening_batch_id = ?,
              updated_at = ?
        WHERE id = ?`,
    ).bind(batchId, timestamp, resumeId).run();
  }
}

export async function loadResumePushBatchByTokenHash(
  db: Db,
  tokenHash: string,
): Promise<ResumePushBatchRow | null> {
  return await db.prepare(
    `SELECT id, interviewer_id, interviewer_name, interviewer_open_id, token_hash, expires_at, status, created_by, created_at, last_sent_at
       FROM resume_push_batches
      WHERE token_hash = ?
      LIMIT 1`,
  ).bind(tokenHash).first<ResumePushBatchRow>();
}

export async function recordBusinessScreeningDecision(
  db: Db,
  input: RecordBusinessScreeningDecisionInput,
): Promise<RecordBusinessScreeningDecisionResult> {
  const screenedAt = input.screenedAt || new Date().toISOString();
  const itemStatus = input.status === 'passed' ? 'passed' : 'rejected';
  const itemUpdate = await db.prepare(
    `UPDATE resume_push_batch_items
        SET status = ?, remark = ?, processed_at = ?
      WHERE batch_id = ? AND resume_id = ? AND status = 'pending'`,
  ).bind(itemStatus, input.remark || null, screenedAt, input.batchId, input.resumeId).run();

  if ((itemUpdate.meta?.changes || 0) === 0) {
    const current = await db.prepare(
      `SELECT batch_id, resume_id, status, remark, processed_at
         FROM resume_push_batch_items
        WHERE batch_id = ? AND resume_id = ?
        LIMIT 1`,
    ).bind(input.batchId, input.resumeId).first<{
      batch_id: string;
      resume_id: string;
      status: 'pending' | 'passed' | 'rejected';
      remark: string | null;
      processed_at: string | null;
    }>();

    if (!current) {
      throw new Error('business screening batch item not found');
    }

    if (current.status === itemStatus) {
      return {
        applied: false,
        idempotent: true,
        status: input.status,
      };
    }

    return {
      applied: false,
      idempotent: false,
      status: current.status === 'passed' ? 'passed' : 'rejected',
      reason: 'business screening already completed',
    };
  }

  await db.prepare(
    `UPDATE resumes
        SET business_screening_status = ?,
            business_screening_remark = ?,
            business_screened_at = ?,
            business_screened_by = ?,
            business_screening_batch_id = ?,
            updated_at = ?
      WHERE id = ?`,
  ).bind(
    input.status,
    input.remark || '',
    screenedAt,
    input.screenedBy || '',
    input.batchId,
    screenedAt,
    input.resumeId,
  ).run();

  return {
    applied: true,
    idempotent: false,
    status: input.status,
  };
}
