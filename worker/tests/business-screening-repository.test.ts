import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BUSINESS_SCREENING_RESUME_MIGRATIONS,
  BUSINESS_SCREENING_PUSH_TABLE_INDEXES,
  BUSINESS_SCREENING_PUSH_TABLE_MIGRATIONS,
  BUSINESS_SCREENING_SCHEMA_STATEMENTS,
  applyTerminalResumeOutcome,
  createResumePushBatch,
  ensureBusinessScreeningSchema,
  insertResumePushBatchItems,
  loadResumePushBatchByTokenHash,
  loadLatestResumePushBatchByInterviewer,
  markResumesPushed,
  recordBusinessScreeningDecision,
  refreshResumePushBatchExpiry,
  revokeActiveBusinessScreeningBatchesForResume,
} from '../src/business-screening/repository';

describe('business screening schema compatibility', () => {
  it('keeps the tracked SQL migration repeat-safe by reserving resume add-column guards for code-side compatibility migrations', async () => {
    const sql = await readFile(resolve(process.cwd(), 'migrations/0028_business_screening_push.sql'), 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS resume_push_batches');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS resume_push_batch_items');
    expect(sql).toContain('dispatch_group_id TEXT');
    expect(sql).not.toContain('ALTER TABLE resumes ADD COLUMN hr_disposition');
    expect(sql).not.toContain('ALTER TABLE resumes ADD COLUMN business_screening_status');
  });

  it('defines guarded resume compatibility migrations for every additive resume column', () => {
    const requiredColumns = [
      'hr_disposition',
      'business_screening_status',
      'business_screening_remark',
      'business_screened_at',
      'business_screened_by',
      'business_screening_batch_id',
      'business_screening_dispatch_group_id',
    ];

    const migrationSql = BUSINESS_SCREENING_RESUME_MIGRATIONS.join('\n');
    for (const column of requiredColumns) {
      expect(migrationSql).toContain(`ALTER TABLE resumes ADD COLUMN ${column}`);
    }
    expect(BUSINESS_SCREENING_SCHEMA_STATEMENTS.join('\n')).toContain('CREATE TABLE IF NOT EXISTS resume_push_batches');
    expect(BUSINESS_SCREENING_SCHEMA_STATEMENTS.join('\n')).toContain('CREATE TABLE IF NOT EXISTS resume_push_batch_items');
    expect(BUSINESS_SCREENING_SCHEMA_STATEMENTS.join('\n')).toContain('dispatch_group_id TEXT');
    expect(BUSINESS_SCREENING_PUSH_TABLE_MIGRATIONS.join('\n')).toContain('ALTER TABLE resume_push_batches ADD COLUMN dispatch_group_id');
    expect(BUSINESS_SCREENING_PUSH_TABLE_MIGRATIONS.join('\n')).toContain('ALTER TABLE resume_push_batch_items ADD COLUMN dispatch_group_id');
  });

  it('attempts every compatibility migration and ignores duplicate-column errors', async () => {
    const attempted: string[] = [];
    const db = {
      prepare(sql: string) {
        attempted.push(sql);
        return {
          async run() {
            if (sql.includes('hr_disposition')) throw new Error('duplicate column name');
            return { meta: { changes: 1 } };
          },
        };
      },
    };

    await expect(ensureBusinessScreeningSchema(db as never)).resolves.toBeUndefined();
    expect(attempted).toEqual([
      ...BUSINESS_SCREENING_RESUME_MIGRATIONS,
      ...BUSINESS_SCREENING_SCHEMA_STATEMENTS,
      ...BUSINESS_SCREENING_PUSH_TABLE_MIGRATIONS,
      ...BUSINESS_SCREENING_PUSH_TABLE_INDEXES,
    ]);
  });
});

