import { describe, expect, it } from 'vitest';
import { resolveInterviewAssignments, resolveStoredInterviewAssignments } from '../src/index';

describe('interview assignments', () => {
  it('keeps both manually entered interviewers', () => {
    expect(resolveInterviewAssignments({
      interviewer_name: '一面面试官',
      secondary_interviewer: '二面面试官',
    }, null)).toEqual({
      interviewer: '一面面试官',
      primaryInterviewer: '一面面试官',
      secondaryInterviewer: '二面面试官',
    });
  });

  it('falls back to the position defaults when no interviewer is entered', () => {
    expect(resolveInterviewAssignments({}, {
      primary_interviewer: '岗位一面',
      secondary_interviewer: '岗位二面',
    })).toEqual({
      interviewer: '岗位一面',
      primaryInterviewer: '岗位一面',
      secondaryInterviewer: '岗位二面',
    });
  });

  it('accepts the legacy interviewer field used by manual interview creation', () => {
    expect(resolveInterviewAssignments({ interviewer: '岗位一面' }, {
      primary_interviewer: '默认一面',
      secondary_interviewer: '岗位二面',
    })).toMatchObject({
      interviewer: '岗位一面',
      primaryInterviewer: '岗位一面',
      secondaryInterviewer: '岗位二面',
    });
  });
  it('fills a historical raw-position interview from the standard position defaults', () => {
    expect(resolveStoredInterviewAssignments({
      position_id: 'IoT产品经理（双休｜入职五险一金）',
      position_applied: '',
      interviewer: '',
      primary_interviewer: '',
      secondary_interviewer: '',
    }, {
      title: '软件产品经理（智能硬件方向）',
      primary_interviewer: '杜雁玲',
      secondary_interviewer: '何雨菱',
    })).toEqual({
      interviewer: '杜雁玲',
      primaryInterviewer: '杜雁玲',
      secondaryInterviewer: '何雨菱',
    });
  });

  it('keeps explicitly stored interviewers instead of replacing them with defaults', () => {
    expect(resolveStoredInterviewAssignments({
      interviewer: '已确认的一面',
      primary_interviewer: '已确认的一面',
      secondary_interviewer: '已确认的二面',
    }, {
      primary_interviewer: '岗位一面',
      secondary_interviewer: '岗位二面',
    })).toEqual({
      interviewer: '已确认的一面',
      primaryInterviewer: '已确认的一面',
      secondaryInterviewer: '已确认的二面',
    });
  });

  it('repairs legacy auto-assignment values stored against a raw position name', () => {
    expect(resolveStoredInterviewAssignments({
      position_id: 'IoT产品经理（双休｜入职五险一金）',
      position_applied: '',
      interviewer: '旧的一面',
      primary_interviewer: '旧的一面',
      secondary_interviewer: '旧的二面',
    }, {
      id: 'position-1',
      title: '软件产品经理（智能硬件方向）',
      primary_interviewer: '杜雁玲',
      secondary_interviewer: '何雨菱',
    })).toEqual({
      interviewer: '杜雁玲',
      primaryInterviewer: '杜雁玲',
      secondaryInterviewer: '何雨菱',
    });
  });

  it('keeps explicit values when the legacy position reference is already the standard title', () => {
    expect(resolveStoredInterviewAssignments({
      position_id: '软件产品经理（智能硬件方向）',
      position_applied: '',
      interviewer: '人工指定一面',
      primary_interviewer: '人工指定一面',
      secondary_interviewer: '人工指定二面',
    }, {
      id: 'position-1',
      title: '软件产品经理（智能硬件方向）',
      primary_interviewer: '岗位一面',
      secondary_interviewer: '岗位二面',
    })).toEqual({
      interviewer: '人工指定一面',
      primaryInterviewer: '人工指定一面',
      secondaryInterviewer: '人工指定二面',
    });
  });
});
