import { describe, expect, it } from 'vitest';
import { resolveInterviewAssignments } from '../src/index';

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
});
