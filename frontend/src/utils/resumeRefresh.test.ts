import { describe, expect, it } from 'vitest';
import { createRefreshVersion } from './resumeRefresh';

describe('resume refresh versioning', () => {
  it('rejects a response captured before a resume mutation', () => {
    const version = createRefreshVersion();
    const requestVersion = version.capture();

    version.invalidate();

    expect(version.isCurrent(requestVersion)).toBe(false);
    expect(version.isCurrent(version.capture())).toBe(true);
  });
});
