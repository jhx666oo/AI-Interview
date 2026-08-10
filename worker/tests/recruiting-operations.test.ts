import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { approveBatch, createDashboardSnapshot, enrichScreeningEvaluation, evaluateHardRequirements, getBoardFirstInterviewCount, getBoardInterviewPassCondition, getDashboardOwner, getDashboardPositionRowsForOwner, getSharedBoard, groupBoardRows, normalizeCapabilityDimensions, readDashboardSnapshot, weightedScore } from '../src/index';
import {
  assertShareDataMode,
  createShareExpiry,
  hashShareToken,
  isShareLinkActive,
  toShanghaiSnapshotDate,
  toPublicBoardRow,
} from '../src/recruiting-operations/share-links';
import { buildRecruitingBoard, toPublicRecruitingBoard } from '../src/recruiting-operations/dashboard';

function createDashboardRowsDb(overrides: { positions?: any[]; mappings?: any[]; resumes?: any[] } = {}) {
  const positions = overrides.positions || [
    { id: 'p1', title: '标准运营', department: '职培', responsible_person: 'HR A', status: 'open', urgency: 'medium', headcount: 2, created_at: '2026-08-02' },
    { id: 'p2', title: '销售', department: '到家', responsible_person: 'HR B', status: 'draft', urgency: 'low', headcount: 5, created_at: '2026-08-01' },
  ];
  const mappings = overrides.mappings || [
    { raw_name: '旧运营', raw_names: '["运营专员"]', mapped_name: '标准运营', responsible_person: 'HR A' },
    { raw_name: '待建岗位', raw_names: '[]', mapped_name: '尚未建档', responsible_person: 'HR A' },
    { raw_name: '神秘岗位', raw_names: '[]', mapped_name: '无法匹配', responsible_person: 'HR B' },
  ];
  const resumes = overrides.resumes || [
    { id: 'r1', position_id: 'p1', position_applied: '', mapped_position: '', parse_status: 'ai_screened' },
    { id: 'r2', position_id: '', position_applied: '旧运营', mapped_position: '', parse_status: 'ai_screened' },
    { id: 'r3', position_id: null, position_applied: '', mapped_position: '标准运营', parse_status: 'pending' },
    { id: 'r4', position_id: '', position_applied: '神秘岗位', mapped_position: '', parse_status: 'pending' },
    { id: 'r5', position_id: '', position_applied: '待建岗位', mapped_position: '', parse_status: 'pending' },
    { id: 'r6', position_id: 'p2', position_applied: '旧运营', mapped_position: '标准运营', parse_status: 'ai_screened' },
  ];

  return {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async all() {
              if (sql.includes('FROM positions')) {
                const owner = sql.includes('responsible_person = ?') ? values[0] : null;
                return { results: owner ? positions.filter((position) => position.responsible_person === owner) : positions };
              }
              if (sql.includes('FROM position_mappings')) {
                const owner = sql.includes('responsible_person = ?') ? values[0] : null;
                return { results: owner ? mappings.filter((mapping) => mapping.responsible_person === owner) : mappings };
              }
              if (sql.includes('FROM resumes')) {
                if (sql.includes('COUNT(*)')) {
                  const allowedIds = new Set(values.filter((value): value is string => typeof value === 'string'));
                  const direct = resumes.filter((resume) => resume.position_id && (!allowedIds.size || allowedIds.has(resume.position_id)));
                  const counts = new Map<string, { position_id: string; cnt: number; ai_screened: number }>();
                  for (const resume of direct) {
                    const row = counts.get(resume.position_id!) || { position_id: resume.position_id!, cnt: 0, ai_screened: 0 };
                    row.cnt += 1;
                    row.ai_screened += resume.parse_status === 'ai_screened' ? 1 : 0;
                    counts.set(resume.position_id!, row);
                  }
                  return { results: [...counts.values()] };
                }
                return { results: resumes };
              }
              if (/FROM (interviews|offers|onboarding_records)/.test(sql)) return { results: [] };
              throw new Error(`Unexpected SQL: ${sql}`);
            },
          };
        },
      };
    },
  };
}

