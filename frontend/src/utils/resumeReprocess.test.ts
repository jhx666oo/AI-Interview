import { describe, expect, it } from 'vitest';
import {
  getReprocessPercent,
  isReprocessBatchActive,
  getEvaluationStepLabel,
  getEvaluationCardState,
} from './resumeReprocess';
import type { ReprocessBatchView } from './resumeReprocess';

describe('getReprocessPercent', () => {
  it('calculates percent from completed + failed + skipped', () => {
    const batch: ReprocessBatchView = {
      batch_id: 'b1', scope: 'all', status: 'running',
      total: 120, completed: 42, processing: 5, queued: 68,
      pending: 0, failed: 4, skipped: 1, percent: 0,
      current: null, failed_items: [],
      created_at: '', updated_at: '', completed_at: null,
    };
    expect(getReprocessPercent(batch)).toBe(39);
  });

  it('returns 100 when total is zero', () => {
    const batch: ReprocessBatchView = {
      batch_id: 'b1', scope: 'all', status: 'completed',
      total: 0, completed: 0, processing: 0, queued: 0,
      pending: 0, failed: 0, skipped: 0, percent: 0,
      current: null, failed_items: [],
      created_at: '', updated_at: '', completed_at: '',
    };
    expect(getReprocessPercent(batch)).toBe(100);
  });
});

describe('isReprocessBatchActive', () => {
  it('returns true for running batch', () => {
    expect(isReprocessBatchActive({ status: 'running' } as ReprocessBatchView)).toBe(true);
  });

  it('returns true for queued batch', () => {
    expect(isReprocessBatchActive({ status: 'queued' } as ReprocessBatchView)).toBe(true);
  });

  it('returns false for completed batch', () => {
    expect(isReprocessBatchActive({ status: 'completed' } as ReprocessBatchView)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isReprocessBatchActive(null)).toBe(false);
  });
});

describe('getEvaluationStepLabel', () => {
  it('maps screening to AI 评分中', () => {
    expect(getEvaluationStepLabel('screening')).toBe('AI 评分中');
  });

  it('maps extracting_text', () => {
    expect(getEvaluationStepLabel('extracting_text')).toBe('文本提取中');
  });

  it('returns empty for null', () => {
    expect(getEvaluationStepLabel(null)).toBe('');
  });
});

describe('getEvaluationCardState', () => {
  it('returns queued state when evaluation_job_status is queued', () => {
    const record = { evaluation_job_status: 'queued' };
    const state = getEvaluationCardState(record);
    expect(state.status).toBe('queued');
    expect(state.label).toBe('排队中');
  });

  it('returns running state with step label', () => {
    const record = { evaluation_job_status: 'running', evaluation_job_step: 'screening' };
    const state = getEvaluationCardState(record);
    expect(state.status).toBe('running');
    expect(state.label).toBe('AI 评分中');
  });

  it('returns failed state when evaluation_job_status is failed', () => {
    const record = { evaluation_job_status: 'failed', evaluation_job_error: '文本不可用' };
    const state = getEvaluationCardState(record);
    expect(state.status).toBe('failed');
    expect(state.label).toBe('评估失败');
    expect(state.error).toBe('文本不可用');
  });

  it('returns idle state when no job projection exists', () => {
    const record = { evaluation_job_status: null };
    const state = getEvaluationCardState(record);
    expect(state.status).toBe('idle');
  });

  it('queued/running wins over old ai_evaluation', () => {
    const record = {
      evaluation_job_status: 'running',
      evaluation_job_step: 'screening',
      ai_evaluation: { weighted_score: 80, summary: '好' },
    };
    const state = getEvaluationCardState(record);
    expect(state.status).toBe('running');
  });
});
