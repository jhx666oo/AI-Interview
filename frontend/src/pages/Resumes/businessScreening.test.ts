import { describe, expect, it } from 'vitest';
import {
  getBusinessScreeningActions,
  getBusinessScreeningStatusMeta,
  inferBusinessScreeningStatus,
  summarizePushResult,
} from './businessScreening';

describe('resume business screening helpers', () => {
  it('shows 淘汰 for AI-passed resumes that are not yet pushed (AI 通过自动进链接，提供撤回)', () => {
    const actions = getBusinessScreeningActions({
      status: 'pending_review',
      screening_result: '通过',
      hr_disposition: 'pending',
      business_screening_status: 'not_ready',
    });

    expect(actions.primary).toBeNull();
    expect(actions.secondary).toEqual({ key: 'reject', label: '淘汰' });
    expect(actions.tags).toEqual([]);
  });

  it('shows 淘汰 while waiting for business screening after AI-passed auto-push', () => {
    const actions = getBusinessScreeningActions({
      status: 'pending_review',
      screening_result: '通过',
      hr_disposition: 'pushed',
      business_screening_status: 'pending',
    });

    expect(actions.primary).toBeNull();
    expect(actions.secondary).toEqual({ key: 'reject', label: '淘汰' });
    expect(actions.tags.map((tag) => tag.label)).toContain('待业务筛选');
  });

  it('shows push for AI-rejected resumes that are not otherwise terminal', () => {
    const actions = getBusinessScreeningActions({
      status: 'pending_review',
      screening_result: '不通过',
      hr_disposition: 'pending',
      business_screening_status: 'not_ready',
    });

    expect(actions.primary).toEqual({ key: 'push', label: '推送' });
    expect(actions.secondary).toBeNull();
  });

  it('shows push for resumes without an AI screening result', () => {
    const actions = getBusinessScreeningActions({
      status: 'pending_screening',
      screening_result: null,
      hr_disposition: 'pending',
      business_screening_status: 'not_ready',
    });

    expect(actions.primary).toEqual({ key: 'push', label: '推送' });
  });

  it('keeps push hidden for HR-rejected and completed business-screening resumes', () => {
    expect(getBusinessScreeningActions({
      status: 'pending_review',
      screening_result: '不通过',
      hr_disposition: 'rejected',
      business_screening_status: 'not_ready',
    }).primary).toBeNull();

    expect(getBusinessScreeningActions({
      status: 'pending_review',
      screening_result: '不通过',
      hr_disposition: 'pushed',
      business_screening_status: 'pending',
    }).primary).toBeNull();

    expect(getBusinessScreeningActions({
      status: 'pending_review',
      screening_result: '不通过',
      hr_disposition: 'pushed',
      business_screening_status: 'passed',
    }).primary).toBeNull();
  });

  it('keeps push hidden for pushed resumes that are still marked not_ready', () => {
    const actions = getBusinessScreeningActions({
      status: 'pending_review',
      screening_result: '不通过',
      hr_disposition: 'pushed',
      business_screening_status: 'not_ready',
    });

    expect(actions.primary).toBeNull();
  });

  it('shows completed business screening outcomes instead of the old HR approval action', () => {
    expect(getBusinessScreeningActions({
      status: 'approved',
      screening_result: '通过',
      hr_disposition: 'pushed',
      business_screening_status: 'passed',
    }).tags.map((tag) => tag.label)).toContain('业务已通过');

    expect(getBusinessScreeningActions({
      status: 'rejected',
      screening_result: '通过',
      hr_disposition: 'pushed',
      business_screening_status: 'rejected',
    }).tags.map((tag) => tag.label)).toContain('业务不通过');
  });

  it('defaults resumes without business push state to not_ready even when they were approved after AI screening', () => {
    expect(inferBusinessScreeningStatus({
      status: 'approved',
      screening_result: '通过',
      hr_disposition: 'pending',
      business_screening_status: undefined,
    })).toBe('not_ready');
  });

  it('shows 淘汰 for an unpushed AI-passed resume with a stale pending marker', () => {
    const actions = getBusinessScreeningActions({
      status: 'pending_review',
      screening_result: '通过',
      hr_disposition: 'pending',
      business_screening_status: 'pending',
    });

    expect(actions.primary).toBeNull();
    expect(actions.secondary).toEqual({ key: 'reject', label: '淘汰' });
    expect(actions.tags).toEqual([]);
  });

  it('maps status filter values to the correct list params', () => {
    expect(getBusinessScreeningStatusMeta('business_screening_pending')).toEqual({
      color: 'processing',
      text: '待业务筛选',
      params: { business_screening_status: 'pending' },
    });
    expect(getBusinessScreeningStatusMeta('business_screening_passed')).toEqual({
      color: 'success',
      text: '业务已通过',
      params: { business_screening_status: 'passed' },
    });
    expect(getBusinessScreeningStatusMeta('business_screening_rejected')).toEqual({
      color: 'error',
      text: '业务不通过',
      params: { business_screening_status: 'rejected' },
    });
  });

  it('summarizes batch push results with pushed, skipped, failed, and interviewer batches', () => {
    expect(summarizePushResult({
      pushed: ['1', '2'],
      skipped: [{ id: '3', reason: '岗位未配置有效责任人' }],
      failed: [{ interviewer: '张三', reason: '当前账号未授权飞书身份，无法发送业务筛选链接' }],
      batches: [{ batchId: 'batch-1', interviewer: '李四', url: 'https://example.com', itemCount: 2 }],
    })).toBe('推送完成：成功 2 份，跳过 1 份，发送失败 1 个责任人批次，生成 1 个推送批次');
  });
});