describe('dashboard snapshot schema', () => {
  it('makes dashboard snapshots immutable in every bootstrap and migration definition', async () => {
    const sqlDefinitions = await Promise.all([
      readFile(resolve(process.cwd(), 'migrations/0010_dashboard_snapshots.sql'), 'utf8'),
      readFile(resolve(process.cwd(), 'schema.sql'), 'utf8'),
      readFile(resolve(process.cwd(), '../scripts/migration_dashboard_snapshots.sql'), 'utf8'),
    ]);

    for (const sql of sqlDefinitions) {
      expect(sql).toMatch(/CREATE TRIGGER IF NOT EXISTS prevent_dashboard_snapshot_update\s+BEFORE UPDATE ON dashboard_snapshots[\s\S]*?RAISE\(ABORT, 'dashboard snapshot is immutable'\)/);
      expect(sql).toMatch(/CREATE TRIGGER IF NOT EXISTS prevent_dashboard_snapshot_delete\s+BEFORE DELETE ON dashboard_snapshots[\s\S]*?RAISE\(ABORT, 'dashboard snapshot is immutable'\)/);
    }
  });
});

describe('dashboard snapshots', () => {
  it('writes only the first snapshot for a date', async () => {
    const db = createSnapshotDb();
    await expect(createDashboardSnapshot(db as never, '2026-08-02', { version: 'v2' } as never, 'cron', '2026-08-02T15:55:00.000Z'))
      .resolves.toMatchObject({ snapshot_date: '2026-08-02' });
    await expect(createDashboardSnapshot(db as never, '2026-08-02', { version: 'v2' } as never, 'cron', '2026-08-02T15:56:00.000Z'))
      .rejects.toThrow('snapshot already exists');
    await expect(readDashboardSnapshot(db as never, '2026-08-02')).resolves.toMatchObject({ version: 'v2' });
  });
});

