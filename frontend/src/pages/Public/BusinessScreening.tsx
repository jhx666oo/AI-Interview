import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card, Tag, Typography } from 'antd';
import request from '../../utils/request';
import {
  applyBusinessScreeningDecision,
  buildBusinessScreeningDecisionPayload,
  classifyBusinessScreeningLoadError,
  mapBusinessScreeningDecisionError,
  pickActiveBusinessScreeningResumeId,
  type BusinessScreeningProfile,
  type BusinessScreeningResume,
  type BusinessScreeningView,
} from './businessScreeningLogic';
import {
  asDisplayTextList,
  formatWeightedScore,
  getScreeningGateRows,
  normalizeResumeEvaluation,
} from '../../utils/resumeEvaluation';

const { Text } = Typography;

const STATUS_LABELS: Record<BusinessScreeningResume['status'], string> = {
  pending: '待处理',
  passed: '已入库',
  rejected: '不入库',
};

const formatTime = (value?: string) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const shellStyle: React.CSSProperties = {
  minHeight: '100vh',
  background: '#f8fafc',
  padding: '16px',
};

const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 16,
  boxShadow: '0 8px 24px rgba(15, 23, 42, 0.08)',
};

const profileRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(96px, 132px) minmax(0, 1fr)',
  borderBottom: '1px solid #eef2f7',
};

const profileLabelStyle: React.CSSProperties = {
  background: '#f8fafc',
  color: '#475569',
  fontSize: 13,
  padding: '10px 14px',
  borderRight: '1px solid #eef2f7',
};

const profileValueStyle: React.CSSProperties = {
  color: '#1e293b',
  fontSize: 14,
  padding: '10px 14px',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
};

function formatProfileDuration(entry: { start?: string; end?: string; duration?: string }): string {
  if (entry.duration) return entry.duration;
  if (entry.start || entry.end) return `${entry.start || ''}~${entry.end || ''}`;
  return '';
}

