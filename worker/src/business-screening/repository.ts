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
  "ALTER TABLE resumes ADD COLUMN business_screening_dispatch_group_id TEXT DEFAULT ''",
] as const;

export const BUSINESS_SCREENING_PUSH_TABLE_MIGRATIONS = [
  'ALTER TABLE resume_push_batches ADD COLUMN dispatch_group_id TEXT DEFAULT NULL',
  'ALTER TABLE resume_push_batch_items ADD COLUMN dispatch_group_id TEXT DEFAULT NULL',
  'ALTER TABLE resume_push_batches ADD COLUMN batch_title TEXT DEFAULT NULL',
  'ALTER TABLE resume_push_batches ADD COLUMN batch_subtitle TEXT DEFAULT NULL',
  'ALTER TABLE resume_push_batches ADD COLUMN scope_key TEXT DEFAULT NULL',
] as const;

export const BUSINESS_SCREENING_PUSH_TABLE_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_resume_push_batches_scope_key ON resume_push_batches(scope_key, status, expires_at)',
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
    last_sent_at TEXT,
    dispatch_group_id TEXT
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
    dispatch_group_id TEXT,
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
  for (const sql of BUSINESS_SCREENING_PUSH_TABLE_MIGRATIONS) {
    try {
      await db.prepare(sql).run();
    } catch (error) {
      if (!isIgnorableMigrationError(error)) throw error;
    }
  }
  for (const sql of BUSINESS_SCREENING_PUSH_TABLE_INDEXES) {
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
      (id, interviewer_id, interviewer_name, interviewer_open_id, token_hash, expires_at, status, created_by, created_at, last_sent_at, dispatch_group_id, batch_title, batch_subtitle, scope_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    input.dispatchGroupId,
    input.batchTitle || null,
    input.batchSubtitle || null,
    input.scopeKey || null,
  ).run();
}

export async function insertResumePushBatchItemsIfAbsent(
  db: Db,
  items: CreateResumePushBatchItemInput[],
): Promise<void> {
  if (items.length === 0) return;
  // 分块多值 INSERT OR IGNORE（每块 10 行（D1 单语句绑定参数上限约 100，10×9=90 参数）），大幅减少 D1 往返，避免大批量超时
  const CHUNK = 10;
  for (let start = 0; start < items.length; start += CHUNK) {
    const chunk = items.slice(start, start + CHUNK);
    const cols = '(id, batch_id, resume_id, position_id, status, remark, processed_at, created_at, dispatch_group_id)';
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const values: unknown[] = [];
    for (const item of chunk) {
      values.push(
        item.id,
        item.batchId,
        item.resumeId,
        item.positionId || null,
        item.status || 'pending',
        item.remark || null,
        item.processedAt || null,
        item.createdAt || new Date().toISOString(),
        item.dispatchGroupId,
      );
    }
    await db.prepare(
      `INSERT OR IGNORE INTO resume_push_batch_items ${cols} VALUES ${placeholders}`,
    ).bind(...values).run();
  }
}

export async function insertResumePushBatchItems(
  db: Db,
  items: CreateResumePushBatchItemInput[],
): Promise<void> {
  if (items.length === 0) return;
  // 分块多值 INSERT（每块 10 行（D1 单语句绑定参数上限约 100，10×9=90 参数）），大幅减少 D1 往返，避免大批量超时
  const CHUNK = 10;
  for (let start = 0; start < items.length; start += CHUNK) {
    const chunk = items.slice(start, start + CHUNK);
    const cols = '(id, batch_id, resume_id, position_id, status, remark, processed_at, created_at, dispatch_group_id)';
    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const values: unknown[] = [];
    for (const item of chunk) {
      values.push(
        item.id,
        item.batchId,
        item.resumeId,
        item.positionId || null,
        item.status || 'pending',
        item.remark || null,
        item.processedAt || null,
        item.createdAt || new Date().toISOString(),
        item.dispatchGroupId,
      );
    }
    await db.prepare(
      `INSERT INTO resume_push_batch_items ${cols} VALUES ${placeholders}`,
    ).bind(...values).run();
  }
}

/** 批量执行：逐条提交（线上 D1 batch 在 Pages Functions 环境有兼容问题，暂不用 batch） */
async function runBatch(db: Db, stmts: D1PreparedStatement[]): Promise<void> {
  for (const stmt of stmts) {
    await stmt.run();
  }
}