describe('dashboard share links', () => {
  const now = new Date('2026-07-31T00:00:00.000Z');

  const liveBoardWith = (
    values: { total_resumes: number },
    mode: { dataMode: 'live' | 'snapshot'; snapshotDate?: string } = { dataMode: 'live' },
  ) => buildRecruitingBoard([{
    position_id: 'p1', division: 'A', hrbp: 'HR A', position: '运营', priority: 'P1', headcount: 1,
    total_resumes: values.total_resumes, ai_screened: 1, first_interview: 1, first_pass: 1, second_pass: 0, third_pass: 0,
    offers: 0, hired: 0, notes: '', status: '招聘中',
  }], { ...mode, updatedAt: now.toISOString() });

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

  it('requires a snapshot id only for snapshot links', () => {
    expect(() => assertShareDataMode('live', null)).not.toThrow();
    expect(() => assertShareDataMode('snapshot', 'snapshot-1')).not.toThrow();
    expect(() => assertShareDataMode('snapshot', null)).toThrow('snapshot_id is required');
  });

  it('uses the China calendar date for a snapshot', () => {
    expect(toShanghaiSnapshotDate(new Date('2026-08-02T15:55:00.000Z'))).toBe('2026-08-02');
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

  it('returns 404 instead of public data for an expired token', async () => {
    const fakeDb = {
      prepare: () => ({ bind: () => ({ first: async () => ({
        expires_at: '2026-07-30T00:00:00.000Z',
        revoked_at: null,
        scope_type: 'all',
        scope_ids: '[]',
      }) }) }),
    };

    const response = await getSharedBoard(fakeDb as never, 'expired-token', now);
    expect(response.status).toBe(404);
    expect(response.body).toBeNull();
  });

  it('returns only public aggregate fields for an active token', async () => {
    const fakeDb = {
      prepare: () => ({ bind: () => ({ first: async () => ({
        expires_at: null,
        revoked_at: null,
        scope_type: 'all',
        scope_ids: '[]',
      }) }) }),
    };
    const response = await getSharedBoard(fakeDb as never, 'live-token', now, async () => ({
      version: 'v1', updated_at: now.toISOString(), kpis: { total_resumes: 2, candidate_name: 'Private KPI', ai_evaluation: { hidden: true } },
      rows: [{ division: 'A', candidate_name: 'Private', positions: [{ position: '运营', total_resumes: 2, candidate_name: 'Private' }] }],
    }));

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ rows: [{ division: 'A', positions: [{ position: '运营' }] }] });
    expect(JSON.stringify(response.body)).not.toContain('Private');
    expect(response.body.kpis).toMatchObject({ total_resumes: 2 });
    expect(response.body.kpis).not.toHaveProperty('candidate_name');
  });

  it('returns stored aggregate JSON instead of fresh data for a snapshot link', async () => {
    const storedBoard = liveBoardWith(
      { total_resumes: 2 },
      { dataMode: 'snapshot', snapshotDate: '2026-08-01' },
    );
    Object.assign(storedBoard.divisions[0].positions[0], { email: 'candidate@example.com' });
    const fakeSnapshotDb = {
      prepare: (sql: string) => ({
        bind: () => ({
          first: async () => {
            if (sql.includes('FROM dashboard_share_links')) {
              return {
                expires_at: null,
                revoked_at: null,
                scope_type: 'all',
                scope_ids: '[]',
                data_mode: 'snapshot',
                snapshot_id: 'snapshot-1',
              };
            }
            if (sql.includes('FROM dashboard_snapshots')) return { payload_json: JSON.stringify(storedBoard) };
            throw new Error(`Unexpected SQL: ${sql}`);
          },
        }),
      }),
    };

    const response = await getSharedBoard(
      fakeSnapshotDb as never,
      'snapshot-token',
      now,
      async () => liveBoardWith({ total_resumes: 999 }),
    );

    expect(response.body).toMatchObject({ data_mode: 'snapshot', snapshot_date: '2026-08-01' });
    expect(response.body).toMatchObject({ totals: { total_resumes: 2 } });
    expect(JSON.stringify(response.body)).not.toContain('candidate@example.com');
  });

  it('recomputes public KPIs from a division-scoped share instead of exposing company totals', async () => {
    const fakeDb = { prepare: () => ({ bind: () => ({ first: async () => ({ expires_at: null, revoked_at: null, scope_type: 'divisions', scope_ids: '["A"]' }) }) }) };
    const response = await getSharedBoard(fakeDb as never, 'division-token', now, async () => ({
      version: 'v1', updated_at: now.toISOString(), kpis: { total_resumes: 99, active_positions: 99 },
      rows: [
        { division: 'A', positions: [{ position: '运营', status: '招聘中', headcount: 2, total_resumes: 3, first_interview: 1, offers: 1, hired: 0 }] },
        { division: 'B', positions: [{ position: '销售', status: '招聘中', headcount: 8, total_resumes: 96, first_interview: 5, offers: 5, hired: 2 }] },
      ],
    }));

    expect(response.body).toMatchObject({ kpis: { active_positions: 1, total_headcount: 2, total_resumes: 3, first_interview: 1, offers: 1, hired: 0 } });
    expect((response.body.rows as Array<{ division: string }>).map((row) => row.division)).toEqual(['A']);
  });

  it('passes an HR owner marker into public board loading so an HR share cannot read all owners', async () => {
    const fakeDb = { prepare: () => ({ bind: () => ({ first: async () => ({ expires_at: null, revoked_at: null, scope_type: 'all', scope_ids: '["__owner__:HR A"]' }) }) }) };
    let receivedScope: unknown;
    await getSharedBoard(fakeDb as never, 'hr-token', now, async (scope) => {
      receivedScope = scope;
      return { version: 'v1', updated_at: now.toISOString(), kpis: {}, rows: [] };
    });
    expect(receivedScope).toMatchObject({ owner: 'HR A', divisions: [] });
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
    expect(db.rows['resume-1'].approved_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
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

  it('normalizes an AI result to the seven weighted screening dimensions', () => {
    const dimensions = ['核心画像', '核心职责', '任职要求', '企业背景', '加分项', '关键词匹配', '避坑雷区']
      .map((name) => ({ name, score: 5, reason: '有跨团队经验' }));
    expect(enrichScreeningEvaluation(
      { dimensions },
      [],
      [{ field: 'age', operator: 'between', value: [22, 35] }],
      { age: null },
    )).toMatchObject({
      dimensions,
      weighted_score: 5,
      match_score: 5,
      screening_result: '通过',
      hard_requirement_result: { passed: true, unknown_items: ['age'] },
    });
  });

  it('drops non-screening model dimensions before applying gate rules', () => {
    expect(enrichScreeningEvaluation(
      {
        dimensions: [
          { name: '额外维度', score: 5, reason: '模型自行扩展' },
          { name: '核心画像', score: 4, reason: '符合画像' },
          { name: '核心职责', score: 4, reason: '履历符合' },
          { name: '任职要求', score: 4, reason: '具备条件' },
          { name: '企业背景', score: 4, reason: '背景匹配' },
          { name: '加分项', score: 4, reason: '有加分项' },
          { name: '关键词匹配', score: 5, reason: '关键词齐全' },
          { name: '避坑雷区', score: 5, reason: '无红旗' },
        ],
      },
      [
        { name: '业务', weight: 60, description: '业务理解' },
        { name: '沟通', weight: 40, description: '协作表达' },
      ],
    )).toMatchObject({
      dimensions: [
        { name: '核心画像', score: 4 },
        { name: '核心职责', score: 4 },
        { name: '任职要求', score: 4 },
        { name: '企业背景', score: 4 },
        { name: '加分项', score: 4 },
        { name: '关键词匹配', score: 5 },
        { name: '避坑雷区', score: 5 },
      ],
      configured_dimensions: [
        { name: '业务', weight: 60, description: '业务理解' },
        { name: '沟通', weight: 40, description: '协作表达' },
      ],
      weighted_score: 4,
      screening_result: '通过',
    });
  });
});

describe('recruiting board aggregation', () => {
  it('maps id-less resumes by position names and keeps unresolved records visible', async () => {
    const rows = await getDashboardPositionRowsForOwner(createDashboardRowsDb() as never, null);

    expect(rows.find((row) => row.position_id === 'p1')).toMatchObject({
      position: '标准运营',
      total_resumes: 3,
      ai_screened: 2,
    });
    expect(rows).toContainEqual(expect.objectContaining({
      position: '神秘岗位',
      total_resumes: 1,
      unmatched: true,
    }));
  });

  it('keeps id-less fallback and unmatched resume rows within the requested owner scope', async () => {
    const rows = await getDashboardPositionRowsForOwner(createDashboardRowsDb() as never, 'HR A');

    expect(rows.find((row) => row.position_id === 'p1')).toMatchObject({ total_resumes: 3 });
    expect(rows).toContainEqual(expect.objectContaining({ position: '待建岗位', unmatched: true, hrbp: 'HR A' }));
    expect(rows.some((row) => row.position === '神秘岗位')).toBe(false);
    expect(rows.some((row) => row.hrbp === 'HR B')).toBe(false);
  });

  it('excludes another owner\'s valid position id even when its names alias to the requested owner', async () => {
    const rows = await getDashboardPositionRowsForOwner(createDashboardRowsDb() as never, 'HR A');

    expect(rows.find((row) => row.position_id === 'p1')).toMatchObject({ total_resumes: 3, ai_screened: 2 });
    expect(rows.reduce((total, row) => total + row.total_resumes, 0)).toBe(4);
    expect(rows.some((row) => row.position_id === 'p2' || row.hrbp === 'HR B')).toBe(false);
  });

  it('keeps title and alias lookups ambiguous after three conflicting entries', async () => {
    const position = (id: string, title: string) => ({
      id, title, department: '职培', responsible_person: 'HR A', status: 'open', urgency: 'medium', headcount: 1, created_at: '2026-08-02',
    });
    const rows = await getDashboardPositionRowsForOwner(createDashboardRowsDb({
      positions: [
        position('duplicate-1', '重复岗位'),
        position('duplicate-2', '重复岗位'),
        position('duplicate-3', '重复岗位'),
        position('target-1', '目标一'),
        position('target-2', '目标二'),
        position('target-3', '目标三'),
      ],
      mappings: [
        { raw_name: '共享别名', raw_names: '[]', mapped_name: '目标一', responsible_person: 'HR A' },
        { raw_name: '共享别名', raw_names: '[]', mapped_name: '目标二', responsible_person: 'HR A' },
        { raw_name: '共享别名', raw_names: '[]', mapped_name: '目标三', responsible_person: 'HR A' },
      ],
      resumes: [
        { id: 'title-resume', position_id: '', position_applied: '重复岗位', mapped_position: '', parse_status: 'pending' },
        { id: 'alias-resume', position_id: '', position_applied: '共享别名', mapped_position: '', parse_status: 'pending' },
      ],
    }) as never, 'HR A');

    expect(rows.filter((row) => !row.unmatched).every((row) => row.total_resumes === 0)).toBe(true);
    expect(rows).toContainEqual(expect.objectContaining({
      position: '共享别名',
      total_resumes: 1,
      unmatched: true,
    }));
  });

  it('builds all dashboard levels and marks weekly completion unavailable', () => {
    const board = buildRecruitingBoard([{
      position_id: 'p1', division: '职培', hrbp: '王凯月', position: '销售', priority: 'P0', headcount: 2,
      total_resumes: 8, ai_screened: 6, first_interview: 4, first_pass: 3, second_pass: 2, third_pass: 1,
      offers: 1, hired: 1, notes: '', status: '招聘中',
    }], { dataMode: 'live', updatedAt: '2026-08-02T15:00:00.000Z' });

    expect(board.funnel.stages.map((item) => item.key)).toEqual([
      'resumes', 'ai_screened', 'first_interview', 'first_pass', 'second_pass', 'third_pass', 'offers', 'hired',
    ]);
    expect(board.divisions[0]).toMatchObject({ division: '职培', hrbps: ['王凯月'] });
    expect(board.hrbps[0]).toMatchObject({ hrbp: '王凯月', average_hiring_days: null });
    expect(board.kpis.weekly_requirement_completion).toEqual({ value: null, available: false });
  });

  it('uses third-pass divided by scheduled first interviews for the published pass rate', () => {
    const board = buildRecruitingBoard([{
      position_id: 'p1', division: 'A', hrbp: '', position: '运营', priority: 'P1', headcount: 1,
      total_resumes: 10, ai_screened: 8, first_interview: 8, first_pass: 5, second_pass: 3, third_pass: 2,
      offers: 1, hired: 1, notes: '', status: '招聘中',
    }], { dataMode: 'live', updatedAt: '2026-08-02T15:00:00.000Z' });

    expect(board.kpis.interview_pass_rate).toEqual({ value: 25, available: true });
  });

  it('publishes a zero pass rate when first interviews exist but none pass round three', () => {
    const board = buildRecruitingBoard([{
      position_id: 'p1', division: 'A', hrbp: 'HR A', position: '运营', priority: 'P1', headcount: 1,
      total_resumes: 10, ai_screened: 8, first_interview: 4, first_pass: 2, second_pass: 1, third_pass: 0,
      offers: 0, hired: 0, notes: '', status: '招聘中',
    }], { dataMode: 'live', updatedAt: '2026-08-02T15:00:00.000Z' });

    expect(board.totals.interview_pass_rate).toBe(0);
    expect(board.kpis.interview_pass_rate).toEqual({ value: 0, available: true });
    expect(board.divisions[0].interview_pass_rate).toBe(0);
    expect(board.hrbps[0].interview_pass_rate).toBe(0);
  });

  it('counts headcount only for active positions and exposes it as KPI auxiliary data', () => {
    const position = (position_id: string, status: string, headcount: number) => ({
      position_id, division: 'A', hrbp: 'HR A', position: position_id, priority: 'P1' as const, headcount,
      total_resumes: 0, ai_screened: 0, first_interview: 0, first_pass: 0, second_pass: 0, third_pass: 0,
      offers: 0, hired: 0, notes: '', status,
    });
    const board = buildRecruitingBoard([
      position('open', '招聘中', 2),
      position('draft', '草稿', 7),
      position('closed', '已完成', 11),
    ], { dataMode: 'live', updatedAt: '2026-08-02T15:00:00.000Z' });

    expect(board.totals).toMatchObject({ active_positions: 1, total_headcount: 2 });
    expect(board.divisions[0]).toMatchObject({ active_positions: 1, total_headcount: 2 });
    expect(board.hrbps[0]).toMatchObject({ active_positions: 1, total_headcount: 2 });
    expect(board.kpis.total_headcount).toEqual({ value: 2, available: true });
  });

  it('exposes seven displayed KPI cards plus auxiliary active-position headcount', () => {
    const board = buildRecruitingBoard([], { dataMode: 'live', updatedAt: '2026-08-02T15:00:00.000Z' });

    expect(Object.keys(board.kpis).sort()).toEqual([
      'active_positions',
      'first_interview',
      'hired',
      'interview_pass_rate',
      'offers',
      'total_headcount',
      'total_resumes',
      'weekly_requirement_completion',
    ]);
  });

  it('whitelists public v2 position fields before rebuilding scoped cards', () => {
    const board = buildRecruitingBoard([{
      position_id: 'p1', division: 'A', hrbp: 'HR A', position: '运营', priority: 'P1', headcount: 1,
      total_resumes: 10, ai_screened: 8, first_interview: 6, first_pass: 4, second_pass: 3, third_pass: 2,
      offers: 1, hired: 1, notes: 'public note', status: '招聘中',
      candidate_name: 'Private Candidate', contact: '13800000000', email: 'candidate@example.com',
      raw_text: 'private resume text', parsed_data: { age: 30 }, ai_evaluation: { hidden: true }, unknown_property: 'secret',
    } as unknown as Parameters<typeof buildRecruitingBoard>[0][number]], { dataMode: 'live', updatedAt: '2026-08-02T15:00:00.000Z' });

    const publicBoard = toPublicRecruitingBoard(board, { divisions: ['A'] });
    const serialized = JSON.stringify(publicBoard);

    for (const privateField of ['candidate_name', 'contact', 'email', 'raw_text', 'parsed_data', 'ai_evaluation', 'unknown_property']) {
      expect(serialized).not.toContain(privateField);
    }
  });

  it('uses a neutral deterministic insight when no funnel conversion can be calculated', () => {
    const board = buildRecruitingBoard([{
      position_id: 'p1', division: 'A', hrbp: '', position: '运营', priority: 'P1', headcount: 1,
      total_resumes: 0, ai_screened: 0, first_interview: 0, first_pass: 0, second_pass: 0, third_pass: 0,
      offers: 0, hired: 0, notes: '', status: '招聘中',
    }], { dataMode: 'live', updatedAt: '2026-08-02T15:00:00.000Z' });

    expect(board.insights.summary).toContain('暂无足够漏斗数据');
    expect(board.insights.bottlenecks).toContain('暂无足够漏斗数据');
  });

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

  it('uses the stored second-round result field and legacy round rows for pass counts', () => {
    expect(getBoardInterviewPassCondition(1)).toContain("result IN ('pass', 'passed')");
    expect(getBoardInterviewPassCondition(2)).toContain("result2 IN ('pass', 'passed')");
    expect(getBoardInterviewPassCondition(2)).toContain("round = 2 AND result IN ('pass', 'passed')");
    expect(getBoardInterviewPassCondition(3)).toContain("round = 3 AND result IN ('pass', 'passed')");
  });

  it('counts a first interview only once when it has a pass result', () => {
    expect(getBoardFirstInterviewCount(3, 2)).toBe(3);
  });

  it('does not let an HR user override their dashboard owner scope', () => {
    const hrContext = { get: () => ({ role: 'hr', full_name: 'HR A' }), req: { query: () => 'HR B' } };
    const adminContext = { get: () => ({ role: 'admin', full_name: 'Admin' }), req: { query: () => 'HR B' } };
    expect(getDashboardOwner(hrContext)).toBe('HR A');
    expect(getDashboardOwner(adminContext)).toBe('HR B');
  });

  it('uses an empty owner scope when a non-admin profile has no full name', () => {
    const incompleteHrContext = { get: () => ({ role: 'hr', full_name: '' }), req: { query: () => undefined } };
    expect(getDashboardOwner(incompleteHrContext)).toBe('__no_dashboard_owner__');
  });
});

function createSnapshotDb() {
  const snapshots = new Map<string, { id: string; payload_json: string }>();

  return {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first() {
              const snapshotDate = values[0] as string;
              const row = snapshots.get(snapshotDate);
              if (sql.includes('SELECT id FROM dashboard_snapshots')) return row ? { id: row.id } : null;
              if (sql.includes('SELECT payload_json FROM dashboard_snapshots')) return row ? { payload_json: row.payload_json } : null;
              throw new Error(`Unexpected SQL: ${sql}`);
            },
            async run() {
              if (!sql.includes('INSERT INTO dashboard_snapshots')) throw new Error(`Unexpected SQL: ${sql}`);
              const [id, snapshotDate, payloadJson] = values as [string, string, string];
              snapshots.set(snapshotDate, { id, payload_json: payloadJson });
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
}

function createApprovalDb() {
  const rows: Record<string, { id: string; status: string; stage: string; approved_at?: string }> = {
    'resume-1': { id: 'resume-1', status: 'pending_review', stage: 'screening' },
    'resume-2': { id: 'resume-2', status: 'approved', stage: 'talent_pool' },
  };
  const updatedIds: string[] = [];
  const operationLogIds: string[] = [];

  return {
    get updatedIds() { return updatedIds; },
    get operationLogIds() { return operationLogIds; },
    get rows() { return rows; },
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
              if (sql.includes('UPDATE resumes SET approved_at = ?')) {
                const id = values.at(-1) as string;
                rows[id] = { ...rows[id], approved_at: values[0] as string };
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