function ProfileDescriptions({ profile }: { profile: BusinessScreeningProfile }) {
  const rows: Array<{ label: string; value?: string; full?: boolean }> = [
    { label: '学历', value: profile.highestDegree },
    { label: '毕业院校', value: profile.school },
    { label: '专业', value: profile.major },
    { label: '工作年限', value: profile.yearsOfExperience },
    { label: '最近公司', value: profile.recentCompany },
    { label: '当前职位', value: profile.currentTitle },
    { label: '性别', value: profile.gender },
    { label: '出生年月', value: profile.birthday },
    { label: '技能', value: profile.skills?.length ? profile.skills.join('、') : undefined },
    { label: '证书/资质', value: profile.certifications?.length ? profile.certifications.join('、') : undefined },
    { label: '自我评价', value: profile.selfEvaluation, full: true },
    { label: '工作经历', value: undefined, full: true },
    { label: '教育经历', value: undefined, full: true },
  ];

  return (
    <div className="business-screening-profile" style={{ marginTop: 20, border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '10px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontWeight: 600, fontSize: 15 }}>
        候选人档案
      </div>
      {rows.map((row) => {
        if (row.label === '工作经历') {
          if (!profile.workExperience?.length) return null;
          return (
            <div key={row.label} style={{ ...profileRowStyle, gridTemplateColumns: 'minmax(96px, 132px) minmax(0, 1fr)' }}>
              <div style={profileLabelStyle}>工作经历</div>
              <div style={profileValueStyle}>
                {profile.workExperience.map((work, index) => (
                  <div key={index} style={{ marginBottom: index < (profile.workExperience?.length || 0) - 1 ? 8 : 0 }}>
                    <strong>{work.company || '公司不详'}</strong>
                    {work.title ? ` · ${work.title}` : ''}
                    {formatProfileDuration(work) ? `（${formatProfileDuration(work)}）` : ''}
                    {work.description ? <div style={{ color: '#666', fontSize: 13 }}>{work.description}</div> : null}
                  </div>
                ))}
              </div>
            </div>
          );
        }
        if (row.label === '教育经历') {
          if (!profile.educationHistory?.length) return null;
          return (
            <div key={row.label} style={{ ...profileRowStyle, gridTemplateColumns: 'minmax(96px, 132px) minmax(0, 1fr)' }}>
              <div style={profileLabelStyle}>教育经历</div>
              <div style={profileValueStyle}>
                {profile.educationHistory.map((edu, index) => (
                  <div key={index} style={{ marginBottom: index < (profile.educationHistory?.length || 0) - 1 ? 4 : 0 }}>
                    <strong>{edu.school || '学校不详'}</strong>
                    {edu.degree ? ` · ${edu.degree}` : ''}
                    {edu.major ? ` · ${edu.major}` : ''}
                    {formatProfileDuration(edu) ? `（${formatProfileDuration(edu)}）` : ''}
                  </div>
                ))}
              </div>
            </div>
          );
        }
        if (row.value === undefined) return null;
        return (
          <div key={row.label} style={row.full ? { ...profileRowStyle, gridTemplateColumns: 'minmax(96px, 132px) minmax(0, 1fr)' } : profileRowStyle}>
            <div style={profileLabelStyle}>{row.label}</div>
            <div style={profileValueStyle}>{row.value}</div>
          </div>
        );
      })}
    </div>
  );
}

const cardBodyStyle: React.CSSProperties = {
  borderRadius: 16,
  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  border: '1px solid #E2E8F0',
  marginTop: 16,
};

const cardTitleStyle: React.CSSProperties = {
  fontSize: 16,
  color: '#6366F1',
  fontWeight: 700,
  marginBottom: 12,
};

/** AI 初筛评估（antd Card / ant-card-body 样式，与简历管理详情页一致） */
function AiEvaluationCard({ resume }: { resume: BusinessScreeningResume }) {
  const evaluation = normalizeResumeEvaluation({
    ai_evaluation: resume.aiEvaluation,
    ai_review: resume.aiReview,
    match_score: resume.matchScore,
  });
  const hasAny = !!(resume.aiReview || resume.aiEvaluation || evaluation.overallScore != null || evaluation.screeningReason);
  if (!hasAny) return null;

  const gateRows = getScreeningGateRows(evaluation);
  const summary = evaluation.summary;
  const recommendation = String(evaluation.source?.recommendation || '');
  const strengths = asDisplayTextList(evaluation.source?.strengths);
  const risks = asDisplayTextList(evaluation.source?.risks);
  const matchedSkills = asDisplayTextList(evaluation.source?.skill_match?.matched_skills ?? evaluation.source?.matched_skills);
  const skillGaps = asDisplayTextList(evaluation.source?.skill_match?.skill_gaps ?? evaluation.source?.skill_gaps);
  const suggestedQuestions = asDisplayTextList(evaluation.source?.suggested_questions);
  const recommendationText =
    recommendation === 'strongly_recommend' ? '强烈推荐'
      : recommendation === 'recommend' ? '推荐'
        : recommendation === 'neutral' ? '中立'
          : recommendation === 'not_recommend' ? '不推荐'
            : recommendation === 'strongly_not_recommend' ? '强烈不推荐'
              : recommendation;

  return (
    <Card bordered={false} style={cardBodyStyle}>
      <Text strong style={cardTitleStyle}>AI 初筛评估</Text>
      <div style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
        {evaluation.overallScore != null && (
          <Tag color={evaluation.overallScore >= 4 ? 'green' : evaluation.overallScore >= 3 ? 'blue' : 'orange'} style={{ margin: 0 }}>
            加权分 {formatWeightedScore(evaluation.overallScore)}
          </Tag>
        )}
        {gateRows.map((gate) => (
          <Tag key={gate.key} color={gate.passed ? 'green' : 'red'} style={{ margin: 0 }}>
            {gate.passed ? `${gate.label}已通过` : gate.reason}
          </Tag>
        ))}
        {recommendationText && (
          <Tag color={recommendation.includes('recommend') && !recommendation.includes('not') ? 'blue' : recommendation.includes('not') ? 'red' : 'gold'} style={{ margin: 0 }}>
            {recommendationText}
          </Tag>
        )}
      </div>
      {evaluation.dimensions.length > 0 && (
        <div style={{ marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {evaluation.dimensions.map((dimension) => (
            <Tag key={dimension.name} color={dimension.score >= 4 ? 'green' : dimension.score >= 3 ? 'blue' : dimension.score >= 2 ? 'orange' : 'red'} style={{ margin: 0 }}>
              {dimension.name} {dimension.score}/5
            </Tag>
          ))}
        </div>
      )}
      {evaluation.screeningReason && <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>初筛结论：{evaluation.screeningReason}</Text>}
      {summary && (
        <div style={{ marginBottom: 12, padding: '12px 16px', background: '#EEF2FF', borderRadius: 8, borderLeft: '4px solid #6366F1' }}>
          <Text strong style={{ color: '#4338CA' }}>总体评价：</Text>
          <Text style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{summary}</Text>
        </div>
      )}
      {strengths.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Text strong style={{ color: '#10B981', display: 'block', marginBottom: 6 }}>核心优势</Text>
          <div>{strengths.map((s, i) => <Tag key={i} color="green" style={{ marginBottom: 4, whiteSpace: 'normal', wordBreak: 'break-word' }}>{s}</Tag>)}</div>
        </div>
      )}
      {risks.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Text strong style={{ color: '#EF4444', display: 'block', marginBottom: 6 }}>潜在风险</Text>
          <div>{risks.map((r, i) => <Tag key={i} color="red" style={{ marginBottom: 4, whiteSpace: 'normal', wordBreak: 'break-word' }}>{r}</Tag>)}</div>
        </div>
      )}
      {(matchedSkills.length > 0 || skillGaps.length > 0) && (
        <div style={{ marginBottom: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          {matchedSkills.length > 0 && (
            <div>
              <Text strong style={{ color: '#3B82F6', display: 'block', marginBottom: 6 }}>匹配技能</Text>
              <div>{matchedSkills.map((s, i) => <Tag key={i} color="blue" style={{ marginBottom: 4, whiteSpace: 'normal', wordBreak: 'break-word' }}>{s}</Tag>)}</div>
            </div>
          )}
          {skillGaps.length > 0 && (
            <div>
              <Text strong style={{ color: '#F59E0B', display: 'block', marginBottom: 6 }}>技能差距</Text>
              <div>{skillGaps.map((s, i) => <Tag key={i} color="orange" style={{ marginBottom: 4, whiteSpace: 'normal', wordBreak: 'break-word' }}>{s}</Tag>)}</div>
            </div>
          )}
        </div>
      )}
      {suggestedQuestions.length > 0 && (
        <div>
          <Text strong style={{ display: 'block', marginBottom: 6, color: '#7C3AED' }}>建议面试问题</Text>
          {suggestedQuestions.map((q, i) => (
            <div key={i} style={{ padding: '8px 12px', marginBottom: 4, background: '#FDF4FF', borderRadius: 6, borderLeft: '3px solid #7C3AED', fontSize: 14 }}>
              {i + 1}. {q}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

const BusinessScreeningPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'ready' | 'expired' | 'error'>('ready');
  const [data, setData] = useState<BusinessScreeningView | null>(null);
  const [activeResumeId, setActiveResumeId] = useState<string | null>(null);
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<'approve' | 'reject' | null>(null);
  const [actionError, setActionError] = useState<string>('');

  const fetchData = async () => {
    if (!token) {
      setView('error');
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const response = await request.get(`/public/business-screening/${token}`) as BusinessScreeningView;
      setData(response);
      setView('ready');
      setActionError('');
      setActiveResumeId((current) => pickActiveBusinessScreeningResumeId(response.resumes, current));
      setRemarks((current) => {
        const next = { ...current };
        response.resumes.forEach((resume) => {
          if (!(resume.id in next)) next[resume.id] = resume.remark || '';
        });
        return next;
      });
    } catch (error) {
      setView(classifyBusinessScreeningLoadError(error));
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [token]);

  const activeResume = useMemo(
    () => data?.resumes.find((resume) => resume.id === activeResumeId) || null,
    [activeResumeId, data],
  );

  const handleDecision = async (action: 'approve' | 'reject') => {
    if (!token || !activeResume) return;
    setSubmitting(action);
    setActionError('');
    const remark = remarks[activeResume.id] || '';
    try {
      await request.post(
        `/public/business-screening/${token}/resumes/${activeResume.id}/${action === 'approve' ? 'approve' : 'reject'}`,
        buildBusinessScreeningDecisionPayload(remark),
      );

      setRemarks((current) => ({
        ...current,
        [activeResume.id]: remark.trim(),
      }));

      setData((current) => current ? {
        ...current,
        resumes: applyBusinessScreeningDecision(current.resumes, {
          resumeId: activeResume.id,
          action,
          remark: remark.trim(),
          processedAt: new Date().toISOString(),
        }),
      } : current);
    } catch (error: any) {
      setActionError(mapBusinessScreeningDecisionError(error));
    } finally {
      setSubmitting(null);
    }
  };

  if (loading) {
    return (
      <div style={{ ...shellStyle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', color: '#475569' }}>加载中...</div>
      </div>
    );
  }

  if (view === 'expired') {
    return (
      <div style={{ ...shellStyle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ ...cardStyle, width: 'min(560px, 100%)', padding: 32, textAlign: 'center' }}>
          <h1 style={{ marginTop: 0 }}>链接已失效</h1>
          <p style={{ marginBottom: 0, color: '#64748b' }}>请联系 HR 重新发送业务筛选链接。</p>
        </div>
      </div>
    );
  }

  if (view === 'error') {
    return (
      <div style={{ ...shellStyle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ ...cardStyle, width: 'min(560px, 100%)', padding: 32, textAlign: 'center' }}>
          <h1 style={{ marginTop: 0 }}>加载失败</h1>
          <p style={{ color: '#64748b' }}>请稍后重试，或联系 HR 确认链接是否有效。</p>
          <button
            type="button"
            onClick={fetchData}
            style={{ marginTop: 8, borderRadius: 10, border: '1px solid #cbd5e1', background: '#fff', padding: '10px 16px', cursor: 'pointer' }}
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="business-screening-page" style={shellStyle}>
      <div className="business-screening-container" style={{ maxWidth: 1160, margin: '0 auto' }}>
        <div style={{ ...cardStyle, padding: 20 }}>
          <div style={{ marginBottom: 20 }}>
            <h1 style={{ margin: 0, fontSize: 32 }}>业务筛选</h1>
            <p style={{ margin: '8px 0 12px', color: '#64748b' }}>请查看候选人信息并完成入库 / 不入库决策。</p>
            <div className="business-screening-meta" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <span className="business-screening-meta-pill" style={{ borderRadius: 999, background: '#eff6ff', color: '#1d4ed8', padding: '6px 12px', fontSize: 14 }}>
                {data?.batch.interviewer || '待分配'}
              </span>
              <span className="business-screening-meta-pill" style={{ borderRadius: 999, background: '#f1f5f9', color: '#334155', padding: '6px 12px', fontSize: 14 }}>
                候选人 {data?.resumes.length || 0} 人
              </span>
              <span className="business-screening-meta-pill" style={{ borderRadius: 999, background: '#f1f5f9', color: '#334155', padding: '6px 12px', fontSize: 14 }}>
                链接到期 {formatTime(data?.batch.expiresAt)}
              </span>
            </div>
          </div>

          {data?.resumes.length ? (
            <div
              className="business-screening-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 360px) minmax(0, 1fr)',
                gap: 16,
              }}
            >
              <section className="business-screening-candidates" style={{ ...cardStyle, padding: 12, minWidth: 0 }}>
                <h2 style={{ margin: '4px 4px 12px', fontSize: 18 }}>候选人列表</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {data.resumes.map((resume) => {
                    const selected = resume.id === activeResumeId;
                    return (
                      <button
                        key={resume.id}
                        type="button"
                        onClick={() => setActiveResumeId(resume.id)}
                        className="business-screening-candidate"
                        style={{
                          textAlign: 'left',
                          border: selected ? '1px solid #2563eb' : '1px solid #e2e8f0',
                          background: selected ? '#eff6ff' : '#fff',
                          borderRadius: 14,
                          padding: 14,
                          cursor: 'pointer',
                        }}
                      >
                        <div className="business-screening-candidate-summary" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                          <strong>{resume.candidateName}</strong>
                          <span style={{ color: resume.status === 'passed' ? '#15803d' : resume.status === 'rejected' ? '#b91c1c' : '#1d4ed8', fontSize: 13 }}>
                            {STATUS_LABELS[resume.status]}
                          </span>
                        </div>
                        <div className="business-screening-position" style={{ marginTop: 6, color: '#475569', overflowWrap: 'anywhere' }}>{resume.position}</div>
                        {resume.remark ? (
                          <div style={{ marginTop: 6, color: '#64748b', fontSize: 13 }}>{resume.remark}</div>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="business-screening-detail" style={{ ...cardStyle, padding: 20, minWidth: 0 }}>
                {activeResume ? (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      <div>
                        <h2 style={{ margin: 0, fontSize: 24 }}>{activeResume.candidateName}</h2>
                        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          <span className="business-screening-position" style={{ borderRadius: 999, background: '#f1f5f9', color: '#334155', padding: '6px 12px', fontSize: 14, overflowWrap: 'anywhere' }}>{activeResume.position}</span>
                          {activeResume.education ? <span style={{ borderRadius: 999, background: '#f1f5f9', color: '#334155', padding: '6px 12px', fontSize: 14 }}>{activeResume.education}</span> : null}
                          {activeResume.workExperience ? <span style={{ borderRadius: 999, background: '#f1f5f9', color: '#334155', padding: '6px 12px', fontSize: 14 }}>{activeResume.workExperience}</span> : null}
                        </div>
                      </div>
                      <div style={{ color: activeResume.status === 'passed' ? '#15803d' : activeResume.status === 'rejected' ? '#b91c1c' : '#1d4ed8', fontWeight: 600 }}>
                        {STATUS_LABELS[activeResume.status]}
                      </div>
                    </div>

                    <div className="business-screening-facts" style={{ marginTop: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                      <div>
                        <div style={{ color: '#64748b', fontSize: 13 }}>应聘岗位</div>
                        <div>{activeResume.position}</div>
                      </div>
                      <div>
                        <div style={{ color: '#64748b', fontSize: 13 }}>学历</div>
                        <div>{activeResume.education || '未提供'}</div>
                      </div>
                      <div>
                        <div style={{ color: '#64748b', fontSize: 13 }}>工作经验</div>
                        <div>{activeResume.workExperience || '未提供'}</div>
                      </div>
                      <div>
                        <div style={{ color: '#64748b', fontSize: 13 }}>处理时间</div>
                        <div>{formatTime(activeResume.processedAt)}</div>
                      </div>
                    </div>

                    {activeResume.profile ? <ProfileDescriptions profile={activeResume.profile} /> : null}

                    {/* AI 初筛评估（ant-card-body 卡片，与简历管理模块一致） */}
                    <AiEvaluationCard resume={activeResume} />

                    <div style={{ marginTop: 20 }}>
                      <label htmlFor="business-screening-remark" style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>
                        筛选备注
                      </label>
                      <textarea
                        id="business-screening-remark"
                        aria-label="筛选备注"
                        rows={6}
                        value={remarks[activeResume.id] ?? activeResume.remark ?? ''}
                        onChange={(event) => setRemarks((current) => ({
                          ...current,
                          [activeResume.id]: event.target.value,
                        }))}
                        placeholder="可选：补充入库建议或不入库原因"
                        style={{
                          width: '100%',
                          resize: 'vertical',
                          borderRadius: 12,
                          border: '1px solid #cbd5e1',
                          padding: 12,
                          font: 'inherit',
                          minHeight: 120,
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>

                    {actionError ? (
                      <div style={{ marginTop: 12, color: '#b91c1c' }}>{actionError}</div>
                    ) : null}

                    <div className="business-screening-actions" style={{ marginTop: 20, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                      <button
                        type="button"
                        disabled={submitting !== null}
                        onClick={() => handleDecision('approve')}
                        style={{
                          borderRadius: 12,
                          border: 'none',
                          background: '#2563eb',
                          color: '#fff',
                          padding: '12px 20px',
                          fontWeight: 600,
                          cursor: submitting !== null ? 'not-allowed' : 'pointer',
                          opacity: submitting !== null ? 0.7 : 1,
                        }}
                      >
                        {submitting === 'approve' ? '提交中...' : '入库'}
                      </button>
                      <button
                        type="button"
                        disabled={submitting !== null}
                        onClick={() => handleDecision('reject')}
                        style={{
                          borderRadius: 12,
                          border: '1px solid #fecaca',
                          background: '#fff1f2',
                          color: '#b91c1c',
                          padding: '12px 20px',
                          fontWeight: 600,
                          cursor: submitting !== null ? 'not-allowed' : 'pointer',
                          opacity: submitting !== null ? 0.7 : 1,
                        }}
                      >
                        {submitting === 'reject' ? '提交中...' : '不入库'}
                      </button>
                    </div>
                  </>
                ) : (
                  <div style={{ color: '#64748b' }}>请选择候选人查看详情</div>
                )}
              </section>
            </div>
          ) : (
            <div style={{ ...cardStyle, padding: 32, textAlign: 'center', color: '#64748b' }}>
              当前批次暂无待处理候选人
            </div>
          )}
        </div>
      </div>

      <style>{`
        .business-screening-page,
        .business-screening-page * {
          box-sizing: border-box;
        }

        @media (max-width: 1024px) {
          .business-screening-grid {
            grid-template-columns: 1fr !important;
          }
        }

        @media (max-width: 600px) {
          .business-screening-page {
            padding: 8px !important;
          }

          .business-screening-container > div {
            padding: 14px !important;
            border-radius: 14px;
          }

          .business-screening-page h1 {
            font-size: clamp(26px, 8vw, 32px) !important;
            line-height: 1.2;
          }

          .business-screening-page h2 {
            line-height: 1.3;
          }

          .business-screening-meta {
            flex-direction: column;
            align-items: stretch;
          }

          .business-screening-meta-pill {
            width: 100%;
            border-radius: 10px !important;
          }

          .business-screening-candidates,
          .business-screening-detail {
            padding: 14px !important;
          }

          .business-screening-candidate-summary {
            align-items: flex-start !important;
          }

          .business-screening-candidate-summary strong {
            min-width: 0;
            overflow-wrap: anywhere;
          }

          .business-screening-facts {
            grid-template-columns: minmax(0, 1fr) !important;
          }

          .business-screening-actions {
            display: grid !important;
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .business-screening-actions button {
            width: 100%;
            min-height: 44px;
            padding-inline: 10px !important;
          }
        }
      `}</style>
    </div>
  );
};

export default BusinessScreeningPage;
