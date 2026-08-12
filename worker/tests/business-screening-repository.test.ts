import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BUSINESS_SCREENING_RESUME_MIGRATIONS,
  BUSINESS_SCREENING_SCHEMA_STATEMENTS,
  applyTerminalResumeOutcome,
  createResumePushBatch,
  ensureBusinessScreeningSchema,
  insertResumePushBatchItems,
  loadResumePushBatchByTokenHash,
  markResumesPushed,
  recordBusinessScreeningDecision,
} from '../src/business-screening/repository';

describe('business screening schema compatibility', () => {
  it('keeps the tracked SQL migration repeat-safe by reserving resume add-column guards for code-side compatibility migrations', async () => {
    const sql = await readFile(resolve(process.cwd(), 'migrations/0028_business_screening_push.sql'), 'utf8');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS resume_push_batches');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS resume_push_batch_items');
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
    ];

    const migrationSql = BUSINESS_SCREENING_RESUME_MIGRATIONS.join('\n');
    for (const column of requiredColumns) {
      expect(migrationSql).toContain(`ALTER TABLE resumes ADD COLUMN ${column}`);
    }
    expect(BUSINESS_SCREENING_SCHEMA_STATEMENTS.join('\n')).toContain('CREATE TABLE IF NOT EXISTS resume_push_batches');
    expect(BUSINESS_SCREENING_SCHEMA_STATEMENTS.join('\n')).toContain('CREATE TABLE IF NOT EXISTS resume_push_batch_items');
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
    ]);
  });
});

describe('business screening repository writes', () => {
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
    });
    await insertResumePushBatchItems(db as never, [{
      id: 'item-1',
      batchId: 'batch-1',
      resumeId: 'resume-1',
      positionId: 'position-1',
      createdAt: '2026-08-12T12:00:00.000Z',
    }]);
    await markResumesPushed(db as never, ['resume-1'], 'batch-1');
    await expect(loadResumePushBatchByTokenHash(db as never, 'hash-1')).resolves.toMatchObject({
      id: 'batch-1',
      interviewer_name: '张三',
      token_hash: 'hash-1',
    });

    expect(calls.find((call) => call.sql.includes('INSERT INTO resume_push_batches'))?.values).toEqual([
      'batch-1', 'user-1', '张三', 'ou_123', 'hash-1', null, 'active', 'hr@example.com', '2026-08-12T12:00:00.000Z', null,
    ]);
    expect(calls.find((call) => call.sql.includes('INSERT INTO resume_push_batch_items'))?.values).toEqual([
      'item-1', 'batch-1', 'resume-1', 'position-1', 'pending', null, null, '2026-08-12T12:00:00.000Z',
    ]);
    expect(calls.find((call) => call.sql.includes("SET hr_disposition = 'pushed'"))?.values).toEqual([
      'batch-1', expect.any(String), 'resume-1',
    ]);
    expect(calls.find((call) => call.sql.includes('FROM resume_push_batches'))?.values).toEqual(['hash-1']);
  });

  it('guards business-screening persistence so a pending item transitions once and cannot be overwritten', async () => {
    const db = createDecisionDb();

    await expect(recordBusinessScreeningDecision(db as never, {
      resumeId: 'resume-1',
      batchId: 'batch-1',
      status: 'passed',
      remark: '通过',
      screenedAt: '2026-08-12T12:00:00.000Z',
      screenedBy: '张三',
    })).resolves.toEqual({ applied: true, idempotent: false, status: 'passed' });

    expect(db.item.status).toBe('passed');
    expect(db.resume.business_screening_status).toBe('passed');

    await expect(recordBusinessScreeningDecision(db as never, {
      resumeId: 'resume-1',
      batchId: 'batch-1',
      status: 'passed',
      remark: '重复通过',
      screenedAt: '2026-08-12T12:01:00.000Z',
      screenedBy: '张三',
    })).resolves.toEqual({ applied: false, idempotent: true, status: 'passed' });

    expect(db.item.remark).toBe('通过');
    expect(db.resume.business_screening_remark).toBe('通过');

    await expect(recordBusinessScreeningDecision(db as never, {
      resumeId: 'resume-1',
      batchId: 'batch-1',
      status: 'rejected',
      remark: '试图反向改判',
      screenedAt: '2026-08-12T12:02:00.000Z',
      screenedBy: '张三',
    })).resolves.toEqual({ applied: false, idempotent: false, status: 'passed', reason: 'business screening already completed' });

    expect(db.item.status).toBe('passed');
    expect(db.resume.business_screening_status).toBe('passed');
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

function createDecisionDb() {
  const item = {
    status: 'pending',
    remark: null as string | null,
    processed_at: null as string | null,
  };
  const resume = {
    business_screening_status: 'pending',
    business_screening_remark: '',
    business_screened_at: null as string | null,
    business_screened_by: '',
    business_screening_batch_id: '',
    updated_at: '',
  };

  return {
    item,
    resume,
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first() {
              if (sql.includes('FROM resume_push_batch_items')) {
                return {
                  batch_id: values[0],
                  resume_id: values[1],
                  status: item.status,
                  remark: item.remark,
                  processed_at: item.processed_at,
                };
              }
              return null;
            },
            async run() {
              if (sql.includes('UPDATE resume_push_batch_items')) {
                if (item.status !== 'pending') return { meta: { changes: 0 } };
                item.status = values[0] as string;
                item.remark = values[1] as string | null;
                item.processed_at = values[2] as string | null;
                return { meta: { changes: 1 } };
              }
              if (sql.includes('UPDATE resumes')) {
                resume.business_screening_status = values[0] as string;
                resume.business_screening_remark = values[1] as string;
                resume.business_screened_at = values[2] as string | null;
                resume.business_screened_by = values[3] as string;
                resume.business_screening_batch_id = values[4] as string;
                resume.updated_at = values[5] as string;
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
