import { describe, expect, it } from 'vitest';
import {
  finalPass,
  isCycleEligiblePosition,
  isP2Position,
  isStatisticalPosition,
  normalizeFeishuPositionRecord,
} from '../src/recruiting-operations/feishu-board-source';

describe('Feishu dashboard source adapter', () => {
  it('normalizes vocational-training field names and user selectors', () => {
    const position = normalizeFeishuPositionRecord({
      record_id: 'rec-1',
      table: 'zhipei',
      fields: {
        岗位名称: '招聘专员',
        城市: '杭州',
        所属部门: '职培事业部',
        负责HRBP: [{ id: 'ou-1', name: '雨菱' }],
        优先级: 'P1-正常',
        招聘状态: '初筛中',
        在招人数: 2,
        简历推送: 8,
        安排1面: 4,
        '1面通过': 2,
        '2面通过': 1,
        '3面通过': 0,
        发放Offer数: 1,
        入职数: 1,
        已耗时天数: { value: 12 },
        本周需完结数: 1,
        备注: '重点岗位',
      },
    });

    expect(position).toMatchObject({
      feishu_record_id: 'rec-1',
      department: '职培事业部',
      display_name: '招聘专员-杭州',
      hrbps: ['雨菱'],
      priority: 'P1',
      headcount: 2,
      resume_push: 8,
      first_scheduled: 4,
      third_pass: 0,
      weekly_target: 1,
    });
  });

  it('normalizes pension table department names and spaced fields', () => {
    const position = normalizeFeishuPositionRecord({
      record_id: 'rec-2',
      table: 'yanglao',
      fields: {
        岗位名称: '护理部主任',
        城市: '长沙',
        所属事业部: '养老及商业事业部',
        招聘状态: '已完成',
        优先级: 'P0-紧急',
        在招人数: '1',
        '安排 1 面': '3',
        '1 面通过': '2',
        '2 面通过': '1',
        '3 面通过': '',
        '发放 Offer数': '1',
        入职数: '0',
        已耗时天数: '5天',
      },
    });

    expect(position?.department).toBe('养老及商业事业部');
    expect(position?.first_scheduled).toBe(3);
    expect(position?.first_pass).toBe(2);
    expect(position?.elapsed_days).toBe(5);
    expect(position?.hrbps).toEqual(['未分配']);
  });

  it('keeps cancelled rows out of main stats but allows completed cycle stats', () => {
    const cancelled = normalizeFeishuPositionRecord({
      record_id: 'rec-cancelled',
      table: 'zhipei',
      fields: { 岗位名称: '取消岗位', 招聘状态: '已取消', 优先级: 'P1', 在招人数: 1, 已耗时天数: 4 },
    })!;
    const completed = { ...cancelled, status: '已完成', feishu_record_id: 'rec-completed' };
    expect(isStatisticalPosition(cancelled)).toBe(false);
    expect(isCycleEligiblePosition(cancelled)).toBe(true);
    expect(isCycleEligiblePosition(completed)).toBe(true);
  });

  it('separates P2 and treats numeric zero as a real final-round value', () => {
    const position = normalizeFeishuPositionRecord({
      record_id: 'rec-p2', table: 'zhipei', fields: { 岗位名称: '储备岗位', 优先级: 'P2-储备', 在招人数: 1, '2面通过': 4, '3面通过': 0 },
    })!;
    expect(isP2Position(position)).toBe(true);
    expect(isStatisticalPosition(position)).toBe(false);
    expect(finalPass(position)).toBe(0);
  });
});
