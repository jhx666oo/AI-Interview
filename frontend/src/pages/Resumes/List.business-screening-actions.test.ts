import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./List.tsx', import.meta.url), 'utf8');

describe('resume list business-screening wiring', () => {
  it('pushes by position from the toolbar (岗位 → 该岗位全部 AI 通过简历) and keeps eliminate for single rows', () => {
    expect(source).toContain("request.post('/positions/business-screening/push'");
    expect(source).toContain('position: pushPosition');
    expect(source).toContain('request.post(`/resumes/${record.id}/business-screening/eliminate`');
    expect(source).not.toContain('request.post(`/resumes/${record.id}/business-screening/manual-push`');
    expect(source).not.toContain('request.post(`/resumes/${record.id}/business-screening/reject`');
    expect(source).not.toContain("request.post(`/resumes/${record.id}/approve-to-talent-pool`");
    expect(source).not.toContain("request.post('/resumes/batch-approve-to-talent-pool'");
  });

  it('lets the HR choose a link expiry (7d default / 30d / 90d / permanent) on push', () => {
    expect(source).toContain('expires_in_days: pushExpiry');
    expect(source).toContain('useState<number>(7)');
    expect(source).toContain('{ label: \'7天\', value: 7 }');
    expect(source).toContain('{ label: \'30天\', value: 30 }');
    expect(source).toContain('{ label: \'90天\', value: 90 }');
    expect(source).toContain('{ label: \'永久\', value: 0 }');
    expect(source).toContain('链接有效期');
    expect(source).toContain('永久链接长期公开，简历被淘汰或重新推送后自动失效');
  });

  it('renders the push-by-position toolbar action and eliminate action labels with business-screening status copy', () => {
    expect(source).toContain("getBusinessScreeningActions(record)");
    expect(source).toContain('handlePushByPosition');
    expect(source).toContain('handleReject(record)');
    expect(source).toContain('批量推送');
    expect(source).toContain('批量淘汰');
    expect(source).toContain('待业务筛选');
    expect(source).toContain('业务已通过');
    expect(source).toContain('业务不通过');
    expect(source).toContain('已移出业务链接');
    expect(source).not.toContain('批量入库');
    expect(source).not.toContain('不入库');
  });
});
