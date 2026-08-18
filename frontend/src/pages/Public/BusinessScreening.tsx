import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card, Modal, Tag, Tooltip, message } from 'antd';
import { FileTextOutlined } from '@ant-design/icons';
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
  formatWeightedScore,
  getDimensionScoreTotal,
  getScreeningGateRows,
  normalizeResumeEvaluation,
} from '../../utils/resumeEvaluation';

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
  height: '100vh',
  overflow: 'hidden',
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

/**
 * AI 初筛评估（与简历管理列表页简历卡片 ant-card-body 内评估区一致）：
 * AI 评估符合度、加权分、维度合计、各维度标签（悬浮显示评分理由）、初筛结论。
 */
function AiEvaluationCard({ resume }: { resume: BusinessScreeningResume }) {
  const evaluation = normalizeResumeEvaluation({
    ai_evaluation: resume.aiEvaluation,
    ai_review: resume.aiReview,
    match_score: resume.matchScore,
  });

  // 能力维度分兜底：capability_scores 格式 {"scores":[{"dimension":"核心画像","score":4,"reason":"..."}]}
  const capabilityDimensions: Array<{ name: string; score: number; reason: string }> = (() => {
    try {
      const raw = JSON.parse(resume.capabilityScores || '{}');
      const scores = Array.isArray(raw?.scores) ? raw.scores : [];
      return scores
        .map((s: any) => ({
          name: String(s?.dimension || s?.name || '').trim(),
          score: Number(s?.score),
          reason: String(s?.reason || ''),
        }))
        .filter((d: any) => d.name && Number.isFinite(d.score));
    } catch { return []; }
  })();
  // 合并维度：ai_evaluation 的 dimensions 优先，capability_scores 补充缺失维度
  const scoreDetails = [...evaluation.dimensions];
  const knownNames = new Set(scoreDetails.map((d) => d.name));
  for (const d of capabilityDimensions) {
    if (!knownNames.has(d.name)) {
      scoreDetails.push({ name: d.name, score: Math.max(0, Math.min(5, d.score)), reason: d.reason });
      knownNames.add(d.name);
    }
  }

  const scoreTotal = getDimensionScoreTotal(scoreDetails);
  const matchCount = scoreDetails.filter((d) => d.score >= 3).length;
  const totalDims = scoreDetails.length;
  const gateRows = getScreeningGateRows(evaluation);
  const hasAny = !!(resume.aiReview || resume.aiEvaluation || resume.screeningResult
    || evaluation.overallScore != null || evaluation.screeningReason || scoreDetails.length > 0 || gateRows.length > 0);
  if (!hasAny) return null;

  const screeningLabel = resume.screeningResult === '通过' || resume.screeningResult === '不通过' ? `AI${resume.screeningResult}` : '';
  const screeningColor = resume.screeningResult === '通过' ? 'green' : resume.screeningResult === '不通过' ? 'red' : 'gold';

  return (
    <Card bordered={false} style={{ ...cardBodyStyle, padding: '12px 16px' }}>
      {/* 状态标签行：岗位 + AI 初筛结果 + 关键词匹配/避坑雷区门槛 */}
      <div className="resume-card__status" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {resume.position ? <Tag style={{ margin: 0 }}>{resume.position}</Tag> : null}
        {screeningLabel ? <Tag color={screeningColor} style={{ margin: 0 }}>{screeningLabel}</Tag> : null}
        {gateRows.map((gate) => (
          <Tag key={gate.key} color={gate.passed ? 'green' : 'red'} style={{ margin: 0 }}>
            {gate.passed ? `${gate.label}已通过` : gate.reason}
          </Tag>
        ))}
      </div>
      {/* 评估摘要：AI 评估符合度 + 加权分 + 维度合计 */}
      {scoreDetails.length > 0 || evaluation.overallScore != null ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginBottom: 8 }}>
          {scoreDetails.length > 0 && (
            <span style={{ fontSize: 12, color: '#1677ff', fontWeight: 600, background: '#f0f5ff', padding: '1px 8px', borderRadius: 4 }}>
              AI 评估 {matchCount}/{totalDims} 符合
            </span>
          )}
          {evaluation.overallScore != null && (
            <span style={{ fontSize: 12, color: '#8c8c8c' }}>加权分：{formatWeightedScore(evaluation.overallScore)}</span>
          )}
          {scoreDetails.length > 0 && (
            <span style={{ fontSize: 12, color: '#8c8c8c' }}>维度合计：{scoreTotal.total}/{scoreTotal.maximum}</span>
          )}
        </div>
      ) : null}
      {/* 维度标签：悬浮显示评分理由 */}
      {scoreDetails.length > 0 && (
        <div className="resume-card__dimensions" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {scoreDetails.map((d, i) => (
            <Tooltip key={i} title={d.reason || d.name}>
              <Tag
                color={d.score >= 4 ? 'green' : d.score >= 3 ? 'blue' : d.score >= 2 ? 'orange' : 'red'}
                style={{ margin: 0, cursor: 'pointer', fontSize: 11, lineHeight: '18px' }}
              >
                {d.name} {d.score}/5
              </Tag>
            </Tooltip>
          ))}
        </div>
      )}
      {/* 初筛结论 */}
      {evaluation.screeningReason ? (
        <div style={{ marginTop: 8 }}>
          <span style={{ color: '#8c8c8c', fontSize: 12 }}>初筛结论：{evaluation.screeningReason}</span>
        </div>
      ) : scoreDetails.length === 0 && evaluation.overallScore == null && gateRows.length === 0 ? (
        <div style={{ marginTop: 8 }}>
          <span style={{ color: '#bfbfbf', fontSize: 12 }}>暂无 AI 评估</span>
        </div>
      ) : null}
    </Card>
  );
}

