import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('settings page actions', () => {
  it('wraps interviewer mapping header actions on narrow screens', () => {
    const source = readFileSync(new URL('./InterviewerMappings.tsx', import.meta.url), 'utf8');

    expect(source).toContain('actions={<Space wrap>');
  });

  it('wraps position mapping toolbar actions on narrow screens', () => {
    const source = readFileSync(new URL('./PositionMappings.tsx', import.meta.url), 'utf8');

    expect(source).toContain('actions={<Space wrap>');
  });
});
