import { describe, expect, it } from 'vitest';
import { buildD1DashboardOverlay, type D1OverlayInput } from '../src/recruiting-operations/d1-dashboard-overlay';
import type { FeishuPositionMetric } from '../src/recruiting-operations/feishu-board-source';

const feishuPosition: FeishuPositionMetric = {
  feishu_record_id: 'rec-feishu-1',
  department: '职培事业部', position_name: '招聘专员', display_name: '招聘专员-杭州', city: '杭州',
  hrbps: ['雨菱'], priority: 'P1', status: '初筛中', headcount: 2, resume_push: 10,
  first_scheduled: 3, first_pass: 1, second_pass: 1, third_pass: null, offers: 0, hired: 0,
  elapsed_days: 5, weekly_target: 0, notes: '',
};

const baseInput: D1OverlayInput = {
  resumes: [
    { id: 'rec-feishu-1', position_id: '', position_applied: '招聘专员', mapped_position: '招聘专员', city: '杭州', resume_source: 'feishu', resume_source_record_id: 'rec-feishu-1', resume_ingest_key: 'feishu:rec-feishu-1' },
    { id: 'local-1', position_id: 'pos-local', position_applied: '招聘专员', mapped_position: '招聘专员', city: '杭州', resume_source: 'local_upload', resume_source_record_id: '', resume_ingest_key: 'file:local-1' },
    { id: 'local-1-retry', position_id: 'pos-local', position_applied: '招聘专员', mapped_position: '招聘专员', city: '杭州', resume_source: 'local_upload', resume_source_record_id: '', resume_ingest_key: 'file:local-1' },
  ],
  positions: [{ id: 'pos-local', title: '招聘专员', location: '杭州', department: '职培事业部', urgency: 'medium', status: 'open', headcount: 2, responsible_person: '雨菱' }],
  scheduled: [{ position_id: 'pos-local', count: 2 }],
  first_pass: [{ position_id: 'pos-local', count: 1 }],
  second_pass: [{ position_id: 'pos-local', count: 1 }],
  third_pass: [], offers: [], hired: [],
};

describe('D1 dashboard overlay', () => {
  it('does not double count Feishu synced records or duplicate ingest keys', () => {
    const overlay = buildD1DashboardOverlay(baseInput, [feishuPosition]);
    expect(overlay.byPosition['rec-feishu-1']?.resume_push_increment).toBe(1);
    expect(overlay.byPosition['rec-feishu-1']?.first_scheduled_increment).toBe(2);
    expect(overlay.byPosition['rec-feishu-1']?.source_resume_ids).toEqual(['local-1']);
  });

  it('returns a D1-only position when no Feishu position matches', () => {
    const input: D1OverlayInput = {
      ...baseInput,
      positions: [{ id: 'pos-new', title: '新岗位', location: '深圳', department: 'AI创新事业部', urgency: 'high', status: 'open', headcount: 1, responsible_person: '魏魏姐' }],
      resumes: [{ id: 'new-resume', position_id: 'pos-new', position_applied: '新岗位', mapped_position: '', city: '深圳', resume_source: 'email', resume_source_record_id: 'mail-1', resume_ingest_key: 'email:mail-1:0' }],
      scheduled: [{ position_id: 'pos-new', count: 1 }], first_pass: [], second_pass: [], third_pass: [], offers: [], hired: [],
    };
    const overlay = buildD1DashboardOverlay(input, [feishuPosition]);
    expect(overlay.d1OnlyPositions).toHaveLength(1);
    expect(overlay.d1OnlyPositions[0]).toMatchObject({ display_name: '新岗位-深圳', priority: 'P0', resume_push: 1, first_scheduled: 1 });
  });

  it('keeps unmatched resumes out of position totals', () => {
    const overlay = buildD1DashboardOverlay({ ...baseInput, resumes: [{ id: 'orphan', position_id: '', position_applied: '不存在', mapped_position: '', city: '', resume_source: 'unknown', resume_source_record_id: '', resume_ingest_key: 'unknown:orphan' }] }, [feishuPosition]);
    expect(overlay.unmatchedResumeCount).toBe(1);
    expect(Object.values(overlay.byPosition).every((row) => row.resume_push_increment === 0)).toBe(true);
  });
});
