import type { InterviewAutomationAction } from './types';

export type AutomationHandler = (job: any) => Promise<{ status: 'succeeded' | 'partial'; [key: string]: unknown }>;

export class InterviewAutomationOrchestrator {
  constructor(private readonly handlers: Partial<Record<InterviewAutomationAction, AutomationHandler>>) {}

  async execute(job: { action: InterviewAutomationAction }): Promise<{ status: 'succeeded' | 'partial'; [key: string]: unknown }> {
    const handler = this.handlers[job.action];
    if (!handler) throw automationError('ACTION_HANDLER_MISSING', `未配置自动作业处理器: ${job.action}`, false);
    return handler(job);
  }
}

export function automationError(code: string, message: string, retryable: boolean): Error & { code: string; retryable: boolean } {
  return Object.assign(new Error(message), { code, retryable });
}

export function classifyAutomationError(error: unknown): { code: string; message: string; retryable: boolean } {
  const value = error as { code?: string; message?: string; retryable?: boolean };
  return {
    code: value?.code || 'AUTOMATION_UNKNOWN',
    message: value?.message || String(error),
    retryable: value?.retryable === true,
  };
}
