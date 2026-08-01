import { describe, expect, it } from 'vitest';
import { sortResumesNewestFirst } from '../../frontend/src/utils/resumeSort';

describe('sortResumesNewestFirst', () => {
  it('puts newly uploaded D1 resumes first using created_at', () => {
    const rows = [
      { id: 'older', created_at: '2026-08-01T04:00:00.000Z' },
      { id: 'newer', created_at: '2026-08-01T05:00:00.000Z' },
    ];

    expect(sortResumesNewestFirst(rows).map(row => row.id)).toEqual(['newer', 'older']);
  });
});
