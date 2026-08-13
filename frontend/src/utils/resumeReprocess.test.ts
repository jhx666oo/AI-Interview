import { describe, expect, it } from 'vitest';
import {
  getReprocessPercent,
  isReprocessBatchActive,
  getEvaluationStepLabel,
  getEvaluationCardState,
  isHardGateRejection,
} from './resumeReprocess';
import type { ReprocessBatchView } from './resumeReprocess';

describe('getReprocessPercent', () => {
  it('calculates percent from completed + failed + skipped', () => {
    const batch: ReprocessBatchView = {
      batch_id: 'b1', scope: 'all', status: 'running',
      total: 120, completed: 42, processing: 5, queued: 68,
      pending: 0, failed: 4, skipped: 1, percent: 0,
      current: null, failed_items: [], error_message: null,
      created_at: '', updated_at: '', completed_at: null,
    };
    expect(getReprocessPercent(batch)).toBe(39);
  });

  it('returns 100 when total is zero', () => {
    const batch: ReprocessBatchView = {
      batch_id: 'b1', scope: 'all', status: 'completed',
      total: 0, completed: 0, processing: 0, queued: 0,
      pending: 0, failed: 0, skipped: 0, percent: 0,
      current: null, failed_items: [], error_message: null,
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

  it('returns false for cancelled batch', () => {
    expect(isReprocessBatchActive({ status: 'cancelled' } as ReprocessBatchView)).toBe(false);
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
    const record = { evaluation_job_status: 'failed', evaluation_job_error: 'PROCESSING_FAILED:文本不可用' };
    const state = getEvaluationCardState(record);
    expect(state.status).toBe('failed');
    expect(state.label).toBe('评估失败');
    expect(state.error).toBe('文本不可用');
  });

  it('shows page limit error with specific label', () => {
    const record = { evaluation_job_status: 'failed', evaluation_job_error: 'OCR_PAGE_LIMIT_EXCEEDED: file page count exceeds API limit' };
    const state = getEvaluationCardState(record);
    expect(state.status).toBe('failed');
    expect(state.label).toBe('PDF 超过 MinerU 20 页限制');
    expect(state.error).toContain('MinerU');
  });

  it('returns idle state when no job projection exists', () => {
    const record = { evaluation_job_status: null };
    const state = getEvaluationCardState(record);
    expect(state.status).toBe('idle');
  });

  it('hides stale evaluation while a job is cancelled', () => {
    const state = getEvaluationCardState({
      evaluation_job_status: 'cancelled',
      ai_evaluation: { weighted_score: 80, summary: '旧结果' },
    });
    expect(state.status).toBe('cancelled');
    expect(state.label).toBe('已停止');
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

describe('getEvaluationCardState format failures', () => {
  it('labels invalid-format AI failures clearly', () => {
    const state = getEvaluationCardState({
      evaluation_job_status: 'failed',
      evaluation_job_error: 'AI_SCREENING_INVALID_SUMMARY: AI 返回提示词内容',
    });
    expect(state.status).toBe('failed');
    expect(state.label).toBe('评估失败');
    expect(state.error).toContain('格式');
  });

  it('labels invalid-dimension failures clearly', () => {
    const state = getEvaluationCardState({
      evaluation_job_status: 'failed',
      evaluation_job_error: 'AI_SCREENING_INVALID_DIMENSIONS: 缺少完整七项维度',
    });
    expect(state.error).toContain('维度');
  });
});

describe('isHardGateRejection', () => {
  it('detects a rejected screening with no weighted score as a hard gate, not a system error', () => {
    expect(isHardGateRejection({ screening_result: '不通过', match_score: null, evaluation_job_status: null })).toBe(true);
  });

  it('does not flag a passed screening with a score', () => {
    expect(isHardGateRejection({ screening_result: '通过', match_score: 3, evaluation_job_status: null })).toBe(false);
  });

  it('does not flag a record with an active job', () => {
    expect(isHardGateRejection({ screening_result: '不通过', match_score: null, evaluation_job_status: 'failed' })).toBe(false);
  });
});