export async function markResumesPushed(
  db: Db,
  resumeIds: string[],
  batchId: string,
  dispatchGroupId: string,
): Promise<void> {
  const timestamp = new Date().toISOString();
  if (resumeIds.length === 0) return;
  // 分块多值 UPDATE ... WHERE id IN (…)，每块 100 个 id，避免大批量逐条往返超时
  const CHUNK = 10;
  for (let start = 0; start < resumeIds.length; start += CHUNK) {
    const chunk = resumeIds.slice(start, start + CHUNK);
    const placeholders = chunk.map(() => '?').join(', ');
    const values: unknown[] = [batchId, dispatchGroupId, timestamp, ...chunk];
    await db.prepare(
      `UPDATE resumes
          SET hr_disposition = 'pushed',
              business_screening_status = 'pending',
              business_screening_batch_id = ?,
              business_screening_dispatch_group_id = ?,
              updated_at = ?
        WHERE id IN (${placeholders})`,
    ).bind(...values).run();
  }
}

export async function loadResumePushBatchByTokenHash(
  db: Db,
  tokenHash: string,
): Promise<ResumePushBatchRow | null> {
  return await db.prepare(
    `SELECT id, interviewer_id, interviewer_name, interviewer_open_id, token_hash, expires_at, status, created_by, created_at, last_sent_at, dispatch_group_id, batch_title, batch_subtitle, scope_key
       FROM resume_push_batches
      WHERE token_hash = ?
      ORDER BY created_at DESC
      LIMIT 1`,
  ).bind(tokenHash).first<ResumePushBatchRow>();
}

export async function loadLatestResumePushBatchByInterviewer(
  db: Db,
  interviewerOpenId: string,
): Promise<ResumePushBatchRow | null> {
  return await db.prepare(
    `SELECT id, interviewer_id, interviewer_name, interviewer_open_id, token_hash, expires_at, status, created_by, created_at, last_sent_at, dispatch_group_id, batch_title, batch_subtitle, scope_key
       FROM resume_push_batches
      WHERE interviewer_open_id = ?
        AND scope_key IS NOT NULL
        AND status IN ('active', 'completed', 'expired')
      ORDER BY created_at DESC
      LIMIT 1`,
  ).bind(interviewerOpenId).first<ResumePushBatchRow>();
}

export async function refreshResumePushBatchExpiry(
  db: Db,
  batchId: string,
  expiresAt: string | null,
): Promise<void> {
  await db.prepare(
    `UPDATE resume_push_batches
        SET expires_at = ?,
            status = CASE WHEN status = 'expired' THEN 'active' ELSE status END
      WHERE id = ?
        AND status != 'revoked'`,
  ).bind(expiresAt, batchId).run();
}

export async function revokeActiveBusinessScreeningBatchesForResume(
  db: Db,
  resumeId: string,
): Promise<void> {
  await db.prepare(
    `UPDATE resume_push_batches
        SET status = 'revoked'
      WHERE status = 'active'
        AND id IN (
          SELECT DISTINCT batch_id
            FROM resume_push_batch_items
           WHERE resume_id = ?
        )`,
  ).bind(resumeId).run();
}

type CurrentResumeDecisionRow = {
  hr_disposition: string | null;
  business_screening_status: 'not_ready' | 'pending' | 'passed' | 'rejected' | null;
  business_screening_batch_id: string | null;
  business_screening_dispatch_group_id: string | null;
  status: string | null;
  stage: string | null;
};

type CurrentBatchItemDecisionRow = {
  batch_id: string;
  resume_id: string;
  status: 'pending' | 'passed' | 'rejected';
  remark: string | null;
  processed_at: string | null;
  dispatch_group_id: string | null;
};

type BatchCapableDb = Db & Partial<Pick<D1Database, 'batch'>>;

function resolveDispatchGroupId(
  resume: Pick<CurrentResumeDecisionRow, 'business_screening_dispatch_group_id' | 'business_screening_batch_id'> | null | undefined,
  item: Pick<CurrentBatchItemDecisionRow, 'dispatch_group_id' | 'batch_id'> | null | undefined,
): string {
  const itemGroup = item?.dispatch_group_id?.trim();
  if (itemGroup) return itemGroup;
  const resumeGroup = resume?.business_screening_dispatch_group_id?.trim();
  if (resumeGroup) return resumeGroup;
  const batchFallback = item?.batch_id?.trim() || resume?.business_screening_batch_id?.trim();
  return batchFallback || '';
}

