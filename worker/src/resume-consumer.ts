import type { ResumeQueueMessage } from './resume-processing/types';
import { claimJob } from './resume-processing/job-repository';
import { processResume } from './resume-processing/processor';
import { resolveResumeText } from './resume-processing/ocr';
import { normalizeResumeFields } from './resume-processing/fields';
import { missingDimensionNames, normalizeDimensionScores } from './resume-processing/dimension-scores';
import { callAI, enrichScreeningEvaluation, extractJSON, getPositionContext, normalizeCapabilityDimensions, resolvePositionTitle } from './index';
import { ArtifactRepository } from './resume-storage/artifact-repository';
import { EventRepository } from './recruitment-events/repository';
import { ResumeSearchDocumentGenerator } from './resume-search/document-generator';
import { ResumeSearchServiceImpl } from './resume-search/search-service';
import { R2ArtifactStore } from './resume-storage/r2-artifact-store';

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
  resetJob(jobId: string): Promise<void>;
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
      await deps.resetJob(message.body.jobId);
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
  RESUMES_KV?: KVNamespace;
  RESUME_ARTIFACTS?: R2Bucket;
  R2_ARTIFACT_READ?: string;
  R2_ARTIFACT_WRITE?: string;
};

async function updateResume(db: D1Database, resumeId: string, update: Record<string, unknown>) {
  const keys = Object.keys(update);
  const set = keys.map((key) => `${key}=?`).join(', ');
  await db.prepare(`UPDATE resumes SET ${set}, updated_at=? WHERE id=?`)
    .bind(...keys.map((key) => update[key]), new Date().toISOString(), resumeId).run();
}


// 简历 PDF 读取：KV 优先（新数据），D1 content 兜底（旧数据）
async function getResumeFileContent(env: ConsumerEnv, resumeId: string): Promise<{ content: string } | null> {
  const row: any = await env.DB.prepare('SELECT content, kv_key FROM resume_files WHERE id=?').bind(resumeId).first();
  if (row?.content) return { content: row.content };
  const kv = env.RESUMES_KV;
  if (kv) {
    const value = await kv.get(row?.kv_key || 'kv_' + resumeId, 'arrayBuffer');
    if (value) {
      const bytes = new Uint8Array(value);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      return { content: btoa(binary) };
    }
  }
  return null;
}

