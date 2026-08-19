import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Spin, Tag, message } from 'antd';
import {
  CalendarOutlined, ClockCircleOutlined, EnvironmentOutlined, TeamOutlined,
  UserOutlined, FileTextOutlined, CheckCircleOutlined, CloseCircleOutlined,
  HistoryOutlined, CommentOutlined, PhoneOutlined, VideoCameraOutlined,
} from '@ant-design/icons';
import request from '../../utils/request';
import type { BusinessScreeningProfile } from '../Public/businessScreeningLogic';

// =================== 面试管理卡片（免登录公开页） ===================
// 简历档案信息结构与系统内简历详情页 /resumes/:id 保持一致（不含联系方式），
// 另汇总各轮面试情况、评分评价、HR 备注与进度时间线。

interface InterviewCardPublicInterview {
  id: string;
  candidate_name: string | null;
  position_applied: string | null;
  round: number | null;
  interview_time: string | null;
  started_at: string | null;
  interview_type: string | null;
  interview_category: string | null;
  interview_location: string | null;
  meeting_link: string | null;
  status: string | null;
  result: string | null;
  result2: string | null;
  status2: string | null;
  interviewer: string | null;
  primary_interviewer: string | null;
  secondary_interviewer: string | null;
  panel_members: string | null;
  total_score: number | null;
  scores: Record<string, number> | null;
  evaluation: string | null;
  evaluation2: string | null;
  suggestion: string | null;
  comments: Record<string, string> | null;
}

interface InterviewCardTimelineEvent {
  stage: string;
  action: string;
  occurred_at: string;
  actor_user_id: string | null;
  source: string;
  metadata: Record<string, unknown>;
}

interface InterviewCardView {
  card: { id: string; expires_at: string; created_at: string; status: string };
  candidate: {
    resume_id: string | null;
    candidate_name: string;
    position_applied: string;
    mapped_position: string;
    hr_review: string | null;
    business_screening_remark: string | null;
    profile: BusinessScreeningProfile | undefined;
  };
  interviews: InterviewCardPublicInterview[];
  timeline: InterviewCardTimelineEvent[];
}

const INTERVIEW_STATUS: Record<string, { text: string; color: string }> = {
  scheduled: { text: '待面试', color: '#3b82f6' },
  in_progress: { text: '面试中', color: '#f59e0b' },
  completed: { text: '已完成', color: '#10b981' },
  cancelled: { text: '已取消', color: '#94a3b8' },
  failed: { text: '已淘汰', color: '#ef4444' },
  pending_onboarding: { text: '待入职', color: '#f59e0b' },
  onboarded: { text: '已入职', color: '#10b981' },
};

const INTERVIEW_RESULT: Record<string, { text: string; color: string }> = {
  pending: { text: '待评价', color: '#94a3b8' },
  passed: { text: '通过', color: '#10b981' },
  failed: { text: '不通过', color: '#ef4444' },
};

const INTERVIEW_TYPE: Record<string, string> = {
  onsite: '现场面试',
  video: '视频面试',
  phone: '电话面试',
  online: '在线面试',
};

const INTERVIEW_CATEGORY: Record<string, string> = {
  technical: '技术面',
  behavioral: '行为面',
  hr: 'HR 面',
  culture: '文化面',
};

const STAGE_LABELS: Record<string, string> = {
  resume_received: '简历收到',
  ai_screened: 'AI 初筛完成',
  hr_approved: 'HR 通过',
  hr_rejected: 'HR 淘汰',
  interview_scheduled: '安排面试',
  interview_completed: '完成面试',
  interview_passed: '面试通过',
  interview_failed: '面试未通过',
  offer_sent: 'Offer 发出',
  offer_accepted: 'Offer 接受',
  offer_rejected: 'Offer 拒绝',
  hired: '已录用',
  candidate_withdrawn: '候选人放弃',
};

const formatTime = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
};

const formatDate = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
};

const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 16,
  boxShadow: '0 8px 24px rgba(15, 23, 42, 0.06)',
  padding: '20px 24px',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
  color: '#0f172a',
  marginBottom: 16,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

