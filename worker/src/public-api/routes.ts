import { Hono } from 'hono';
import {
  setPublicMode,
  pagination,
  PublicMode,
  resumeView,
  interviewView,
  positionView,
  pickFields,
  resolveInterviewerName,
  publicError,
  buildEducationFilter,
  buildAgeFilter,
  resumeEducation,
  resumeAge,
} from './helpers';

export interface PublicQueryRouteDeps {
  buildPersonResumeFilter: (db: any, name: string) => Promise<{ where: string; params: any[] }>;
}

export const PENDING_RESUME_STATUSES = ['pending_screening', 'pending_review', 'pending_dept_review', 'pending_hr_decision'];

/** 统一分页查询：表/列/排序均为代码内常量，用户输入只经 bind 参数传递 */
async function queryPage(db: any, opts: {
  table: string;
  cols: string;
  where: string;
  params: any[];
  orderBy: string;
  limit: number;
  offset: number;
}) {
  const { table, cols, where, params, orderBy, limit, offset } = opts;
  const countRow = await db.prepare(`SELECT COUNT(*) as cnt FROM ${table} WHERE ${where}`).bind(...params).first();
  const rows = await db.prepare(
    `SELECT ${cols} FROM ${table} WHERE ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
  ).bind(...params, limit, offset).all();
  return { total: countRow?.cnt ?? 0, rows: rows.results || [] };
}

function buildResumeWhere(c: any, personFilter?: { where: string; params: any[] }) {
  const clauses: string[] = [];
  const params: any[] = [];
  if (personFilter) {
    clauses.push(personFilter.where);
    params.push(...personFilter.params);
  }
  const q = (key: string) => c.req.query(key);
  const status = q('status');
  const stage = q('stage');
  const screening_result = q('screening_result');
  const keyword = q('keyword');
  const position_id = q('position_id');
  const position_applied = q('position_applied');
  const mapped_position = q('mapped_position');
  if (status) { clauses.push('status = ?'); params.push(status); }
  if (stage) { clauses.push('stage = ?'); params.push(stage); }
  if (screening_result) { clauses.push('screening_result = ?'); params.push(screening_result); }
  if (keyword) {
    clauses.push('(candidate_name LIKE ? OR position_applied LIKE ? OR mapped_position LIKE ?)');
    const like = `%${keyword}%`;
    params.push(like, like, like);
  }
  if (position_id) { clauses.push('position_id = ?'); params.push(position_id); }
  if (position_applied) { clauses.push('LOWER(position_applied) = LOWER(?)'); params.push(position_applied); }
  if (mapped_position) { clauses.push('LOWER(mapped_position) = LOWER(?)'); params.push(mapped_position); }
  return { where: clauses.length ? clauses.join(' AND ') : '1=1', params };
}

function resumeSelect(mode: PublicMode, needParsed: boolean): string {
  const cols = [
    'id', 'candidate_name', 'mapped_position', 'position_applied', 'status', 'stage',
    'match_score', 'screening_result', 'parse_status', 'created_at', 'updated_at',
  ];
  if (mode === 'full') cols.push('gender', 'education', 'birthday', 'work_experience', 'contact', 'email');
  if (needParsed && mode !== 'full') cols.push('education');
  if (needParsed) cols.push('parsed_data');
  return cols.join(', ');
}

export function createPublicQueryRoutes(deps: PublicQueryRouteDeps) {
  const app = new Hono<{ Bindings: any }>();
  app.use('/api/public/*', setPublicMode);

  const mode = (c: any): PublicMode => c.get('publicMode');

  // ==================== 岗位 ====================

  app.get('/api/public/positions', async (c) => {
    try {
      const m = mode(c);
      const { limit, offset } = pagination(c);
      const { status, keyword, responsible_person, department } = c.req.query();
      const clauses: string[] = ['1=1'];
      const params: any[] = [];
      if (status) { clauses.push('status = ?'); params.push(status); }
      if (department) { clauses.push('department = ?'); params.push(department); }
      if (responsible_person) { clauses.push('responsible_person = ?'); params.push(responsible_person); }
      if (keyword) {
        clauses.push('(title LIKE ? OR department LIKE ? OR description LIKE ?)');
        const like = `%${keyword}%`;
        params.push(like, like, like);
      }
      const { total, rows } = await queryPage(c.env.DB, {
        table: 'positions', cols: '*',
        where: clauses.join(' AND '), params,
        orderBy: 'created_at DESC, updated_at DESC', limit, offset,
      });
      return c.json({ total, limit, offset, items: (rows as any[]).map((r) => positionView(r, m)) });
    } catch (e: any) {
      return publicError(c, e, '查询岗位失败');
    }
  });

  // ==================== 简历 ====================

  app.get('/api/public/resumes', async (c) => {
    try {
      const m = mode(c);
      const { limit, offset } = pagination(c);
      const eduFilter = buildEducationFilter({
        education: c.req.query('education'),
        education_min: c.req.query('education_min'),
        education_max: c.req.query('education_max'),
      });
      const ageFilter = buildAgeFilter({
        age_min: c.req.query('age_min'),
        age_max: c.req.query('age_max'),
      });
      const needParsed = !!(eduFilter || ageFilter);
      const { where, params } = buildResumeWhere(c);

      if (!needParsed) {
        const { total, rows } = await queryPage(c.env.DB, {
          table: 'resumes', cols: resumeSelect(m, false),
          where, params, orderBy: 'created_at DESC, updated_at DESC', limit, offset,
        });
        return c.json({ total, limit, offset, items: (rows as any[]).map((r) => resumeView(r, m)) });
      }
      // 学历/年龄需读 parsed_data，先拉取匹配行再内存过滤（量小，上限 5000）
      const rows = await c.env.DB.prepare(
        `SELECT ${resumeSelect(m, true)} FROM resumes WHERE ${where} ORDER BY created_at DESC, updated_at DESC LIMIT 5000`,
      ).bind(...params).all();
      const filtered = ((rows.results || []) as any[]).filter((r) => {
        if (eduFilter && !eduFilter(resumeEducation(r))) return false;
        if (ageFilter) {
          const age = resumeAge(r);
          if (age == null || !ageFilter(age)) return false;
        }
        return true;
      });
      const items = filtered.slice(offset, offset + limit).map((r) => resumeView(r, m));
      return c.json({ total: filtered.length, limit, offset, items });
    } catch (e: any) {
      return publicError(c, e, '查询简历失败');
    }
  });

  app.get('/api/public/resumes/:id', async (c) => {
    try {
      const m = mode(c);
      const row = await c.env.DB.prepare('SELECT * FROM resumes WHERE id = ?').bind(c.req.param('id')).first();
      if (!row) return c.json({ detail: 'Not found' }, 404);
      const publicKeys = [
        'id', 'candidate_name', 'mapped_position', 'position_applied', 'status', 'stage',
        'match_score', 'screening_result', 'parse_status', 'gender', 'education',
        'created_at', 'updated_at',
      ];
      const fullKeys = [
        ...publicKeys, 'contact', 'email', 'birthday', 'work_experience', 'city',
        'remark', 'parsed_data', 'ai_evaluation', 'ai_review', 'raw_text', 'resume_markdown',
      ];
      const view = pickFields(row as any, m, publicKeys, fullKeys);
      if (m === 'full') {
        const pd = (row as any).parsed_data;
        if (pd && view.city === undefined) {
          try {
            const parsed = typeof pd === 'string' ? JSON.parse(pd) : pd;
            if (parsed && typeof parsed === 'object') {
              if (view.city === undefined && parsed.city) view.city = parsed.city;
              if (view.age === undefined && typeof parsed.age === 'number') view.age = parsed.age;
              if (view.gender === undefined && parsed.gender) view.gender = parsed.gender;
            }
          } catch { /* 非 JSON */ }
        }
      }
      return c.json(view);
    } catch (e: any) {
      return publicError(c, e, '查询简历详情失败');
    }
  });

  // ==================== 面试官 ====================

  async function interviewerAggregates(db: any) {
    const posMap: Record<string, number> = {};
    const ivMap: Record<string, number> = {};
    for (const col of ['responsible_person', 'primary_interviewer', 'secondary_interviewer']) {
      const rows = await db.prepare(`SELECT ${col} as n, COUNT(*) as c FROM positions GROUP BY ${col}`).all();
      for (const r of (rows.results || []) as any[]) {
        if (r.n) posMap[r.n] = (posMap[r.n] || 0) + (r.c || 0);
      }
    }
    for (const col of ['interviewer', 'primary_interviewer', 'secondary_interviewer']) {
      const ivRows = await db.prepare(
        `SELECT ${col} as n, COUNT(*) as c FROM interviews WHERE status IN ('scheduled','in_progress') GROUP BY ${col}`,
      ).all();
      for (const r of (ivRows.results || []) as any[]) {
        if (r.n) ivMap[r.n] = (ivMap[r.n] || 0) + (r.c || 0);
      }
    }
    return { posMap, ivMap };
  }

  app.get('/api/public/interviewers', async (c) => {
    try {
      const m = mode(c);
      const { limit, offset } = pagination(c);
      const keyword = (c.req.query('keyword') || '').trim();
      const names = await collectAllNames(c.env.DB);
      const openIdMap = await collectOpenIdMap(c.env.DB);
      const { posMap, ivMap } = await interviewerAggregates(c.env.DB);
      const taskCounts = await collectTaskCounts(c.env.DB);

      let list = names.map((name) => ({
        name,
        open_id: m === 'full' ? (openIdMap.get(name) || '') : undefined,
        position_count: posMap[name] || 0,
        pending_interview_count: ivMap[name] || 0,
        pending_task_count: taskCounts[name] || 0,
      }));
      if (keyword) list = list.filter((x) => x.name.includes(keyword) || (x.open_id || '').includes(keyword));
      list.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
      const items = list.slice(offset, offset + limit);
      return c.json({ total: list.length, limit, offset, items });
    } catch (e: any) {
      return publicError(c, e, '查询面试官失败');
    }
  });

  // ==================== 按人：待办（姓名容错） ====================
  // 注：GET /api/public/person/:name/resumes 由 index.ts 的既有路由处理（本处不重复注册，
  // 避免同名路由被后注册者覆盖）。

  app.get('/api/public/person/:name/todo', async (c) => {
    try {
      const m = mode(c);
      const name = (c.req.param('name') || '').trim();
      if (!name) return c.json({ detail: 'Not found' }, 404);
      const { limit, offset } = pagination(c);
      const resolved = await resolveInterviewerName(c.env.DB, name);
      if (!resolved.matched && resolved.candidates.length > 0) {
        return c.json({ person: name, matched: null, candidates: resolved.candidates });
      }
      const effectiveName = resolved.matched || name;

      const pendingFilter = await deps.buildPersonResumeFilter(c.env.DB, effectiveName);
      const pendingWhere = `${pendingFilter.where} AND status IN (${PENDING_RESUME_STATUSES.map(() => '?').join(',')})`;
      const pendingParams = [...pendingFilter.params, ...PENDING_RESUME_STATUSES];
      const aiWhere = `${pendingFilter.where} AND screening_result = ? AND status IN (${PENDING_RESUME_STATUSES.map(() => '?').join(',')})`;
      const aiParams = [...pendingFilter.params, '通过', ...PENDING_RESUME_STATUSES];
      const ivWhere = `${pendingFilter.where} AND status = ?`;
      const ivParams = [...pendingFilter.params, 'pending_interview'];

      const [pendingCnt, aiCnt, ivCnt] = await Promise.all([
        c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM resumes WHERE ${pendingWhere}`).bind(...pendingParams).first(),
        c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM resumes WHERE ${aiWhere}`).bind(...aiParams).first(),
        c.env.DB.prepare(`SELECT COUNT(*) as cnt FROM resumes WHERE ${ivWhere}`).bind(...ivParams).first(),
      ]);

      const [pendingRows, aiRows, ivRows] = await Promise.all([
        c.env.DB.prepare(
          `SELECT ${resumeSelect(m, false)} FROM resumes WHERE ${pendingWhere} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
        ).bind(...pendingParams, limit, offset).all(),
        c.env.DB.prepare(
          `SELECT ${resumeSelect(m, false)} FROM resumes WHERE ${aiWhere} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
        ).bind(...aiParams, limit, offset).all(),
        c.env.DB.prepare(
          `SELECT ${resumeSelect(m, false)} FROM resumes WHERE ${ivWhere} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
        ).bind(...ivParams, limit, offset).all(),
      ]);

      const taskWhere = '(responsible_person = ? OR interviewers LIKE ?)';
      const taskParams: any[] = [effectiveName, `%${effectiveName}%`];
      const taskCnt = await c.env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM recruitment_tasks WHERE ${taskWhere}`,
      ).bind(...taskParams).first();
      const taskRows = await c.env.DB.prepare(
        `SELECT id, position_name, status, assignee, due_date, notes, interviewers, responsible_person, city, created_at, updated_at
         FROM recruitment_tasks WHERE ${taskWhere} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      ).bind(...taskParams, limit, offset).all();

      const interviewWhere = `(interviewer = ? OR primary_interviewer = ? OR secondary_interviewer = ?) AND status IN ('scheduled','in_progress')`;
      const interviewParams = [effectiveName, effectiveName, effectiveName];
      const interviewCnt = await c.env.DB.prepare(
        `SELECT COUNT(*) as cnt FROM interviews WHERE ${interviewWhere}`,
      ).bind(...interviewParams).first();
      const interviewRows = await c.env.DB.prepare(
        `SELECT id, resume_id, position_id, candidate_name, position_applied, round, interview_time, started_at,
                interviewer, primary_interviewer, secondary_interviewer, interview_type, interview_category,
                interview_location, status, result, total_score, created_at
         FROM interviews WHERE ${interviewWhere} ORDER BY COALESCE(interview_time, started_at) ASC LIMIT ? OFFSET ?`,
      ).bind(...interviewParams, limit, offset).all();

      const taskKeys = [
        'id', 'position_name', 'status', 'assignee', 'due_date', 'notes',
        'interviewers', 'responsible_person', 'city', 'created_at', 'updated_at',
      ];

      return c.json({
        person: effectiveName,
        ...(effectiveName !== name ? { matched_from: name } : {}),
        summary: {
          pending_resumes: pendingCnt?.cnt ?? 0,
          ai_passed: aiCnt?.cnt ?? 0,
          pending_interview: ivCnt?.cnt ?? 0,
          recruitment_tasks: taskCnt?.cnt ?? 0,
          interviews: interviewCnt?.cnt ?? 0,
        },
        groups: {
          pending_resumes: { total: pendingCnt?.cnt ?? 0, limit, offset, items: (pendingRows.results || []).map((r: any) => resumeView(r, m)) },
          ai_passed: { total: aiCnt?.cnt ?? 0, limit, offset, items: (aiRows.results || []).map((r: any) => resumeView(r, m)) },
          pending_interview: { total: ivCnt?.cnt ?? 0, limit, offset, items: (ivRows.results || []).map((r: any) => resumeView(r, m)) },
          recruitment_tasks: { total: taskCnt?.cnt ?? 0, limit, offset, items: (taskRows.results || []).map((r: any) => pickFields(r, m, taskKeys)) },
          interviews: { total: interviewCnt?.cnt ?? 0, limit, offset, items: (interviewRows.results || []).map((r: any) => interviewView(r, m)) },
        },
      });
    } catch (e: any) {
      return publicError(c, e, '查询人员待办失败');
    }
  });

  // ==================== 招聘任务 ====================

  app.get('/api/public/recruitment-tasks', async (c) => {
    try {
      const { limit, offset } = pagination(c);
      const { status, responsible_person, interviewer } = c.req.query();
      const clauses: string[] = ['1=1'];
      const params: any[] = [];
      if (status) { clauses.push('status = ?'); params.push(status); }
      if (responsible_person) { clauses.push('responsible_person = ?'); params.push(responsible_person); }
      if (interviewer) { clauses.push('interviewers LIKE ?'); params.push(`%${interviewer}%`); }
      const { total, rows } = await queryPage(c.env.DB, {
        table: 'recruitment_tasks',
        cols: 'id, position_name, status, assignee, due_date, notes, interviewers, responsible_person, city, created_at, updated_at',
        where: clauses.join(' AND '), params,
        orderBy: 'created_at DESC, updated_at DESC', limit, offset,
      });
      return c.json({ total, limit, offset, items: rows });
    } catch (e: any) {
      return publicError(c, e, '查询招聘任务失败');
    }
  });

  // ==================== 面试 ====================

  app.get('/api/public/interviews', async (c) => {
    try {
      const m = mode(c);
      const { limit, offset } = pagination(c);
      const { status, interviewer, position_id, date_from, date_to, result } = c.req.query();
      const clauses: string[] = ['1=1'];
      const params: any[] = [];
      if (status) { clauses.push('status = ?'); params.push(status); }
      if (result) { clauses.push('result = ?'); params.push(result); }
      if (interviewer) {
        clauses.push('(interviewer = ? OR primary_interviewer = ? OR secondary_interviewer = ?)');
        params.push(interviewer, interviewer, interviewer);
      }
      if (position_id) { clauses.push('position_id = ?'); params.push(position_id); }
      if (date_from) { clauses.push('date(COALESCE(interview_time, started_at)) >= date(?)'); params.push(date_from); }
      if (date_to) { clauses.push('date(COALESCE(interview_time, started_at)) <= date(?)'); params.push(date_to); }
      const { total, rows } = await queryPage(c.env.DB, {
        table: 'interviews', cols: '*',
        where: clauses.join(' AND '), params,
        orderBy: 'COALESCE(interview_time, started_at) DESC, created_at DESC', limit, offset,
      });
      return c.json({ total, limit, offset, items: (rows as any[]).map((r) => interviewView(r, m)) });
    } catch (e: any) {
      return publicError(c, e, '查询面试失败');
    }
  });

  app.get('/api/public/interviews/:id', async (c) => {
    try {
      const m = mode(c);
      const row = await c.env.DB.prepare('SELECT * FROM interviews WHERE id = ?').bind(c.req.param('id')).first();
      if (!row) return c.json({ detail: 'Not found' }, 404);
      const publicKeys = [
        'id', 'resume_id', 'position_id', 'candidate_name', 'position_applied', 'round',
        'interviewer', 'primary_interviewer', 'secondary_interviewer', 'interview_time',
        'started_at', 'interview_type', 'interview_category', 'interview_location', 'status',
        'result', 'result2', 'status2', 'total_score', 'created_at',
      ];
      const fullKeys = [...publicKeys, 'comments', 'evaluation', 'evaluation2', 'panel_members', 'scores', 'suggestion'];
      return c.json(pickFields(row as any, m, publicKeys, fullKeys));
    } catch (e: any) {
      return publicError(c, e, '查询面试详情失败');
    }
  });

  // ==================== 人才库 ====================

  app.get('/api/public/talent-pool', async (c) => {
    try {
      const m = mode(c);
      const { limit, offset } = pagination(c);
      const { status, keyword } = c.req.query();
      const clauses: string[] = ['1=1'];
      const params: any[] = [];
      if (status) { clauses.push('status = ?'); params.push(status); }
      if (keyword) {
        clauses.push('(candidate_name LIKE ? OR current_title LIKE ? OR skills LIKE ?)');
        const like = `%${keyword}%`;
        params.push(like, like, like);
      }
      const { total, rows } = await queryPage(c.env.DB, {
        table: 'talent_pool', cols: '*',
        where: clauses.join(' AND '), params,
        orderBy: 'created_at DESC, updated_at DESC', limit, offset,
      });
      const publicKeys = [
        'id', 'resume_id', 'candidate_name', 'current_title', 'skills', 'experience_years',
        'education', 'expected_salary', 'source', 'tags', 'status', 'notes',
        'last_contacted_at', 'created_at', 'updated_at',
      ];
      const fullKeys = [...publicKeys, 'email', 'phone'];
      return c.json({ total, limit, offset, items: (rows as any[]).map((r) => pickFields(r, m, publicKeys, fullKeys)) });
    } catch (e: any) {
      return publicError(c, e, '查询人才库失败');
    }
  });

  // ==================== Offer ====================

  app.get('/api/public/offers', async (c) => {
    try {
      const m = mode(c);
      const { limit, offset } = pagination(c);
      const { status, position_id, keyword } = c.req.query();
      const clauses: string[] = ['1=1'];
      const params: any[] = [];
      if (status) { clauses.push('status = ?'); params.push(status); }
      if (position_id) { clauses.push('position_id = ?'); params.push(position_id); }
      if (keyword) { clauses.push('(candidate_name LIKE ? OR position_title LIKE ?)'); const like = `%${keyword}%`; params.push(like, like); }
      const { total, rows } = await queryPage(c.env.DB, {
        table: 'offers', cols: '*',
        where: clauses.join(' AND '), params,
        orderBy: 'created_at DESC, updated_at DESC', limit, offset,
      });
      const publicKeys = [
        'id', 'resume_id', 'position_id', 'candidate_name', 'position_title', 'department',
        'work_location', 'onboard_date', 'probation_months', 'status', 'created_at', 'updated_at',
      ];
      const fullKeys = [
        ...publicKeys, 'candidate_email', 'salary_monthly', 'salary_annual', 'salary_structure',
        'report_to', 'work_hours', 'benefits', 'bonus', 'special_terms', 'notes',
        'valid_until', 'sent_at', 'accepted_at', 'rejected_at', 'rejected_reason', 'created_by',
      ];
      return c.json({ total, limit, offset, items: (rows as any[]).map((r) => pickFields(r, m, publicKeys, fullKeys)) });
    } catch (e: any) {
      return publicError(c, e, '查询 Offer 失败');
    }
  });

  // ==================== 招聘需求 ====================

  app.get('/api/public/requisitions', async (c) => {
    try {
      const m = mode(c);
      const { limit, offset } = pagination(c);
      const { status, department } = c.req.query();
      const clauses: string[] = ['1=1'];
      const params: any[] = [];
      if (status) { clauses.push('status = ?'); params.push(status); }
      if (department) { clauses.push('department = ?'); params.push(department); }
      const { total, rows } = await queryPage(c.env.DB, {
        table: 'job_requisitions', cols: '*',
        where: clauses.join(' AND '), params,
        orderBy: 'created_at DESC, updated_at DESC', limit, offset,
      });
      const publicKeys = [
        'id', 'title', 'department', 'headcount', 'employment_type', 'salary_range', 'urgency',
        'expected_date', 'requested_by', 'status', 'approved_by', 'position_id', 'created_at', 'updated_at',
      ];
      const fullKeys = [...publicKeys, 'description', 'requirements', 'reporting_to', 'budget', 'channel_plan', 'rejection_reason', 'approved_at'];
      return c.json({ total, limit, offset, items: (rows as any[]).map((r) => pickFields(r, m, publicKeys, fullKeys)) });
    } catch (e: any) {
      return publicError(c, e, '查询招聘需求失败');
    }
  });

  // ==================== 入职 ====================

  app.get('/api/public/onboarding', async (c) => {
    try {
      const m = mode(c);
      const { limit, offset } = pagination(c);
      const { status, department } = c.req.query();
      const clauses: string[] = ['1=1'];
      const params: any[] = [];
      if (status) { clauses.push('status = ?'); params.push(status); }
      if (department) { clauses.push('department = ?'); params.push(department); }
      const { total, rows } = await queryPage(c.env.DB, {
        table: 'onboarding_records', cols: '*',
        where: clauses.join(' AND '), params,
        orderBy: 'created_at DESC, updated_at DESC', limit, offset,
      });
      const publicKeys = [
        'id', 'resume_id', 'position_id', 'candidate_name', 'position_title', 'department',
        'onboard_date', 'status', 'created_at', 'updated_at',
      ];
      const fullKeys = [
        ...publicKeys, 'offer_id', 'employee_id', 'contract_signed', 'contract_type', 'documents',
        'accounts_created', 'equipment_assigned', 'mentor_id', 'orientation_completed',
        'orientation_date', 'notes',
      ];
      return c.json({ total, limit, offset, items: (rows as any[]).map((r) => pickFields(r, m, publicKeys, fullKeys)) });
    } catch (e: any) {
      return publicError(c, e, '查询入职记录失败');
    }
  });

  // ==================== 试用期 ====================

  app.get('/api/public/probation', async (c) => {
    try {
      const m = mode(c);
      const { limit, offset } = pagination(c);
      const { result } = c.req.query();
      const clauses: string[] = ['1=1'];
      const params: any[] = [];
      if (result) { clauses.push('result = ?'); params.push(result); }
      const { total, rows } = await queryPage(c.env.DB, {
        table: 'probation_records', cols: '*',
        where: clauses.join(' AND '), params,
        orderBy: 'created_at DESC, updated_at DESC', limit, offset,
      });
      const publicKeys = [
        'id', 'onboarding_id', 'resume_id', 'position_id', 'employee_name',
        'probation_start', 'probation_end', 'probation_months', 'result', 'confirmed_at',
        'new_title', 'created_at', 'updated_at',
      ];
      const fullKeys = [...publicKeys, 'employee_id', 'monthly_reviews', 'final_assessment', 'confirmed_by', 'salary_adjustment', 'notes'];
      return c.json({ total, limit, offset, items: (rows as any[]).map((r) => pickFields(r, m, publicKeys, fullKeys)) });
    } catch (e: any) {
      return publicError(c, e, '查询试用期记录失败');
    }
  });

  // ==================== 背调 ====================

  app.get('/api/public/background-checks', async (c) => {
    try {
      const { limit, offset } = pagination(c);
      const { status } = c.req.query();
      const clauses: string[] = ['1=1'];
      const params: any[] = [];
      if (status) { clauses.push('status = ?'); params.push(status); }
      const { total, rows } = await queryPage(c.env.DB, {
        table: 'background_checks', cols: '*',
        where: clauses.join(' AND '), params,
        orderBy: 'created_at DESC, updated_at DESC', limit, offset,
      });
      return c.json({ total, limit, offset, items: rows });
    } catch (e: any) {
      return publicError(c, e, '查询背调失败');
    }
  });

  // ==================== 岗位映射 ====================

  app.get('/api/public/position-mappings', async (c) => {
    try {
      const { limit, offset } = pagination(c);
      const { total, rows } = await queryPage(c.env.DB, {
        table: 'position_mappings',
        cols: 'id, raw_name, raw_names, mapped_name, responsible_person, interviewers, created_at, updated_at',
        where: '1=1', params: [],
        orderBy: 'created_at DESC, updated_at DESC', limit, offset,
      });
      return c.json({ total, limit, offset, items: rows });
    } catch (e: any) {
      return publicError(c, e, '查询岗位映射失败');
    }
  });

  // ==================== 全局统计 ====================

  app.get('/api/public/overview', async (c) => {
    try {
      const db = c.env.DB;
      const q = (sql: string, params: any[] = []) => (params.length ? db.prepare(sql).bind(...params).first() : db.prepare(sql).first());
      const [ap, th, tr, si, ci, pi, of, hi, po] = await Promise.all([
        q("SELECT COUNT(*) as cnt FROM positions"),
        q("SELECT COALESCE(SUM(headcount),0) as cnt FROM positions"),
        q("SELECT COUNT(*) as cnt FROM resumes"),
        q("SELECT COUNT(*) as cnt FROM interviews WHERE status = 'scheduled'"),
        q("SELECT COUNT(*) as cnt FROM interviews WHERE status = 'completed'"),
        q("SELECT COUNT(*) as cnt FROM interviews WHERE result = 'pass' OR status2 = 'passed'"),
        q("SELECT COUNT(*) as cnt FROM offers WHERE status NOT IN ('draft','cancelled')"),
        q("SELECT COUNT(*) as cnt FROM onboarding_records WHERE status = 'onboarded'"),
        q("SELECT COUNT(*) as cnt FROM onboarding_records WHERE status = 'pending'"),
      ]);
      const num = (r: any) => r?.cnt || 0;
      const trVal = num(tr), siVal = num(si), ciVal = num(ci), piVal = num(pi), ofVal = num(of), hiVal = num(hi);
      const [totalReq, pendingReq, approvedReq, tpSize, obCnt, pbCnt, ivCnt, pendingCnt] = await Promise.all([
        q("SELECT COUNT(*) as cnt FROM job_requisitions"),
        q("SELECT COUNT(*) as cnt FROM job_requisitions WHERE status = 'pending'"),
        q("SELECT COUNT(*) as cnt FROM job_requisitions WHERE status = 'approved'"),
        q("SELECT COUNT(*) as cnt FROM talent_pool"),
        q("SELECT COUNT(*) as cnt FROM onboarding_records"),
        q("SELECT COUNT(*) as cnt FROM probation_records"),
        q("SELECT COUNT(*) as cnt FROM interviews"),
        q(`SELECT COUNT(*) as cnt FROM resumes WHERE status IN ('pending_screening','pending_review','pending_dept_review','pending_hr_decision')`),
      ]);
      const breakdownRows = await db.prepare('SELECT status, COUNT(*) as c FROM resumes GROUP BY status ORDER BY c DESC').all();
      return c.json({
        overview: {
          active_positions: num(ap),
          total_headcount: num(th),
          total_resumes: trVal,
          pending_resumes: num(pendingCnt),
          scheduled_interviews: siVal,
          push_conversion_rate: trVal > 0 ? Math.round(((siVal + ciVal) / trVal) * 100) : 0,
          interview_pass_rate: ciVal > 0 ? Math.round((piVal / ciVal) * 100) : 0,
          offers: ofVal,
          offer_conversion_rate: piVal > 0 ? Math.round((ofVal / piVal) * 100) : 0,
          hired: hiVal,
          hire_conversion_rate: ofVal > 0 ? Math.round((hiVal / ofVal) * 100) : 0,
          pending_onboarding: num(po),
        },
        funnel: {
          stages: [
            { name: '简历推送', count: trVal },
            { name: '安排面试', count: siVal + ciVal },
            { name: '面试通过', count: piVal },
            { name: '发放Offer', count: ofVal },
            { name: '已入职', count: hiVal },
          ],
        },
        resume_status_breakdown: (breakdownRows.results || []).reduce((acc: Record<string, number>, r: any) => {
          acc[r.status || 'unknown'] = r.c || 0;
          return acc;
        }, {}),
        hr_stats: {
          total_requisitions: num(totalReq),
          pending_requisitions: num(pendingReq),
          approved_requisitions: num(approvedReq),
          talent_pool_size: num(tpSize),
          onboarding_count: num(obCnt),
          probation_count: num(pbCnt),
        },
      });
    } catch (e: any) {
      return publicError(c, e, '查询全局统计失败');
    }
  });

  // ==================== 日报 ====================

  app.get('/api/public/daily-reports', async (c) => {
    try {
      const m = mode(c);
      const { limit, offset } = pagination(c);
      const { report_date, date_from, date_to } = c.req.query();
      const clauses: string[] = ['1=1'];
      const params: any[] = [];
      if (report_date) { clauses.push('report_date = ?'); params.push(report_date); }
      if (date_from) { clauses.push('report_date >= ?'); params.push(date_from); }
      if (date_to) { clauses.push('report_date <= ?'); params.push(date_to); }
      const { total, rows } = await queryPage(c.env.DB, {
        table: 'daily_reports', cols: '*',
        where: clauses.join(' AND '), params,
        orderBy: 'report_date DESC, created_at DESC', limit, offset,
      });
      const publicKeys = [
        'id', 'report_date', 'total_resumes', 'pending_screening', 'approved', 'rejected',
        'total_interviews', 'total_offers', 'total_onboarding', 'created_at', 'updated_at',
      ];
      const fullKeys = [...publicKeys, 'ai_summary', 'stats', 'candidate_details'];
      return c.json({ total, limit, offset, items: (rows as any[]).map((r) => pickFields(r, m, publicKeys, fullKeys)) });
    } catch (e: any) {
      return publicError(c, e, '查询日报失败');
    }
  });

  // ==================== 看板快照 ====================

  app.get('/api/public/snapshots', async (c) => {
    try {
      const m = mode(c);
      const { limit, offset } = pagination(c);
      const { total, rows } = await queryPage(c.env.DB, {
        table: 'dashboard_snapshots', cols: '*',
        where: '1=1', params: [],
        orderBy: 'snapshot_date DESC, created_at DESC', limit, offset,
      });
      const publicKeys = ['id', 'snapshot_date', 'generated_at', 'generated_by'];
      const fullKeys = [...publicKeys, 'payload_json'];
      return c.json({ total, limit, offset, items: (rows as any[]).map((r) => pickFields(r, m, publicKeys, fullKeys)) });
    } catch (e: any) {
      return publicError(c, e, '查询看板快照失败');
    }
  });

  // ==================== AI 用量 ====================

  app.get('/api/public/ai-usage', async (c) => {
    try {
      const { limit, offset } = pagination(c);
      const { date_from, date_to } = c.req.query();
      const clauses: string[] = ['1=1'];
      const params: any[] = [];
      if (date_from) { clauses.push('date >= ?'); params.push(date_from); }
      if (date_to) { clauses.push('date <= ?'); params.push(date_to); }
      const { total, rows } = await queryPage(c.env.DB, {
        table: 'ai_usage', cols: 'date, total_tokens, updated_at',
        where: clauses.join(' AND '), params,
        orderBy: 'date DESC', limit, offset,
      });
      const sumRow = await c.env.DB.prepare(
        `SELECT COALESCE(SUM(total_tokens),0) as total_tokens, COUNT(*) as days FROM ai_usage WHERE ${clauses.join(' AND ')}`,
      ).bind(...params).first();
      return c.json({ total, limit, offset, items: rows, totals: { total_tokens: sumRow?.total_tokens || 0, days: sumRow?.days || 0 } });
    } catch (e: any) {
      return publicError(c, e, '查询 AI 用量失败');
    }
  });

  return app;
}

