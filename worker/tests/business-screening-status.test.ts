import { describe, expect, it } from 'vitest';
import {
  buildBusinessScreeningStatusSqlClause,
  exposeBusinessScreeningState,
  inferBusinessScreeningStatus,
} from '../src/resume-list/business-screening-status';

describe('resume business-screening state', () => {
  it('does not expose a stale pending state for a resume that was never pushed', () => {
    const record = {
      id: 'resume-unpushed',
      hr_disposition: 'pending',
      business_screening_status: 'pending',
    };

    expect(inferBusinessScreeningStatus(record)).toBe('not_ready');
    expect(exposeBusinessScreeningState(record)).toMatchObject({
      hr_disposition: 'pending',
      business_screening_status: 'not_ready',
    });
  });

  it('only treats a pushed resume as pending business screening', () => {
    expect(inferBusinessScreeningStatus({
      hr_disposition: 'pushed',
      business_screening_status: 'not_ready',
    })).toBe('pending');
  });

  it('requires the pushed marker when filtering pending business screening resumes', () => {
    const filter = buildBusinessScreeningStatusSqlClause('pending');

    expect(filter.clause).toContain("r.hr_disposition = 'pushed'");
    expect(filter.clause).toContain("r.business_screening_status = ? AND r.hr_disposition = 'pushed'");
  });
});
