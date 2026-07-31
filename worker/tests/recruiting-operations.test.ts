import { describe, expect, it } from 'vitest';
import { approveBatch, enrichScreeningEvaluation, evaluateHardRequirements, groupBoardRows, normalizeCapabilityDimensions, weightedScore } from '../src/index';
import {
  createShareExpiry,
  hashShareToken,
  isShareLinkActive,
  toPublicBoardRow,
} from '../src/recruiting-operations/share-links';

describe('dashboard share links', () => {
  const now = new Date('2026-07-31T00:00:00.000Z');

  it('accepts a live link and rejects expired or revoked links', () => {
    expect(isShareLinkActive({ expires_at: '2026-08-01T00:00:00.000Z', revoked_at: null }, now)).toBe(true);
    expect(isShareLinkActive({ expires_at: '2026-07-30T00:00:00.000Z', revoked_at: null }, now)).toBe(false);
    expect(isShareLinkActive({ expires_at: null, revoked_at: now.toISOString() }, now)).toBe(false);
  });

  it('creates the requested share expiry', () => {
    expect(createShareExpiry('1d', now)?.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(createShareExpiry('7d', now)?.toISOString()).toBe('2026-08-07T00:00:00.000Z');
    expect(createShareExpiry('30d', now)?.toISOString()).toBe('2026-08-30T00:00:00.000Z');
    expect(createShareExpiry('permanent', now)).toBeNull();
  });

  it('hashes a token before it can be persisted', async () => {
    expect(await hashShareToken('test-token')).toBe('4c5dc9b7708905f77f5e5d16316b5dfb425e68cb326dcd55a860e90a7707031e');
  });

  it('removes candidate fields from a public board row', () => {
    const row = toPublicBoardRow({
      position: '运营',
      total_resumes: 10,
      candidate_name: 'X',
      email: 'candidate@example.com',
      contact: '13800000000',
      raw_text: 'private resume text',
      ai_evaluation: { hidden: true },
    });

    expect(row).toEqual({ position: '运营', total_resumes: 10 });
    expect(row).not.toHaveProperty('candidate_name');
  });
});

describe('bulk talent-pool approval', () => {
  it('approves eligible rows and skips already-approved rows by resume id', async () => {
    const db = createApprovalDb();

    await expect(approveBatch(db as never, ['resume-1', 'resume-2'], 'hr@example.com')).resolves.toEqual({
      approved: ['resume-1'],
      skipped: [{ id: 'resume-2', reason: 'already_approved' }],
      failed: [],
    });
    expect(db.updatedIds).toEqual(['resume-1']);
    expect(db.operationLogIds).toEqual(['resume-1']);
  });
});

describe('weighted role rules', () => {
  it('normalizes configured weights before calculating a weighted score', () => {
    const dimensions = normalizeCapabilityDimensions([
      { name: '沟通', weight: 40, description: '跨团队协作' },
      { name: '业务', weight: 60 },
    ]);

    expect(dimensions).toEqual([
      { name: '沟通', weight: 40, description: '跨团队协作' },
      { name: '业务', weight: 60, description: '' },
    ]);
    expect(weightedScore([{ score: 4, weight: 40 }, { score: 3, weight: 60 }])).toBe(3.4);
  });

  it('marks missing age as manual review rather than failed', () => {
    expect(evaluateHardRequirements({ age: null }, [{ field: 'age', operator: 'between', value: [22, 35] }]))
      .toMatchObject({ passed: true, unmet_items: [], unknown_items: ['age'] });
  });

  it('marks a known unmet condition without treating unknown conditions as failed', () => {
    expect(evaluateHardRequirements(
      { age: 40, highest_degree: null },
      [
        { field: 'age', operator: 'between', value: [22, 35] },
        { field: 'highest_degree', operator: 'in', value: ['本科', '硕士'] },
      ],
    )).toMatchObject({ passed: false, unmet_items: ['age'], unknown_items: ['highest_degree'] });
  });

  it('enriches an AI result while retaining raw dimension evidence', () => {
    expect(enrichScreeningEvaluation(
      { dimensions: [{ name: '沟通', score: 4, reason: '有跨团队经验' }] },
      [{ name: '沟通', weight: 100 }],
      [{ field: 'age', operator: 'between', value: [22, 35] }],
      { age: null },
    )).toMatchObject({
      dimensions: [{ name: '沟通', score: 4, reason: '有跨团队经验', weight: 100 }],
      weighted_score: 4,
      hard_requirement_result: { passed: true, unknown_items: ['age'] },
    });
  });
});

describe('recruiting board aggregation', () => {
  it('sums position rows into one division total without storing a second total', () => {
    expect(groupBoardRows([
      { division: 'A', position: '运营', total_resumes: 2, first_interview: 1, first_pass: 1, second_pass: 0, third_pass: 0, offers: 0, hired: 0 },
      { division: 'A', position: '销售', total_resumes: 3, first_interview: 2, first_pass: 1, second_pass: 1, third_pass: 0, offers: 1, hired: 0 },
    ])).toMatchObject([{
      division: 'A',
      total_resumes: 5,
      first_interview: 3,
      first_pass: 2,
      pass_rate: 67,
      positions: expect.any(Array),
    }]);
  });

  it('returns a null pass rate when a division has no first interviews', () => {
    expect(groupBoardRows([
      { division: 'A', position: '运营', total_resumes: 2, first_interview: 0, first_pass: 0, second_pass: 0, third_pass: 0, offers: 0, hired: 0 },
    ])[0].pass_rate).toBeNull();
  });
});

function createApprovalDb() {
  const rows: Record<string, { id: string; status: string; stage: string }> = {
    'resume-1': { id: 'resume-1', status: 'pending_review', stage: 'screening' },
    'resume-2': { id: 'resume-2', status: 'approved', stage: 'talent_pool' },
  };
  const updatedIds: string[] = [];
  const operationLogIds: string[] = [];

  return {
    get updatedIds() { return updatedIds; },
    get operationLogIds() { return operationLogIds; },
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first() {
              if (sql.includes('SELECT id, status, stage FROM resumes')) {
                return rows[values[0] as string] || null;
              }
              return null;
            },
            async run() {
              if (sql.includes("UPDATE resumes SET status = 'approved', stage = 'talent_pool'")) {
                const id = values.at(-1) as string;
                if (!rows[id]) return { meta: { changes: 0 } };
                rows[id] = { ...rows[id], status: 'approved', stage: 'talent_pool' };
                updatedIds.push(id);
                return { meta: { changes: 1 } };
              }
              if (sql.includes('INSERT INTO operation_logs')) {
                operationLogIds.push(values[2] as string);
                return { meta: { changes: 1 } };
              }
              throw new Error(`Unexpected SQL: ${sql}`);
            },
          };
        },
      };
    },
  };
}