// ==================== 面试官名单聚合（供列表接口使用） ====================

async function collectAllNames(db: any): Promise<string[]> {
  const set = new Set<string>();
  const add = (v: any) => {
    if (!v || typeof v !== 'string') return;
    for (const n of v.split(/[,，;；]/)) {
      const t = n.trim();
      if (t && t.length <= 20) set.add(t);
    }
  };
  try {
    const rows = await db.prepare('SELECT name FROM interviewer_mappings').all();
    for (const r of (rows.results || []) as any[]) add(r.name);
  } catch { /* 忽略 */ }
  try {
    const rows = await db.prepare('SELECT responsible_person, primary_interviewer, secondary_interviewer FROM positions').all();
    for (const r of (rows.results || []) as any[]) { add(r.responsible_person); add(r.primary_interviewer); add(r.secondary_interviewer); }
  } catch { /* 忽略 */ }
  try {
    const rows = await db.prepare('SELECT responsible_person, interviewers FROM recruitment_tasks').all();
    for (const r of (rows.results || []) as any[]) { add(r.responsible_person); add(r.interviewers); }
  } catch { /* 忽略 */ }
  try {
    const rows = await db.prepare('SELECT interviewer, primary_interviewer, secondary_interviewer FROM interviews').all();
    for (const r of (rows.results || []) as any[]) { add(r.interviewer); add(r.primary_interviewer); add(r.secondary_interviewer); }
  } catch { /* 忽略 */ }
  return [...set];
}

async function collectOpenIdMap(db: any): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const rows = await db.prepare('SELECT name, open_id FROM interviewer_mappings').all();
    for (const r of (rows.results || []) as any[]) {
      if (r.name && !map.has(r.name)) map.set(r.name, r.open_id || '');
    }
  } catch { /* 忽略 */ }
  return map;
}

async function collectTaskCounts(db: any): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  try {
    const rows = await db.prepare('SELECT responsible_person, interviewers FROM recruitment_tasks').all();
    for (const r of (rows.results || []) as any[]) {
      const names = new Set<string>();
      if (r.responsible_person) names.add(r.responsible_person);
      let arr: any = r.interviewers;
      if (typeof arr === 'string' && arr.length > 0) {
        try { arr = JSON.parse(arr); } catch { arr = r.interviewers.split(/[,，;；]/); }
      }
      if (Array.isArray(arr)) {
        for (const n of arr) {
          const t = String(n).trim();
          if (t) names.add(t);
        }
      }
      for (const n of names) counts[n] = (counts[n] || 0) + 1;
    }
  } catch { /* 忽略 */ }
  return counts;
}

export default createPublicQueryRoutes;