function ProfileDescriptions({ profile }: { profile: BusinessScreeningProfile }) {
  if (!profile) return null;
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

  const profileRow: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'minmax(96px, 132px) minmax(0, 1fr)',
    borderBottom: '1px solid #eef2f7',
  };
  const labelStyle: React.CSSProperties = {
    background: '#f8fafc', color: '#475569', fontSize: 13,
    padding: '10px 14px', borderRight: '1px solid #eef2f7',
  };
  const valueStyle: React.CSSProperties = {
    color: '#1e293b', fontSize: 14, padding: '10px 14px',
    whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
  };

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden', marginBottom: 24 }}>
      <div style={{ padding: '10px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontWeight: 600, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
        <UserOutlined /> 候选人档案
      </div>
      {rows.map((row) => {
        if (row.label === '工作经历') {
          if (!profile.workExperience?.length) return null;
          return (
            <div key={row.label} style={profileRow}>
              <div style={labelStyle}>工作经历</div>
              <div style={valueStyle}>
                {profile.workExperience.map((work, index) => (
                  <div key={index} style={{ marginBottom: index < profile.workExperience!.length - 1 ? 8 : 0 }}>
                    <strong>{work.company || '公司不详'}</strong>
                    {work.title ? ` · ${work.title}` : ''}
                    {work.duration ? `（${work.duration}）` : work.start || work.end ? `（${work.start || ''}~${work.end || ''}）` : ''}
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
            <div key={row.label} style={profileRow}>
              <div style={labelStyle}>教育经历</div>
              <div style={valueStyle}>
                {profile.educationHistory.map((edu, index) => (
                  <div key={index} style={{ marginBottom: index < profile.educationHistory!.length - 1 ? 4 : 0 }}>
                    <strong>{edu.school || '学校不详'}</strong>
                    {edu.degree ? ` · ${edu.degree}` : ''}
                    {edu.major ? ` · ${edu.major}` : ''}
                    {edu.start || edu.end ? `（${edu.start || ''}~${edu.end || ''}）` : ''}
                  </div>
                ))}
              </div>
            </div>
          );
        }
        if (!row.value && row.value !== undefined) return null;
        return (
          <div key={row.label} style={profileRow}>
            <div style={labelStyle}>{row.label}</div>
            <div style={valueStyle}>{row.value || '—'}</div>
          </div>
        );
      })}
    </div>
  );
}

function InterviewRoundCard({ interview, index }: { interview: InterviewCardPublicInterview; index: number }) {
  const roundLabel = interview.round != null ? `第${interview.round}轮` : `面试 ${index + 1}`;
  const statusCfg = INTERVIEW_STATUS[interview.status || ''] || { text: interview.status || '—', color: '#64748b' };
  const resultCfg = INTERVIEW_RESULT[interview.result || ''] || { text: interview.result || '待评价', color: '#64748b' };
  const result2Cfg = interview.result2 && interview.result2 !== 'pending' ? INTERVIEW_RESULT[interview.result2] : null;

  const infoItems: Array<{ icon: React.ReactNode; label: string; value: string }> = [
    {
      icon: <ClockCircleOutlined />,
      label: '面试时间',
      value: formatTime(interview.interview_time || interview.started_at),
    },
    {
      icon: <TeamOutlined />,
      label: '面试官',
      value: [interview.primary_interviewer, interview.secondary_interviewer, interview.interviewer]
        .filter((v, i, arr) => v && arr.indexOf(v) === i)
        .join('、') || '—',
    },
    {
      icon: <EnvironmentOutlined />,
      label: '方式/地点',
      value: [
        INTERVIEW_TYPE[interview.interview_type || ''] || interview.interview_type || '',
        INTERVIEW_CATEGORY[interview.interview_category || ''] || interview.interview_category || '',
        interview.interview_location || '',
        interview.meeting_link || '',
      ].filter(Boolean).join(' · ') || '—',
    },
  ];

  const renderComments = () => {
    if (!interview.comments) return null;
    const entries = Object.entries(interview.comments).filter(([, v]) => v);
    if (!entries.length) return null;
    return (
      <div style={{ marginTop: 12, background: '#f8fafc', borderRadius: 8, padding: '10px 12px' }}>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6, fontWeight: 600 }}>分题评语</div>
        {entries.map(([k, v]) => (
          <div key={k} style={{ fontSize: 13, color: '#334155', marginBottom: 4 }}>
            <span style={{ color: '#94a3b8', marginRight: 6 }}>Q{Number(k) + 1}.</span>
            {v}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, marginBottom: 16, background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 15, fontWeight: 600, color: '#0f172a' }}>{roundLabel}</span>
        <Tag color={statusCfg.color} style={{ margin: 0 }}>{statusCfg.text}</Tag>
        {interview.result && interview.result !== 'pending' && (
          <Tag color={resultCfg.color} style={{ margin: 0 }} icon={interview.result === 'passed' ? <CheckCircleOutlined /> : <CloseCircleOutlined />}>
            一面结果：{resultCfg.text}
          </Tag>
        )}
        {result2Cfg && (
          <Tag color={result2Cfg.color} style={{ margin: 0 }} icon={result2Cfg.text === '通过' ? <CheckCircleOutlined /> : <CloseCircleOutlined />}>
            二面结果：{result2Cfg.text}
          </Tag>
        )}
        {interview.total_score != null && (
          <span style={{ fontSize: 13, color: '#475569', marginLeft: 'auto' }}>
            综合评分：<strong style={{ color: '#0f172a', fontSize: 16 }}>{interview.total_score}</strong>
          </span>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 12 }}>
        {infoItems.map((item) => (
          <div key={item.label} style={{ fontSize: 13, color: '#334155', minWidth: 0 }}>
            <span style={{ color: '#94a3b8', marginRight: 6 }}>{item.icon}</span>
            <span style={{ color: '#94a3b8', marginRight: 6 }}>{item.label}：</span>
            <span style={{ overflowWrap: 'anywhere' }}>{item.value}</span>
          </div>
        ))}
      </div>

      {(interview.evaluation || interview.evaluation2 || interview.suggestion) && (
        <div style={{ borderTop: '1px dashed #e2e8f0', paddingTop: 12 }}>
          {interview.evaluation && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 4 }}>一面评价</div>
              <div style={{ fontSize: 13, color: '#1e293b', whiteSpace: 'pre-wrap', background: '#f8fafc', borderRadius: 8, padding: '10px 12px' }}>
                {interview.evaluation}
              </div>
            </div>
          )}
          {interview.evaluation2 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 4 }}>二面评价</div>
              <div style={{ fontSize: 13, color: '#1e293b', whiteSpace: 'pre-wrap', background: '#f8fafc', borderRadius: 8, padding: '10px 12px' }}>
                {interview.evaluation2}
              </div>
            </div>
          )}
          {interview.suggestion && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 4 }}>面试建议</div>
              <div style={{ fontSize: 13, color: '#1e293b', whiteSpace: 'pre-wrap' }}>{interview.suggestion}</div>
            </div>
          )}
        </div>
      )}

      {renderComments()}
    </div>
  );
}

