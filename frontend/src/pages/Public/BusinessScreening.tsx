import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import request from '../../utils/request';
import {
  applyBusinessScreeningDecision,
  buildBusinessScreeningDecisionPayload,
  classifyBusinessScreeningLoadError,
  mapBusinessScreeningDecisionError,
  pickActiveBusinessScreeningResumeId,
  type BusinessScreeningResume,
  type BusinessScreeningView,
} from './businessScreeningLogic';

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
    <div style={shellStyle}>
      <div style={{ maxWidth: 1160, margin: '0 auto' }}>
        <div style={{ ...cardStyle, padding: 20 }}>
          <div style={{ marginBottom: 20 }}>
            <h1 style={{ margin: 0, fontSize: 32 }}>业务筛选</h1>
            <p style={{ margin: '8px 0 12px', color: '#64748b' }}>请查看候选人信息并完成入库 / 不入库决策。</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <span style={{ borderRadius: 999, background: '#eff6ff', color: '#1d4ed8', padding: '6px 12px', fontSize: 14 }}>
                {data?.batch.interviewer || '待分配'}
              </span>
              <span style={{ borderRadius: 999, background: '#f1f5f9', color: '#334155', padding: '6px 12px', fontSize: 14 }}>
                候选人 {data?.resumes.length || 0} 人
              </span>
              <span style={{ borderRadius: 999, background: '#f1f5f9', color: '#334155', padding: '6px 12px', fontSize: 14 }}>
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
              <section style={{ ...cardStyle, padding: 12 }}>
                <h2 style={{ margin: '4px 4px 12px', fontSize: 18 }}>候选人列表</h2>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {data.resumes.map((resume) => {
                    const selected = resume.id === activeResumeId;
                    return (
                      <button
                        key={resume.id}
                        type="button"
                        onClick={() => setActiveResumeId(resume.id)}
                        style={{
                          textAlign: 'left',
                          border: selected ? '1px solid #2563eb' : '1px solid #e2e8f0',
                          background: selected ? '#eff6ff' : '#fff',
                          borderRadius: 14,
                          padding: 14,
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                          <strong>{resume.candidateName}</strong>
                          <span style={{ color: resume.status === 'passed' ? '#15803d' : resume.status === 'rejected' ? '#b91c1c' : '#1d4ed8', fontSize: 13 }}>
                            {STATUS_LABELS[resume.status]}
                          </span>
                        </div>
                        <div style={{ marginTop: 6, color: '#475569' }}>{resume.position}</div>
                        {resume.remark ? (
                          <div style={{ marginTop: 6, color: '#64748b', fontSize: 13 }}>{resume.remark}</div>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </section>

              <section style={{ ...cardStyle, padding: 20 }}>
                {activeResume ? (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      <div>
                        <h2 style={{ margin: 0, fontSize: 24 }}>{activeResume.candidateName}</h2>
                        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                          <span style={{ borderRadius: 999, background: '#f1f5f9', color: '#334155', padding: '6px 12px', fontSize: 14 }}>{activeResume.position}</span>
                          {activeResume.education ? <span style={{ borderRadius: 999, background: '#f1f5f9', color: '#334155', padding: '6px 12px', fontSize: 14 }}>{activeResume.education}</span> : null}
                          {activeResume.workExperience ? <span style={{ borderRadius: 999, background: '#f1f5f9', color: '#334155', padding: '6px 12px', fontSize: 14 }}>{activeResume.workExperience}</span> : null}
                        </div>
                      </div>
                      <div style={{ color: activeResume.status === 'passed' ? '#15803d' : activeResume.status === 'rejected' ? '#b91c1c' : '#1d4ed8', fontWeight: 600 }}>
                        {STATUS_LABELS[activeResume.status]}
                      </div>
                    </div>

                    <div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
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

                    <div style={{ marginTop: 20, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
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
        @media (max-width: 900px) {
          .business-screening-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </div>
  );
};

export default BusinessScreeningPage;
