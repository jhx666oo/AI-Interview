import { describe, expect, it } from 'vitest';
import { approveSingleResume, rejectBatch } from '../src/index';

function createApprovalDb() {
  let resume = {
    id: '9b56d629-3eea-4d25-bbb8-4f2697f6ac79',
    candidate_name: '测试候选人',
    status: 'pending_review',
    stage: 'screening',
    approved_at: '',
  };

  return {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first() {
              if (sql.includes('SELECT id, status, stage FROM resumes')) {
                return values[0] === resume.id ? { id: resume.id, status: resume.status, stage: resume.stage } : null;
              }
              if (sql.includes('SELECT * FROM resumes')) {
                return values[0] === resume.id ? resume : null;
              }
              return null;
            },
            async run() {
              if (sql.includes("UPDATE resumes SET status = 'approved'")) {
                resume = { ...resume, status: 'approved', stage: 'talent_pool' };
                return { meta: { changes: 1 } };
              }
              if (sql.includes('UPDATE resumes SET approved_at = ?')) {
                resume = { ...resume, approved_at: values[0] as string };
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

describe('single resume approval', () => {
  it('approves a D1-uploaded resume even when it has no Feishu record', async () => {
    const db = createApprovalDb();

    await expect(approveSingleResume(db as never, '9b56d629-3eea-4d25-bbb8-4f2697f6ac79', 'hr@example.com'))
      .resolves.toMatchObject({
        id: '9b56d629-3eea-4d25-bbb8-4f2697f6ac79',
        status: 'approved',
        stage: 'talent_pool',
        approved_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      });
  });
});

function createRejectDb() {
  const rows: Record<string, { id: string; status: string; stage: string }> = {
    'r-ok': { id: 'r-ok', status: 'pending_review', stage: 'screening' },
    'r-rejected': { id: 'r-rejected', status: 'rejected', stage: 'rejected' },
  };
  const updates: Array<{ id: string; status: string }> = [];

  return {
    rows,
    updates,
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first() {
              if (sql.includes('SELECT id, status, stage FROM resumes')) {
                const row = rows[values[0] as string];
                return row ? { id: row.id, status: row.status, stage: row.stage } : null;
              }
              return null;
            },
            async run() {
              if (sql.includes("UPDATE resumes SET status = 'rejected'")) {
                const id = values[1] as string;
                const row = rows[id];
                if (row) {
                  row.status = 'rejected';
                  row.stage = 'rejected';
                  updates.push({ id, status: 'rejected' });
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 0 } };
              }
              if (sql.includes('UPDATE resumes SET rejected_at')) {
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

describe('rejectBatch', () => {
  it('marks resumes as rejected and records timestamps', async () => {
    const db = createRejectDb();
    const result = await rejectBatch(db as never, ['r-ok'], 'test-actor');
    expect(result.approved).toEqual(['r-ok']);
    expect(result.skipped).toEqual([]);
    expect(result.failed).toEqual([]);
    expect((db as any).rows['r-ok']).toEqual({ id: 'r-ok', status: 'rejected', stage: 'rejected' });  });

  it('skips already-rejected and not-found resumes', async () => {
    const db = createRejectDb();
    const result = await rejectBatch(db as never, ['r-rejected', 'r-missing']);
    expect(result.approved).toEqual([]);
    expect(result.skipped).toEqual([
      { id: 'r-rejected', reason: 'already_rejected' },
      { id: 'r-missing', reason: 'not_found' },
    ]);
  });

  it('deduplicates ids and filters empty strings', async () => {
    const db = createRejectDb();
    const result = await rejectBatch(db as never, ['r-ok', 'r-ok', '']);
    expect(result.approved).toEqual(['r-ok']);
  });
});
