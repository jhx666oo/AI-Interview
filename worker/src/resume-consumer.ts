import type { ResumeQueueMessage } from './resume-processing/types';
import { claimJob } from './resume-processing/job-repository';
import { processResume } from './resume-processing/processor';
import { resolveResumeText } from './resume-processing/ocr';
import { normalizeResumeFields } from './resume-processing/fields';
import { callAI, enrichScreeningEvaluation, extractJSON, getPositionContext } from './index';

export class RetryableResumeError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
  }
}

type QueueMessage = {
  body: ResumeQueueMessage;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
};

type ResumeConsumerDeps = {
  claim(jobId: string): Promise<unknown | null>;
  process(message: ResumeQueueMessage): Promise<void>;
  complete(jobId: string): Promise<void>;
  fail(jobId: string, error: Error): Promise<void>;
};

export async function handleResumeQueueMessage(
  message: QueueMessage,
  deps: ResumeConsumerDeps,
): Promise<void> {
  const job = await deps.claim(message.body.jobId);
  if (!job) {
    message.ack();
    return;
  }

  try {
    await deps.process(message.body);
    await deps.complete(message.body.jobId);
    message.ack();
  } catch (error) {
    if (error instanceof RetryableResumeError) {
      message.retry({ delaySeconds: 30 });
      return;
    }
    await deps.fail(message.body.jobId, error instanceof Error ? error : new Error(String(error)));
    message.ack();
  }
}

type ConsumerEnv = {
  DB: D1Database;
  AI_API_KEY: string;
  AI_BASE_URL: string;
  AI_MODEL?: string;
  AI_DAILY_TOKEN_LIMIT?: string;
  AI: Ai;
  MINERU_BASE?: string;
};

async function updateResume(db: D1Database, resumeId: string, update: Record<string, unknown>) {
  const keys = Object.keys(update);
  const set = keys.map((key) => `${key}=?`).join(', ');
  await db.prepare(`UPDATE resumes SET ${set}, updated_at=? WHERE id=?`)
    .bind(...keys.map((key) => update[key]), new Date().toISOString(), resumeId).run();
}