describe('business screening repository writes', () => {
  it('loads the latest reusable interviewer batch and refreshes its expiry', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            calls.push({ sql, values });
            return {
              async first() {
                return sql.includes('ORDER BY created_at DESC')
                  ? { id: 'batch-canonical', interviewer_open_id: 'ou_123', scope_key: 'ou_123', status: 'expired' }
                  : null;
              },
              async run() { return { meta: { changes: 1 } }; },
            };
          },
        };
      },
    };

    await expect(loadLatestResumePushBatchByInterviewer(db as never, 'ou_123')).resolves.toMatchObject({
      id: 'batch-canonical',
      status: 'expired',
    });
    await expect(refreshResumePushBatchExpiry(db as never, 'batch-canonical', '2026-09-11T12:00:00.000Z')).resolves.toBeUndefined();
    expect(calls).toEqual([
      { sql: expect.stringContaining('interviewer_open_id = ?'), values: ['ou_123'] },
      { sql: expect.stringContaining('SET expires_at = ?'), values: ['2026-09-11T12:00:00.000Z', 'batch-canonical'] },
    ]);
  });

  it('persists batches, batch items, and resume push marks with the expected SQL contract', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            calls.push({ sql, values });
            return {
              async run() {
                return { meta: { changes: 1 } };
              },
              async first() {
                if (sql.includes('FROM resume_push_batches')) {
                  return {
                    id: 'batch-1',
                    interviewer_id: 'user-1',
                    interviewer_name: '张三',
                    interviewer_open_id: 'ou_123',
                    token_hash: 'hash-1',
                    expires_at: null,
                    status: 'active',
                    created_by: 'hr@example.com',
                    created_at: '2026-08-12T12:00:00.000Z',
                    last_sent_at: null,
                    dispatch_group_id: 'dispatch-1',
                  };
                }
                return null;
              },
            };
          },
        };
      },
    };

    await createResumePushBatch(db as never, {
      id: 'batch-1',
      interviewerId: 'user-1',
      interviewerName: '张三',
      interviewerOpenId: 'ou_123',
      tokenHash: 'hash-1',
      createdBy: 'hr@example.com',
      createdAt: '2026-08-12T12:00:00.000Z',
      dispatchGroupId: 'dispatch-1',
    });
    await insertResumePushBatchItems(db as never, [{
      id: 'item-1',
      batchId: 'batch-1',
      resumeId: 'resume-1',
      positionId: 'position-1',
      createdAt: '2026-08-12T12:00:00.000Z',
      dispatchGroupId: 'dispatch-1',
    }]);
    await markResumesPushed(db as never, ['resume-1'], 'batch-1', 'dispatch-1');
    await expect(loadResumePushBatchByTokenHash(db as never, 'hash-1')).resolves.toMatchObject({
      id: 'batch-1',
      interviewer_name: '张三',
      token_hash: 'hash-1',
    });

    expect(calls.find((call) => call.sql.includes('INSERT INTO resume_push_batches'))?.values).toEqual([
      'batch-1', 'user-1', '张三', 'ou_123', 'hash-1', null, 'active', 'hr@example.com', '2026-08-12T12:00:00.000Z', null, 'dispatch-1', null, null, null,
    ]);
    expect(calls.find((call) => call.sql.includes('INSERT INTO resume_push_batch_items'))?.values).toEqual([
      'item-1', 'batch-1', 'resume-1', 'position-1', 'pending', null, null, '2026-08-12T12:00:00.000Z', 'dispatch-1',
    ]);
    expect(calls.find((call) => call.sql.includes("SET hr_disposition = 'pushed'"))?.values).toEqual([
      'batch-1', 'dispatch-1', expect.any(String), 'resume-1',
    ]);
    expect(calls.find((call) => call.sql.includes('FROM resume_push_batches'))?.values).toEqual(['hash-1']);
  });

  it('revokes every active batch containing the HR-rejected resume', async () => {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const db = {
      prepare(sql: string) {
        return {
          bind(...values: unknown[]) {
            calls.push({ sql, values });
            return {
              async run() {
                return { meta: { changes: 2 } };
              },
            };
          },
        };
      },
    };

    await expect(revokeActiveBusinessScreeningBatchesForResume(db as never, 'resume-1')).resolves.toBeUndefined();

    expect(calls).toEqual([{
      sql: expect.stringContaining("UPDATE resume_push_batches"),
      values: ['resume-1'],
    }]);
  });

  it('guards business-screening persistence so a pending item transitions once and cannot be overwritten', async () => {
    const db = createDecisionDb();

    await expect(recordBusinessScreeningDecision(db as never, {
      batchItemId: 'item-1',
      resumeId: 'resume-1',
      batchId: 'batch-1',
      status: 'passed',
      remark: '通过',
      screenedAt: '2026-08-12T12:00:00.000Z',
      screenedBy: '张三',
    })).resolves.toEqual({ applied: true, idempotent: false, status: 'passed' });

    expect(db.item.status).toBe('passed');
    expect(db.resume.business_screening_status).toBe('passed');
    expect(db.resume.status).toBe('approved');
    expect(db.resume.stage).toBe('talent_pool');

    await expect(recordBusinessScreeningDecision(db as never, {
      batchItemId: 'item-1',
      resumeId: 'resume-1',
      batchId: 'batch-1',
      status: 'passed',
      remark: '重复通过',
      screenedAt: '2026-08-12T12:01:00.000Z',
      screenedBy: '张三',
    })).resolves.toEqual({ applied: false, idempotent: true, status: 'passed' });

    expect(db.item.remark).toBe('通过');
    expect(db.resume.business_screening_remark).toBe('通过');
    expect(db.resume.approved_at).toBe('2026-08-12T12:00:00.000Z');
    expect(db.resume.rejected_at).toBeNull();

    await expect(recordBusinessScreeningDecision(db as never, {
      batchItemId: 'item-1',
      resumeId: 'resume-1',
      batchId: 'batch-1',
      status: 'rejected',
      remark: '试图反向改判',
      screenedAt: '2026-08-12T12:02:00.000Z',
      screenedBy: '张三',
    })).resolves.toEqual({ applied: false, idempotent: false, status: 'passed', reason: 'business screening already completed' });

    expect(db.item.status).toBe('passed');
    expect(db.resume.business_screening_status).toBe('passed');
    expect(db.resume.status).toBe('approved');
    expect(db.resume.stage).toBe('talent_pool');
  });

  it('rejects revoked stale batch callbacks before mutating business-screening or terminal resume fields', async () => {
    const db = createDecisionDb({
      resume: {
        status: 'pending_review',
        stage: 'screening',
        approved_at: null,
        rejected_at: null,
        business_screening_status: 'pending',
        business_screening_remark: '',
        business_screened_at: null,
        business_screened_by: '',
        business_screening_batch_id: 'batch-b',
        business_screening_dispatch_group_id: 'dispatch-b',
      },
      items: {
        'item-a': {
          batch_id: 'batch-a',
          resume_id: 'resume-1',
          status: 'rejected',
          remark: null,
          processed_at: null,
          dispatch_group_id: 'dispatch-a',
        },
      },
    });

    await expect(recordBusinessScreeningDecision(db as never, {
      batchItemId: 'item-a',
      resumeId: 'resume-1',
      batchId: 'batch-a',
      status: 'rejected',
      remark: '过期批次不入库',
      screenedAt: '2026-08-12T12:05:00.000Z',
      screenedBy: '张三',
    })).resolves.toMatchObject({
      applied: false,
      idempotent: false,
      reason: 'business screening dispatch group changed',
    });

    expect(db.items['item-a']).toEqual({
      batch_id: 'batch-a',
      resume_id: 'resume-1',
      status: 'rejected',
      remark: null,
      processed_at: null,
      dispatch_group_id: 'dispatch-a',
    });
    expect(db.resume).toMatchObject({
      hr_disposition: 'pushed',
      status: 'pending_review',
      stage: 'screening',
      approved_at: null,
      rejected_at: null,
      business_screening_status: 'pending',
      business_screening_remark: '',
      business_screened_at: null,
      business_screened_by: '',
      business_screening_batch_id: 'batch-b',
      business_screening_dispatch_group_id: 'dispatch-b',
    });
  });

  it('blocks an HR-rejected resume before any batch-item mutation and never reports applied=true', async () => {
    const db = createDecisionDb({
      resume: {
        hr_disposition: 'rejected',
        status: 'rejected',
        stage: 'rejected',
        approved_at: null,
        rejected_at: '2026-08-12T11:59:00.000Z',
        business_screening_status: 'rejected',
        business_screening_remark: 'HR淘汰',
        business_screened_at: '2026-08-12T11:59:00.000Z',
        business_screened_by: 'HR',
        business_screening_batch_id: 'batch-1',
        business_screening_dispatch_group_id: 'dispatch-1',
      },
    });

    await expect(recordBusinessScreeningDecision(db as never, {
      batchItemId: 'item-1',
      resumeId: 'resume-1',
      batchId: 'batch-1',
      status: 'passed',
      remark: '面试官试图改判',
      screenedAt: '2026-08-12T12:00:00.000Z',
      screenedBy: '张三',
    })).resolves.toEqual({
      applied: false,
      idempotent: false,
      status: 'rejected',
      reason: 'HR already rejected resume',
    });

    expect(db.item).toMatchObject({
      status: 'pending',
      remark: null,
      processed_at: null,
    });
    expect(db.resume).toMatchObject({
      hr_disposition: 'rejected',
      business_screening_status: 'rejected',
      business_screening_remark: 'HR淘汰',
      business_screened_by: 'HR',
      status: 'rejected',
      stage: 'rejected',
    });
  });

  it('closes sibling pending items when one interviewer completes the resume and blocks later opposite callbacks', async () => {
    const db = createDecisionDb({
      resume: {
        status: 'pending_review',
        stage: 'screening',
        approved_at: null,
        rejected_at: null,
        business_screening_status: 'pending',
        business_screening_remark: '',
        business_screened_at: null,
        business_screened_by: '',
        business_screening_batch_id: 'batch-b',
        business_screening_dispatch_group_id: 'dispatch-1',
      },
      items: {
        'item-a': {
          batch_id: 'batch-a',
          resume_id: 'resume-1',
          status: 'pending',
          remark: null,
          processed_at: null,
          dispatch_group_id: 'dispatch-1',
        },
        'item-b': {
          batch_id: 'batch-b',
          resume_id: 'resume-1',
          status: 'pending',
          remark: null,
          processed_at: null,
          dispatch_group_id: 'dispatch-1',
        },
      },
    });

    await expect(recordBusinessScreeningDecision(db as never, {
      batchItemId: 'item-a',
      resumeId: 'resume-1',
      batchId: 'batch-a',
      status: 'passed',
      remark: '张三通过',
      screenedAt: '2026-08-12T12:00:00.000Z',
      screenedBy: '张三',
    })).resolves.toEqual({ applied: true, idempotent: false, status: 'passed' });

    expect(db.resume).toMatchObject({
      business_screening_status: 'passed',
      status: 'approved',
      stage: 'talent_pool',
      business_screening_batch_id: 'batch-a',
      business_screening_dispatch_group_id: 'dispatch-1',
    });
    expect(db.items['item-a']).toMatchObject({
      status: 'passed',
      remark: '张三通过',
    });
    expect(db.items['item-b']).toMatchObject({
      status: 'passed',
      remark: '张三通过',
    });

    await expect(recordBusinessScreeningDecision(db as never, {
      batchItemId: 'item-b',
      resumeId: 'resume-1',
      batchId: 'batch-b',
      status: 'rejected',
      remark: '李四改判',
      screenedAt: '2026-08-12T12:01:00.000Z',
      screenedBy: '李四',
    })).resolves.toEqual({
      applied: false,
      idempotent: false,
      status: 'passed',
      reason: 'business screening already completed',
    });

    expect(db.resume).toMatchObject({
      business_screening_status: 'passed',
      status: 'approved',
      stage: 'talent_pool',
      business_screening_remark: '张三通过',
    });
  });

  it('conflicts stale old-group callbacks before any mutation when the resume points at a different current dispatch group', async () => {
    const db = createDecisionDb({
      resume: {
        status: 'pending_review',
        stage: 'screening',
        approved_at: null,
        rejected_at: null,
        business_screening_status: 'pending',
        business_screening_remark: '',
        business_screened_at: null,
        business_screened_by: '',
        business_screening_batch_id: 'batch-b',
        business_screening_dispatch_group_id: 'dispatch-new',
      },
      items: {
        'item-a': {
          batch_id: 'batch-a',
          resume_id: 'resume-1',
          status: 'pending',
          remark: null,
          processed_at: null,
          dispatch_group_id: 'dispatch-old',
        },
        'item-b': {
          batch_id: 'batch-b',
          resume_id: 'resume-1',
          status: 'pending',
          remark: null,
          processed_at: null,
          dispatch_group_id: 'dispatch-new',
        },
      },
    });

    await expect(recordBusinessScreeningDecision(db as never, {
      batchItemId: 'item-a',
      resumeId: 'resume-1',
      batchId: 'batch-a',
      status: 'rejected',
      remark: '旧批次回调',
      screenedAt: '2026-08-12T12:00:00.000Z',
      screenedBy: '张三',
    })).resolves.toEqual({
      applied: false,
      idempotent: false,
      status: 'rejected',
      reason: 'business screening dispatch group changed',
    });

    expect(db.items['item-a']).toMatchObject({
      status: 'pending',
      remark: null,
      processed_at: null,
      dispatch_group_id: 'dispatch-old',
    });
    expect(db.items['item-b']).toMatchObject({
      status: 'pending',
      remark: null,
      processed_at: null,
      dispatch_group_id: 'dispatch-new',
    });
    expect(db.resume).toMatchObject({
      business_screening_status: 'pending',
      business_screening_batch_id: 'batch-b',
      business_screening_dispatch_group_id: 'dispatch-new',
      status: 'pending_review',
      stage: 'screening',
    });
  });

  it('allows same-push sibling batches sharing a dispatch group and only closes sibling items from that same group', async () => {
    const db = createDecisionDb({
      resume: {
        status: 'pending_review',
        stage: 'screening',
        approved_at: null,
        rejected_at: null,
        business_screening_status: 'pending',
        business_screening_remark: '',
        business_screened_at: null,
        business_screened_by: '',
        business_screening_batch_id: 'batch-b',
        business_screening_dispatch_group_id: 'dispatch-shared',
      },
      items: {
        'item-a': {
          batch_id: 'batch-a',
          resume_id: 'resume-1',
          status: 'pending',
          remark: null,
          processed_at: null,
          dispatch_group_id: 'dispatch-shared',
        },
        'item-b': {
          batch_id: 'batch-b',
          resume_id: 'resume-1',
          status: 'pending',
          remark: null,
          processed_at: null,
          dispatch_group_id: 'dispatch-shared',
        },
        'item-c': {
          batch_id: 'batch-c',
          resume_id: 'resume-1',
          status: 'pending',
          remark: null,
          processed_at: null,
          dispatch_group_id: 'dispatch-older',
        },
      },
    });

    await expect(recordBusinessScreeningDecision(db as never, {
      batchItemId: 'item-a',
      resumeId: 'resume-1',
      batchId: 'batch-a',
      status: 'passed',
      remark: '同推送批次通过',
      screenedAt: '2026-08-12T12:00:00.000Z',
      screenedBy: '张三',
    })).resolves.toEqual({ applied: true, idempotent: false, status: 'passed' });

    expect(db.items['item-a']).toMatchObject({ status: 'passed', dispatch_group_id: 'dispatch-shared' });
    expect(db.items['item-b']).toMatchObject({ status: 'passed', dispatch_group_id: 'dispatch-shared' });
    expect(db.items['item-c']).toMatchObject({
      status: 'pending',
      remark: null,
      processed_at: null,
      dispatch_group_id: 'dispatch-older',
    });
    expect(db.resume).toMatchObject({
      business_screening_status: 'passed',
      business_screening_batch_id: 'batch-a',
      business_screening_dispatch_group_id: 'dispatch-shared',
      status: 'approved',
      stage: 'talent_pool',
    });
  });

  it('accepts the resend replacement group while the older group remains blocked and untouched', async () => {
    const db = createDecisionDb({
      resume: {
        status: 'pending_review',
        stage: 'screening',
        approved_at: null,
        rejected_at: null,
        business_screening_status: 'pending',
        business_screening_remark: '',
        business_screened_at: null,
        business_screened_by: '',
        business_screening_batch_id: 'batch-new',
        business_screening_dispatch_group_id: 'dispatch-new',
      },
      items: {
        'item-old': {
          batch_id: 'batch-old',
          resume_id: 'resume-1',
          status: 'pending',
          remark: null,
          processed_at: null,
          dispatch_group_id: 'dispatch-old',
        },
        'item-new': {
          batch_id: 'batch-new',
          resume_id: 'resume-1',
          status: 'pending',
          remark: null,
          processed_at: null,
          dispatch_group_id: 'dispatch-new',
        },
      },
    });

    await expect(recordBusinessScreeningDecision(db as never, {
      batchItemId: 'item-new',
      resumeId: 'resume-1',
      batchId: 'batch-new',
      status: 'passed',
      remark: '重发后通过',
      screenedAt: '2026-08-12T12:00:00.000Z',
      screenedBy: '张三',
    })).resolves.toEqual({ applied: true, idempotent: false, status: 'passed' });

    expect(db.items['item-new']).toMatchObject({ status: 'passed', dispatch_group_id: 'dispatch-new' });
    expect(db.items['item-old']).toMatchObject({
      status: 'pending',
      remark: null,
      processed_at: null,
      dispatch_group_id: 'dispatch-old',
    });
    expect(db.resume).toMatchObject({
      business_screening_status: 'passed',
      business_screening_batch_id: 'batch-new',
      business_screening_dispatch_group_id: 'dispatch-new',
      status: 'approved',
      stage: 'talent_pool',
    });

    await expect(recordBusinessScreeningDecision(db as never, {
      batchItemId: 'item-old',
      resumeId: 'resume-1',
      batchId: 'batch-old',
      status: 'rejected',
      remark: '旧重发链接不应生效',
      screenedAt: '2026-08-12T12:01:00.000Z',
      screenedBy: '张三',
    })).resolves.toEqual({
      applied: false,
      idempotent: false,
      status: 'rejected',
      reason: 'business screening dispatch group changed',
    });

    expect(db.items['item-old']).toMatchObject({
      status: 'pending',
      remark: null,
      processed_at: null,
      dispatch_group_id: 'dispatch-old',
    });
    expect(db.resume).toMatchObject({
      business_screening_status: 'passed',
      business_screening_batch_id: 'batch-new',
      business_screening_dispatch_group_id: 'dispatch-new',
      business_screening_remark: '重发后通过',
    });
  });

  it('updates terminal resume status/stage idempotently without undoing a completed opposite outcome', async () => {
    const db = createTerminalOutcomeDb();

    await expect(applyTerminalResumeOutcome(db as never, {
      resumeId: 'resume-1',
      outcome: 'approved',
      timestamp: '2026-08-12T12:00:00.000Z',
    })).resolves.toEqual({ applied: true, idempotent: false, status: 'approved', stage: 'talent_pool' });

    expect(db.resume.status).toBe('approved');
    expect(db.resume.stage).toBe('talent_pool');
    expect(db.resume.approved_at).toBe('2026-08-12T12:00:00.000Z');
    expect(db.resume.rejected_at).toBeNull();

    await expect(applyTerminalResumeOutcome(db as never, {
      resumeId: 'resume-1',
      outcome: 'approved',
      timestamp: '2026-08-12T12:01:00.000Z',
    })).resolves.toEqual({ applied: false, idempotent: true, status: 'approved', stage: 'talent_pool' });

    expect(db.resume.approved_at).toBe('2026-08-12T12:00:00.000Z');

    await expect(applyTerminalResumeOutcome(db as never, {
      resumeId: 'resume-1',
      outcome: 'rejected',
      timestamp: '2026-08-12T12:02:00.000Z',
    })).resolves.toEqual({
      applied: false,
      idempotent: false,
      status: 'approved',
      stage: 'talent_pool',
      reason: 'resume terminal outcome already completed',
    });

    expect(db.resume.status).toBe('approved');
    expect(db.resume.stage).toBe('talent_pool');
    expect(db.resume.rejected_at).toBeNull();
  });
});

