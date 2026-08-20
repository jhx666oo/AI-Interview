import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Alert, Button, Card, Col, Divider, Empty, Row, Spin, Tag, Typography } from 'antd';
import {
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DownloadOutlined,
  FilePdfOutlined,
  LinkOutlined,
  UserOutlined,
} from '@ant-design/icons';
import request from '../../utils/request';
import PdfViewer from '../../components/PdfViewer';
import './InterviewCard.css';

const { Title, Text, Paragraph } = Typography;

type InterviewCardData = {
  card: { id: string; expires_at?: string; created_at?: string; status?: string };
  candidate: {
    resume_id?: string | null;
    resume_link_status?: 'linked' | 'missing' | 'ambiguous';
    candidate_name?: string;
    position_applied?: string;
    mapped_position?: string;
    contact?: string | null;
    profile?: Record<string, any> | null;
    current_status?: { code?: string; label?: string; source?: string; updated_at?: string | null };
    ai?: {
      overall_score?: number | null;
      overall_score_max?: number;
      screening_result?: string;
      screening_reason?: string;
      summary?: string;
      dimensions?: Array<{ name?: string; score?: number; reason?: string }>;
      strengths?: string[];
      risks?: string[];
      suggested_questions?: string[];
      hard_requirement_result?: any;
    } | null;
    hr?: { decision?: string; note?: string | null; updated_at?: string | null } | null;
    business_screening?: { status?: string; remark?: string | null; screened_by?: string | null; screened_at?: string | null } | null;
    ocr_markdown?: string | null;
    resume_file?: { available?: boolean; preview_url?: string | null; download_url?: string | null };
  };
  interviews: Array<Record<string, any>>;
  timeline: Array<Record<string, any>>;
};

const text = (value: unknown, fallback = '未填写') => {
  const result = String(value ?? '').trim();
  return result || fallback;
};

const formatTime = (value: unknown, fallback = '未安排') => {
  if (!value) return fallback;
  const date = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};

const statusColor = (code?: string) => {
  if (!code) return 'default';
  if (code.includes('reject') || code.includes('failed')) return 'red';
  if (code.includes('pass') || code.includes('hired') || code.includes('approved')) return 'green';
  if (code.includes('scheduled') || code.includes('pending')) return 'blue';
  return 'gold';
};

