import { describe, expect, it } from 'vitest';
import { getLayoutMode } from './responsive';

describe('getLayoutMode', () => {
  it.each([
    [1920, 'desktop'],
    [1200, 'desktop'],
    [1199, 'compact'],
    [768, 'compact'],
    [767, 'mobile'],
    [480, 'mobile'],
    [479, 'narrow'],
    [390, 'narrow'],
  ] as const)('maps %dpx to %s', (width, expected) => {
    expect(getLayoutMode(width)).toBe(expected);
  });
});