function buildBlockedDecisionResult(input: RecordBusinessScreeningDecisionInput, currentResume: CurrentResumeDecisionRow, currentItem: CurrentBatchItemDecisionRow): RecordBusinessScreeningDecisionResult {
  const requestedItemStatus = input.status === 'passed' ? 'passed' : 'rejected';
  if (currentItem.status === requestedItemStatus) {
    return {
      applied: false,
      idempotent: true,
      status: input.status,
    };
  }

  if (currentResume.hr_disposition === 'rejected') {
    return {
      applied: false,
      idempotent: false,
      status: currentItem.status === 'passed'
        ? 'passed'
        : currentResume.business_screening_status === 'passed'
          ? 'passed'
          : 'rejected',
      reason: 'HR already rejected resume',
    };
  }

  if (currentResume.business_screening_status === 'passed' || currentResume.business_screening_status === 'rejected') {
    return {
      applied: false,
      idempotent: false,
      status: currentResume.business_screening_status,
      reason: 'business screening already completed',
    };
  }

  return {
    applied: false,
    idempotent: false,
    status: currentItem.status === 'passed' ? 'passed' : 'rejected',
    reason: 'business screening already completed',
  };
}

export async function recordBusinessScreeningDecision(
  db: BatchCapableDb,
  input: RecordBusinessScreeningDecisionInput,
): Promise<RecordBusinessScreeningDecisionResult> {
  const screenedAt = input.screenedAt || new Date().toISOString();
  const itemStatus = input.status === 'passed' ? 'passed' : 'rejected';
  const resumeStatus = input.status === 'passed' ? 'approved' : 'rejected';
  const resumeStage = input.status === 'passed' ? 'talent_pool' : 'rejected';
  const approvedAt = input.status === 'passed' ? screenedAt : null;
  const rejectedAt = input.status === 'rejected' ? screenedAt : null;
  const currentResume = await db.prepare(
    `SELECT hr_disposition, business_screening_status, business_screening_batch_id, business_screening_dispatch_group_id, status, stage
       FROM resumes
      WHERE id = ?
      LIMIT 1`,
  ).bind(input.resumeId).first<CurrentResumeDecisionRow>();

  if (!currentResume) {
    throw new Error('resume not found');
  }

  const loadCurrentItem = async () => {
    const currentItem = await db.prepare(
      `SELECT batch_id, resume_id, status, remark, processed_at, dispatch_group_id
         FROM resume_push_batch_items
        WHERE id = ? AND batch_id = ? AND resume_id = ?
        LIMIT 1`,
    ).bind(input.batchItemId, input.batchId, input.resumeId).first<CurrentBatchItemDecisionRow>();

    if (!currentItem) {
      throw new Error('business screening batch item not found');
    }

    return currentItem;
  };

  const currentItem = await loadCurrentItem();
  const dispatchGroupId = resolveDispatchGroupId(currentResume, currentItem);
  const resumeDispatchGroupId = resolveDispatchGroupId(currentResume, null);
  if (!dispatchGroupId || !resumeDispatchGroupId || dispatchGroupId !== resumeDispatchGroupId) {
    return {
      applied: false,
      idempotent: false,
      status: input.status,
      reason: 'business screening dispatch group changed',
    };
  }

  if (
    currentResume.hr_disposition === 'rejected'
    || currentResume.status === 'approved'
    || currentResume.status === 'rejected'
    || currentResume.business_screening_status === 'passed'
    || currentResume.business_screening_status === 'rejected'
  ) {
    return buildBlockedDecisionResult(input, currentResume, currentItem);
  }

  if (currentItem.status !== 'pending') {
    if (currentItem.status === itemStatus) {
      return {
        applied: false,
        idempotent: true,
        status: input.status,
      };
    }
    return buildBlockedDecisionResult(input, currentResume, currentItem);
  }

  const resumeUpdateStatement = db.prepare(
    `UPDATE resumes
        SET business_screening_status = ?,
            business_screening_remark = ?,
            business_screened_at = ?,
            business_screened_by = ?,
            business_screening_batch_id = ?,
            business_screening_dispatch_group_id = ?,
            status = ?,
            stage = ?,
            approved_at = ?,
            rejected_at = ?,
            updated_at = ?
      WHERE id = ?
        AND hr_disposition != 'rejected'
        AND business_screening_status IN ('not_ready', 'pending')
        AND status != 'approved'
        AND status != 'rejected'
        AND COALESCE(NULLIF(business_screening_dispatch_group_id, ''), NULLIF(business_screening_batch_id, '')) = ?
        AND EXISTS (
          SELECT 1
            FROM resume_push_batch_items
           WHERE id = ?
             AND batch_id = ?
             AND resume_id = ?
             AND status = 'pending'
             AND COALESCE(NULLIF(dispatch_group_id, ''), batch_id) = ?
        )`,
  ).bind(
    input.status,
    input.remark || '',
    screenedAt,
    input.screenedBy || '',
    input.batchId,
    dispatchGroupId,
    resumeStatus,
    resumeStage,
    approvedAt,
    rejectedAt,
    screenedAt,
    input.resumeId,
    dispatchGroupId,
    input.batchItemId,
    input.batchId,
    input.resumeId,
    dispatchGroupId,
  );

  const itemUpdateStatement = db.prepare(
    `UPDATE resume_push_batch_items
        SET status = ?, remark = ?, processed_at = ?
      WHERE id = ?
        AND batch_id = ?
        AND resume_id = ?
        AND status = 'pending'
        AND COALESCE(NULLIF(dispatch_group_id, ''), batch_id) = ?
        AND EXISTS (
          SELECT 1
            FROM resumes
           WHERE id = ?
             AND business_screening_status = ?
             AND business_screened_at = ?
             AND business_screening_batch_id = ?
             AND COALESCE(NULLIF(business_screening_dispatch_group_id, ''), NULLIF(business_screening_batch_id, '')) = ?
        )`,
  ).bind(
    itemStatus,
    input.remark || null,
    screenedAt,
    input.batchItemId,
    input.batchId,
    input.resumeId,
    dispatchGroupId,
    input.resumeId,
    input.status,
    screenedAt,
    input.batchId,
    dispatchGroupId,
  );

  const siblingUpdateStatement = db.prepare(
    `UPDATE resume_push_batch_items
        SET status = ?, remark = COALESCE(remark, ?), processed_at = COALESCE(processed_at, ?)
      WHERE resume_id = ?
        AND COALESCE(NULLIF(dispatch_group_id, ''), batch_id) = ?
        AND id != ?
        AND status = 'pending'
        AND EXISTS (
          SELECT 1
            FROM resumes
           WHERE id = ?
             AND business_screening_status = ?
             AND business_screened_at = ?
             AND business_screening_batch_id = ?
             AND COALESCE(NULLIF(business_screening_dispatch_group_id, ''), NULLIF(business_screening_batch_id, '')) = ?
        )`,
  ).bind(
    itemStatus,
    input.remark || null,
    screenedAt,
    input.resumeId,
    dispatchGroupId,
    input.batchItemId,
    input.resumeId,
    input.status,
    screenedAt,
    input.batchId,
    dispatchGroupId,
  );

  if (typeof db.batch === 'function') {
    await db.batch([resumeUpdateStatement, itemUpdateStatement, siblingUpdateStatement]);
  } else {
    await resumeUpdateStatement.run();
    await itemUpdateStatement.run();
    await siblingUpdateStatement.run();
  }

  const finalizedResume = await db.prepare(
    `SELECT hr_disposition, business_screening_status, business_screening_batch_id, business_screening_dispatch_group_id, status, stage
       FROM resumes
      WHERE id = ?
      LIMIT 1`,
  ).bind(input.resumeId).first<CurrentResumeDecisionRow>();

  if (!finalizedResume) {
    throw new Error('resume not found');
  }

  const finalizedItem = await loadCurrentItem();
  const finalizedDispatchGroupId = resolveDispatchGroupId(finalizedResume, finalizedItem);

  if (
    finalizedResume.business_screening_status === input.status
    && finalizedResume.business_screening_batch_id === input.batchId
    && finalizedDispatchGroupId === dispatchGroupId
    && finalizedItem.status === itemStatus
    && finalizedItem.processed_at === screenedAt
  ) {
    return {
      applied: true,
      idempotent: false,
      status: input.status,
    };
  }

  if (finalizedDispatchGroupId !== dispatchGroupId) {
    return {
      applied: false,
      idempotent: false,
      status: input.status,
      reason: 'business screening dispatch group changed',
    };
  }

  if (finalizedItem.status === itemStatus && finalizedResume.business_screening_status === input.status) {
    return {
      applied: false,
      idempotent: true,
      status: input.status,
    };
  }

  if (finalizedItem.status === itemStatus) {
    return {
      applied: false,
      idempotent: true,
      status: input.status,
    };
  }

  if (
    finalizedResume.hr_disposition === 'rejected'
    || finalizedResume.status === 'approved'
    || finalizedResume.status === 'rejected'
    || finalizedResume.business_screening_status === 'passed'
    || finalizedResume.business_screening_status === 'rejected'
    || finalizedItem.status === 'passed'
    || finalizedItem.status === 'rejected'
  ) {
    return buildBlockedDecisionResult(input, finalizedResume, finalizedItem);
  }

  if (resolveDispatchGroupId(finalizedResume, null) !== dispatchGroupId) {
    return {
      applied: false,
      idempotent: false,
      status: input.status,
      reason: 'business screening dispatch group changed',
    };
  }

  return {
    applied: false,
    idempotent: false,
    status: input.status,
    reason: 'business screening already completed',
  };
}

