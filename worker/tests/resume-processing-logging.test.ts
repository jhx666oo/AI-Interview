import { describe, expect, it } from 'vitest';
import { formatResumeProcessingLog } from '../src/resume-processing/logging';

describe('resume processing logging', () => {
  it('emits a stable JSON envelope with event, timestamp, and safe context', () => {
    const line = formatResumeProcessingLog(
      'queue.send.ok',
      { resumeId: 'resume-1', jobId: 'job-1', durationMs: 12 },
      '2026-08-05T00:00:00.000Z',
    );

    expect(JSON.parse(line)).toEqual({
      scope: 'resume-processing',
      event: 'queue.send.ok',
      ts: '2026-08-05T00:00:00.000Z',
      resumeId: 'resume-1',
      jobId: 'job-1',
      durationMs: 12,
    });
  });
});
