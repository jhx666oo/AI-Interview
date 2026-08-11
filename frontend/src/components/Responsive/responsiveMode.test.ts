import { describe, expect, it } from 'vitest';
import { getResponsiveMode } from './responsiveMode';

describe('getResponsiveMode', () => {
  it.each([
    [1180, 'full'],
    [1536, 'full'],
    [1179, 'compact'],
    [760, 'compact'],
    [759, 'narrow'],
    [390, 'narrow'],
  ])('maps %dpx to %s', (width, expected) => {
    expect(getResponsiveMode(width)).toBe(expected);
  });
});
