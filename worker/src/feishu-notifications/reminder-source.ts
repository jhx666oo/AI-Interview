type RawRecord = Record<string, unknown>;

export interface LoadedInterviewReminderSource {
  interview: RawRecord;
  resume: RawRecord | null;
  screening: RawRecord | null;
  recruitmentTask: RawRecord | null;
}

function sourceError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function isOptionalSchemaCompatibilityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /no such (?:table|column)|has no column named/i.test(message);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function optionalFirst(
  db: D1Database,
  sql: string,
  value: string,
): Promise<RawRecord | null> {
  try {
    return await db.prepare(sql).bind(value).first<RawRecord>();
  } catch (error) {
    if (isOptionalSchemaCompatibilityError(error)) return null;
    throw error;
  }
}

function uniqueOpenId(rows: RawRecord[]): string | null {
  const openIds = [...new Set(rows.map((row) => text(row.open_id || row.feishu_open_id)).filter(Boolean))];
  if (openIds.length > 1) {
    throw sourceError(
      'AMBIGUOUS_INTERVIEWER_BINDING',
      '存在多个同名面试官绑定，请在面试官管理中清理重复映射后重试。',
    );
  }
  return openIds[0] || null;
}

export async function resolveExactInterviewerOpenId(
  db: D1Database,
  name: string,
): Promise<string | null> {
  let mappings: RawRecord[] = [];
  try {
    const rows = await db.prepare(
      "SELECT open_id FROM interviewer_mappings WHERE name = ? AND open_id IS NOT NULL AND open_id != ''",
    ).bind(name).all<RawRecord>();
    mappings = rows.results;
  } catch (error) {
    if (!isOptionalSchemaCompatibilityError(error)) throw error;
  }
  const mappedOpenId = uniqueOpenId(mappings);
  if (mappedOpenId) return mappedOpenId;

  const users = await db.prepare(
    "SELECT feishu_open_id FROM users WHERE full_name = ? AND feishu_open_id IS NOT NULL AND feishu_open_id != ''",
  ).bind(name).all<RawRecord>();
  return uniqueOpenId(users.results);
}

export async function loadInterviewReminderSource(
  db: D1Database,
  interviewId: string,
): Promise<LoadedInterviewReminderSource | null> {
  const interview = await db.prepare('SELECT * FROM interviews WHERE id = ?')
    .bind(interviewId).first<RawRecord>();
  if (!interview) return null;

  let resume: RawRecord | null = null;
  const resumeId = text(interview.resume_id);
  if (resumeId) {
    resume = await db.prepare('SELECT * FROM resumes WHERE id = ?').bind(resumeId).first<RawRecord>();
  } else {
    const candidateName = text(interview.candidate_name);
    if (candidateName) {
      const matches = await db.prepare(
        'SELECT * FROM resumes WHERE candidate_name = ? ORDER BY updated_at DESC, created_at DESC LIMIT 2',
      ).bind(candidateName).all<RawRecord>();
      if (matches.results.length > 1) {
        throw sourceError(
          'AMBIGUOUS_RESUME',
          '存在多份同名简历，请先在面试记录中关联正确的简历后重试。',
        );
      }
      resume = matches.results[0] || null;
    }
  }

  const authoritativeResumeId = text(resume?.id);
  const screening = authoritativeResumeId
    ? await optionalFirst(db,
      'SELECT * FROM resume_screening_queue WHERE resume_id = ? ORDER BY updated_at DESC, created_at DESC LIMIT 1',
      authoritativeResumeId)
    : null;

  let recruitmentTask: RawRecord | null = null;
  const positionId = text(interview.position_id);
  if (positionId) {
    recruitmentTask = await optionalFirst(db, 'SELECT * FROM recruitment_tasks WHERE id = ?', positionId);
  }
  const positionName = text(resume?.mapped_position)
    || text(resume?.position_applied)
    || text(interview.position_applied);
  if (!recruitmentTask && positionName) {
    recruitmentTask = await optionalFirst(db,
      'SELECT * FROM recruitment_tasks WHERE position_name = ? ORDER BY updated_at DESC LIMIT 1',
      positionName);
  }

  return { interview, resume, screening, recruitmentTask };
}

export function resolveReminderInterviewer(
  interview: RawRecord,
  requestedName?: string,
): string | null {
  const names = [interview.primary_interviewer, interview.secondary_interviewer, interview.interviewer]
    .flatMap((value) => text(value).split(/[,，、/;；]/))
    .map((value) => value.trim())
    .filter(Boolean);
  const allowed = [...new Set(names)];
  const requested = text(requestedName);
  if (requested) return allowed.includes(requested) ? requested : null;
  return allowed[0] || null;
}