function Timeline({ events }: { events: InterviewCardTimelineEvent[] }) {
  if (!events.length) return null;
  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ ...sectionTitleStyle, marginBottom: 12 }}>
        <HistoryOutlined /> 进度时间线
      </div>
      <div style={{ borderLeft: '2px solid #e2e8f0', marginLeft: 8, paddingLeft: 20 }}>
        {events.map((event, index) => (
          <div key={index} style={{ position: 'relative', paddingBottom: 16 }}>
            <div style={{
              position: 'absolute', left: -26.5, top: 4, width: 10, height: 10, borderRadius: '50%',
              background: index === events.length - 1 ? '#3b82f6' : '#cbd5e1',
              border: '2px solid #fff', boxShadow: '0 0 0 2px #e2e8f0',
            }} />
            <div style={{ fontSize: 13, color: '#0f172a', fontWeight: 600 }}>
              {STAGE_LABELS[event.stage] || event.stage}
              {event.action ? <span style={{ fontWeight: 400, color: '#475569', marginLeft: 8 }}>{event.action}</span> : null}
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{formatTime(event.occurred_at)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const InterviewCard: React.FC = () => {
  const { token } = useParams();
  const [data, setData] = useState<InterviewCardView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await request.get(`/public/interview-card/${token}`);
        if (cancelled) return;
        setData(res);
      } catch (e: any) {
        if (cancelled) return;
        const status = e?.response?.status;
        if (status === 404) setError('链接无效或不存在');
        else if (status === 410) setError('链接已失效，请联系 HR 重新生成');
        else setError('加载失败，请稍后重试');
        message.error(error || '加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#f8fafc', gap: 12 }}>
        <div style={{ fontSize: 40 }}>🔗</div>
        <div style={{ fontSize: 16, color: '#334155', fontWeight: 600 }}>{error || '加载失败'}</div>
        <div style={{ fontSize: 13, color: '#94a3b8' }}>如有疑问请联系 HR</div>
      </div>
    );
  }

  const { card, candidate, interviews, timeline } = data;
  const positionTitle = candidate.mapped_position || candidate.position_applied || '—';

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', padding: '24px 16px' }}>
      <div style={{ maxWidth: 880, margin: '0 auto' }}>

        {/* 头部卡片 */}
        <div style={{ ...cardStyle, marginBottom: 20, padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                <FileTextOutlined /> 面试管理卡片
              </div>
              <div style={{ fontSize: 24, fontWeight: 700, color: '#0f172a', lineHeight: 1.3, overflowWrap: 'anywhere' }}>
                {candidate.candidate_name}
              </div>
              <div style={{ fontSize: 14, color: '#475569', marginTop: 4 }}>
                应聘岗位：{positionTitle}
              </div>
            </div>
            <div style={{ textAlign: 'right', fontSize: 12, color: '#94a3b8' }}>
              <div style={{ marginBottom: 4 }}>
                <CalendarOutlined /> 生成时间 {formatDate(card.created_at)}
              </div>
              <div>
                <ClockCircleOutlined style={{ marginRight: 4 }} />
                链接有效期至 <strong style={{ color: '#f59e0b' }}>{formatDate(card.expires_at)}</strong>
              </div>
            </div>
          </div>

          {/* 面试进度总览 */}
          {interviews.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16, paddingTop: 16, borderTop: '1px solid #eef2f7' }}>
              <span style={{ fontSize: 13, color: '#64748b', alignSelf: 'center' }}>面试进度：</span>
              {interviews.map((iv) => {
                const label = iv.round != null ? `第${iv.round}轮` : '面试';
                const done = iv.status === 'completed';
                const passed = iv.result === 'passed';
                const failed = iv.result === 'failed' || iv.status === 'failed';
                const color = failed ? '#ef4444' : passed ? '#10b981' : done ? '#f59e0b' : '#3b82f6';
                const icon = failed ? <CloseCircleOutlined /> : passed ? <CheckCircleOutlined /> : done ? <ClockCircleOutlined /> : <CalendarOutlined />;
                return (
                  <Tag key={iv.id} color={color} icon={icon} style={{ margin: 0, fontSize: 12 }}>
                    {label}{done || failed ? ` · ${INTERVIEW_RESULT[iv.result || '']?.text || iv.result || ''}` : ' · 进行中'}
                  </Tag>
                );
              })}
            </div>
          )}
        </div>

        {/* 候选人档案（信息结构照搬系统简历详情页 /resumes/:id，不含联系方式） */}
        <div style={{ ...cardStyle, marginBottom: 20 }}>
          <ProfileDescriptions profile={candidate.profile} />
          {(candidate.hr_review || candidate.business_screening_remark) && (
            <div>
              <div style={{ ...sectionTitleStyle, marginBottom: 12 }}>
                <CommentOutlined /> 备注
              </div>
              {candidate.hr_review && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 4 }}>HR 备注</div>
                  <div style={{ fontSize: 13, color: '#1e293b', whiteSpace: 'pre-wrap', background: '#f8fafc', borderRadius: 8, padding: '10px 12px' }}>
                    {candidate.hr_review}
                  </div>
                </div>
              )}
              {candidate.business_screening_remark && (
                <div>
                  <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 4 }}>业务筛选备注</div>
                  <div style={{ fontSize: 13, color: '#1e293b', whiteSpace: 'pre-wrap', background: '#f8fafc', borderRadius: 8, padding: '10px 12px' }}>
                    {candidate.business_screening_remark}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 面试情况 */}
        <div style={{ ...cardStyle, marginBottom: 20 }}>
          <div style={{ ...sectionTitleStyle, marginBottom: 16 }}>
            <TeamOutlined /> 面试情况
            {interviews.length === 0 && <Tag color="default" style={{ marginLeft: 8 }}>暂无面试记录</Tag>}
          </div>
          {interviews.map((iv, index) => (
            <InterviewRoundCard key={iv.id} interview={iv} index={index} />
          ))}
          {interviews.length === 0 && (
            <div style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
              该候选人暂无面试记录，可前往系统「面试管理」安排面试
            </div>
          )}
        </div>

        {/* 进度时间线 */}
        {timeline.length > 0 && (
          <div style={{ ...cardStyle, marginBottom: 20 }}>
            <Timeline events={timeline} />
          </div>
        )}

        <div style={{ textAlign: 'center', fontSize: 12, color: '#94a3b8', padding: '8px 0 16px' }}>
          本页面由 AI-Interview 系统生成 · 仅供招聘内部协作使用 · 请勿外传
        </div>
      </div>
    </div>
  );
};

export default InterviewCard;
