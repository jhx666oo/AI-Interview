import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./InterviewCard.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./InterviewCard.css', import.meta.url), 'utf8');

describe('public interview card detail page contract', () => {
  it('loads the token-scoped public endpoint and keeps anonymous error states', () => {
    expect(source).toContain('`/public/interview-card/${token}`');
    expect(source).toContain('链接已失效');
    expect(source).toContain('加载面试详情失败');
  });

  it('renders the resume, AI result, HR note, business screening, interviews, and current status', () => {
    expect(source).toContain('候选人档案');
    expect(source).toContain('AI 初筛结果');
    expect(source).toContain('HR 备注');
    expect(source).toContain('业务筛选');
    expect(source).toContain('一面/二面评价');
    expect(source).toContain('当前状态');
    expect(source).toContain('简历原件');
  });

  it('keeps detail sections readable on narrow screens and supports the PDF links', () => {
    expect(source).toContain('interview-card-grid');
    expect(styles).toContain('@media (max-width: 768px)');
    expect(source).toContain('candidate.resume_file.preview_url');
    expect(source).toContain('download_url');
    expect(source).toContain('overflowWrap: \'anywhere\'');
  });
});
