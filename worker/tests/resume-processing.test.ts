import { describe, expect, it } from 'vitest';
import {
  ACTIVE_JOB_STATUSES,
  isTerminalJobStatus,
} from '../src/resume-processing/types';

describe('resume processing job status contract', () => {
  it('only treats completed, failed, and cancelled as terminal', () => {
    expect(isTerminalJobStatus('completed')).toBe(true);
    expect(isTerminalJobStatus('failed')).toBe(true);
    expect(isTerminalJobStatus('cancelled')).toBe(true);
    expect(isTerminalJobStatus('queued')).toBe(false);
    expect(isTerminalJobStatus('running')).toBe(false);
  });

  it('keeps queued and running as the only active job states', () => {
    expect(ACTIVE_JOB_STATUSES).toEqual(['queued', 'running']);
  });
});
