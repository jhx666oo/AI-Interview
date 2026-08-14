import { describe, expect, it } from 'vitest';
import { mergeInterviewerDirectoryEntries } from '../src/interviewer-directory';

describe('interviewer directory', () => {
  it('includes mapped Feishu interviewers even when they are not system users', () => {
    expect(mergeInterviewerDirectoryEntries(
      [{ id: 'hr-1', full_name: '杜雁玲', role: 'hr', is_active: 1 }],
      [{ id: 'mapping-1', name: '何雨菱', open_id: 'ou_he' }],
    )).toEqual([
      { id: 'hr-1', full_name: '杜雁玲', name: '杜雁玲', email: '' },
      { id: 'mapping-1', full_name: '何雨菱', name: '何雨菱', email: '' },
    ]);
  });

  it('deduplicates a mapped name that is already present in the user directory', () => {
    expect(mergeInterviewerDirectoryEntries(
      [{ id: 'user-1', full_name: '杜雁玲', email: 'du@example.com' }],
      [{ id: 'mapping-1', name: '杜雁玲', open_id: 'ou_du' }],
    )).toEqual([
      { id: 'user-1', full_name: '杜雁玲', name: '杜雁玲', email: 'du@example.com' },
    ]);
  });
});
