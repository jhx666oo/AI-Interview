export type ResumeProcessingLogContext = Record<string, unknown>;

export function formatResumeProcessingLog(
  event: string,
  context: ResumeProcessingLogContext = {},
  timestamp = new Date().toISOString(),
): string {
  return JSON.stringify({
    scope: 'resume-processing',
    event,
    ts: timestamp,
    ...context,
  });
}

export function logResumeProcessing(event: string, context: ResumeProcessingLogContext = {}): void {
  console.log(formatResumeProcessingLog(event, context));
}

export function logResumeProcessingError(
  event: string,
  error: unknown,
  context: ResumeProcessingLogContext = {},
): void {
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.error(formatResumeProcessingLog(event, {
    ...context,
    error: errorMessage.slice(0, 500),
  }));
}
