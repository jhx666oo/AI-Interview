import { describe, expect, it } from 'vitest';
import {
  applyBusinessScreeningDecision,
  buildBusinessScreeningDecisionPayload,
  classifyBusinessScreeningLoadError,
  pickActiveBusinessScreeningResumeId,
} from './businessScreeningLogic';

describe('business screening public helpers', () => {
  const resumes = [
    { id: 'resume-1', candidateName: '候选人甲', position: '产品经理', status: 'pending' as const },
    { id: 'resume-2', candidateName: '候选人乙', position: '运营经理', status: 'rejected' as const, remark: '经验不匹配' },
  ];

  it('keeps the current selection when still present and otherwise falls back to the first resume', () => {
    expect(pickActiveBusinessScreeningResumeId(resumes, 'resume-2')).toBe('resume-2');
    expect(pickActiveBusinessScreeningResumeId(resumes, 'missing')).toBe('resume-1');
    expect(pickActiveBusinessScreeningResumeId([], 'missing')).toBeNull();
  });

  it('treats 410 links as expired and all other failures as generic errors', () => {
    expect(classifyBusinessScreeningLoadError({ response: { status: 410 } })).toBe('expired');
    expect(classifyBusinessScreeningLoadError({ response: { status: 404 } })).toBe('error');
    expect(classifyBusinessScreeningLoadError(new Error('network failed'))).toBe('error');
  });

  it('trims optional callback remarks before posting them', () => {
    expect(buildBusinessScreeningDecisionPayload('  保留到终面  ')).toEqual({ remark: '保留到终面' });
    expect(buildBusinessScreeningDecisionPayload('   ')).toEqual({});
  });

  it('updates only the decided resume while preserving other cards', () => {
    expect(
      applyBusinessScreeningDecision(resumes, {
        resumeId: 'resume-1',
        action: 'approve',
        remark: '建议一面',
        processedAt: '2026-08-12T09:30:00.000Z',
      }),
    ).toEqual([
      {
        id: 'resume-1',
        candidateName: '候选人甲',
        position: '产品经理',
        status: 'passed',
        remark: '建议一面',
        processedAt: '2026-08-12T09:30:00.000Z',
      },
      {
        id: 'resume-2',
        candidateName: '候选人乙',
        position: '运营经理',
        status: 'rejected',
        remark: '经验不匹配',
      },
    ]);
  });
});
