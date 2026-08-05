type ScreeningMirrorEvaluation = {
  summary?: unknown;
  weighted_score?: unknown;
  screening_result?: unknown;
  screening_reason?: unknown;
  strengths?: unknown;
  advantage?: unknown;
  risks?: unknown;
  risk?: unknown;
};

function displayText(value: unknown): string {
  return Array.isArray(value) ? value.map(String).join('\n') : String(value || '');
}

/** Builds Feishu fields from the backend decision, never from model recommendation or legacy score. */
export function buildFeishuScreeningMirror(evaluation: ScreeningMirrorEvaluation): Record<string, string> {
  const score = evaluation.weighted_score == null || !Number.isFinite(Number(evaluation.weighted_score))
    ? '-'
    : `${Number(evaluation.weighted_score).toFixed(1).replace(/\.0$/, '')}/5`;
  const result = evaluation.screening_result === '通过' ? '通过' : '不通过';
  const reason = String(evaluation.screening_reason || '-');
  const strengths = displayText(evaluation.strengths ?? evaluation.advantage);
  const risks = displayText(evaluation.risks ?? evaluation.risk);
  const summary = [
    String(evaluation.summary || ''),
    `加权分数: ${score}`,
    `初筛结果: ${result}`,
    `初筛原因: ${reason}`,
    strengths ? `优势:\n${strengths}` : '',
    risks ? `风险:\n${risks}` : '',
  ].filter(Boolean).join('\n\n');
  return {
    'AI简历评估': summary,
    '优势分析': strengths,
    '风险点': risks,
    'AI简历初筛结果': result,
  };
}