async function processWithD1(env: ConsumerEnv, message: ResumeQueueMessage): Promise<void> {
  await processResume(message, {
    getResume: async (id) => await env.DB.prepare('SELECT * FROM resumes WHERE id=?').bind(id).first() as any,
    getText: async (resume) => {
      const baseUrl = (env.MINERU_BASE || 'https://mineru.net').replace(/\/$/, '');
      const resolved = await resolveResumeText(resume as any, {
        getFile: (resumeId) => getResumeFileContent(env, resumeId),
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
          const upload = await fetch(uploadUrl, { method: 'PUT', body: binary, headers: { 'Content-Type': '' } });
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
      // 第一步：基础筛选（match_score + recommendation + summary + strengths + risks）
      const screeningResponse = await callAI(env as any,
        '你是资深招聘评估AI，只返回JSON。根据简历文本和岗位信息，评估人岗匹配度。',
        `岗位：${context.standardPosition || position}\n简历：${text}\n字段：${JSON.stringify(fields)}\n请返回JSON：{"match_score":0-100,"recommendation":"strongly_recommend/recommend/neutral/not_recommend/strongly_not_recommend","summary":"综合分析（中文2-3句）","strengths":"优势分析（中文）","risks":"风险点（中文）","suggested_questions":["问题1","问题2"]}`,
        'deepseek-v4-flash'
      );
      const parsed = extractJSON(screeningResponse);
      const evaluation = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : { summary: String(parsed || '') };

      // 第二步：加载岗位完整信息（含能力维度描述、岗位职责、个性化需求）
      const resolvedTitle = await resolvePositionTitle(env.DB, context.standardPosition || position);
      let posDescription = '', posRequirements = '', personalizedReqs = '';
      let configuredDimensions: any[] = [];
      try {
        const posRow = await env.DB.prepare(
          'SELECT title, description, requirements, personalized_requirements, capability_dimensions FROM positions WHERE title = ? LIMIT 1'
        ).bind(resolvedTitle).first() as any;
        if (posRow) {
          posDescription = posRow.description || '';
          posRequirements = posRow.requirements || '';
          personalizedReqs = posRow.personalized_requirements || '';
          configuredDimensions = normalizeCapabilityDimensions(posRow.capability_dimensions || []);
        }
      } catch {}
      // 从 capability_dimensions 独立表补充
      try {
        const dimRow = await env.DB.prepare(
          'SELECT dimensions_json, personalized_requirements FROM capability_dimensions WHERE position_name = ? LIMIT 1'
        ).bind(resolvedTitle).first() as any;
        if (dimRow?.dimensions_json) {
          const extraDims = normalizeCapabilityDimensions(dimRow.dimensions_json);
          if (extraDims.length > 0) configuredDimensions = extraDims;
        }
        if (dimRow?.personalized_requirements && !personalizedReqs) {
          personalizedReqs = dimRow.personalized_requirements;
        }
      } catch {}

      // 第三步：能力维度专项评分（使用详细提示词，含维度描述、岗位职责、个性化需求）
      if (configuredDimensions.length > 0) {
        try {
          const dimsText = configuredDimensions.map((d: any) => {
            let text = '  - ' + d.name;
            if (d.weight) text += '（权重' + Math.round(d.weight) + '%）';
            if (d.description) text += '：' + d.description;
            return text;
          }).join('\n');
          const dutyParts: string[] = [];
          if (posDescription) dutyParts.push('岗位职责：\n' + posDescription);
          if (posRequirements) dutyParts.push('岗位要求：\n' + posRequirements);
          if (personalizedReqs) dutyParts.push('个性化需求：\n' + personalizedReqs);
          const dutyText = dutyParts.join('\n\n');

          const dimensionPrompt = '# 人才能力评估AI打分提示词\n\n' +
            '## 角色定位\n' +
            '你是一名专业的人才能力量化评估专家，具备严谨客观的评分准则与标准化输出能力。' +
            '你的核心任务是**100%基于PDF解析后的原文内容**，对照指定的能力维度清单逐项打分，' +
            '评分需紧密结合岗位职责要求与招聘方个性化需求，最终输出**可直接用于前端页面渲染的标准化结构化数据**，' +
            '禁止输出任何无依据的主观推断与补充信息。\n\n' +
            '## 核心评分规则\n' +
            '### 基础准则\n' +
            '- **原文唯一依据原则**：仅以简历文本中明确表述的经历、成果、技能、资质为评分依据；原文未提及的维度，统一标记为「信息不足」，不得随意赋分或主观推断。\n' +
            '- **岗位对标原则**：每项能力的评分高低，需结合岗位职责对该能力的要求层级与应用场景判断。\n' +
            '- **需求加权原则**：个性化需求中明确强调的核心维度，需严格提高评估标准，并在评分说明中重点标注匹配程度。\n' +
            '- **统一分制规则**：全程采用1-5分整数评分制\n' +
            '  - 5分：远超岗位要求，具备深度经验与可验证的突出成果\n' +
            '  - 4分：完全满足岗位要求，具备明确的相关实践经验\n' +
            '  - 3分：基本符合岗位要求，有一定基础但经验深度不足\n' +
            '  - 2分：仅部分匹配要求，相关经验薄弱\n' +
            '  - 1分：完全不符合岗位要求\n' +
            '  - N/A：原文无对应信息，无法评估\n\n' +
            '## 输出格式\n' +
            '只返回JSON数组，不要markdown代码块：\n' +
            '{"dimensions":[{"name":"维度名","score":1-5或N/A,"reason":"评分依据（中文，引用原文）"}]}\n\n' +
            '## 输入材料\n' +
            '### 简历原文\n' + text + '\n\n' +
            '### 已提取字段\n' + JSON.stringify(fields, null, 2) + '\n\n' +
            '### 能力维度清单（需逐项评估）\n' + dimsText + '\n\n' +
            '### 岗位职责与要求\n' + dutyText + '\n\n' +
            '### 个性化需求\n' + (personalizedReqs || '无');

          const dimResponse = await callAI(
            env as any,
            '你是专业人才能力量化评估专家，只返回JSON。必须严格遵循评分规则，逐项评分所有维度，不得遗漏。',
            dimensionPrompt,
            'deepseek-v4-flash',
          );
          const dimParsed = extractJSON(dimResponse);
          const dimScores = normalizeDimensionScores(dimParsed?.dimensions || dimParsed || []);
          if (dimScores.length > 0) {
            evaluation.dimensions = dimScores;
          }
        } catch (error) {
          console.error('[ResumeConsumer] dimension scoring failed:', error);
        }
      }

      // 第四步：检查缺失维度并补充
      const missingDimensions = missingDimensionNames(configuredDimensions.map((item: any) => item.name), evaluation);
      if (missingDimensions.length > 0) {
        try {
          const supplemental = await callAI(
            env as any,
            '你是招聘评估专家，只返回 JSON。必须为每个给定能力维度评分，不能返回空数组。',
            '候选人简历原文：\n' + text + '\n\n请只返回 {"dimensions":[{"name":"维度名","score":1-5或"N/A","reason":"一句中文依据"}]}。必须且只能逐项评分以下维度：' + missingDimensions.join('、') + '。',
            'deepseek-v4-flash',
          );
          const scores = normalizeDimensionScores(extractJSON(supplemental));
          if (scores.length > 0) {
            const existing = normalizeDimensionScores(evaluation);
            const existingNames = new Set(existing.map((item: any) => item.name));
            evaluation.dimensions = [...existing, ...scores.filter((item: any) => !existingNames.has(item.name))];
          }
        } catch (error) {
          console.error('[ResumeConsumer] supplemental dimension scoring failed:', error);
        }
      }

      // 第五步：加载硬性要求、整合结果
      let hardRequirements: any[] = [];
      try {
        const requisition = await env.DB.prepare(
          'SELECT hard_requirements FROM job_requisitions WHERE title = ? LIMIT 1'
        ).bind(resolvedTitle).first() as any;
        const value = requisition?.hard_requirements;
        const parsedRequirements = typeof value === 'string' ? JSON.parse(value) : value;
        hardRequirements = Array.isArray(parsedRequirements) ? parsedRequirements : [];
      } catch {}
      const enrichedEvaluation = enrichScreeningEvaluation(
        evaluation,
        configuredDimensions,
        hardRequirements,
        fields,
      );
      const score = Number((enrichedEvaluation as any).match_score ?? 0);
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

async function processWithR2(env: ConsumerEnv, message: ResumeQueueMessage): Promise<void> {
  await processResume(message, {
    getResume: async (id) => await env.DB.prepare('SELECT * FROM resumes WHERE id=?').bind(id).first() as any,
    getText: async (resume) => {
      const baseUrl = (env.MINERU_BASE || 'https://mineru.net').replace(/\/$/, '');
      const artifactRepo = new ArtifactRepository(env.DB);
      const r2Store = new R2ArtifactStore((env as any).RESUME_ARTIFACTS);
      const resolved = await resolveResumeText(resume as any, {
        getFile: async (resumeId) => {
          // Try R2 first
          const artifact = await artifactRepo.getCurrentByType(resumeId, 'pdf');
          if (artifact) {
            const obj = await r2Store.get(artifact.objectKey);
            if (obj) {
              const bytes = await obj.arrayBuffer();
              const binary = new Uint8Array(bytes);
              let binaryStr = '';
              for (let i = 0; i < binary.length; i++) {
                binaryStr += String.fromCharCode(binary[i]);
              }
              return { content: btoa(binaryStr) };
            }
          }
          // Fallback to KV / D1
          return getResumeFileContent(env, resumeId);
        },
        startOcr: async (content, resumeId) => {
          const sign = await fetch(`\${baseUrl}/api/v1/agent/parse/file`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_name: `\${resumeId}.pdf`, language: 'ch', is_ocr: true, enable_table: true, enable_formula: false }),
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
          const response = await fetch(`\${baseUrl}/api/v1/agent/parse/\${taskId}`);
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
      return resolved.text;
    },
    extractFields: async (text, resume) => {
      const response = await callAI(env as any, '你是一个简历解析专家。请从简历文本中提取结构化字段，只返回 JSON。', `从以下简历文本中提取字段：姓名、最高学历、学校、专业、工作年限、性别、年龄、技能列表、期望职位、期望薪资、工作经历摘要、证书。只返回 JSON 对象，不要包含其他文字。\n\${text}`, 'deepseek-v4-flash');
      return normalizeResumeFields(extractJSON(response));
    },
    screen: async (text, fields, resume) => {
      const position = String(resume.position_applied || resume.mapped_position || '');
      const context = await getPositionContext(env.DB, position);
      const response = await callAI(env as any, '你是资深招聘评估 AI，只返回 JSON：{match_score,recommendation,summary,strengths,risks,suggested_questions,dimensions}。', `岗位：\${context.standardPosition || position}\n能力维度：\${context.capabilityDimensions}\n字段：\${JSON.stringify(fields)}\n简历：\${text}`, 'deepseek-v4-flash');
      const parsed = extractJSON(response);
      const evaluation = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : { summary: String(parsed || '') };
      const resolvedTitle = await resolvePositionTitle(env.DB, context.standardPosition || position);
      const positionRow = await env.DB.prepare(
        'SELECT title, capability_dimensions FROM positions WHERE title = ? LIMIT 1'
      ).bind(resolvedTitle).first() as any;
      const configuredDimensions = normalizeCapabilityDimensions(positionRow?.capability_dimensions || []);
      const missingDimensions = missingDimensionNames(configuredDimensions.map((item: any) => item.name), evaluation);
      if (missingDimensions.length > 0) {
        try {
          const supplemental = await callAI(
            env as any,
            '你是招聘评估专家，只返回 JSON。必须为每个给定能力维度评分，不能返回空数组。',
            `候选人简历：\n\${text}\n\n请只返回 {"dimensions":[{"name":"维度名","score":0-5,"reason":"一句中文依据"}]}。必须且只能逐项评分以下维度：\${missingDimensions.join('、')}。`,
            'deepseek-v4-flash',
          );
          const scores = normalizeDimensionScores(extractJSON(supplemental));
          if (scores.length > 0) {
            const existing = normalizeDimensionScores(evaluation);
            const existingNames = new Set(existing.map((item: any) => item.name));
            evaluation.dimensions = [...existing, ...scores.filter((item: any) => !existingNames.has(item.name))];
          }
        } catch (error) {
          console.error('[ResumeConsumer] supplemental dimension scoring failed:', error);
        }
      }
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
        configuredDimensions,
        hardRequirements,
        fields,
      );
      const score = Number(enrichedEvaluation.match_score ?? 0);
      await updateResume(env.DB, message.resumeId, {
        ai_review: JSON.stringify(enrichedEvaluation),
        match_score: Number.isFinite(score) ? score : null,
        screening_result: score >= 75 ? '通过' : score >= 60 ? '存疑' : '淘汰',
      });

      // 搜索文档生成（当 RESUME_HYBRID_SEARCH=true 时）
      const searchEnabled = ((env as any).RESUME_HYBRID_SEARCH || '').toLowerCase() === 'true';
      if (searchEnabled) {
        try {
          const generator = new ResumeSearchDocumentGenerator();
          const doc = await generator.generate(message.resumeId, { db: env.DB });
          if (doc) {
            const searchService = new ResumeSearchServiceImpl(env as any);
            await searchService.requestIndex(message.resumeId, doc.version);
          }
        } catch (e) {
          console.error('[Search] document generation failed:', e);
        }
      }
      // 事件记录：AI 初筛完成
      const eventsEnabled = ((env as any).RECRUITMENT_EVENTS || '').toLowerCase() === 'true';
      if (eventsEnabled) {
        try {
          const eventRepo = new EventRepository(env.DB);
          await eventRepo.append({
            resumeId: message.resumeId,
            stage: 'ai_screened',
            action: 'ai_complete',
            source: 'system',
            dedupeKey: `system:${message.resumeId}:ai_screened:ai_complete`,
            metadata: { matchScore: score, screeningResult: score >= 75 ? '通过' : score >= 60 ? '存疑' : '淘汰' },
          });
        } catch (e) {
          console.error('[Event] ai_screened recording failed:', e);
        }
      }
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
    const r2Enabled = ((env as any).R2_ARTIFACT_READ || '').toLowerCase() === 'true';
    for (const message of batch.messages) {
      await handleResumeQueueMessage(message, {
        claim: (jobId) => claimJob(env.DB, jobId),
        process: (payload) => r2Enabled ? processWithR2(env, payload) : processWithD1(env, payload),
        resetJob: async (jobId) => {
        const timestamp = new Date().toISOString();
        await env.DB.prepare("UPDATE resume_processing_jobs SET status='queued', updated_at=? WHERE id=? AND status='running'").bind(timestamp, jobId).run();
      },
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
