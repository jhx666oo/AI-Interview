import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import {
  hasValidAiEvaluation,
} from '../src/resume-processing/types';

describe('hasValidAiEvaluation', () => {
  it('rejects null and undefined', () => {
    expect(hasValidAiEvaluation(null)).toBe(false);
    expect(hasValidAiEvaluation(undefined)).toBe(false);
  });

  it('rejects arrays', () => {
    expect(hasValidAiEvaluation([])).toBe(false);
    expect(hasValidAiEvaluation([1, 2])).toBe(false);
  });

  it('rejects empty objects', () => {
    expect(hasValidAiEvaluation({})).toBe(false);
    expect(hasValidAiEvaluation({ foo: 'bar' })).toBe(false);
  });

  it('accepts objects with non-empty dimensions array', () => {
    expect(hasValidAiEvaluation({ dimensions: [{ name: 'A', score: 4 }] })).toBe(true);
  });

  it('accepts objects with non-empty summary', () => {
    expect(hasValidAiEvaluation({ summary: '好候选人' })).toBe(true);
  });

  it('accepts objects with weighted_score', () => {
    expect(hasValidAiEvaluation({ weighted_score: 42 })).toBe(true);
  });

  it('rejects objects with empty summary', () => {
    expect(hasValidAiEvaluation({ summary: '' })).toBe(false);
  });

  it('parses valid JSON strings', () => {
    expect(hasValidAiEvaluation(JSON.stringify({ summary: 'ok' }))).toBe(true);
  });

  it('rejects malformed JSON strings', () => {
    expect(hasValidAiEvaluation('{ invalid')).toBe(false);
  });
});