async function processWithD1(env: ConsumerEnv, message: ResumeQueueMessage): Promise<void> {
  await processResume(message, {
    getResume: async (id) => await env.DB.prepare('SELECT * FROM resumes WHERE id=?').bind(id).first() as any,
    getText: async (resume) => {
      const baseUrl = (env.MINERU_BASE || 'https://mineru.net').replace(/\/$/, '');
      const resolved = await resolveResumeText(resume as any, {
        getFile: async (resumeId) => await env.DB.prepare('SELECT content FROM resume_files WHERE id=?').bind(resumeId).first() as any,
        startOcr: async (content, resumeId) => {
          const sign = await fetch(`${baseUrl}/api/v1/agent/parse/file`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_name: `${resumeId}.pdf`, language: 'ch', is_ocr: true, enable_table: true, enable_formula: false }),
          });
          const data: any = await sign.json().catch(() => ({}));
          const taskId = data?.data?.task_id;
          const uploadUrl = data?.data?.file_url;
          if (!sign.ok || !taskId || !uploadUrl) throw new RetryableResumeError('OCR_SIGN_FAILED', data?.msg || 'MinerU 签名失败');
          const binary = Uint8Array.from(atob(content), (char) => char.charCodeAt(0));
          const upload = await fetch(uploadUrl, { method: 'PUT', body: binary });
          if (!upload.ok) throw new RetryableResumeError('OCR_UPLOAD_FAILED', 'MinerU 文件上传失败');
          return { taskId };
        },
        getOcrStatus: async (taskId) => {
          const response = await fetch(`${baseUrl}/api/v1/agent/parse/${taskId}`);
          const data: any = await response.json().catch(() => ({}));
          const state = data?.data?.state;
          if (!response.ok || !state) throw new RetryableResumeError('OCR_STATUS_FAILED', data?.msg || 'MinerU 状态查询失败');
          if (state === 'failed') return { state: 'failed' as const, error: data?.data?.err_msg || 'MinerU OCR 失败' };
          if (state !== 'done') return { state: 'processing' as const };
          const markdownUrl = data?.data?.markdown_url;
          if (!markdownUrl) return { state: 'failed' as const, error: 'MinerU 未返回 markdown' };
          const markdownResponse = await fetch(markdownUrl);
          if (!markdownResponse.ok) throw new RetryableResumeError('OCR_DOWNLOAD_FAILED', 'MinerU 结果下载失败');
          return { state: 'done' as const, markdown: await markdownResponse.text() };
        },
        update: (id, update) => updateResume(env.DB, id, update),
      });
      if (resolved.state === 'pending') throw new RetryableResumeError('OCR_PENDING', '扫描件 OCR 尚未完成');
      if (resolved.state === 'failed') throw new Error(resolved.error);
      return resolved.text.slice(0, 80000);
    },
    extractFields: async (text) => {
      const response = await callAI(env as any, '你是简历字段提取助手，只返回 JSON。', `从以下简历提取字段并严格使用这些英文键：name, phone, email, gender, birthday, highest_degree, school, major, years_of_experience, recent_company, current_position, skills, certifications, self_evaluation, work_experience, education。找不到填 null；skills、certifications、work_experience、education 使用数组。\n${text}`, 'deepseek-v4-flash');
      return normalizeResumeFields(extractJSON(response));
    },
    screen: async (text, fields, resume) => {
      const position = String(resume.position_applied || resume.mapped_position || '');
      const context = await getPositionContext(env.DB, position);
      const response = await callAI(env as any, '你是资深招聘评估 AI，只返回 JSON：{match_score,recommendation,summary,strengths,risks,suggested_questions,dimensions}。', `岗位：${context.standardPosition || position}\n能力维度：${context.capabilityDimensions}\n字段：${JSON.stringify(fields)}\n简历：${text}`, 'deepseek-v4-flash');
      const parsed = extractJSON(response);
      const evaluation = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : { summary: String(parsed || '') };
      const positionRow = await env.DB.prepare(
        'SELECT title, capability_dimensions FROM positions WHERE title = ? LIMIT 1'
      ).bind(context.standardPosition || position).first() as any;
      let hardRequirements: any[] = [];
      try {
        const requisition = await env.DB.prepare(
          'SELECT hard_requirements FROM job_requisitions WHERE title = ? LIMIT 1'
        ).bind(positionRow?.title || context.standardPosition || position).first() as any;
        const value = requisition?.hard_requirements;
        const parsedRequirements = typeof value === 'string' ? JSON.parse(value) : value;
        hardRequirements = Array.isArray(parsedRequirements) ? parsedRequirements : [];
      } catch {}
      const enrichedEvaluation = enrichScreeningEvaluation(
        evaluation,
        positionRow?.capability_dimensions || [],
        hardRequirements,
        fields,
      );
      const score = Number(enrichedEvaluation.match_score ?? 0);
      await updateResume(env.DB, message.resumeId, {
        ai_review: JSON.stringify(enrichedEvaluation),
        match_score: Number.isFinite(score) ? score : null,
        screening_result: score >= 75 ? '通过' : score >= 60 ? '存疑' : '淘汰',
      });
      return enrichedEvaluation;
    },
    updateResume: (id, update) => updateResume(env.DB, id, update),
    setJobStep: async (jobId, step) => {
      await env.DB.prepare("UPDATE resume_processing_jobs SET step=?, updated_at=? WHERE id=? AND status='running'")
        .bind(step, new Date().toISOString(), jobId).run();
    },
  });
}

export default {
  async queue(batch: MessageBatch<ResumeQueueMessage>, env: ConsumerEnv): Promise<void> {
    for (const message of batch.messages) {
      await handleResumeQueueMessage(message, {
        claim: (jobId) => claimJob(env.DB, jobId),
        process: (payload) => processWithD1(env, payload),
        complete: async (jobId) => {
          const timestamp = new Date().toISOString();
          await env.DB.prepare("UPDATE resume_processing_jobs SET status='completed', completed_at=?, updated_at=? WHERE id=? AND status='running'")
            .bind(timestamp, timestamp, jobId).run();
        },
        fail: async (jobId, error) => {
          await env.DB.prepare("UPDATE resume_processing_jobs SET status='failed', error_code=?, error_message=?, updated_at=? WHERE id=?")
            .bind('PROCESSING_FAILED', error.message.slice(0, 500), new Date().toISOString(), jobId).run();
          await env.DB.prepare("UPDATE resumes SET parse_status='failed', parse_error=?, updated_at=? WHERE id=?")
            .bind(error.message.slice(0, 500), new Date().toISOString(), message.body.resumeId).run();
        },
      });
    }
  },
} satisfies ExportedHandler<ConsumerEnv, ResumeQueueMessage>;
