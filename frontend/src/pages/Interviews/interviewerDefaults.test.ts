import { describe, expect, it } from 'vitest';
import {
  buildCreateFromTalentPayload,
  resolveScheduleInterviewerDefaults,
  resolveScheduleInterviewerPrefill,
} from './interviewerDefaults';

describe('resolveScheduleInterviewerPrefill（弹窗面试官初始值）', () => {
  it('优先记录已安排的面试官，其次才是岗位匹配的默认面试官', () => {
    // 周佳场景：记录已有金皓翔/黄维，岗位默认是魏秋柠/练童 → 必须显示记录的
    expect(resolveScheduleInterviewerPrefill({
      primary_interviewer: '金皓翔',
      secondary_interviewer: '黄维',
    }, { interviewerName: '魏秋柠', secondaryInterviewer: '练童' })).toEqual({
      interviewer_name: '金皓翔',
      secondary_interviewer: '黄维',
    });
  });

  it('记录面试官为空时回退岗位匹配的默认面试官', () => {
    expect(resolveScheduleInterviewerPrefill({
      primary_interviewer: '',
      secondary_interviewer: '',
    }, { interviewerName: '魏秋柠', secondaryInterviewer: '练童' })).toEqual({
      interviewer_name: '魏秋柠',
      secondary_interviewer: '练童',
    });
  });

  it('没有默认值时保持为空', () => {
    expect(resolveScheduleInterviewerPrefill({}, null)).toEqual({
      interviewer_name: undefined,
      secondary_interviewer: undefined,
    });
  });
});

describe('interviewer scheduling defaults', () => {
  const positions = [
    { title: '产品经理', primary_interviewer: '张三', secondary_interviewer: '李四' },
    { title: '运营经理', primary_interviewer: '王五', secondary_interviewer: '' },
  ];

  it('prefers the standard position title and falls back to the applied position title', () => {
    expect(resolveScheduleInterviewerDefaults({
      standard_position: '产品经理',
      position_applied: '产品经理（上海）',
    }, positions)).toEqual({
      interviewerName: '张三',
      secondaryInterviewer: '李四',
      matchedPositionTitle: '产品经理',
    });

    expect(resolveScheduleInterviewerDefaults({
      standard_position: '',
      position_applied: '运营经理',
    }, positions)).toEqual({
      interviewerName: '王五',
      secondaryInterviewer: '',
      matchedPositionTitle: '运营经理',
    });

    expect(resolveScheduleInterviewerDefaults({
      standard_position: 'iot',
      position_applied: 'iot',
    }, [{ title: '软件产品经理（智能硬件方向）', primary_interviewer: '杜雁玲', secondary_interviewer: '何雨菱' }])).toEqual({
      interviewerName: '杜雁玲',
      secondaryInterviewer: '何雨菱',
      matchedPositionTitle: '软件产品经理（智能硬件方向）',
    });
  });

  it('stores frontend defaults when HR leaves the fields unchanged and keeps overrides when provided', () => {
    const defaults = {
      interviewerName: '张三',
      secondaryInterviewer: '李四',
      matchedPositionTitle: '产品经理',
    };

    expect(buildCreateFromTalentPayload({
      record: {
        candidate_name: '候选人甲',
        position_applied: '产品经理',
        standard_position: '产品经理',
        city: '上海',
        feishu_record_id: 'resume-1',
      },
      values: {
        interview_location: 'A 会议室',
        interviewer_name: '',
        secondary_interviewer: '',
      },
      defaults,
      interviewTime: '2026-08-12 14:00',
    })).toMatchObject({
      candidate_name: '候选人甲',
      interviewer_name: '张三',
      secondary_interviewer: '李四',
      interview_time: '2026-08-12 14:00',
    });

    expect(buildCreateFromTalentPayload({
      record: {
        candidate_name: '候选人甲',
        position_applied: '产品经理',
        standard_position: '产品经理',
        city: '上海',
        feishu_record_id: 'resume-1',
      },
      values: {
        interview_location: 'A 会议室',
        interviewer_name: '赵六',
        secondary_interviewer: '孙七',
      },
      defaults,
      interviewTime: '2026-08-12 14:00',
    })).toMatchObject({
      interviewer_name: '赵六',
      secondary_interviewer: '孙七',
    });
  });
});
