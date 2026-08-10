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
  file?: { bytes: Uint8Array; fileName: string };
}

export interface InterviewReminderDeliveryResult {
  cardSent: boolean;
  fileSent: boolean;
  warning: string | null;
}

const EMPTY_VALUE = '未填写';
const MAX_ADVICE_LENGTH = 500;
const MAX_PDF_BYTES = 30 * 1024 * 1024;
const MAX_FEISHU_RESPONSE_BYTES = 1024 * 1024;
const FEISHU_IM_API = 'https://open.feishu.cn/open-apis/im/v1';

function deliveryError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
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
    throw deliveryError('FEISHU_DELIVERY_FAILED', 'Feishu delivery request failed');
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

  const today = new Date(at);
  if (Number.isNaN(today.getTime()) || birthday > today) return null;
  let age = today.getUTCFullYear() - birthday.getUTCFullYear();
  const beforeBirthday = today.getUTCMonth() < birthday.getUTCMonth()
    || (today.getUTCMonth() === birthday.getUTCMonth() && today.getUTCDate() < birthday.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

function list(value: unknown): string[] {
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    .map((item) => item.trim());
}

function buildAiAdvice(evaluation: RawRecord): string {
  const advice = [
    text(evaluation.summary),
    text(evaluation.recommendation, evaluation.recommendations),
    ...list(evaluation.risks).map((point) => `风险点：${point}`),
    ...list(evaluation.risk).map((point) => `风险点：${point}`),
    ...list(evaluation.risk_points).map((point) => `风险点：${point}`),
    ...list(evaluation.suggested_questions).map((question) => `建议提问：${question}`),
    ...list(evaluation.interview_questions).map((question) => `建议提问：${question}`),
  ].filter(Boolean).join('\n');
  return advice.slice(0, MAX_ADVICE_LENGTH) || EMPTY_VALUE;
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
  const evaluation = asRecord(resume.ai_evaluation);

  return {
    name: text(resume.candidate_name, resume.name, screening.candidate_name, interview.candidate_name, task.candidate_name) || EMPTY_VALUE,
    education: text(resume.education, parsed.highest_degree, parsed.education, screening.education) || EMPTY_VALUE,
    age: calculateAge(text(resume.birthday, parsed.birthday, screening.birthday), at),
    gender: text(resume.gender, parsed.gender, screening.gender) || EMPTY_VALUE,
    position: text(resume.mapped_position, resume.position_applied, screening.mapped_position, interview.position_applied, task.position) || EMPTY_VALUE,
    interviewTime: formatInterviewTime(text(interview.interview_time, task.interview_time)),
    city: text(resume.city, parsed.city, screening.city) || EMPTY_VALUE,
    aiAdvice: buildAiAdvice(evaluation),
  };
}

export function buildInterviewReminderCard(
  view: InterviewReminderView,
  options: { operatorName: string; attachmentAvailable: boolean },
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
      { tag: 'note', elements: [{ tag: 'plain_text', content: `${attachment}｜操作人：${options.operatorName || EMPTY_VALUE}` }] },
    ],
  };
}

export async function deliverInterviewReminder(
  input: InterviewReminderDeliveryInput,
  dependencies: { fetch: typeof fetch },
): Promise<InterviewReminderDeliveryResult> {
  if (!input.userToken.trim()) {
    throw deliveryError('FEISHU_AUTH_REQUIRED', 'A current-user Feishu token is required');
  }
  if (input.file && (input.file.bytes.byteLength === 0 || input.file.bytes.byteLength > MAX_PDF_BYTES)) {
    throw deliveryError('FEISHU_INVALID_PDF', 'PDF must be between 1 byte and 30 MB');
  }

  let fileKey: string | null = null;
  let warning: string | null = null;
  if (input.file) {
    try {
      fileKey = await uploadPdf(input.file, input.resourceToken, dependencies.fetch);
    } catch {
      warning = 'PDF 上传失败，已发送面试提醒卡片。';
    }
  }

  await sendFeishuMessage(
    dependencies.fetch,
    input.userToken,
    input.receiverOpenId,
    'interactive',
    JSON.stringify(buildInterviewReminderCard(input.view, {
      operatorName: input.operatorName,
      attachmentAvailable: Boolean(fileKey),
    })),
  );

  if (!fileKey) return { cardSent: true, fileSent: false, warning };

  try {
    await sendFeishuMessage(
      dependencies.fetch,
      input.userToken,
      input.receiverOpenId,
      'file',
      JSON.stringify({ file_key: fileKey }),
    );
    return { cardSent: true, fileSent: true, warning: null };
  } catch {
    return { cardSent: true, fileSent: false, warning: 'PDF 发送失败，已发送面试提醒卡片。' };
  }
}
