import { describe, expect, it } from 'vitest';
import {
  decideBusinessScreening,
  groupEligibleResumesForPush,
  isEligibleForPush,
} from '../src/business-screening/service';
import type { InterviewerDirectoryEntry } from '../src/business-screening/types';

describe('business screening service', () => {
  it('allows pushing only AI-passed resumes that are not HR-rejected and have an interviewer binding', () => {
    expect(isEligibleForPush(
      { id: 'r-ok', screening_result: '通过', status: 'pending_review', hr_disposition: 'pending', mapped_position: '标准运营', business_screening_status: 'not_ready' },
      { name: '张三', openId: 'ou_123' },
    )).toEqual({ ok: true });

    expect(isEligibleForPush(
      { id: 'r-ai-fail', screening_result: '不通过', status: 'pending_review', hr_disposition: 'pending', mapped_position: '标准运营' },
      { name: '张三', openId: 'ou_123' },
    )).toEqual({ ok: false, reason: 'AI初筛未通过' });

    expect(isEligibleForPush(
      { id: 'r-legacy-rejected', screening_result: '通过', status: 'rejected', hr_disposition: 'pending', mapped_position: '标准运营' },
      { name: '张三', openId: 'ou_123' },
    )).toEqual({ ok: false, reason: 'HR已淘汰该简历' });

    expect(isEligibleForPush(
      { id: 'r-hr-rejected', screening_result: '通过', status: 'pending_review', hr_disposition: 'rejected', mapped_position: '标准运营' },
      { name: '张三', openId: 'ou_123' },
    )).toEqual({ ok: false, reason: 'HR已淘汰该简历' });

    expect(isEligibleForPush(
      { id: 'r-business-pending', screening_result: '通过', status: 'pending_review', hr_disposition: 'pushed', mapped_position: '标准运营', business_screening_status: 'pending' },
      { name: '张三', openId: 'ou_123' },
    )).toEqual({ ok: false, reason: '业务筛选已发起，请使用批次重发' });

    expect(isEligibleForPush(
      { id: 'r-business-passed', screening_result: '通过', status: 'pending_review', hr_disposition: 'pushed', mapped_position: '标准运营', business_screening_status: 'passed' },
      { name: '张三', openId: 'ou_123' },
    )).toEqual({ ok: false, reason: '业务筛选已完成' });

    expect(isEligibleForPush(
      { id: 'r-business-rejected', screening_result: '通过', status: 'pending_review', hr_disposition: 'pushed', mapped_position: '标准运营', business_screening_status: 'rejected' },
      { name: '张三', openId: 'ou_123' },
    )).toEqual({ ok: false, reason: '业务筛选已完成' });

    expect(isEligibleForPush(
      { id: 'r-no-position', screening_result: '通过', status: 'pending_review', hr_disposition: 'pending', mapped_position: '' },
      { name: '张三', openId: 'ou_123' },
    )).toEqual({ ok: false, reason: '缺少标准岗位' });

    expect(isEligibleForPush(
      { id: 'r-no-interviewer', screening_result: '通过', status: 'pending_review', hr_disposition: 'pending', mapped_position: '标准运营' },
      { name: '', openId: '' },
    )).toEqual({ ok: false, reason: '岗位未配置有效责任人' });
  });

  it('groups only eligible resumes into one batch per responsible person', () => {
    const interviewerDirectory: InterviewerDirectoryEntry[] = [
      { name: '张三', openId: 'ou_zhang' },
      { name: '李四', openId: 'ou_li' },
    ];
    const positions = [
      { id: 'p1', title: '标准运营', primary_interviewer: '张三', secondary_interviewer: '李四', responsible_person: '张三' },
      { id: 'p2', title: '销售', primary_interviewer: '李四', secondary_interviewer: '', responsible_person: '李四' },
    ];
    const groups = groupEligibleResumesForPush(
      [
        { id: 'r1', screening_result: '通过', status: 'pending_review', hr_disposition: 'pending', mapped_position: '标准运营', position_applied: '运营专员' },
        { id: 'r2', screening_result: '通过', status: 'pending_review', hr_disposition: 'pending', mapped_position: '销售', position_applied: '销售' },
        { id: 'r3', screening_result: '不通过', status: 'pending_review', hr_disposition: 'pending', mapped_position: '标准运营', position_applied: '运营专员' },
        { id: 'r4', screening_result: '通过', status: 'pending_review', hr_disposition: 'rejected', mapped_position: '标准运营', position_applied: '运营专员' },
      ],
      positions,
      interviewerDirectory,
    );

    expect([...groups.keys()]).toEqual(['张三', '李四']);
    expect(groups.get('张三')).toMatchObject({
      interviewer: { name: '张三', openId: 'ou_zhang' },
      positionTitles: ['标准运营'],
    });
    expect(groups.get('李四')).toMatchObject({
      interviewer: { name: '李四', openId: 'ou_li' },
      positionTitles: ['销售'],
    });
    expect(groups.get('张三')?.resumes.map((resume) => resume.id)).toEqual(['r1']);
    expect(groups.get('李四')?.resumes.map((resume) => resume.id)).toEqual(['r2']);
  });

  it('resolves raw resume positions to standard titles before grouping', () => {
    const interviewerDirectory: InterviewerDirectoryEntry[] = [
      { name: '张三', openId: 'ou_zhang' },
    ];
    const positions = [
      { id: 'p1', title: '标准运营', primary_interviewer: '张三', secondary_interviewer: '', responsible_person: '张三' },
    ];
    const resolveStandardTitle = (raw: string): string => (
      raw === 'IoT产品经理（双休｜入职五险一金）' ? '标准运营' : raw
    );
    const groups = groupEligibleResumesForPush(
      [
        { id: 'r1', screening_result: '通过', status: 'pending_review', hr_disposition: 'pending', mapped_position: 'IoT产品经理（双休｜入职五险一金）', position_applied: 'IoT产品经理（双休｜入职五险一金）' },
      ],
      positions,
      interviewerDirectory,
      resolveStandardTitle,
    );

    expect([...groups.keys()]).toEqual(['张三']);
    expect(groups.get('张三')?.resumes.map((resume) => resume.id)).toEqual(['r1']);
    expect(groups.get('张三')?.positionTitles).toEqual(['标准运营']);
  });

  it('keeps completed interviewer decisions idempotent', () => {
    expect(decideBusinessScreening('pending', 'approve')).toEqual({
      nextStatus: 'passed',
      changed: true,
      terminal: true,
    });
    expect(decideBusinessScreening('passed', 'approve')).toEqual({
      nextStatus: 'passed',
      changed: false,
      terminal: true,
    });
    expect(decideBusinessScreening('passed', 'reject')).toEqual({
      nextStatus: 'passed',
      changed: false,
      terminal: true,
      reason: 'business screening already completed',
    });
    expect(decideBusinessScreening('rejected', 'approve')).toEqual({
      nextStatus: 'rejected',
      changed: false,
      terminal: true,
      reason: 'business screening already completed',
    });
  });
});
