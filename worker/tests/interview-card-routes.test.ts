import { describe, expect, it } from 'vitest';
import { createInterviewCardRoutes, ensureInterviewCard } from '../src/interview-card/routes';

type Row = Record<string, unknown>;

function makeDb(tables: Record<string, Row[]>) {
  function rowsFor(table: string) { return tables[table] || []; }
  return {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          const first = async () => {
            if (sql.includes('FROM interview_cards')) {
              return rowsFor('interview_cards').find((row) => row.token_hash === params[0]) || null;
            }
            if (sql.includes('FROM interview_card_links')) {
              return rowsFor('interview_card_links').find((row) => row.token_hash === params[0]) || null;
            }
            if (sql.includes('FROM interviews') && sql.includes('candidate_name = ?')) {
              return rowsFor('interviews').find((row) => row.candidate_name === params[0] && row.position_applied === params[1]) || null;
            }
            if (sql.includes('FROM interviews') && sql.includes('WHERE id = ?')) {
              return rowsFor('interviews').find((row) => row.id === params[0]) || null;
            }
            if (sql.includes('FROM resumes') && sql.includes('WHERE id = ?')) {
              return rowsFor('resumes').find((row) => row.id === params[0]) || null;
            }
            return null;
          };
          const all = async () => {
            if (sql.includes('FROM interviews')) {
              return { results: rowsFor('interviews').filter((row) => !params[0] || row.resume_id === params[0]) };
            }
            if (sql.includes('FROM resumes')) {
              return { results: rowsFor('resumes').filter((row) => {
                if (params.length === 0) return true;
                return row.candidate_name === params[0];
              }) };
            }
            if (sql.includes('FROM candidate_stage_events')) {
              return { results: rowsFor('candidate_stage_events').filter((row) => row.resume_id === params[0]) };
            }
            return { results: [] };
          };
          return { first, all, run: async () => ({ meta: { changes: 1 } }) };
        },
        first: async () => null,
        all: async () => ({ results: [] }),
        run: async () => ({ meta: { changes: 1 } }),
      };
    },
  };
}

function request(path: string, db: unknown) {
  const app = createInterviewCardRoutes({ hashToken: async (token) => token });
  return app.fetch(new Request(`https://worker.local${path}`), { DB: db } as any);
}

