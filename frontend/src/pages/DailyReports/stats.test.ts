import { expect, it } from 'vitest';
import { normalizeDailyReportStats } from './stats';

it('maps v2 snapshot totals to the fields used by the daily report UI', () => {
  expect(normalizeDailyReportStats({
    version: 'v2',
    reportDate: '2026-08-10',
    rows: [{
      owner: '何雨菱',
      openPositions: 8,
      todayNew: 1,
      pending: 3,
      todayApproved: 2,
      todayRejected: 0,
      todayInterviews: 1,
      todayOffers: 0,
      todayOnboarding: 0,
    }],
    totals: {
      openPositions: 10,
      allTimeResumes: 194,
      todayNew: 6,
      pending: 167,
      todayApproved: 2,
      todayRejected: 1,
      todayInterviews: 3,
      todayOffers: 2,
      todayOnboarding: 4,
    },
  })).toMatchObject({
    report_date: '2026-08-10',
    open_requisitions: 10,
    total_resumes: 194,
    today_new: 6,
    pending_screening: 167,
    approved_candidates: 2,
    rejected_candidates: 1,
    active_interviews: 3,
    offers_count: 2,
    onboarding_count: 4,
    rows: [{
      owner: '何雨菱',
      open_requisitions: 8,
      today_new: 1,
      pending_screening: 3,
      approved_candidates: 2,
      rejected_candidates: 0,
      active_interviews: 1,
      onboarding_count: 0,
    }],
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
