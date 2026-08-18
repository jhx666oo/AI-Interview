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
    expect(position?.hrbps).toEqual(['何雨菱']);
  });

  it('accepts the Excel snapshot aliases for final pass and weekly target', () => {
    const position = normalizeFeishuPositionRecord({
      record_id: 'rec-excel',
      table: 'zhipei',
      fields: {
        岗位名称: 'Excel岗位',
        招聘状态: '复试中',
        终面通过: 3,
        本周需完结: 2,
      },
    });

    expect(position?.third_pass).toBe(3);
    expect(position?.weekly_target).toBe(2);
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

  it('applies the Miaoda pension fallback when arranged first interviews are empty', () => {
    const position = normalizeFeishuPositionRecord({
      record_id: 'rec-yanglao-fallback',
      table: 'yanglao',
      fields: {
        岗位名称: '商家运营专员',
        城市: '杭州',
        所属事业部: '雏渐肥事业部',
        招聘状态: '初筛中',
        在招人数: 1,
        简历推送: 7,
        '安排 1 面': 0,
      },
    });

    expect(position?.first_scheduled).toBe(7);
  });

  it('resolves Miaoda HRBP ids and position-city fallbacks', () => {
    const byId = normalizeFeishuPositionRecord({
      record_id: 'rec-hrbp-id',
      table: 'zhipei',
      fields: {
        岗位名称: '招聘销售',
        城市: '北京',
        负责HRBP: [{ id: '1803521547169955' }],
      },
    });
    const byPosition = normalizeFeishuPositionRecord({
      record_id: 'rec-hrbp-fallback',
      table: 'yanglao',
      fields: {
        岗位名称: '商家运营专员',
        城市: '杭州',
        所属事业部: '雏渐肥事业部',
      },
    });

    expect(byId?.hrbps).toEqual(['魏秋柠']);
    expect(byPosition?.hrbps).toEqual(['杜雁玲']);
  });

  it('keeps an empty Feishu formula object null for final-pass fallback', () => {
    const position = normalizeFeishuPositionRecord({
      record_id: 'rec-empty-final',
      table: 'zhipei',
      fields: {
        岗位名称: '空终面岗位',
        '2面通过': 4,
        '3面通过': { value: [] },
      },
    })!;

    expect(position.third_pass).toBeNull();
    expect(finalPass(position)).toBe(4);
  });

  it('excludes any cancelled status variant and preserves the Miaoda extended fields', () => {
    const position = normalizeFeishuPositionRecord({
      record_id: 'rec-extended',
      table: 'zhipei',
      fields: {
        岗位名称: '扩展字段岗位',
        招聘状态: '取消',
        在招人数: 1,
        岗位编号: 'P-001',
        发布名称: '扩展字段岗位-北京',
        岗位JD: '负责招聘流程',
        简历分级标准: '优先本科',
        一面官: [{ name: '尹艺涵' }],
        终面官: [{ name: '王凯月' }],
        期望交付日: '2026-08-31',
        待招人数: 2,
        面试通过率: 14.9,
        开始周期: '2026-07-17',
        结束周期: '2026-08-31',
      },
    })!;

    expect(isStatisticalPosition(position)).toBe(false);
    expect(position).toMatchObject({
      position_code: 'P-001',
      publish_name: '扩展字段岗位-北京',
      job_description: '负责招聘流程',
      resume_grade_standard: '优先本科',
      first_interviewers: ['尹艺涵'],
      final_interviewers: ['王凯月'],
      expected_delivery_date: '2026-08-31',
      remaining_headcount: 2,
      interview_pass_rate: 14.9,
      start_date: '2026-07-17',
      end_date: '2026-08-31',
    });
  });
});