const valueStyle: React.CSSProperties = { color: '#1e293b', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' };

function ProfileSection({ profile }: { profile?: Record<string, any> | null }) {
  if (!profile) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无结构化档案" />;
  const rows = [
    ['学历', profile.highest_degree],
    ['毕业院校', profile.school],
    ['专业', profile.major],
    ['工作年限', profile.years_of_experience],
    ['最近公司', profile.recent_company],
    ['当前职位', profile.current_title],
    ['性别', profile.gender],
    ['年龄', profile.age],
    ['出生年月', profile.birthday],
    ['技能', Array.isArray(profile.skills) ? profile.skills.join('、') : profile.skills],
    ['证书/资质', Array.isArray(profile.certifications) ? profile.certifications.join('、') : profile.certifications],
    ['自我评价', profile.self_evaluation],
  ];
  return (
    <div className="interview-card-profile-grid">
      {rows.map(([label, value]) => (
        <div className="interview-card-profile-row" key={String(label)}>
          <Text type="secondary">{label}</Text>
          <span style={valueStyle}>{text(value)}</span>
        </div>
      ))}
      {Array.isArray(profile.work_experience) && profile.work_experience.length > 0 ? (
        <div className="interview-card-profile-row interview-card-profile-row--full">
          <Text type="secondary">工作经历</Text>
          <div style={valueStyle}>
            {profile.work_experience.map((item: any, index: number) => (
              <div key={index} style={{ marginBottom: index === profile.work_experience.length - 1 ? 0 : 8 }}>
                <strong>{text(item.company, '公司不详')}</strong>{item.title ? ` · ${item.title}` : ''}
                {item.start || item.end ? `（${item.start || ''}~${item.end || ''}）` : ''}
                {item.description ? <div className="interview-card-muted">{item.description}</div> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AiSection({ ai }: { ai: InterviewCardData['candidate']['ai'] }) {
  if (!ai) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 AI 评估结果" />;
  const dimensions = Array.isArray(ai.dimensions) ? ai.dimensions : [];
  const score = ai.overall_score;
  return (
    <div>
      <div className="interview-card-ai-summary">
        {score !== null && score !== undefined ? <span className="interview-card-score">总分：{score}/{ai.overall_score_max || 100}</span> : null}
        <Tag color={statusColor(ai.screening_result)}>{text(ai.screening_result, '待初筛')}</Tag>
      </div>
      {ai.summary || ai.screening_reason ? <Paragraph style={{ marginBottom: 12, ...valueStyle }}>{ai.summary || ai.screening_reason}</Paragraph> : null}
      {dimensions.length > 0 ? (
        <div className="interview-card-tags">
          {dimensions.map((dimension, index) => (
            <Tag key={`${dimension.name}-${index}`} color={Number(dimension.score) >= 4 ? 'green' : Number(dimension.score) >= 3 ? 'blue' : 'orange'}>
              {text(dimension.name)} {dimension.score ?? '-'}/5
            </Tag>
          ))}
        </div>
      ) : null}
      <Row gutter={[16, 12]} style={{ marginTop: 12 }}>
        <Col xs={24} md={12}>
          <Text strong>优势</Text>
          {ai.strengths?.length ? <ul>{ai.strengths.map((item, index) => <li key={index}>{item}</li>)}</ul> : <div className="interview-card-muted">暂无</div>}
        </Col>
        <Col xs={24} md={12}>
          <Text strong>风险与建议</Text>
          {ai.risks?.length || ai.suggested_questions?.length ? (
            <ul>
              {(ai.risks || []).map((item, index) => <li key={`risk-${index}`}>{item}</li>)}
              {(ai.suggested_questions || []).map((item, index) => <li key={`question-${index}`}>建议提问：{item}</li>)}
            </ul>
          ) : <div className="interview-card-muted">暂无</div>}
        </Col>
      </Row>
    </div>
  );
}

function InterviewSection({ interviews }: { interviews: Array<Record<string, any>> }) {
  if (!interviews.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无面试安排" />;
  return (
    <div className="interview-card-interviews">
      {interviews.map((interview, index) => {
        const round = Number(interview.round || index + 1);
        const result = text(interview.result || (round === 2 ? interview.result2 : ''), '待评价');
        const evaluation = interview.evaluation || (round === 2 ? interview.evaluation2 : '') || interview.comments || interview.remark || interview.comment;
        const interviewStatus = round === 2 ? interview.status2 || interview.status : interview.status;
        return (
          <div className="interview-card-interview" key={String(interview.id || index)}>
            <div className="interview-card-interview-head">
              <strong>{round === 1 ? '一面' : round === 2 ? '二面' : `${round}面`}</strong>
              <Tag color={statusColor(interviewStatus)}>{text(interviewStatus, '待安排')}</Tag>
            </div>
            <div className="interview-card-meta"><CalendarOutlined /> {formatTime(interview.interview_time)}</div>
            <div className="interview-card-meta"><UserOutlined /> 面试官：{text(interview.primary_interviewer || interview.interviewer || interview.secondary_interviewer)}</div>
            {interview.interview_location || interview.meeting_link ? <div className="interview-card-meta"><LinkOutlined /> {text(interview.meeting_link || interview.interview_location)}</div> : null}
            <div className="interview-card-interview-result"><Text type="secondary">面试评价</Text><span style={valueStyle}>{text(evaluation, result)}</span></div>
            {interview.comments || interview.remark || interview.comment ? <Paragraph style={{ margin: '8px 0 0', ...valueStyle }}>{interview.comments || interview.remark || interview.comment}</Paragraph> : null}
          </div>
        );
      })}
    </div>
  );
}

const InterviewCard: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<InterviewCardData | null>(null);
  const [showPdf, setShowPdf] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    request.get(`/public/interview-card/${token}`)
      .then((result: InterviewCardData) => { if (!cancelled) setData(result); })
      .catch((err: any) => {
        if (cancelled) return;
        setError(err?.response?.status === 410 ? '链接已失效，请联系 HR 重新发送。' : err?.response?.data?.detail || '加载面试详情失败');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  const candidate = data?.candidate;
  const profile = candidate?.profile;
  const status = candidate?.current_status;
  const hasResume = Boolean(candidate?.resume_file?.available && candidate.resume_file.preview_url);
  const expiry = useMemo(() => data?.card.expires_at ? formatTime(data.card.expires_at, '') : '', [data?.card.expires_at]);

  if (loading) return <div className="interview-card-loading"><Spin size="large" /><span>正在加载面试详情...</span></div>;
  if (error || !data || !candidate) return <div className="interview-card-page"><Alert type="error" showIcon message={error || '链接无效'} description="请联系 HR 获取最新的面试详情链接。" /></div>;

  return (
    <div className="interview-card-page">
      <header className="interview-card-hero">
        <div>
          <Text className="interview-card-eyebrow">AI Interview · 面试详情</Text>
          <Title level={1}>{text(candidate.candidate_name, '未知候选人')}</Title>
          <div className="interview-card-subtitle">应聘岗位：{text(candidate.position_applied)}</div>
        </div>
        <Tag color={statusColor(status?.code)} className="interview-card-status-tag">{text(status?.label, '待定')}</Tag>
      </header>
      <div className="interview-card-notice"><ClockCircleOutlined /> 本链接仅供面试协作查看{expiry ? `，有效期至 ${expiry}` : ''}。</div>

      <div className="interview-card-grid">
        <main>
          <Card title={<span><FilePdfOutlined /> 简历原件</span>} className="interview-card-section" extra={hasResume ? <span className="interview-card-actions"><Button size="small" onClick={() => setShowPdf((value) => !value)}>{showPdf ? '收起预览' : '在线预览'}</Button><Button size="small" icon={<DownloadOutlined />} href={candidate.resume_file?.download_url || undefined} target="_blank" disabled={!candidate.resume_file?.download_url}>下载</Button></span> : null}>
            {hasResume && showPdf ? <PdfViewer pdfUrl={candidate.resume_file!.preview_url!} /> : hasResume ? <div className="interview-card-file-placeholder">已关联候选人简历，点击“在线预览”查看原件。</div> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={candidate.resume_link_status === 'ambiguous' ? '候选人姓名存在重复，暂未自动关联简历' : '该候选人暂无可查看的简历原件'} />}
          </Card>

          <Card title={<span><UserOutlined /> 候选人档案</span>} className="interview-card-section"><ProfileSection profile={profile} /></Card>
          <Card title={<span><CheckCircleOutlined /> AI 初筛结果</span>} className="interview-card-section"><AiSection ai={candidate.ai} /></Card>
          {candidate.ocr_markdown ? <Card title="简历正文" className="interview-card-section"><div className="interview-card-longtext">{candidate.ocr_markdown}</div></Card> : null}
        </main>

        <aside>
          <Card title="当前状态" className="interview-card-section">
            <div className="interview-card-current-status"><Tag color={statusColor(status?.code)}>{text(status?.label, '待定')}</Tag><Text type="secondary">{status?.updated_at ? `更新于 ${formatTime(status.updated_at)}` : '状态以系统最新记录为准'}</Text></div>
            <Divider />
            <div className="interview-card-summary-row"><Text type="secondary">姓名</Text><strong>{text(candidate.candidate_name)}</strong></div>
            <div className="interview-card-summary-row"><Text type="secondary">岗位</Text><span style={valueStyle}>{text(candidate.position_applied)}</span></div>
            <div className="interview-card-summary-row"><Text type="secondary">联系方式</Text><span style={valueStyle}>{text(candidate.contact)}</span></div>
          </Card>
          <Card title="HR 备注" className="interview-card-section"><div className="interview-card-note-label">HR 决策：<Tag color={statusColor(candidate.hr?.decision)}>{text(candidate.hr?.decision, '待处理')}</Tag></div><Paragraph style={{ ...valueStyle }}>{text(candidate.hr?.note, '暂无 HR 备注')}</Paragraph></Card>
          <Card title="业务筛选" className="interview-card-section"><div className="interview-card-note-label">筛选结果：<Tag color={statusColor(candidate.business_screening?.status)}>{text(candidate.business_screening?.status, '未开始')}</Tag></div><Paragraph style={{ ...valueStyle }}>{text(candidate.business_screening?.remark, '暂无业务筛选备注')}</Paragraph>{candidate.business_screening?.screened_by ? <Text type="secondary">处理人：{candidate.business_screening.screened_by}</Text> : null}</Card>
          <Card title="一面/二面评价" className="interview-card-section"><InterviewSection interviews={data.interviews} /></Card>
          {data.timeline.length ? <Card title="流程记录" className="interview-card-section"><div className="interview-card-timeline">{data.timeline.map((event, index) => <div className="interview-card-timeline-item" key={String(event.id || index)}><span className="interview-card-timeline-dot" /><div><strong>{text(event.title || event.event_type, '流程更新')}</strong><div className="interview-card-muted">{formatTime(event.occurred_at)}</div><div style={valueStyle}>{text(event.description || event.remark, '')}</div></div></div>)}</div></Card> : null}
        </aside>
      </div>
      <footer className="interview-card-footer">由招聘管理智能助手生成 · 请以系统内最新面试记录为准</footer>
    </div>
  );
};

export default InterviewCard;