/**
 * 动态加载的 PdfViewer（pdf.js）：仅在 Modal 打开时才开始加载，与简历管理列表页一致
 */
function DynamicPdfViewer({ pdfUrl }: { pdfUrl: string }) {
  const [Comp, setComp] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    import('../../components/PdfViewer').then((mod) => {
      if (!cancelled) { setComp(() => mod.default); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [pdfUrl]);
  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '80vh', color: '#999' }}>加载 PDF 引擎...</div>;
  return <Comp pdfUrl={pdfUrl} />;
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
  const [downloading, setDownloading] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewPdfUrl, setPreviewPdfUrl] = useState('');

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

  // 批量下载本批次全部候选人的简历源文件（逐个触发，避免浏览器拦截多个下载）
  const handleBatchDownload = async () => {
    if (!token || !data?.resumes?.length) return;
    setDownloading(true);
    let ok = 0;
    const failedIds: string[] = [];
    for (const resume of data.resumes) {
      try {
        const res = await fetch(`/api/public/business-screening/${token}/resumes/${resume.id}/file`);
        if (!res.ok) {
          failedIds.push(resume.candidateName || resume.id);
          continue;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${resume.candidateName || resume.id}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        ok++;
      } catch {
        failedIds.push(resume.candidateName || resume.id);
      }
      // 间隔触发下载，避免浏览器把连续多个下载当作恶意行为拦截
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    setDownloading(false);
    if (ok > 0) {
      message.success(`已开始下载 ${ok} 份简历源文件${failedIds.length ? `，${failedIds.length} 份无缓存文件未下载` : ''}`);
    } else if (failedIds.length > 0) {
      message.warning('未找到可下载的简历源文件（可能未缓存），请重新上传 PDF');
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

      // 决策成功后自动切换到下一份候选人：优先当前之后的待处理项，否则回绕到第一份待处理
      const resumes = data?.resumes || [];
      const idx = resumes.findIndex((r) => r.id === activeResume.id);
      const after = resumes.slice(idx + 1);
      const next = after.find((r) => r.status === 'pending')
        || (after.length ? after[0] : undefined)
        || resumes.find((r) => r.status === 'pending');
      if (next) {
        setActiveResumeId(next.id);
        setActionError('');
      }
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
      <div className="business-screening-container" style={{ maxWidth: 1280, margin: '0 auto', height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div style={{ ...cardStyle, padding: 12, display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' }}>
          <div style={{ marginBottom: 10, flexShrink: 0 }}>
            <h1 style={{ margin: 0, fontSize: 20 }}>{data?.batch.title || '业务筛选'}</h1>
            <p style={{ margin: '3px 0 6px', color: '#64748b', fontSize: 12.5 }}>{data?.batch.subtitle || '请查看候选人信息并完成入库 / 不入库决策。'}</p>
            <div className="business-screening-meta" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <span className="business-screening-meta-pill" style={{ borderRadius: 999, background: '#eff6ff', color: '#1d4ed8', padding: '3px 9px', fontSize: 12.5 }}>
                {data?.batch.interviewer || '待分配'}
              </span>
              <span className="business-screening-meta-pill" style={{ borderRadius: 999, background: '#f1f5f9', color: '#334155', padding: '3px 9px', fontSize: 12.5 }}>
                候选人 {data?.resumes.length || 0} 人
              </span>
              <span className="business-screening-meta-pill" style={{ borderRadius: 999, background: '#f1f5f9', color: '#334155', padding: '3px 9px', fontSize: 12.5 }}>
                链接到期 {formatTime(data?.batch.expiresAt)}
              </span>
              <button
                type="button"
                onClick={handleBatchDownload}
                disabled={downloading || !data?.resumes?.length}
                style={{
                  borderRadius: 999,
                  border: '1px solid #2563eb',
                  background: downloading ? '#dbeafe' : '#2563eb',
                  color: downloading ? '#1d4ed8' : '#fff',
                  padding: '3px 10px',
                  fontSize: 12.5,
                  cursor: downloading ? 'default' : 'pointer',
                  fontWeight: 600,
                }}
              >
                {downloading ? '下载中...' : `批量下载简历源文件（${data?.resumes.length || 0}）`}
              </button>
            </div>
          </div>

          {data?.resumes.length ? (
            <div
              className="business-screening-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 200px) minmax(0, 1fr)',
                gap: 16,
                flex: 1,
                minHeight: 0,
                overflow: 'hidden',
              }}
            >
              <section className="business-screening-candidates" style={{ ...cardStyle, padding: 6, minWidth: 0, overflowY: 'auto' }}>
                <h2 style={{ margin: '2px 4px 8px', fontSize: 14 }}>候选人列表</h2>
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
                          padding: 8,
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

              <section className="business-screening-detail" style={{ ...cardStyle, padding: 20, minWidth: 0, overflowY: 'auto' }}>
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <button
                          type="button"
                          onClick={() => {
                            setPreviewPdfUrl(`/api/public/business-screening/${token}/resumes/${activeResume.id}/file?preview=1`);
                            setPreviewVisible(true);
                          }}
                          title="预览简历源文件"
                          style={{
                            borderRadius: 8,
                            border: '1px solid #d1d5db',
                            background: '#fff',
                            padding: '6px 10px',
                            fontSize: 13,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            color: '#334155',
                          }}
                        >
                          <FileTextOutlined style={{ color: '#6366F1' }} />
                          预览简历
                        </button>
                        <span style={{ color: activeResume.status === 'passed' ? '#15803d' : activeResume.status === 'rejected' ? '#b91c1c' : '#1d4ed8', fontWeight: 600 }}>
                          {STATUS_LABELS[activeResume.status]}
                        </span>
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

                    {/* AI 初筛评估（简历列表卡片式评估区，ant-card-body 样式） */}
                    <AiEvaluationCard resume={activeResume} />

                    {activeResume.profile ? (
                      <ProfileDescriptions profile={activeResume.profile} />
                    ) : (
                      <div style={{ marginTop: 20, border: '1px dashed #cbd5e1', borderRadius: 12, padding: 14, background: '#f8fafc', color: '#64748b', fontSize: 13, lineHeight: 1.7 }}>
                        该简历暂无结构化档案（可能仅完成 AI 初筛、未生成字段解析）。可点击右上角「预览简历」查看简历原文；
                        如需生成档案，请联系 HR 在简历管理中对这位候选人执行「重新评估」。
                      </div>
                    )}

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
          .business-screening-page {
            height: auto !important;
            min-height: 100vh;
            overflow: auto !important;
          }

          .business-screening-container {
            height: auto !important;
          }

          .business-screening-container > div {
            height: auto !important;
            overflow: visible !important;
          }

          .business-screening-grid {
            grid-template-columns: 1fr !important;
            overflow: visible !important;
            flex: none !important;
          }

          .business-screening-candidates,
          .business-screening-detail {
            overflow: visible !important;
            max-height: none !important;
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

      {/* 简历源文件预览弹窗（pdf.js 渲染，与简历管理列表页一致） */}
      <Modal
        open={previewVisible}
        onCancel={() => { setPreviewPdfUrl(''); setPreviewVisible(false); }}
        footer={null}
        width={1000}
        title={activeResume ? `简历 - ${activeResume.candidateName}` : '简历预览'}
        destroyOnHidden
        styles={{ body: { height: '85vh', padding: 0 } }}
      >
        {previewPdfUrl ? (
          <DynamicPdfViewer pdfUrl={previewPdfUrl} />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            加载中...
          </div>
        )}
      </Modal>
    </div>
  );
};

export default BusinessScreeningPage;
