import type { ResumeProcessingQueueMessage, ResumeQueueMessage } from './resume-processing/types';
import { failHistoricalResumeReprocessBatch, processHistoricalResumeReprocessPage } from './resume-processing/reprocess';
import { assertJobRunning, claimJob, ResumeProcessingCancelledError, updateJobAIDiagnostics } from './resume-processing/job-repository';
import { syncReprocessBatchItemByJob } from './resume-processing/batch-repository';
import { processResume } from './resume-processing/processor';
import { resolveResumeText } from './resume-processing/ocr';
import { normalizeResumeFields } from './resume-processing/fields';
import { logResumeProcessing, logResumeProcessingError } from './resume-processing/logging';
import { assembleScreeningEvaluation, missingDimensionNames, normalizeDimensionScores, requireCompleteScreeningEvaluation, type DimensionScore } from './resume-processing/dimension-scores';
import { buildScreeningRepairPrompt, parseStructuredOutput, type StructuredOutputFailureCode, type StructuredOutputResult } from './resume-processing/structured-output';
import { callAI, callAIWithMetadata, enrichScreeningEvaluation, extractJSON, getAIPrompt, getPositionContext, normalizeCapabilityDimensions, resolvePositionTitle } from './index';
import { buildPositionScreeningContextText, buildPositionSpecificScreeningRule, WEIGHTED_SCREENING_DIMENSION_NAMES, WEIGHTED_SCREENING_PROMPT } from './resume-processing/weighted-screening';
import { ArtifactRepository } from './resume-storage/artifact-repository';
import { EventRepository } from './recruitment-events/repository';
import { ResumeSearchDocumentGenerator } from './resume-search/document-generator';
import { ResumeSearchServiceImpl } from './resume-search/search-service';
import { R2ArtifactStore } from './resume-storage/r2-artifact-store';
import { aiScreeningResultFromScore } from './ai-screening-result';

export class RetryableResumeError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
  }
}

const PAGE_LIMIT_ERROR_PATTERNS = [
  'file page count exceeds API limit',
  'page count exceeds',
  '-30003',
];

export function isPageLimitError(error: unknown): boolean {
  const msg = String(error ?? '').toLowerCase();
  return PAGE_LIMIT_ERROR_PATTERNS.some((p) => msg.includes(p.toLowerCase()));
}

