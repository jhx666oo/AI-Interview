import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./List.tsx', import.meta.url), 'utf8');

describe('resume list business-screening wiring', () => {
  it('uses push and business-screening reject endpoints instead of the old HR talent-pool actions', () => {
    expect(source).toContain("request.post('/resumes/business-screening/push'");
    expect(source).toContain('request.post(`/resumes/${record.id}/business-screening/reject`');
    expect(source).not.toContain("request.post(`/resumes/${record.id}/approve-to-talent-pool`");
    expect(source).not.toContain("request.post('/resumes/batch-approve-to-talent-pool'");
  });

  it('renders the new push/reject action labels and business-screening status copy', () => {
    expect(source).toContain("getBusinessScreeningActions(record)");
    expect(source).toContain("handlePush(record)");
    expect(source).toContain("handleReject(record)");
    expect(source).toContain('批量推送');
    expect(source).toContain('批量淘汰');
    expect(source).toContain('待业务筛选');
    expect(source).toContain('业务已通过');
    expect(source).toContain('业务不通过');
    expect(source).not.toContain('批量入库');
    expect(source).not.toContain('不入库');
  });
});
