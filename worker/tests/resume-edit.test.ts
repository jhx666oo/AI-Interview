import { describe, expect, it } from 'vitest';
import { normalizeResumeEditPayload } from '../src/index';

describe('resume edit payload', () => {
  it('keeps only editable fields and trims text values', () => {
    expect(normalizeResumeEditPayload({
      candidate_name: '  张三 ',
      email: ' zhang@example.com ',
      contact: ' 13800000000 ',
      status: 'approved',
      ai_evaluation: '{}',
    })).toEqual({
      candidate_name: '张三',
      email: 'zhang@example.com',
      contact: '13800000000',
    });
  });

  it('allows partial updates and ignores undefined values', () => {
    expect(normalizeResumeEditPayload({ candidate_name: '李四', email: undefined })).toEqual({ candidate_name: '李四' });
  });
});