describe('public interview card routes', () => {
  it('creates a stable-format expiring token for reminder links', async () => {
    const db = makeDb({ interview_cards: [] });
    const result = await ensureInterviewCard(db, {
      interviewId: 'iv-new',
      resumeId: 'res-new',
      createdBy: 'hr@example.com',
      tokenFactory: () => 'ic-test-token',
    });
    expect(result.token).toBe('ic-test-token');
    expect(result.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('returns resume, AI, HR, business screening, interviews and timeline data', async () => {
    const db = makeDb({
      interview_cards: [{ id: 'card-1', token_hash: 'token-1', interview_id: 'iv-1', resume_id: 'res-1', status: 'active', expires_at: '2099-01-01T00:00:00.000Z', created_at: '2026-08-20T00:00:00.000Z' }],
      resumes: [{
        id: 'res-1', candidate_name: '张三', position_applied: '产品经理', mapped_position: '产品经理', position_id: 'pos-1',
        status: 'pending_interview', stage: 'interview', match_score: 88, screening_result: '通过', parse_status: 'ai_screened',
        contact: '13800000000', email: 'zhang@example.com', gender: '男', birthday: '1995-01',
        parsed_data: JSON.stringify({ highest_degree: '本科', school: 'A大学', major: '计算机', age: 31, skills: ['产品设计'] }),
        ai_evaluation: JSON.stringify({ dimensions: [{ name: '核心画像', score: 4, reason: '匹配' }], summary: '匹配度较高', strengths: ['沟通好'], risks: ['行业经验待核实'] }),
        ai_review: 'AI 建议重点核实行业经验', hr_review: 'HR 备注：优先安排面试', hr_disposition: 'approved',
        business_screening_status: 'passed', business_screening_remark: '业务认可', business_screened_by: '业务负责人', business_screened_at: '2026-08-19T10:00:00Z',
        ocr_markdown: '# 张三\n产品经理', resume_markdown: '# 张三\n产品经理', updated_at: '2026-08-20T01:00:00Z',
      }],
      interviews: [
        { id: 'iv-1', resume_id: 'res-1', position_id: 'pos-1', candidate_name: '张三', position_applied: '产品经理', round: 1, interview_time: '2026-08-20 10:00', status: 'scheduled', result: 'pending', result2: 'pending', primary_interviewer: '面试官甲', interview_type: 'video', interview_location: '', meeting_link: 'https://meeting.example/1' },
        { id: 'iv-2', resume_id: 'res-1', position_id: 'pos-1', candidate_name: '张三', position_applied: '产品经理', round: 2, interview_time: '2026-08-22 10:00', status: 'scheduled', result: 'pending', result2: 'pending', secondary_interviewer: '面试官乙' },
      ],
      candidate_stage_events: [
        { id: 'event-1', resume_id: 'res-1', stage: 'resume_received', action: '简历收到', occurred_at: '2026-08-18T10:00:00Z' },
        { id: 'event-2', resume_id: 'res-1', stage: 'interview_scheduled', action: '安排一面', occurred_at: '2026-08-19T10:00:00Z' },
      ],
    });

    const response = await request('/api/public/interview-card/token-1', db);
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.candidate).toMatchObject({ resume_id: 'res-1', candidate_name: '张三', resume_link_status: 'linked' });
    expect(body.candidate.contact).toBe('138****0000');
    expect(body.candidate.ai.dimensions[0]).toMatchObject({ name: '核心画像', score: 4 });
    expect(body.candidate.hr).toMatchObject({ decision: 'approved', note: 'HR 备注：优先安排面试' });
    expect(body.candidate.business_screening).toMatchObject({ status: 'passed', remark: '业务认可' });
    expect(body.candidate.current_status).toMatchObject({ code: 'pending_interview', label: '待面试' });
    expect(body.interviews).toHaveLength(2);
    expect(body.timeline).toHaveLength(2);
  });

  it('does not guess a legacy same-name resume', async () => {
    const db = makeDb({
      interview_cards: [{ id: 'card-2', token_hash: 'token-2', interview_id: 'iv-legacy', resume_id: '', status: 'active', expires_at: '2099-01-01T00:00:00.000Z' }],
      interviews: [{ id: 'iv-legacy', resume_id: '', candidate_name: '同名候选人', position_applied: '运营', position_id: 'pos-2', round: 1, status: 'scheduled' }],
      resumes: [{ id: 'res-a', candidate_name: '同名候选人' }, { id: 'res-b', candidate_name: '同名候选人' }],
    });

    const response = await request('/api/public/interview-card/token-2', db);
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.candidate).toMatchObject({ candidate_name: '同名候选人', resume_id: null, resume_link_status: 'ambiguous' });
    expect(body.candidate.ai).toBeNull();
  });

  it('reads legacy interview_card_links rows so existing reminders stay valid', async () => {
    const db = makeDb({
      interview_cards: [],
      interview_card_links: [{
        id: 'legacy-card', token_hash: 'legacy-token-hash', resume_id: null,
        candidate_name: '测试候选人', position_applied: '软件产品经理', status: 'active',
        expires_at: '2099-01-01T00:00:00.000Z', created_at: '2026-08-19T00:00:00.000Z',
      }],
      interviews: [{
        id: 'legacy-interview', candidate_name: '测试候选人', position_applied: '软件产品经理',
        round: 1, interview_time: '2026-08-20 10:00', status: 'completed', result: 'failed',
        evaluation: '历史链接评价',
      }],
    });
    const response = await createInterviewCardRoutes({ hashToken: async () => 'legacy-token-hash' })
      .fetch(new Request('https://worker.local/api/public/interview-card/legacy-token'), { DB: db } as any);
    expect(response.status).toBe(200);
    const body = await response.json() as any;
    expect(body.candidate.candidate_name).toBe('测试候选人');
    expect(body.interviews[0].evaluation).toBe('历史链接评价');
    expect(body.candidate.current_status.label).toBe('面试未通过');
  });

  it('returns 410 for an expired card', async () => {
    const db = makeDb({
      interview_cards: [{ id: 'card-3', token_hash: 'token-3', interview_id: 'iv-3', resume_id: 'res-3', status: 'active', expires_at: '2020-01-01T00:00:00.000Z' }],
    });

    const response = await request('/api/public/interview-card/token-3', db);
    expect(response.status).toBe(410);
  });

  it('streams the linked PDF through the same expiring bearer token', async () => {
    const db = makeDb({
      interview_cards: [{ id: 'card-file', token_hash: 'token-file', interview_id: 'iv-file', resume_id: 'res-file', status: 'active', expires_at: '2099-01-01T00:00:00.000Z' }],
      resumes: [{ id: 'res-file', candidate_name: '候选人' }],
      interviews: [{ id: 'iv-file', resume_id: 'res-file', candidate_name: '候选人' }],
    });
    const app = createInterviewCardRoutes({
      hashToken: async (token) => token,
      readFile: async () => ({ bytes: new Uint8Array([37, 80, 68, 70]), fileName: 'candidate.pdf' }),
    });
    const response = await app.fetch(new Request('https://worker.local/api/public/interview-card/token-file/file?preview=1'), { DB: db } as any);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/pdf');
    expect(response.headers.get('content-disposition')).toContain('inline');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([37, 80, 68, 70]));
  });
});
