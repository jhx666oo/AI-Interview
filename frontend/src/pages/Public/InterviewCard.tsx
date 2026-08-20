import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Spin, Tag, Progress, Descriptions, Button, message } from 'antd';
import {
  CalendarOutlined, ClockCircleOutlined, EnvironmentOutlined, TeamOutlined,
  UserOutlined, FileTextOutlined, CheckCircleOutlined,
  HistoryOutlined, CommentOutlined, DownloadOutlined, PhoneOutlined, SyncOutlined,
} from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import request from '../../utils/request';
import { useViewportWidth } from '../../components/Layout/responsive';
import {
  asDisplayTextList,
  formatWeightedScore,
  getScreeningGateRows,
  normalizeResumeEvaluation,
} from '../../utils/resumeEvaluation';
import type { BusinessScreeningProfile } from './businessScreeningLogic';

// =================== 面试管理卡片（免登录公开页） ===================
// 布局照搬简历详情页 /resumes/:id：左侧简历原件 PDF 预览，右侧候选人档案为主体
// （Descriptions 档案 + AI 评估 + 简历文本识别），面试情况/备注/时间线作为辅助信息区。
// 字段口径与业务筛选公开页一致：电话可见、邮箱不透出。

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

interface InterviewCardCandidate {
  resume_id: string | null;
  candidate_name: string;
  position_applied: string;
  mapped_position: string;
  status: string | null;
  stage: string | null;
  parse_status: string | null;
  hr_review: string | null;
  business_screening_remark: string | null;
  contact: string | null;
  match_score: number | null;
  screening_result: string | null;
  ai_review: string | null;
  ai_evaluation: string | null;
  capability_scores: string | null;
  hard_requirement_result: string | null;
  ocr_markdown: string | null;
  raw_text: string | null;
  resume_markdown: string | null;
  profile: BusinessScreeningProfile | undefined;
}

interface InterviewCardView {
  card: { id: string; expires_at: string; created_at: string; status: string };
  candidate: InterviewCardCandidate;
  interviews: InterviewCardPublicInterview[];
  timeline: InterviewCardTimelineEvent[];
}

const INTERVIEW_STATUS: Record<string, { text: string; color: string }> = {
  scheduled: { text: '待面试', color: 'blue' },
  in_progress: { text: '面试中', color: 'orange' },
  completed: { text: '已完成', color: 'green' },
  cancelled: { text: '已取消', color: 'default' },
  failed: { text: '已淘汰', color: 'red' },
  pending_onboarding: { text: '待入职', color: 'orange' },
  onboarded: { text: '已入职', color: 'green' },
};

const INTERVIEW_RESULT: Record<string, { text: string; color: string }> = {
  pending: { text: '待评价', color: 'default' },
  passed: { text: '通过', color: 'green' },
  failed: { text: '不通过', color: 'red' },
};

const INTERVIEW_TYPE: Record<string, string> = { onsite: '现场', video: '视频', phone: '电话', online: '在线' };
const INTERVIEW_CATEGORY: Record<string, string> = { technical: '技术面', behavioral: '行为面', hr: 'HR面', culture: '文化面' };

const STATUS_MAP: Record<string, { text: string; color: string }> = {
  pending_screening: { text: '待初筛', color: 'warning' },
  pending_review: { text: '待评审', color: 'warning' },
  pending_dept_review: { text: '待部门评审', color: 'cyan' },
  pending_hr_decision: { text: '待HR决策', color: 'purple' },
  pending_interview: { text: '待面试', color: 'geekblue' },
  interview_passed: { text: '面试通过', color: 'lime' },
  interview_failed: { text: '面试未通过', color: 'magenta' },
  offer_pending: { text: 'Offer待确认', color: 'blue' },
  offer_accepted: { text: '已接受Offer', color: 'success' },
  offer_rejected: { text: '已拒绝Offer', color: 'error' },
  onboarding: { text: '入职中', color: 'blue' },
  completed: { text: '已完成', color: 'success' },
  rejected: { text: '已淘汰', color: 'error' },
  hired: { text: '已录用', color: 'success' },
  waitlist: { text: '备选', color: 'gold' },
  approved: { text: '已入库', color: 'success' },
};

const STAGE_LABELS: Record<string, string> = {
  resume_received: '简历收到', ai_screened: 'AI 初筛完成', hr_approved: 'HR 通过', hr_rejected: 'HR 淘汰',
  interview_scheduled: '安排面试', interview_completed: '完成面试', interview_passed: '面试通过',
  interview_failed: '面试未通过', offer_sent: 'Offer 发出', offer_accepted: 'Offer 接受',
  offer_rejected: 'Offer 拒绝', hired: '已录用', candidate_withdrawn: '候选人放弃',
};