function createDecisionDb(overrides?: {
  resume?: {
    hr_disposition?: string;
    status: string;
    stage: string;
    approved_at: string | null;
    rejected_at: string | null;
    business_screening_status: string;
    business_screening_remark: string;
    business_screened_at: string | null;
    business_screened_by: string;
    business_screening_batch_id: string;
    business_screening_dispatch_group_id: string;
    updated_at?: string;
  };
  items?: Record<string, {
    batch_id: string;
    resume_id: string;
    status: string;
    remark: string | null;
    processed_at: string | null;
    dispatch_group_id: string;
  }>;
}) {
  const items = overrides?.items || {
    'item-1': {
      batch_id: 'batch-1',
      resume_id: 'resume-1',
      status: 'pending',
      remark: null as string | null,
      processed_at: null as string | null,
      dispatch_group_id: 'dispatch-1',
    },
  };
  const resume = {
    hr_disposition: overrides?.resume?.hr_disposition || 'pushed',
    status: overrides?.resume?.status || 'pending_review',
    stage: overrides?.resume?.stage || 'screening',
    approved_at: overrides?.resume?.approved_at ?? null,
    rejected_at: overrides?.resume?.rejected_at ?? null,
    business_screening_status: overrides?.resume?.business_screening_status || 'pending',
    business_screening_remark: overrides?.resume?.business_screening_remark || '',
    business_screened_at: overrides?.resume?.business_screened_at ?? null,
    business_screened_by: overrides?.resume?.business_screened_by || '',
    business_screening_batch_id: overrides?.resume?.business_screening_batch_id || 'batch-1',
    business_screening_dispatch_group_id: overrides?.resume?.business_screening_dispatch_group_id || 'dispatch-1',
    updated_at: overrides?.resume?.updated_at || '',
  };

  return {
    item: items['item-1'],
    items,
    resume,
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first() {
              if (sql.includes('FROM resume_push_batch_items')) {
                const itemId = values[0] as string;
                const batchId = values[1] as string;
                const resumeId = values[2] as string;
                const current = items[itemId];
                if (!current || current.batch_id !== batchId || current.resume_id !== resumeId) return null;
                return {
                  batch_id: current.batch_id,
                  resume_id: current.resume_id,
                  status: current.status,
                  remark: current.remark,
                  processed_at: current.processed_at,
                  dispatch_group_id: current.dispatch_group_id,
                };
              }
              if (sql.includes('FROM resumes') && sql.includes('business_screening_status')) {
                return { ...resume };
              }
              return null;
            },
            async run() {
              if (sql.includes('UPDATE resume_push_batch_items')) {
                if (
                  sql.includes('WHERE id = ?')
                  && sql.includes('batch_id = ?')
                  && sql.includes('resume_id = ?')
                  && sql.includes("status = 'pending'")
                  && !sql.includes("AND id != ?")
                ) {
                  const itemId = values[3] as string;
                  const batchId = values[4] as string;
                  const resumeId = values[5] as string;
                  const dispatchGroupId = values[6] as string;
                  const current = items[itemId];
                  if (
                    !current
                    || current.batch_id !== batchId
                    || current.resume_id !== resumeId
                    || current.status !== 'pending'
                    || current.dispatch_group_id !== dispatchGroupId
                  ) {
                    return { meta: { changes: 0 } };
                  }
                  current.status = values[0] as string;
                  current.remark = values[1] as string | null;
                  current.processed_at = values[2] as string | null;
                  return { meta: { changes: 1 } };
                }
                if (sql.includes('WHERE resume_id = ?') && sql.includes('dispatch_group_id') && sql.includes("AND id != ?") && sql.includes("status = 'pending'")) {
                  const resumeId = values[3] as string;
                  const dispatchGroupId = values[4] as string;
                  const itemId = values[5] as string;
                  let changes = 0;
                  for (const [key, current] of Object.entries(items)) {
                    if (
                      key === itemId
                      || current.resume_id !== resumeId
                      || current.dispatch_group_id !== dispatchGroupId
                      || current.status !== 'pending'
                    ) continue;
                    current.status = values[0] as string;
                    current.remark = current.remark ?? (values[1] as string | null);
                    current.processed_at = current.processed_at ?? (values[2] as string | null);
                    changes += 1;
                  }
                  return { meta: { changes } };
                }
              }
              if (sql.includes('UPDATE resumes')) {
                const resumeEligible = ['not_ready', 'pending'].includes(resume.business_screening_status)
                  && resume.status !== 'approved'
                  && resume.status !== 'rejected'
                  && resume.hr_disposition !== 'rejected';
                const expectedResumeId = values[11] as string;
                const expectedDispatchGroupId = values[12] as string;
                const expectedItemId = values[13] as string;
                const expectedBatchId = values[14] as string;
                const expectedItemResumeId = values[15] as string;
                const expectedItemDispatchGroupId = values[16] as string;
                const currentItem = items[expectedItemId];
                if (!resumeEligible) return { meta: { changes: 0 } };
                if (
                  expectedResumeId !== 'resume-1'
                  || expectedItemResumeId !== 'resume-1'
                  || resume.business_screening_dispatch_group_id !== expectedDispatchGroupId
                  || !currentItem
                  || currentItem.batch_id !== expectedBatchId
                  || currentItem.resume_id !== expectedItemResumeId
                  || currentItem.status !== 'pending'
                  || currentItem.dispatch_group_id !== expectedItemDispatchGroupId
                ) {
                  return { meta: { changes: 0 } };
                }
                resume.business_screening_status = values[0] as string;
                resume.business_screening_remark = values[1] as string;
                resume.business_screened_at = values[2] as string | null;
                resume.business_screened_by = values[3] as string;
                resume.business_screening_batch_id = values[4] as string;
                resume.business_screening_dispatch_group_id = values[5] as string;
                resume.status = values[6] as string;
                resume.stage = values[7] as string;
                resume.approved_at = values[8] as string | null;
                resume.rejected_at = values[9] as string | null;
                resume.updated_at = values[10] as string;
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
}

function createTerminalOutcomeDb() {
  const resume = {
    status: 'pending_review',
    stage: 'screening',
    approved_at: null as string | null,
    rejected_at: null as string | null,
    updated_at: '',
  };

  return {
    resume,
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first() {
              if (
                sql.includes('FROM resumes')
                && sql.includes('status')
                && sql.includes('stage')
                && sql.includes('approved_at')
                && sql.includes('rejected_at')
              ) {
                return { ...resume };
              }
              return null;
            },
            async run() {
              if (sql.includes("SET status = 'approved'") && sql.includes("stage = 'talent_pool'")) {
                if (resume.status === 'approved' || resume.status === 'rejected') return { meta: { changes: 0 } };
                resume.status = 'approved';
                resume.stage = 'talent_pool';
                resume.approved_at = values[0] as string;
                resume.rejected_at = null;
                resume.updated_at = values[1] as string;
                return { meta: { changes: 1 } };
              }
              if (sql.includes("SET status = 'rejected'") && sql.includes("stage = 'rejected'")) {
                if (resume.status === 'approved' || resume.status === 'rejected') return { meta: { changes: 0 } };
                resume.status = 'rejected';
                resume.stage = 'rejected';
                resume.rejected_at = values[0] as string;
                resume.approved_at = null;
                resume.updated_at = values[1] as string;
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
}