export function classifyResumeError(code: string, message: string): Error {
  if (isPageLimitError(message)) {
    const classified = new Error(`OCR_PAGE_LIMIT_EXCEEDED: ${message.slice(0, 200)}`);
    (classified as any).code = 'OCR_PAGE_LIMIT_EXCEEDED';
    return classified;
  }
  if (code === 'OCR_PENDING' || code === 'OCR_STATUS_FAILED') {
    return new RetryableResumeError(code, message);
  }
  return new Error(message);
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
  onComplete?: (jobId: string) => Promise<void>,
  onFail?: (jobId: string, error: Error) => Promise<void>,
  onRetry?: (jobId: string) => Promise<void>,
): Promise<void> {
  logResumeProcessing('consumer.claim.start', {
    jobId: message.body.jobId,
    resumeId: message.body.resumeId,
  });
  const job = await deps.claim(message.body.jobId);
  if (!job) {
    logResumeProcessing('consumer.claim.skip', {
      jobId: message.body.jobId,
      resumeId: message.body.resumeId,
      reason: 'not_active',
    });
    message.ack();
    return;
  }
  logResumeProcessing('consumer.claim.ok', { jobId: message.body.jobId, resumeId: message.body.resumeId });

  try {
    logResumeProcessing('consumer.process.start', { jobId: message.body.jobId, resumeId: message.body.resumeId });
    await deps.process(message.body);
    logResumeProcessing('consumer.process.ok', { jobId: message.body.jobId, resumeId: message.body.resumeId });
    await deps.complete(message.body.jobId);
    if (onComplete) await onComplete(message.body.jobId).catch(() => undefined);
    logResumeProcessing('consumer.complete.ok', { jobId: message.body.jobId, resumeId: message.body.resumeId });
    message.ack();
  } catch (error) {
    if (error instanceof RetryableResumeError) {
      logResumeProcessingError('consumer.process.retry', error, {
        jobId: message.body.jobId,
        resumeId: message.body.resumeId,
        retryDelaySeconds: 30,
      });
      await deps.resetJob(message.body.jobId);
      if (onRetry) await onRetry(message.body.jobId).catch(() => undefined);
      message.retry({ delaySeconds: 30 });
      return;
    }
    if (error instanceof ResumeProcessingCancelledError) {
      // 批次停止后 in-flight AI 不应写回结果；直接 ack，不把 job 标失败。
      logResumeProcessingError('resume_processing.cancelled_before_write', error, {
        jobId: message.body.jobId,
        resumeId: message.body.resumeId,
      });
      message.ack();
      return;
    }
    logResumeProcessingError('consumer.process.fail', error, {
      jobId: message.body.jobId,
      resumeId: message.body.resumeId,
    });
    await deps.fail(message.body.jobId, error instanceof Error ? error : new Error(String(error)));
    if (onFail) await onFail(message.body.jobId, error instanceof Error ? error : new Error(String(error))).catch(() => undefined);
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
  RESUME_PROCESSING_QUEUE: Queue<ResumeProcessingQueueMessage>;
};

function cleanBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

export function buildR2OcrSignRequest(baseUrl: string, resumeId: string) {
  return { url: `${cleanBaseUrl(baseUrl)}/api/v1/agent/parse/file`, fileName: `${resumeId}.pdf` };
}

export function buildR2OcrStatusUrl(baseUrl: string, taskId: string): string {
  return `${cleanBaseUrl(baseUrl)}/api/v1/agent/parse/${taskId}`;
}

export function buildR2ExtractionPrompt(text: string): string {
  return `从以下简历文本中提取字段：姓名、最高学历、学校、专业、工作年限、性别、年龄、技能列表、期望职位、期望薪资、工作经历摘要、证书。只返回 JSON 对象，不要包含其他文字。\n${text}`;
}

export function buildR2ScreeningPrompt(input: {
  position: string;
  capabilityDimensions: string;
  fields: Record<string, unknown>;
  text: string;
}): string {
  return `岗位：${input.position}\n能力维度：${input.capabilityDimensions}\n字段：${JSON.stringify(input.fields)}\n简历：${input.text}`;
}

export function buildR2SupplementalPrompt(text: string, missingDimensions: string[]): string {
  return `候选人简历：\n${text}\n\n请只返回 {"dimensions":[{"name":"维度名","score":0-5,"reason":"一句中文依据"}]}。必须且只能逐项评分以下维度：${missingDimensions.join('、')}。`;
}

async function updateResume(db: D1Database, resumeId: string, update: Record<string, unknown>) {
  const keys = Object.keys(update);
  const set = keys.map((key) => `${key}=?`).join(', ');
  await db.prepare(`UPDATE resumes SET ${set}, updated_at=? WHERE id=?`)
    .bind(...keys.map((key) => update[key]), new Date().toISOString(), resumeId).run();
}

// —— 结构化输出修复编排（D1 / R2 两条消费者路径复用）——
async function repairStructuredOutput(
  env: ConsumerEnv,
  kind: 'screening' | 'dimensions',
  raw: string,
  failureCode: StructuredOutputFailureCode,
): Promise<string> {
  const prompt = buildScreeningRepairPrompt(kind, raw, failureCode);
  return callAI(env as any, prompt.system, prompt.user, 'deepseek-v4-flash', {
    structured: true,
    temperature: 0,
    maxTokens: 4096,
  });
}

function classifyAIResponseShape(text: string, finishReason?: string | null): string {
  const trimmed = String(text || '').trim();
  if (!trimmed) return 'empty_content';
  if (finishReason === 'length') return 'truncated_candidate';
  if (trimmed.startsWith('```')) return 'markdown_json_candidate';
  if (trimmed.startsWith('{')) return 'json_object_candidate';
  if (trimmed.startsWith('[')) return 'json_array_candidate';
  return 'text_prefix';
}

async function parseScreeningResponse(
  env: ConsumerEnv,
  response: string,
): Promise<StructuredOutputResult> {
  return parseStructuredOutput(
    response,
    'screening',
    extractJSON,
    (input) => repairStructuredOutput(env, input.kind, input.raw, input.failureCode),
  );
}

async function tryParseDimensionScores(
  env: ConsumerEnv,
  response: string,
): Promise<{ scores: DimensionScore[]; ok: boolean }> {
  try {
    const parsed = await parseStructuredOutput(
      response,
      'dimensions',
      extractJSON,
      (input) => repairStructuredOutput(env, input.kind, input.raw, input.failureCode),
    );
    return { scores: normalizeDimensionScores(parsed.value), ok: true };
  } catch {
    return { scores: [], ok: false };
  }
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
    assertJobRunning: (jobId) => assertJobRunning(env.DB, jobId),
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
      if (resolved.state === 'failed') throw classifyResumeError('OCR_FAILED', resolved.error || 'MinerU OCR 失败');
      return resolved.text.slice(0, 80000);
    },
    extractFields: async (text) => {
      const extractPrompt = await getAIPrompt(env as any, 'resume_extract_fields', {
        system: '你是简历字段提取助手，只返回 JSON。',
        user: '从以下简历提取字段并严格使用这些英文键：name, phone, email, gender, birthday, highest_degree, school, major, years_of_experience, recent_company, current_position, skills, certifications, self_evaluation, work_experience, education。找不到填 null；skills、certifications、work_experience、education 使用数组。\n\n{resume_text}'
      });
      const userText = extractPrompt.user.replace('{resume_text}', text);
      const response = await callAI(env as any, extractPrompt.system, userText, undefined, {
        structured: true,
        temperature: 0,
        maxTokens: 4096,
      });
      return normalizeResumeFields(extractJSON(response));
    },
    screen: async (text, fields, resume) => {
      const position = String(resume.position_applied || resume.mapped_position || '');
      const context = await getPositionContext(env.DB, position);
      // 第一步：基础筛选（match_score + recommendation + summary + strengths + risks）
      const screenPrompt = await getAIPrompt(env as any, 'resume_screening', {
        system: `你是资深招聘评估AI，只返回JSON。${WEIGHTED_SCREENING_PROMPT}`,
        user: '岗位：{position}\n岗位职责与要求：{job_description}\n个性化要求：{personalized_requirements}\n能力维度：{capability_dimensions}\n简历：{resume_text}\n字段：{fields}\n\n请返回JSON：{"match_score":"非权威参考值","recommendation":"strongly_recommend/recommend/neutral/not_recommend/strongly_not_recommend","summary":"综合分析（中文2-3句）","strengths":"优势分析（中文）","risks":"风险点（中文）","suggested_questions":["问题1","问题2"],"dimensions":[{"name":"七个指定维度之一","score":0,"reason":"中文依据"}]}'
      });
      const screenUserText = screenPrompt.user
        .replace('{position}', context.standardPosition || position)
        .replace('{job_description}', `${context.description || ''}\n${context.requirements || ''}`.trim())
        .replace('{personalized_requirements}', context.personalizedRequirements || '无')
        .replace('{resume_text}', text)
        .replace('{fields}', JSON.stringify(fields))
        .replace('{capability_dimensions}', context.capabilityDimensions || '');
      const positionContextText = buildPositionScreeningContextText({
        standardPosition: context.standardPosition || position,
        description: context.description,
        requirements: context.requirements,
        personalizedRequirements: context.personalizedRequirements,
        capabilityDimensions: context.capabilityDimensions,
      });
      const positionSpecificRule = buildPositionSpecificScreeningRule({
        standardPosition: context.standardPosition || position,
        description: context.description,
        requirements: context.requirements,
        personalizedRequirements: context.personalizedRequirements,
        capabilityDimensions: context.capabilityDimensions,
      });
      const finalScreenUserText = [screenUserText, positionContextText, positionSpecificRule]
        .filter(Boolean)
        .join('\n\n');
      const screeningResult = await callAIWithMetadata(
        env as any,
        screenPrompt.system,
        finalScreenUserText,
        'deepseek-v4-flash',
        { structured: true, temperature: 0, maxTokens: 8192 },
      );
      await updateJobAIDiagnostics(env.DB, message.jobId, {
        provider: screeningResult.metadata.provider,
        model: screeningResult.metadata.model,
        attempt: screeningResult.metadata.attempt,
        responseChars: screeningResult.metadata.responseChars,
        finishReason: screeningResult.metadata.finishReason,
        contentChars: screeningResult.metadata.contentChars,
        reasoningChars: screeningResult.metadata.reasoningChars,
        responseShape: classifyAIResponseShape(screeningResult.text, screeningResult.metadata.finishReason),
        formatAttempt: 1,
        repairStatus: 'not_started',
      });
      let evaluation: Record<string, any>;
      try {
        const parsed = await parseScreeningResponse(env, screeningResult.text);
        evaluation = parsed.value as Record<string, any>;
        await updateJobAIDiagnostics(env.DB, message.jobId, {
          formatAttempt: parsed.diagnostics.repairAttempted ? 2 : 1,
          repairStatus: parsed.diagnostics.repairAttempted ? 'succeeded' : 'not_needed',
        });
      } catch (error) {
        await updateJobAIDiagnostics(env.DB, message.jobId, {
          errorStage: 'structured_validation',
          responseChars: screeningResult.metadata.responseChars,
          formatAttempt: 2,
          repairStatus: 'failed',
        });
        logResumeProcessingError('ai.screening.validation_failed', error, {
          resumeId: message.resumeId,
          provider: screeningResult.metadata.provider,
          model: screeningResult.metadata.model,
          attempt: screeningResult.metadata.attempt,
          responseChars: screeningResult.metadata.responseChars,
          failureCode: (error as any)?.code,
        });
        throw error;
      }

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
      const screeningDimensions = WEIGHTED_SCREENING_DIMENSION_NAMES.map((name) => configuredDimensions.find((item: any) => item.name === name) || { name, weight: 0, description: '' });
      if (screeningDimensions.length > 0) {
        try {
          const dimsText = screeningDimensions.map((d: any) => {
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

          const supplementPrompt = await getAIPrompt(env as any, 'resume_screening_supplement', {
            system: `你是专业人才能力量化评估专家，只返回JSON。${WEIGHTED_SCREENING_PROMPT}`,
            user: dimensionPrompt
          });
          // 替换自定义提示词中的变量标签
          let supUserText = supplementPrompt.user;
          if (supUserText.includes('{resume_text}')) supUserText = supUserText.replace('{resume_text}', text);
          if (supUserText.includes('{fields}')) supUserText = supUserText.replace('{fields}', JSON.stringify(fields, null, 2));
          if (supUserText.includes('{capability_dimensions}')) supUserText = supUserText.replace('{capability_dimensions}', dimsText);
          if (supUserText.includes('{job_description}')) supUserText = supUserText.replace('{job_description}', dutyText);
          if (supUserText.includes('{personalized_requirements}')) supUserText = supUserText.replace('{personalized_requirements}', personalizedReqs || '无');
          const positionSpecificRule = buildPositionSpecificScreeningRule({
            standardPosition: resolvedTitle,
            description: posDescription,
            requirements: posRequirements,
            personalizedRequirements: personalizedReqs,
            capabilityDimensions: dimsText,
          });
          if (positionSpecificRule) supUserText += `\n\n${positionSpecificRule}`;
          const dimResponse = await callAI(
            env as any,
            supplementPrompt.system,
            supUserText,
            'deepseek-v4-flash',
            { structured: true, temperature: 0, maxTokens: 4096 },
          );
          // 专项维度只补主评估缺失项，绝不覆盖完整主评估
          const { scores: dimScores, ok: dimOk } = await tryParseDimensionScores(env, dimResponse);
          if (dimOk && dimScores.length > 0) {
            evaluation = assembleScreeningEvaluation(evaluation, dimScores);
          } else {
            logResumeProcessingError('ai.screening.supplement_invalid', new Error('supplement dimensions invalid after one repair'), {
              resumeId: message.resumeId,
            });
          }
        } catch (error) {
          console.error('[ResumeConsumer] dimension scoring failed:', error);
        }
      }

      // 第四步：检查缺失维度并补充
      const missingDimensions = missingDimensionNames([...WEIGHTED_SCREENING_DIMENSION_NAMES], evaluation);
      if (missingDimensions.length > 0) {
        try {
          const supplementPrompt = await getAIPrompt(env as any, 'resume_screening_supplement', {
            system: `你是招聘评估专家，只返回 JSON。${WEIGHTED_SCREENING_PROMPT}`,
            user: '候选人简历原文：\n{resume_text}\n\n请只返回 {"dimensions":[{"name":"维度名","score":1-5,"reason":"一句中文依据"}]}。必须且只能逐项评分以下维度：{missing_dimensions}。'
          });
          const supUserText = supplementPrompt.user
            .replace('{resume_text}', text)
            .replace('{missing_dimensions}', missingDimensions.join('、'));
          const positionSpecificRule = buildPositionSpecificScreeningRule({
            standardPosition: resolvedTitle,
            description: posDescription,
            requirements: posRequirements,
            personalizedRequirements: personalizedReqs,
            capabilityDimensions: configuredDimensions.map((item: any) => `${item.name || ''}：${item.description || ''}`).join('\n'),
          });
          const finalSupUserText = positionSpecificRule ? `${supUserText}\n\n${positionSpecificRule}` : supUserText;
          const supplemental = await callAI(
            env as any,
            supplementPrompt.system,
            finalSupUserText,
            'deepseek-v4-flash',
            { structured: true, temperature: 0, maxTokens: 4096 },
          );
          // 服务端最低要求是完整七项维度，不按 configuredDimensions 过滤
          const { scores, ok } = await tryParseDimensionScores(env, supplemental);
          if (ok && scores.length > 0) {
            evaluation = assembleScreeningEvaluation(evaluation, scores);
          } else {
            logResumeProcessingError('ai.screening.supplement_invalid', new Error('missing dimension supplement invalid'), {
              resumeId: message.resumeId,
            });
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
      const completeEvaluation = requireCompleteScreeningEvaluation(evaluation);
      const enrichedEvaluation = enrichScreeningEvaluation(
        completeEvaluation,
        configuredDimensions,
        hardRequirements,
        fields,
      );
      const score = enrichedEvaluation.weighted_score ?? null;
      // in-flight 保护：批次停止后不允许把本次评估写回简历
      await assertJobRunning(env.DB, message.jobId);
      await updateResume(env.DB, message.resumeId, {
        ai_review: JSON.stringify(enrichedEvaluation),
        ai_evaluation: JSON.stringify(enrichedEvaluation),
        match_score: score,
        screening_result: enrichedEvaluation.screening_result,
      });
      return enrichedEvaluation;
    },

    updateResume: (id, update) => updateResume(env.DB, id, update),
    setJobStep: async (jobId, step) => {
      await env.DB.prepare("UPDATE resume_processing_jobs SET step=?, updated_at=? WHERE id=? AND status='running'")
        .bind(step, new Date().toISOString(), jobId).run();
      await syncReprocessBatchItemByJob(env.DB, jobId, { status: 'running', step }).catch(() => undefined);
    },
  });
}

async function processWithR2(env: ConsumerEnv, message: ResumeQueueMessage): Promise<void> {
  await processResume(message, {
    assertJobRunning: (jobId) => assertJobRunning(env.DB, jobId),
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
          const request = buildR2OcrSignRequest(baseUrl, resumeId);
          const sign = await fetch(request.url, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_name: request.fileName, language: 'ch', is_ocr: true, enable_table: true, enable_formula: false }),
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
          const response = await fetch(buildR2OcrStatusUrl(baseUrl, taskId));
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
      if (resolved.state === 'failed') throw classifyResumeError('OCR_FAILED', resolved.error || 'MinerU OCR 失败');
      return resolved.text;
    },
    extractFields: async (text, resume) => {
      const r2ExtractPrompt = await getAIPrompt(env as any, 'resume_extract_fields', {
        system: '你是一个简历解析专家。请从简历文本中提取结构化字段，只返回 JSON。',
        user: '从以下简历文本中提取字段：姓名、最高学历、学校、专业、工作年限、性别、年龄、技能列表、期望职位、期望薪资、工作经历摘要、证书。只返回 JSON 对象，不要包含其他文字。\n\n{resume_text}'
      });
      const r2ExtractUser = r2ExtractPrompt.user.replace('{resume_text}', text);
      const response = await callAI(env as any, r2ExtractPrompt.system, r2ExtractUser, undefined, {
        structured: true,
        temperature: 0,
        maxTokens: 4096,
      });
      return normalizeResumeFields(extractJSON(response));
    },
    screen: async (text, fields, resume) => {
      const position = String(resume.position_applied || resume.mapped_position || '');
      const context = await getPositionContext(env.DB, position);
      const r2ScreenPrompt = await getAIPrompt(env as any, 'resume_screening', {
        system: `你是资深招聘评估 AI，只返回 JSON。${WEIGHTED_SCREENING_PROMPT}`,
        user: '岗位：{position}\n岗位职责与要求：{job_description}\n个性化要求：{personalized_requirements}\n能力维度：{capability_dimensions}\n字段：{fields}\n简历：{resume_text}'
      });
      const r2ScreenUser = r2ScreenPrompt.user
        .replace('{position}', context.standardPosition || position)
        .replace('{job_description}', `${context.description || ''}\n${context.requirements || ''}`.trim())
        .replace('{personalized_requirements}', context.personalizedRequirements || '无')
        .replace('{capability_dimensions}', context.capabilityDimensions)
        .replace('{fields}', JSON.stringify(fields))
        .replace('{resume_text}', text);
      const r2PositionContextText = buildPositionScreeningContextText({
        standardPosition: context.standardPosition || position,
        description: context.description,
        requirements: context.requirements,
        personalizedRequirements: context.personalizedRequirements,
        capabilityDimensions: context.capabilityDimensions,
      });
      const r2PositionSpecificRule = buildPositionSpecificScreeningRule({
        standardPosition: context.standardPosition || position,
        description: context.description,
        requirements: context.requirements,
        personalizedRequirements: context.personalizedRequirements,
        capabilityDimensions: context.capabilityDimensions,
      });
      const finalR2ScreenUser = [r2ScreenUser, r2PositionContextText, r2PositionSpecificRule]
        .filter(Boolean)
        .join('\n\n');
      const screeningResult = await callAIWithMetadata(
        env as any,
        r2ScreenPrompt.system,
        finalR2ScreenUser,
        undefined,
        { structured: true, temperature: 0, maxTokens: 8192 },
      );
      await updateJobAIDiagnostics(env.DB, message.jobId, {
        provider: screeningResult.metadata.provider,
        model: screeningResult.metadata.model,
        attempt: screeningResult.metadata.attempt,
        responseChars: screeningResult.metadata.responseChars,
        finishReason: screeningResult.metadata.finishReason,
        contentChars: screeningResult.metadata.contentChars,
        reasoningChars: screeningResult.metadata.reasoningChars,
        responseShape: classifyAIResponseShape(screeningResult.text, screeningResult.metadata.finishReason),
        formatAttempt: 1,
        repairStatus: 'not_started',
      });
      let evaluation: Record<string, any>;
      try {
        const parsed = await parseScreeningResponse(env, screeningResult.text);
        evaluation = parsed.value as Record<string, any>;
        await updateJobAIDiagnostics(env.DB, message.jobId, {
          formatAttempt: parsed.diagnostics.repairAttempted ? 2 : 1,
          repairStatus: parsed.diagnostics.repairAttempted ? 'succeeded' : 'not_needed',
        });
      } catch (error) {
        await updateJobAIDiagnostics(env.DB, message.jobId, {
          errorStage: 'structured_validation',
          responseChars: screeningResult.metadata.responseChars,
          formatAttempt: 2,
          repairStatus: 'failed',
        });
        logResumeProcessingError('ai.screening.validation_failed', error, {
          resumeId: message.resumeId,
          provider: screeningResult.metadata.provider,
          model: screeningResult.metadata.model,
          attempt: screeningResult.metadata.attempt,
          responseChars: screeningResult.metadata.responseChars,
          failureCode: (error as any)?.code,
        });
        throw error;
      }
      const resolvedTitle = await resolvePositionTitle(env.DB, context.standardPosition || position);
      const positionRow = await env.DB.prepare(
        'SELECT title, capability_dimensions FROM positions WHERE title = ? LIMIT 1'
      ).bind(resolvedTitle).first() as any;
      const configuredDimensions = normalizeCapabilityDimensions(positionRow?.capability_dimensions || []);
      const missingDimensions = missingDimensionNames([...WEIGHTED_SCREENING_DIMENSION_NAMES], evaluation);
      if (missingDimensions.length > 0) {
        try {
          const r2SupplementPrompt = await getAIPrompt(env as any, 'resume_screening_supplement', {
            system: `你是招聘评估专家，只返回 JSON。${WEIGHTED_SCREENING_PROMPT}`,
            user: '候选人简历：\n{resume_text}\n\n请只返回 {"dimensions":[{"name":"维度名","score":0-5,"reason":"一句中文依据"}]}。必须且只能逐项评分以下维度：{missing_dimensions}。'
          });
          const r2SupUser = r2SupplementPrompt.user
            .replace('{resume_text}', text)
            .replace('{missing_dimensions}', missingDimensions.join('、'));
          const r2PositionSpecificRule = buildPositionSpecificScreeningRule({
            standardPosition: context.standardPosition || position,
            description: context.description,
            requirements: context.requirements,
            personalizedRequirements: context.personalizedRequirements,
            capabilityDimensions: context.capabilityDimensions,
          });
          const finalR2SupUser = r2PositionSpecificRule ? `${r2SupUser}\n\n${r2PositionSpecificRule}` : r2SupUser;
          const supplemental = await callAI(
            env as any,
            r2SupplementPrompt.system,
            finalR2SupUser,
            'deepseek-v4-flash',
            { structured: true, temperature: 0, maxTokens: 4096 },
          );
          // 专项只补主评估缺失项，primary 优先，不覆盖
          const { scores, ok } = await tryParseDimensionScores(env, supplemental);
          if (ok && scores.length > 0) {
            evaluation = assembleScreeningEvaluation(evaluation, scores);
          } else {
            logResumeProcessingError('ai.screening.supplement_invalid', new Error('missing dimension supplement invalid'), {
              resumeId: message.resumeId,
            });
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
      const completeEvaluation = requireCompleteScreeningEvaluation(evaluation);
      const enrichedEvaluation = enrichScreeningEvaluation(
        completeEvaluation,
        configuredDimensions,
        hardRequirements,
        fields,
      );
      const score = enrichedEvaluation.weighted_score ?? null;
      // in-flight 保护：批次停止后不允许把本次评估写回简历
      await assertJobRunning(env.DB, message.jobId);
      await updateResume(env.DB, message.resumeId, {
        ai_review: JSON.stringify(enrichedEvaluation),
        ai_evaluation: JSON.stringify(enrichedEvaluation),
        match_score: score,
        screening_result: enrichedEvaluation.screening_result,
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
            metadata: { matchScore: score, screeningResult: enrichedEvaluation.screening_result },
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
      await syncReprocessBatchItemByJob(env.DB, jobId, { status: 'running', step }).catch(() => undefined);
    },
  });
}

export default {
  async queue(batch: MessageBatch<ResumeProcessingQueueMessage>, env: ConsumerEnv): Promise<void> {
    const r2Enabled = ((env as any).R2_ARTIFACT_READ || '').toLowerCase() === 'true';
    logResumeProcessing('consumer.batch.start', { messageCount: batch.messages.length, r2Enabled });
    for (const message of batch.messages) {
      if (message.body.kind === 'historical_reprocess') {
        try {
          await processHistoricalResumeReprocessPage(env.DB, env.RESUME_PROCESSING_QUEUE, message.body.batchId);
          message.ack();
        } catch (error) {
          logResumeProcessingError('historical_reprocess.page.error', error, { batchId: message.body.batchId });
          // Do not put a coordinator D1 error back into an endless retry loop.
          // The failed batch is visible in the UI and can be started again after
          // the underlying issue is fixed.
          await failHistoricalResumeReprocessBatch(env.DB, message.body.batchId, error);
          message.ack();
        }
        continue;
      }
      const resumeBody = message.body;
      const startedAt = Date.now();
      logResumeProcessing('consumer.message.start', {
        jobId: resumeBody.jobId,
        resumeId: resumeBody.resumeId,
        messageId: message.id,
      });
      try {
        await handleResumeQueueMessage({ body: resumeBody, ack: () => message.ack(), retry: (options) => message.retry(options) }, {
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
            const errorCode = (error as any)?.code || 'PROCESSING_FAILED';
            await env.DB.prepare("UPDATE resume_processing_jobs SET status='failed', error_code=?, error_message=?, updated_at=? WHERE id=?")
              .bind(errorCode, error.message.slice(0, 500), new Date().toISOString(), jobId).run();
            await env.DB.prepare("UPDATE resumes SET parse_status='failed', parse_error=?, updated_at=? WHERE id=?")
              .bind(error.message.slice(0, 500), new Date().toISOString(), resumeBody.resumeId).run();
          },
        },
        async (jobId) => {
          await syncReprocessBatchItemByJob(env.DB, jobId, { status: 'completed', completed_at: new Date().toISOString() }).catch(() => undefined);
        },
        async (jobId, error) => {
          const errorCode = (error as any)?.code || 'PROCESSING_FAILED';
          await syncReprocessBatchItemByJob(env.DB, jobId, {
            status: 'failed',
            error_code: errorCode,
            error_message: error.message.slice(0, 500),
          }).catch(() => undefined);
        },
        async (jobId) => {
          await syncReprocessBatchItemByJob(env.DB, jobId, { status: 'queued' }).catch(() => undefined);
        },
      );
      logResumeProcessing('consumer.message.ok', {
        jobId: resumeBody.jobId,
        resumeId: resumeBody.resumeId,
        messageId: message.id,
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        logResumeProcessingError('consumer.message.error', error, {
          jobId: resumeBody.jobId,
          resumeId: resumeBody.resumeId,
          messageId: message.id,
          durationMs: Date.now() - startedAt,
        });
        throw error;
      }
    }
    logResumeProcessing('consumer.batch.ok', { messageCount: batch.messages.length });
  },
} satisfies ExportedHandler<ConsumerEnv, ResumeQueueMessage>;
