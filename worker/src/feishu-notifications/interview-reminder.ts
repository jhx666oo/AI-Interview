type RawRecord = Record<string, unknown>;

export interface InterviewReminderSource {
  interview?: RawRecord | null;
  resume?: RawRecord | null;
  screening?: RawRecord | null;
  recruitmentTask?: RawRecord | null;
}

export interface InterviewReminderView {
  name: string;
  education: string;
  age: number | null;
  gender: string;
  position: string;
  interviewTime: string;
  city: string;
  aiAdvice: string;
}

export type FeishuCard = Record<string, unknown>;

export interface InterviewReminderDeliveryInput {
  userToken: string;
  resourceToken: string;
  receiverOpenId: string;
  view: InterviewReminderView;
  operatorName: string;
  detailUrl?: string;
  file?: { bytes: Uint8Array; fileName: string };
}

export interface InterviewReminderDeliveryResult {
  cardSent: boolean;
  fileSent: boolean;
  warning: string | null;
}

const EMPTY_VALUE = '未填写';
const DEFAULT_AI_ADVICE = '建议面试官重点核实岗位匹配、核心经历与稳定性，并结合简历原文人工判断。';
const MAX_ADVICE_LENGTH = 500;
const MAX_PDF_BYTES = 30 * 1024 * 1024;
const MAX_FEISHU_RESPONSE_BYTES = 1024 * 1024;
const FEISHU_IM_API = 'https://open.feishu.cn/open-apis/im/v1';

function deliveryError(
  code: string,
  message: string,
  feishuCode?: number,
): Error & { code: string; feishuCode?: number } {
  return Object.assign(new Error(message), { code }, feishuCode === undefined ? {} : { feishuCode });
}

async function readFeishuResponse(response: Response): Promise<RawRecord> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_FEISHU_RESPONSE_BYTES) {
    throw deliveryError('FEISHU_RESPONSE_TOO_LARGE', 'Feishu response is too large');
  }

  const reader = response.body?.getReader();
  if (!reader) throw deliveryError('FEISHU_RESPONSE_INVALID', 'Feishu returned an empty response');

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      totalBytes += value.byteLength;
      if (totalBytes > MAX_FEISHU_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw deliveryError('FEISHU_RESPONSE_TOO_LARGE', 'Feishu response is too large');
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const body = new TextDecoder().decode(bytes);

  let parsed: RawRecord;
  try {
    parsed = asRecord(JSON.parse(body));
  } catch {
    throw deliveryError('FEISHU_RESPONSE_INVALID', 'Feishu returned an invalid response');
  }

  if (!response.ok || parsed.code !== 0) {
    const feishuCode = typeof parsed.code === 'number' && Number.isFinite(parsed.code)
      ? parsed.code
      : undefined;
    throw deliveryError('FEISHU_DELIVERY_FAILED', 'Feishu delivery request failed', feishuCode);
  }
  return parsed;
}

async function sendFeishuMessage(
  fetcher: typeof fetch,
  userToken: string,
  receiverOpenId: string,
  msgType: 'interactive' | 'file',
  content: string,
): Promise<void> {
  const response = await fetcher(`${FEISHU_IM_API}/messages?receive_id_type=open_id`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${userToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({ receive_id: receiverOpenId, msg_type: msgType, content }),
  });
  await readFeishuResponse(response);
}

async function uploadPdf(
  file: NonNullable<InterviewReminderDeliveryInput['file']>,
  resourceToken: string,
  fetcher: typeof fetch,
): Promise<string> {
  const formData = new FormData();
  formData.append('file_type', 'pdf');
  formData.append('file_name', file.fileName);
  formData.append('file', new Blob([file.bytes], { type: 'application/pdf' }), file.fileName);
  const response = await fetcher(`${FEISHU_IM_API}/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${resourceToken}` },
    body: formData,
  });
  const data = await readFeishuResponse(response);
  const fileKey = text(asRecord(data.data).file_key);
  if (!fileKey) throw deliveryError('FEISHU_RESPONSE_INVALID', 'Feishu upload response did not include a file key');
  return fileKey;
}

function asRecord(value: unknown): RawRecord {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return {};
    }
  }

  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as RawRecord
    : {};
}

function text(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return '';
}

