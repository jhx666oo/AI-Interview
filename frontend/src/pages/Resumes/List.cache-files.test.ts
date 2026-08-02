import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('resume list background work', () => {
  it('does not invoke the Feishu attachment cache every time the list loads', () => {
    const source = readFileSync(new URL('./List.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain("request.post('/resumes/cache-files')");
  });
});
