import {
  hasAllDimensionScores,
  isPromptLikeSummary,
  normalizeDimensionScores,
  normalizeScreeningEvaluation,
  type DimensionScore,
} from './dimension-scores';
import { WEIGHTED_SCREENING_DIMENSION_NAMES } from './weighted-screening';

export type StructuredOutputKind = 'screening' | 'dimensions';

export type StructuredOutputFailureCode =
  | 'AI_SCREENING_INVALID_JSON'
  | 'AI_SCREENING_INVALID_SUMMARY'
  | 'AI_SCREENING_INVALID_DIMENSIONS';

export type StructuredOutputDiagnostics = {
  kind: StructuredOutputKind;
  repairAttempted: boolean;
  responseChars: number;
  dimensionNames: string[];
  failureCode?: StructuredOutputFailureCode;
};

export type StructuredOutputResult = {
  value: Record<string, unknown> | Array<Record<string, unknown>>;
  diagnostics: StructuredOutputDiagnostics;
};

type RepairInput = {
  raw: string;
  kind: StructuredOutputKind;
  failureCode: StructuredOutputFailureCode;
};

const REPAIR_INPUT_MAX_CHARS = 12000;

/**
 * Build the bounded one-shot repair prompt. The model is only asked to turn the
 * previous output into valid JSON — never to re-run the original screening.
 */
export function buildScreeningRepairPrompt(
  kind: StructuredOutputKind,
  rawResponse: string,
  failureCode: StructuredOutputFailureCode,
): { system: string; user: string } {
  const raw = (typeof rawResponse === 'string' ? rawResponse : String(rawResponse ?? '')).slice(0, REPAIR_INPUT_MAX_CHARS);
  const system = '你只负责把上一条模型输出转换为合法 JSON。不要解释，不要复述提示词，不要输出 Markdown，不要输出代码。只返回 JSON。';
  const dimensionList = WEIGHTED_SCREENING_DIMENSION_NAMES.join('、');
  const user = kind === 'screening'
    ? `请把下面内容修复为一个合法的 screening 评估 JSON 对象，必须包含 summary（中文综合分析）和完整的七项 dimensions（${dimensionList}）。无法判断的 score 使用 0，reason 写“信息不足”。失败原因：${failureCode}\n\n原始输出：\n${raw}`
    : `请把下面内容修复为一个合法的 dimensions JSON 数组（或 {"dimensions":[...]}），必须包含完整的七项（${dimensionList}）。无法判断的 score 使用 0，reason 写“信息不足”。失败原因：${failureCode}\n\n原始输出：\n${raw}`;
  return { system, user };
}

export function buildStructuredFailure(
  code: StructuredOutputFailureCode,
  message: string,
): Error & { code: StructuredOutputFailureCode } {
  const error = new Error(`${code}: ${message}`) as Error & { code: StructuredOutputFailureCode };
  error.code = code;
  return error;
}

/** Resolve an extracted value into a plain object for screening mode. */
function toObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  return null;
}

/**
 * Parse a model response for screening or dimensions mode and, when the output is
 * structurally invalid, attempt exactly one bounded repair call. Never retries the
 * original prompt, never returns a half-baked value.
 */
export async function parseStructuredOutput(
  raw: string,
  kind: StructuredOutputKind,
  extractJson: (text: string) => unknown,
  repair: (input: RepairInput) => Promise<string>,
): Promise<StructuredOutputResult> {
  const responseChars = typeof raw === 'string' ? raw.length : 0;

  const attemptParse = (text: string): { value: unknown; error: StructuredOutputFailureCode | null } => {
    const extracted = extractJson(text);
    if (kind === 'screening') {
      // A non-object response is not a valid screening payload and cannot be repaired.
      const obj = toObject(extracted);
      if (!obj) return { value: extracted, error: 'AI_SCREENING_INVALID_JSON' };
      const normalized = normalizeScreeningEvaluation(obj);
      if (!hasAllDimensionScores(normalized)) {
        return { value: normalized, error: 'AI_SCREENING_INVALID_DIMENSIONS' };
      }
      if (isPromptLikeSummary(normalized.summary)) {
        return { value: normalized, error: 'AI_SCREENING_INVALID_SUMMARY' };
      }
      return { value: normalized, error: null };
    }
    // dimensions mode: accept array or { dimensions: [...] }
    const scores = normalizeDimensionScores(extracted);
    if (scores.length === 0) return { value: extracted, error: 'AI_SCREENING_INVALID_JSON' };
    if (!hasAllDimensionScores(scores)) {
      return { value: scores, error: 'AI_SCREENING_INVALID_DIMENSIONS' };
    }
    return { value: scores, error: null };
  };

  const first = attemptParse(raw);
  if (!first.error) {
    return {
      value: first.value as Record<string, unknown> | Array<Record<string, unknown>>,
      diagnostics: {
        kind,
        repairAttempted: false,
        responseChars,
        dimensionNames: normalizeDimensionScores(first.value).map((item: DimensionScore) => item.name),
      },
    };
  }
  const truncated = raw.slice(0, REPAIR_INPUT_MAX_CHARS);
  let repairedRaw: string;
  try {
    repairedRaw = await repair({ raw: truncated, kind, failureCode: first.error! });
  } catch (error) {
    throw buildStructuredFailure(
      first.error!,
      `AI 返回内容无法解析为 JSON，修复请求失败：${String((error as Error)?.message || error).slice(0, 180)}`,
    );
  }

  const second = attemptParse(repairedRaw);
  if (second.error) {
    const failureCode: StructuredOutputFailureCode = second.error === 'AI_SCREENING_INVALID_JSON'
      ? 'AI_SCREENING_INVALID_JSON'
      : second.error === 'AI_SCREENING_INVALID_SUMMARY'
        ? 'AI_SCREENING_INVALID_SUMMARY'
        : 'AI_SCREENING_INVALID_DIMENSIONS';
    throw buildStructuredFailure(failureCode, '修复后仍不符合结构化评估要求');
  }

  return {
    value: second.value as Record<string, unknown> | Array<Record<string, unknown>>,
    diagnostics: {
      kind,
      repairAttempted: true,
      responseChars,
      dimensionNames: normalizeDimensionScores(second.value).map((item: DimensionScore) => item.name),
      failureCode: undefined,
    },
  };
}
