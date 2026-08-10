import { describe, expect, it } from 'vitest';
import { approveSingleResume } from '../src/index';

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
