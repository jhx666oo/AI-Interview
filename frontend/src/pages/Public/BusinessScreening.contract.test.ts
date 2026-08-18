import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./BusinessScreening.tsx', import.meta.url), 'utf8');

describe('public business screening page contract', () => {
  it('keeps anonymous loading, expired, and generic error states in the page source', () => {
    expect(source).toContain('加载中...');
    expect(source).toContain('链接已失效');
    expect(source).toContain('请联系 HR 重新发送业务筛选链接。');
    expect(source).toContain('加载失败');
  });

  it('loads the token-scoped public API and posts approve/reject callbacks', () => {
    expect(source).toContain('`/public/business-screening/${token}`');
    expect(source).toContain('`/public/business-screening/${token}/resumes/${activeResume.id}/${action === \'approve\' ? \'approve\' : \'reject\'}`');
    expect(source).toContain('buildBusinessScreeningDecisionPayload(remark)');
  });

  it('renders card/detail layout with a mobile-safe grid fallback', () => {
    expect(source).toContain('business-screening-grid');
    expect(source).toContain('@media (max-width: 1024px)');
    expect(source).toContain('grid-template-columns: 1fr !important');
    expect(source).toContain('overflowWrap: \'anywhere\'');
    expect(source).toContain('business-screening-actions');
    expect(source).toContain('筛选备注');
    expect(source).toContain('候选人列表');
  });

  it('renders the structured candidate profile (parsed_data fields, no source file)', () => {
    expect(source).toContain('ProfileDescriptions');
    expect(source).toContain('候选人档案');
    expect(source).toContain('profile.workExperience?.length');
    expect(source).toContain('profile.educationHistory?.length');
    expect(source).toContain('selfEvaluation');
    expect(source).toContain('profile.skills?.length ? profile.skills.join(\'、\')');
    expect(source).toContain('<ProfileDescriptions profile={activeResume.profile} />');
    expect(source).toContain('暂无结构化档案');
  });

  it('renders the dynamic page title/subtitle from the batch with fallbacks', () => {
    expect(source).toContain('{data?.batch.title || \'业务筛选\'}');
    expect(source).toContain('{data?.batch.subtitle || \'请查看候选人信息并完成通过 / 淘汰决策。\'}');
  });

  it('labels single decisions as 通过/淘汰 and exposes batch approve/reject actions', () => {
    expect(source).toContain("passed: '已通过'");
    expect(source).toContain("rejected: '已淘汰'");
    expect(source).toContain("{submitting === 'approve' ? '提交中...' : '通过'}");
    expect(source).toContain("{submitting === 'reject' ? '提交中...' : '淘汰'}");
    expect(source).toContain('批量通过');
    expect(source).toContain('批量淘汰');
    expect(source).toContain('`/public/business-screening/${token}/batch/${action}`');
    expect(source).toContain('placeholder="可选：补充通过建议或淘汰原因"');
  });

  it('supports the select-all then deselect batch flow with per-candidate checkboxes', () => {
    expect(source).toContain('全选');
    expect(source).toContain('已选');
    expect(source).toContain('toggleSelectAll');
    expect(source).toContain('toggleSelect(resume.id)');
    expect(source).toContain('setSelectedIds(new Set(');
    expect(source).toContain('{ resumeIds: targetIds }');
    expect(source).toContain('checked={selectedIds.has(resume.id)}');
    expect(source).toContain('disabled={!selectable}');
    expect(source).toContain('请先勾选要处理的候选人');
  });
});
