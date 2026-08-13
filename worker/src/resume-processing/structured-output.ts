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
  if (first.error === 'AI_SCREENING_INVALID_JSON') {
    throw buildStructuredFailure('AI_SCREENING_INVALID_JSON', 'AI 返回内容无法解析为 JSON');
  }

  const truncated = raw.slice(0, REPAIR_INPUT_MAX_CHARS);
  const repairedRaw = await repair({ raw: truncated, kind, failureCode: first.error });

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