export interface ApplyTerminalResumeOutcomeInput {
  resumeId: string;
  outcome: 'approved' | 'rejected';
  timestamp?: string;
}

export interface ApplyTerminalResumeOutcomeResult {
  applied: boolean;
  idempotent: boolean;
  status: 'approved' | 'rejected';
  stage: 'talent_pool' | 'rejected';
  reason?: string;
}

type ResumeTerminalStateRow = {
  status: string | null;
  stage: string | null;
  approved_at?: string | null;
  rejected_at?: string | null;
};

export async function applyTerminalResumeOutcome(
  db: Db,
  input: ApplyTerminalResumeOutcomeInput,
): Promise<ApplyTerminalResumeOutcomeResult> {
  const timestamp = input.timestamp || new Date().toISOString();
  const targetStatus = input.outcome;
  const targetStage = input.outcome === 'approved' ? 'talent_pool' : 'rejected';
  const update = targetStatus === 'approved'
    ? await db.prepare(
      `UPDATE resumes
          SET status = 'approved',
              stage = 'talent_pool',
              approved_at = ?,
              rejected_at = NULL,
              updated_at = ?
        WHERE id = ?
          AND status != 'approved'
          AND status != 'rejected'`,
    ).bind(timestamp, timestamp, input.resumeId).run()
    : await db.prepare(
      `UPDATE resumes
          SET status = 'rejected',
              stage = 'rejected',
              rejected_at = ?,
              approved_at = NULL,
              updated_at = ?
        WHERE id = ?
          AND status != 'rejected'
          AND status != 'approved'`,
    ).bind(timestamp, timestamp, input.resumeId).run();

  if ((update.meta?.changes || 0) > 0) {
    return {
      applied: true,
      idempotent: false,
      status: targetStatus,
      stage: targetStage,
    };
  }

  const current = await db.prepare(
    `SELECT status, stage, approved_at, rejected_at
       FROM resumes
      WHERE id = ?
      LIMIT 1`,
  ).bind(input.resumeId).first<ResumeTerminalStateRow>();

  if (!current) {
    throw new Error('resume not found');
  }

  if (current.status === targetStatus && current.stage === targetStage) {
    return {
      applied: false,
      idempotent: true,
      status: targetStatus,
      stage: targetStage,
    };
  }

  if (
    (current.status === 'approved' && current.stage === 'talent_pool')
    || (current.status === 'rejected' && current.stage === 'rejected')
  ) {
    return {
      applied: false,
      idempotent: false,
      status: current.status === 'approved' ? 'approved' : 'rejected',
      stage: current.status === 'approved' ? 'talent_pool' : 'rejected',
      reason: 'resume terminal outcome already completed',
    };
  }

  return {
    applied: false,
    idempotent: false,
    status: current.status === 'approved' ? 'approved' : targetStatus,
    stage: current.stage === 'talent_pool' ? 'talent_pool' : targetStage,
    reason: 'resume terminal outcome already completed',
  };
}