const formatTime = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const formatDate = (value?: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('zh-CN');
};

const formatExperience = (value?: string) => {
  if (!value) return '未识别';
  const text = String(value);
  return text.includes('年') ? text : `${text}年`;
};

/** 动态加载的 PdfViewer（pdf.js）：与简历管理/业务筛选一致，仅在需要时加载 */
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
  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94A3B8' }}>加载 PDF 引擎...</div>;
  return <Comp pdfUrl={pdfUrl} />;
}

const sectionCardStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 16,
  boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  border: '1px solid #E2E8F0',
  padding: '16px 20px',
  marginBottom: 16,
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 16, fontWeight: 600, color: '#0F172A',
  marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8,
};

/** 面试情况（辅助信息区）：紧凑小字排版，一轮一卡 */
function InterviewRoundsSection({ interviews }: { interviews: InterviewCardPublicInterview[] }) {
  return (
    <div style={sectionCardStyle}>
      <div style={sectionTitleStyle}>
        <TeamOutlined /> 面试情况
        <span style={{ fontSize: 12, fontWeight: 400, color: '#94A3B8' }}>各轮安排与评价</span>
      </div>
      {interviews.length === 0 && (
        <div style={{ color: '#94A3B8', fontSize: 13, textAlign: 'center', padding: '16px 0' }}>暂无面试记录</div>
      )}
      {interviews.map((iv, index) => {
        const roundLabel = iv.round != null ? `第${iv.round}轮` : `面试 ${index + 1}`;
        const statusCfg = INTERVIEW_STATUS[iv.status || ''] || { text: iv.status || '—', color: 'default' };
        const resultCfg = INTERVIEW_RESULT[iv.result || ''] || { text: iv.result || '待评价', color: 'default' };
        const result2Cfg = iv.result2 && iv.result2 !== 'pending' ? INTERVIEW_RESULT[iv.result2] : null;
        const interviewers = [iv.primary_interviewer, iv.secondary_interviewer, iv.interviewer]
          .filter((v, i, arr) => v && arr.indexOf(v) === i).join('、');
        return (
          <div key={iv.id} style={{ border: '1px solid #EEF2F7', borderRadius: 10, padding: '10px 14px', marginBottom: 10, background: '#FAFBFC' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>{roundLabel}</span>
              <Tag color={statusCfg.color} style={{ margin: 0, fontSize: 12 }}>{statusCfg.text}</Tag>
              {iv.result && iv.result !== 'pending' && (
                <Tag color={resultCfg.color} style={{ margin: 0, fontSize: 12 }}>一面{resultCfg.text}</Tag>
              )}
              {result2Cfg && <Tag color={result2Cfg.color} style={{ margin: 0, fontSize: 12 }}>二面{result2Cfg.text}</Tag>}
              {iv.total_score != null && (
                <span style={{ fontSize: 12, color: '#475569', marginLeft: 'auto' }}>评分 <strong>{iv.total_score}</strong></span>
              )}
            </div>
            <div style={{ fontSize: 12, color: '#64748B', lineHeight: 1.9 }}>
              <div><ClockCircleOutlined style={{ marginRight: 6 }} />{formatTime(iv.interview_time || iv.started_at)}</div>
              <div><TeamOutlined style={{ marginRight: 6 }} />{interviewers || '—'}</div>
              <div>
                <EnvironmentOutlined style={{ marginRight: 6 }} />
                {[INTERVIEW_TYPE[iv.interview_type || ''] || iv.interview_type || '',
                  INTERVIEW_CATEGORY[iv.interview_category || ''] || iv.interview_category || '',
                  iv.interview_location || '', iv.meeting_link || ''].filter(Boolean).join(' · ') || '—'}
              </div>
            </div>
            {(iv.evaluation || iv.evaluation2 || iv.suggestion) && (
              <div style={{ marginTop: 8, fontSize: 12, color: '#334155' }}>
                {iv.evaluation && <div style={{ marginBottom: 4 }}><span style={{ color: '#94A3B8' }}>一面评价：</span><span style={{ whiteSpace: 'pre-wrap' }}>{iv.evaluation}</span></div>}
                {iv.evaluation2 && <div style={{ marginBottom: 4 }}><span style={{ color: '#94A3B8' }}>二面评价：</span><span style={{ whiteSpace: 'pre-wrap' }}>{iv.evaluation2}</span></div>}
                {iv.suggestion && <div><span style={{ color: '#94A3B8' }}>建议：</span>{iv.suggestion}</div>}
              </div>
            )}
            {iv.comments && Object.entries(iv.comments).filter(([, v]) => v).length > 0 && (
              <div style={{ marginTop: 6, fontSize: 12, color: '#64748B' }}>
                <span style={{ color: '#94A3B8' }}>分题评语：</span>
                {Object.entries(iv.comments).filter(([, v]) => v).map(([k, v]) => `Q${Number(k) + 1}. ${v}`).join('；')}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 目标评价轮次：round=2 → 二面；一面未评 → 一面；一面通过且二面未评 → 二面；其余 → 已完成 */
function resolveTargetRound(iv: InterviewCardPublicInterview): 1 | 2 | null {
  if (iv.round === 2) return 2;
  const r1Done = iv.result === 'passed' || iv.result === 'failed';
  const r2Done = iv.result2 === 'passed' || iv.result2 === 'failed';
  if (r1Done) return iv.result === 'passed' && !r2Done ? 2 : null;
  return 1;
}

/** 面试评价（面试官在卡片链接内填写一面/二面评价与结果） */
function EvaluationSection({
  interviews,
}: {
  interviews: InterviewCardPublicInterview[];
}) {
  const primary = interviews[0];
  if (!primary || !primary.id) return null;
  const targetRound = resolveTargetRound(primary);
  return (
    <div style={sectionCardStyle}>
      <div style={sectionTitleStyle}>
        <CommentOutlined style={{ color: '#2563EB' }} /> 面试评价
      </div>
      <div style={{ fontSize: 13, color: '#64748B', lineHeight: 1.8 }}>
        {targetRound === null ? '该候选人各轮面试评价已完成。' : `当前为第${targetRound}面，评价请登录系统后在面试管理页提交。`}
        <br />公开链接仅用于查看候选人资料、面试信息和历史记录。
      </div>
    </div>
  );
}

/** 备注区：HR 备注 + 业务筛选备注 */
function RemarksSection({ candidate }: { candidate: InterviewCardCandidate }) {
  if (!candidate.hr_review && !candidate.business_screening_remark) return null;
  return (
    <div style={sectionCardStyle}>
      <div style={sectionTitleStyle}><CommentOutlined /> 备注</div>
      {candidate.hr_review && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: '#64748B', fontWeight: 600, marginBottom: 4 }}>HR 备注</div>
          <div style={{ fontSize: 13, color: '#1E293B', whiteSpace: 'pre-wrap', background: '#F8FAFC', borderRadius: 8, padding: '8px 12px' }}>
            {candidate.hr_review}
          </div>
        </div>
      )}
      {candidate.business_screening_remark && (
        <div>
          <div style={{ fontSize: 12, color: '#64748B', fontWeight: 600, marginBottom: 4 }}>业务筛选备注</div>
          <div style={{ fontSize: 13, color: '#1E293B', whiteSpace: 'pre-wrap', background: '#F8FAFC', borderRadius: 8, padding: '8px 12px' }}>
            {candidate.business_screening_remark}
          </div>
        </div>
      )}
    </div>
  );
}

/** 进度时间线（辅助信息区，紧凑） */
function TimelineSection({ events }: { events: InterviewCardTimelineEvent[] }) {
  if (!events.length) return null;
  return (
    <div style={sectionCardStyle}>
      <div style={sectionTitleStyle}><HistoryOutlined /> 进度时间线</div>
      <div style={{ borderLeft: '2px solid #E2E8F0', marginLeft: 6, paddingLeft: 16 }}>
        {events.map((event, index) => (
          <div key={index} style={{ position: 'relative', paddingBottom: 12 }}>
            <div style={{
              position: 'absolute', left: -21.5, top: 4, width: 9, height: 9, borderRadius: '50%',
              background: index === events.length - 1 ? '#3B82F6' : '#CBD5E1',
              border: '2px solid #fff', boxShadow: '0 0 0 2px #E2E8F0',
            }} />
            <div style={{ fontSize: 12, color: '#0F172A', fontWeight: 600 }}>
              {STAGE_LABELS[event.stage] || event.stage}
              {event.action ? <span style={{ fontWeight: 400, color: '#475569', marginLeft: 8 }}>{event.action}</span> : null}
            </div>
            <div style={{ fontSize: 11, color: '#94A3B8', marginTop: 1 }}>{formatTime(event.occurred_at)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

const InterviewCard: React.FC = () => {
  const { token } = useParams();
  const viewportWidth = useViewportWidth();
  const isMobileLayout = viewportWidth < 768;
  const [data, setData] = useState<InterviewCardView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reparsing, setReparsing] = useState(false);

  // 重新解析：简历信息未提取完整时，凭公开链接 token 触发 AI 重新评估（入队去重）
  const handleReparse = async () => {
    if (!data?.candidate?.resume_id || reparsing) return;
    setReparsing(true);
    try {
      const res = await request.post(`/public/interview-card/${token}/reparse`, {}) as { queued?: boolean };
      if (res.queued === false) {
        message.info('该简历正在重新解析中，请稍后刷新页面查看');
      } else {
        message.success('已提交重新解析，通常 1-2 分钟完成，请稍后刷新本页查看');
      }
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '重新解析失败，请稍后重试');
    } finally {
      setReparsing(false);
    }
  };

  const loadData = React.useCallback(async (silent?: boolean) => {
    try {
      const res = await request.get(`/public/interview-card/${token}`);
      setData(res);
    } catch (e: any) {
      if (silent) return;
      const status = e?.response?.status;
      if (status === 404) setError('链接无效或不存在');
      else if (status === 410) setError('链接已失效，请联系 HR 重新生成');
      else setError('加载失败，请稍后重试');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#F8FAFC', gap: 12 }}>
        <div style={{ fontSize: 40 }}>🔗</div>
        <div style={{ fontSize: 16, color: '#334155', fontWeight: 600 }}>{error || '加载失败'}</div>
        <div style={{ fontSize: 13, color: '#94A3B8' }}>如有疑问请联系 HR</div>
      </div>
    );
  }

  const { card, candidate, interviews, timeline } = data;
  const profile = candidate.profile;
  const positionTitle = candidate.mapped_position || candidate.position_applied || '—';
  const statusInfo = STATUS_MAP[candidate.status || ''] || { text: candidate.status || '待定', color: 'default' };
  const evaluation = normalizeResumeEvaluation({
    ai_evaluation: candidate.ai_evaluation,
    ai_review: candidate.ai_review,
    match_score: candidate.match_score,
  });
  const gateRows = getScreeningGateRows(evaluation);
  const aiReviewObject = evaluation.source && typeof evaluation.source === 'object' ? evaluation.source : {};
  const strengths = asDisplayTextList((aiReviewObject as any).strengths);
  const risks = asDisplayTextList((aiReviewObject as any).risks);
  const suggestedQuestions = asDisplayTextList((aiReviewObject as any).suggested_questions);
  const matchedSkills = asDisplayTextList((aiReviewObject as any).skill_match?.matched);
  const skillGaps = asDisplayTextList((aiReviewObject as any).skill_match?.gaps);
  const ocrText = candidate.ocr_markdown || candidate.raw_text || candidate.resume_markdown || '';

  const pdfUrl = `/api/public/interview-card/${token}/file?preview=1`;
  const downloadUrl = `/api/public/interview-card/${token}/file`;
  const hasResumeFile = !!candidate.resume_id;

  // ===== 左侧：简历原件预览（与简历详情页一致） =====
  const pdfPane = (
    <div style={{
      flex: isMobileLayout ? '0 0 auto' : '1 1 45%', width: isMobileLayout ? '100%' : undefined,
      minWidth: 0, height: isMobileLayout ? 'min(60vh, 480px)' : undefined,
      background: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#F8FAFC' }}>
        <span style={{ fontWeight: 600, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileTextOutlined /> 简历原件预览
        </span>
        {hasResumeFile && (
          <Button type="primary" icon={<DownloadOutlined />} href={downloadUrl} target="_blank">下载原件</Button>
        )}
      </div>
      <div style={{ flex: 1, background: '#F1F5F9', minHeight: isMobileLayout ? undefined : 0 }}>
        {hasResumeFile ? (
          <DynamicPdfViewer pdfUrl={pdfUrl} />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94A3B8', fontSize: 13, padding: 24, textAlign: 'center' }}>
            该候选人未关联简历文件
          </div>
        )}
      </div>
    </div>
  );

  // ===== 右侧：候选人信息为主体 =====
  const infoPane = (
    <div style={{ flex: isMobileLayout ? '0 0 auto' : '1 1 55%', width: isMobileLayout ? '100%' : undefined, maxWidth: '100%', minWidth: 0, overflowY: isMobileLayout ? 'visible' : 'auto', paddingRight: isMobileLayout ? 0 : '4px' }}>

      {/* 头部：姓名 + 岗位 + 加权分 + 状态（与简历详情页一致） */}
      <div style={sectionCardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 26, fontWeight: 700, color: '#0F172A', lineHeight: 1.3, overflowWrap: 'anywhere' }}>
              {candidate.candidate_name}
            </div>
            <div style={{ marginTop: 6, fontSize: 14, color: '#475569', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span>应聘岗位：{positionTitle}</span>
              {candidate.contact && <span><PhoneOutlined style={{ marginRight: 4 }} />{candidate.contact}</span>}
            </div>
            <div style={{ marginTop: 6, fontSize: 12, color: '#94A3B8', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <span><CalendarOutlined /> 生成 {formatDate(card.created_at)}</span>
              <span><ClockCircleOutlined /> 有效期至 {formatDate(card.expires_at)}</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            {evaluation.overallScore != null && (
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: '#94A3B8' }}>加权分</div>
                <Progress
                  type="circle"
                  percent={(evaluation.overallScore || 0) * 20}
                  size={48}
                  format={() => <span style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>{formatWeightedScore(evaluation.overallScore)}</span>}
                  strokeColor={evaluation.overallScore >= 4 ? '#10B981' : evaluation.overallScore >= 3 ? '#F59E0B' : '#EF4444'}
                />
              </div>
            )}
            <Tag color={statusInfo.color} style={{ fontSize: 13, padding: '4px 10px', margin: 0 }}>{statusInfo.text}</Tag>
          </div>
        </div>

        {/* 门槛标签 */}
        {gateRows.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
            {gateRows.map((gate) => (
              <Tag key={gate.key} color={gate.passed ? 'green' : 'red'} style={{ margin: 0 }}>
                {gate.passed ? `${gate.label}已通过` : gate.reason}
              </Tag>
            ))}
            {evaluation.screeningReason && (
              <span style={{ fontSize: 12, color: '#64748B', alignSelf: 'center' }}>初筛结论：{evaluation.screeningReason}</span>
            )}
          </div>
        )}
      </div>

      {/* 候选人档案（Descriptions，与简历详情页字段一致） */}
      <div style={sectionCardStyle}>
        <div style={{ ...sectionTitleStyle, justifyContent: 'space-between' }}>
          <span><UserOutlined /> 候选人档案</span>
          {candidate.resume_id ? (
            <span>
              <Button
                size="small"
                icon={<SyncOutlined />}
                loading={reparsing}
                onClick={handleReparse}
                title="简历信息未提取完整时，点击重新解析（AI 重新评估，通常 1-2 分钟）"
              >
                重新解析
              </Button>
            </span>
          ) : null}
        </div>
        <Descriptions column={isMobileLayout ? 1 : 2} bordered size="small">
          <Descriptions.Item label="应聘岗位">{positionTitle}</Descriptions.Item>
          <Descriptions.Item label="学历">{profile?.highestDegree || '未识别'}</Descriptions.Item>
          <Descriptions.Item label="毕业院校">{profile?.school || '未识别'}</Descriptions.Item>
          <Descriptions.Item label="专业">{profile?.major || '未识别'}</Descriptions.Item>
          <Descriptions.Item label="工作年限">{formatExperience(profile?.yearsOfExperience)}</Descriptions.Item>
          <Descriptions.Item label="最近公司">{profile?.recentCompany || '未识别'}</Descriptions.Item>
          <Descriptions.Item label="性别">{profile?.gender || '未识别'}</Descriptions.Item>
          <Descriptions.Item label="出生年月">{profile?.birthday || '未识别'}</Descriptions.Item>
          <Descriptions.Item label="当前职位">{profile?.currentTitle || '未识别'}</Descriptions.Item>
          <Descriptions.Item label="电话">{candidate.contact || '未识别'}</Descriptions.Item>
          <Descriptions.Item label="技能" span={2}>
            {profile?.skills?.length ? profile.skills.join('、') : '未识别'}
          </Descriptions.Item>
          <Descriptions.Item label="证书/资质" span={2}>
            {profile?.certifications?.length ? profile.certifications.join('、') : '未识别'}
          </Descriptions.Item>
          <Descriptions.Item label="自我评价" span={2}>
            {profile?.selfEvaluation || '未识别'}
          </Descriptions.Item>
          {profile?.workExperience?.length ? (
            <Descriptions.Item label="工作经历" span={2}>
              {profile.workExperience.map((w, i) => (
                <div key={i} style={{ marginBottom: 6 }}>
                  <strong>{w.company || '公司不详'}</strong> · {w.title || ''}（{w.duration || `${w.start || ''}~${w.end || ''}`}）
                  {w.description && <div style={{ color: '#666' }}>{w.description}</div>}
                </div>
              ))}
            </Descriptions.Item>
          ) : null}
          {profile?.educationHistory?.length ? (
            <Descriptions.Item label="教育经历" span={2}>
              {profile.educationHistory.map((e, i) => (
                <div key={i} style={{ marginBottom: 4 }}>
                  <strong>{e.school || '学校不详'}</strong> · {e.degree || ''} · {e.major || ''}（{e.start || ''}~{e.end || ''}）
                </div>
              ))}
            </Descriptions.Item>
          ) : null}
        </Descriptions>
      </div>

      {/* AI 评估（优势/风险/建议提问/技能匹配） */}
      {(strengths.length > 0 || risks.length > 0 || suggestedQuestions.length > 0 || matchedSkills.length > 0 || skillGaps.length > 0) && (
        <div style={sectionCardStyle}>
          <div style={sectionTitleStyle}>
            <CheckCircleOutlined style={{ color: '#6366F1' }} /> AI 评估
          </div>
          {strengths.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: '#64748B', fontWeight: 600, marginBottom: 4 }}>优势</div>
              {strengths.map((s, i) => <div key={i} style={{ fontSize: 13, color: '#1E293B', marginBottom: 2 }}>· {s}</div>)}
            </div>
          )}
          {risks.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: '#64748B', fontWeight: 600, marginBottom: 4 }}>风险点</div>
              {risks.map((r, i) => <div key={i} style={{ fontSize: 13, color: '#B45309', marginBottom: 2 }}>· {r}</div>)}
            </div>
          )}
          {suggestedQuestions.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: '#64748B', fontWeight: 600, marginBottom: 4 }}>建议提问</div>
              {suggestedQuestions.map((q, i) => <div key={i} style={{ fontSize: 13, color: '#1E293B', marginBottom: 2 }}>· {q}</div>)}
            </div>
          )}
          {(matchedSkills.length > 0 || skillGaps.length > 0) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {matchedSkills.map((s, i) => <Tag key={`m${i}`} color="green" style={{ margin: 0 }}>{s}</Tag>)}
              {skillGaps.map((s, i) => <Tag key={`g${i}`} color="orange" style={{ margin: 0 }}>待验证：{s}</Tag>)}
            </div>
          )}
        </div>
      )}

      {/* 简历文本识别（OCR Markdown，与简历详情页一致） */}
      {ocrText && (
        <div style={sectionCardStyle}>
          <div style={sectionTitleStyle}>
            <FileTextOutlined style={{ color: '#6366F1' }} /> 简历文本识别
            <span style={{ fontSize: 12, fontWeight: 400, color: '#94A3B8' }}>OCR 结构化文本</span>
          </div>
          <div style={{ background: '#F8FAFC', padding: '16px 20px', borderRadius: 12, border: '1px solid #E2E8F0', maxHeight: 480, overflow: 'auto', fontSize: 13 }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{ocrText.substring(0, 100000)}</ReactMarkdown>
          </div>
        </div>
      )}

      {/* 面试情况（辅助信息） */}
      <InterviewRoundsSection interviews={interviews} />

      {/* 面试评价（面试官在链接内填写） */}
      <EvaluationSection interviews={interviews} />

      {/* 备注 */}
      <RemarksSection candidate={candidate} />

      {/* 进度时间线 */}
      <TimelineSection events={timeline} />

      <div style={{ textAlign: 'center', fontSize: 12, color: '#94A3B8', padding: '4px 0 12px' }}>
        本页面由 AI-Interview 系统生成 · 仅供招聘内部协作使用 · 请勿外传
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC', padding: isMobileLayout ? '12px' : '20px 24px' }}>
      <div style={{
        height: isMobileLayout ? 'auto' : 'calc(100vh - 40px)',
        display: 'flex', flexDirection: isMobileLayout ? 'column' : 'row',
        gap: 16, overflow: isMobileLayout ? 'visible' : 'hidden',
        maxWidth: 1400, margin: '0 auto',
      }}>
        {pdfPane}
        {infoPane}
      </div>
    </div>
  );
};

export default InterviewCard;