function formatInterviewTime(value: unknown): string {
  if (typeof value === 'string') {
    const localMatch = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?$/);
    if (localMatch) {
      const [, year, month, day, hour, minute, second = '00'] = localMatch;
      const localDate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
      const isValidLocalTime = localDate.getUTCFullYear() === Number(year)
        && localDate.getUTCMonth() === Number(month) - 1
        && localDate.getUTCDate() === Number(day)
        && localDate.getUTCHours() === Number(hour)
        && localDate.getUTCMinutes() === Number(minute)
        && localDate.getUTCSeconds() === Number(second);
      return isValidLocalTime ? `${year}-${month}-${day} ${hour}:${minute}` : EMPTY_VALUE;
    }

    if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim())) return EMPTY_VALUE;
  } else if (typeof value !== 'number') {
    return EMPTY_VALUE;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE;

  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}`;
}

function calculateAge(value: unknown, at: Date): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const birthday = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(birthday.getTime()) || birthday.toISOString().slice(0, 10) !== value) return null;

  if (Number.isNaN(at.getTime())) return null;
  const shanghaiParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const today = Object.fromEntries(shanghaiParts.map(({ type, value: part }) => [type, Number(part)]));
  const birthdayYear = birthday.getUTCFullYear();
  const birthdayMonth = birthday.getUTCMonth() + 1;
  const birthdayDay = birthday.getUTCDate();
  if ([today.year, today.month, today.day].some((part) => !Number.isFinite(part))) return null;
  if (birthdayYear > today.year
    || (birthdayYear === today.year && birthdayMonth > today.month)
    || (birthdayYear === today.year && birthdayMonth === today.month && birthdayDay > today.day)) return null;
  let age = today.year - birthdayYear;
  const beforeBirthday = today.month < birthdayMonth
    || (today.month === birthdayMonth && today.day < birthdayDay);
  if (beforeBirthday) age -= 1;
  return age >= 0 && age <= 120 ? age : null;
}

function parsedAge(value: unknown): number | null {
  const numeric = typeof value === 'number'
    ? value
    : (typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : Number.NaN);
  return Number.isInteger(numeric) && numeric >= 0 && numeric <= 120 ? numeric : null;
}

function list(value: unknown): string[] {
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    .map((item) => item.trim());
}

function unique(values: string[], limit: number): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].slice(0, limit);
}

function aiSource(value: unknown): RawRecord | string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (typeof parsed === 'string') return parsed.trim() || null;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as RawRecord;
      return null;
    } catch {
      return trimmed;
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as RawRecord;
  return null;
}

function buildAiAdvice(value: unknown): string {
  const source = aiSource(value);
  if (typeof source === 'string') return source.slice(0, MAX_ADVICE_LENGTH);
  if (!source) return '';

  const conclusions = unique([
    text(source.summary),
    ...list(source.recommendation),
    ...list(source.recommendations),
  ], 2);
  const risks = unique([
    ...list(source.risks),
    ...list(source.risk),
    ...list(source.risk_points),
  ], 4).map((point) => `风险点：${point}`);
  const questions = unique([
    ...list(source.suggested_questions),
    ...list(source.interview_questions),
    ...list(source.questions),
  ], 4).map((question) => `建议提问：${question}`);
  return unique([...conclusions, ...risks, ...questions], 10).join('\n').slice(0, MAX_ADVICE_LENGTH);
}

export function buildInterviewReminderView(
  source: InterviewReminderSource,
  at = new Date(),
): InterviewReminderView {
  const interview = asRecord(source.interview);
  const resume = asRecord(source.resume);
  const screening = asRecord(source.screening);
  const task = asRecord(source.recruitmentTask);
  const parsed = asRecord(resume.parsed_data);
  const advice = [resume.ai_evaluation, resume.ai_review, screening.ai_analysis]
    .map(buildAiAdvice)
    .find(Boolean);
  const authoritativeAge = parsedAge(parsed.age);

  return {
    name: text(resume.candidate_name, interview.candidate_name, resume.name, task.candidate_name) || EMPTY_VALUE,
    education: text(parsed.highest_degree, parsed.education, resume.education, screening.education) || EMPTY_VALUE,
    age: authoritativeAge ?? calculateAge(text(resume.birthday, parsed.birthday, screening.birthday), at),
    gender: text(parsed.gender, resume.gender, screening.gender) || EMPTY_VALUE,
    position: text(resume.mapped_position, resume.position_applied, interview.position_applied, task.position) || EMPTY_VALUE,
    interviewTime: formatInterviewTime(text(interview.interview_time, task.interview_time)),
    city: text(
      parsed.city,
      screening.city,
      task.city,
      resume.position_location,
      resume.work_location,
      resume.location,
      task.position_location,
      task.work_location,
      task.location,
      interview.interview_location,
    ) || EMPTY_VALUE,
    aiAdvice: advice || DEFAULT_AI_ADVICE,
  };
}

export function buildInterviewReminderCard(
  view: InterviewReminderView,
  options: { operatorName: string; attachmentAvailable: boolean; detailUrl?: string },
): FeishuCard {
  const age = view.age === null ? EMPTY_VALUE : `${view.age} 岁`;
  const attachment = options.attachmentAvailable
    ? '简历 PDF 将在下一条消息发送'
    : '暂无可发送的简历 PDF';

  return {
    config: { wide_screen_mode: true },
    header: {
      template: 'blue',
      title: { tag: 'plain_text', content: '面试提醒' },
    },
    elements: [
      { tag: 'markdown', content: `**候选人：** ${view.name}\n**面试时间：** ${view.interviewTime}\n**岗位：** ${view.position}` },
      { tag: 'hr' },
      { tag: 'markdown', content: `**学历：** ${view.education}\n**年龄：** ${age}\n**性别：** ${view.gender}\n**城市：** ${view.city}` },
      { tag: 'hr' },
      { tag: 'markdown', content: `**AI 面试建议：**\n${view.aiAdvice}` },
      ...(options.detailUrl ? [{
        tag: 'action',
        actions: [{
          tag: 'button',
          text: { tag: 'plain_text', content: '查看面试详情（一面/二面评价）' },
          type: 'primary',
          url: options.detailUrl,
        }],
      }] : []),
      { tag: 'note', elements: [{ tag: 'plain_text', content: `${attachment}｜操作人：${options.operatorName || EMPTY_VALUE}` }] },
    ],
  };
}

export async function deliverInterviewReminder(
  input: InterviewReminderDeliveryInput,
  dependencies: {
    fetch: typeof fetch;
    refreshUserToken?: () => Promise<string | null>;
  },
): Promise<InterviewReminderDeliveryResult> {
  if (!input.userToken.trim()) {
    throw deliveryError('FEISHU_AUTH_REQUIRED', 'A current-user Feishu token is required');
  }
  if (input.file && (input.file.bytes.byteLength === 0 || input.file.bytes.byteLength > MAX_PDF_BYTES)) {
    throw deliveryError('FEISHU_INVALID_PDF', 'PDF must be between 1 byte and 30 MB');
  }

  let fileKey: string | null = null;
  let warning: string | null = null;
  let activeUserToken = input.userToken;
  let refreshAttempted = false;

  const sendCurrentUserMessage = async (msgType: 'interactive' | 'file', content: string): Promise<void> => {
    try {
      await sendFeishuMessage(
        dependencies.fetch,
        activeUserToken,
        input.receiverOpenId,
        msgType,
        content,
      );
      return;
    } catch (error) {
      const feishuCode = (error as { feishuCode?: number })?.feishuCode;
      if (feishuCode !== 99991677) throw error;
      if (refreshAttempted || !dependencies.refreshUserToken) {
        throw deliveryError('FEISHU_AUTH_REQUIRED', '当前用户飞书授权已失效，请重新授权后重试', feishuCode);
      }
      refreshAttempted = true;

      let refreshedToken: string | null = null;
      try {
        refreshedToken = await dependencies.refreshUserToken();
      } catch {
        // The route returns a single actionable authentication response for all refresh failures.
      }
      activeUserToken = refreshedToken?.trim() || '';
      if (!activeUserToken) {
        throw deliveryError('FEISHU_AUTH_REQUIRED', '当前用户飞书授权已失效，请重新授权后重试', feishuCode);
      }

      try {
        await sendFeishuMessage(
          dependencies.fetch,
          activeUserToken,
          input.receiverOpenId,
          msgType,
          content,
        );
      } catch (retryError) {
        if ((retryError as { feishuCode?: number })?.feishuCode === 99991677) {
          throw deliveryError('FEISHU_AUTH_REQUIRED', '当前用户飞书授权已失效，请重新授权后重试', 99991677);
        }
        throw retryError;
      }
    }
  };

  if (input.file) {
    try {
      fileKey = await uploadPdf(input.file, input.resourceToken, dependencies.fetch);
    } catch {
      warning = 'PDF 上传失败，已发送面试提醒卡片。';
    }
  }

  await sendCurrentUserMessage(
    'interactive',
    JSON.stringify(buildInterviewReminderCard(input.view, {
      operatorName: input.operatorName,
      attachmentAvailable: Boolean(fileKey),
      detailUrl: input.detailUrl,
    })),
  );

  if (!fileKey) return { cardSent: true, fileSent: false, warning };

  try {
    await sendCurrentUserMessage(
      'file',
      JSON.stringify({ file_key: fileKey }),
    );
    return { cardSent: true, fileSent: true, warning: null };
  } catch (error) {
    if ((error as { code?: string })?.code === 'FEISHU_AUTH_REQUIRED') {
      throw Object.assign(error as Error, { cardSent: true, fileSent: false });
    }
    return { cardSent: true, fileSent: false, warning: 'PDF 发送失败，已发送面试提醒卡片。' };
  }
}
