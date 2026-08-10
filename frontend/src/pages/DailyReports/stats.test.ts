import { expect, it } from 'vitest';
import { normalizeDailyReportStats } from './stats';

it('maps v2 snapshot totals to the fields used by the daily report UI', () => {
  expect(normalizeDailyReportStats({
    version: 'v2',
    reportDate: '2026-08-10',
    totals: {
      openPositions: 10,
      allTimeResumes: 194,
      pending: 167,
      todayApproved: 2,
      todayRejected: 1,
      todayInterviews: 3,
      todayOnboarding: 4,
    },
  })).toEqual({
    report_date: '2026-08-10',
    open_requisitions: 10,
    total_resumes: 194,
    pending_screening: 167,
    approved_candidates: 2,
    rejected_candidates: 1,
    active_interviews: 3,
    onboarding_count: 4,
  });
});

it('keeps legacy stored stats compatible', () => {
  expect(normalizeDailyReportStats(JSON.stringify({
    report_date: '2026-08-09',
    open_requisitions: 8,
    total_resumes: 90,
    pending_screening: 12,
    approved_candidates: 3,
    rejected_candidates: 2,
    active_interviews: 4,
    onboarding_count: 1,
  }))).toMatchObject({
    open_requisitions: 8,
    total_resumes: 90,
    pending_screening: 12,
    approved_candidates: 3,
    rejected_candidates: 2,
    active_interviews: 4,
    onboarding_count: 1,
  });
});

it('returns null for missing or malformed stats', () => {
  expect(normalizeDailyReportStats(null)).toBeNull();
  expect(normalizeDailyReportStats('{bad json')).toBeNull();
});
