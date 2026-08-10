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

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
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
    ? await db.prepare(
      'SELECT * FROM resume_screening_queue WHERE resume_id = ? ORDER BY updated_at DESC, created_at DESC LIMIT 1',
    ).bind(authoritativeResumeId).first<RawRecord>()
    : null;

  let recruitmentTask: RawRecord | null = null;
  const positionId = text(interview.position_id);
  if (positionId) {
    recruitmentTask = await db.prepare('SELECT * FROM recruitment_tasks WHERE id = ?')
      .bind(positionId).first<RawRecord>();
  }
  const positionName = text(resume?.mapped_position)
    || text(resume?.position_applied)
    || text(interview.position_applied);
  if (!recruitmentTask && positionName) {
    recruitmentTask = await db.prepare(
      'SELECT * FROM recruitment_tasks WHERE position_name = ? ORDER BY updated_at DESC LIMIT 1',
    ).bind(positionName).first<RawRecord>();
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
