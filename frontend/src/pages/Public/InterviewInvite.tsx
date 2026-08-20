import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { Spin, Tag, Button, Typography, Modal, Radio, DatePicker, message } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import {
  CalendarOutlined, ClockCircleOutlined, EnvironmentOutlined, VideoCameraOutlined,
  UserOutlined, SafetyOutlined, LinkOutlined,
} from '@ant-design/icons';
import request from '../../utils/request';

// =================== 候选人面试详情（免登录公开页） ===================
// 「开始面试」流程给候选人邮件附带的链接页面，只展示候选人本人可见的面试安排
// （时间/岗位/形式/地点/面试官/会议链接），不含任何内部评估、评分与其他候选人信息。
// 链接固定 7 天有效（过期后由 HR 重新触发流程续期）。

interface InterviewInviteView {
  interview: {
    id: string;
    candidate_name: string;
    position_applied: string;
    interview_time: string | null;
    interview_type: string | null;
    interview_location: string | null;
    meeting_link: string | null;
    round: number | null;
    interviewer: string | null;
    primary_interviewer: string | null;
    secondary_interviewer: string | null;
    status: string | null;
  };
  invite: {
    expires_at: string;
  };
}

const TYPE_LABELS: Record<string, string> = {
  onsite: '现场面试',
  video: '线上面试',
  online: '线上面试',
  remote: '线上面试',
  phone: '电话面试',
};

const STATUS_LABELS: Record<string, { text: string; color: string }> = {
  scheduled: { text: '已安排', color: 'blue' },
  in_progress: { text: '进行中', color: 'processing' },
  completed: { text: '已完成', color: 'green' },
  cancelled: { text: '已取消', color: 'default' },
};

const infoItemStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'flex-start', gap: 10, padding: '13px 0', borderBottom: '1px solid #F1F5F9',
};
const infoIconStyle: React.CSSProperties = { fontSize: 17, color: '#2563EB', marginTop: 2 };
const infoLabelStyle: React.CSSProperties = { fontSize: 13, color: '#64748B', marginBottom: 2 };
const infoValueStyle: React.CSSProperties = { fontSize: 15, color: '#0F172A', fontWeight: 500 };

const InterviewInvite: React.FC = () => {
  const { token } = useParams();
  const [data, setData] = useState<InterviewInviteView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const res = await request.get(`/public/interview-invite/${token}`);
      setData(res);
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 404) setError('链接无效或不存在');
      else if (status === 410) setError('链接已过期，请联系 HR 重新发送');
      else setError('加载失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // ===== 修改面试时间（面试官入口） =====
  const [modalOpen, setModalOpen] = useState(false);
  const [slots, setSlots] = useState<Array<{ start: string; end: string }>>([]);
  const [slotLoading, setSlotLoading] = useState(false);
  const [slotReason, setSlotReason] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [customTime, setCustomTime] = useState<Dayjs | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const openReschedule = async () => {
    setModalOpen(true);
    setSelectedSlot(null);
    setCustomTime(null);
    setSlotReason(null);
    setSlotLoading(true);
    try {
      const res = await request.get(`/public/interview-invite/${token}/slots`);
      setSlots(res?.slots || []);
      if (res?.reason) setSlotReason(res.reason);
    } catch {
      setSlots([]);
      setSlotReason('空闲时段加载失败，可手动选择下方时间');
    } finally {
      setSlotLoading(false);
    }
  };

  const submitReschedule = async () => {
    const picked = selectedSlot || (customTime ? customTime.format('YYYY-MM-DD HH:mm') : '');
    if (!picked) {
      message.warning('请选择一个空闲时段或手动填写时间');
      return;
    }
    setSubmitting(true);
    try {
      const res = await request.post(`/public/interview-invite/${token}/reschedule`, {
        interview_time: picked,
      });
      message.success(`面试时间已更新为 ${res?.interview_time || picked}`);
      setModalOpen(false);
      await loadData();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '修改失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

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

  const { interview } = data;
  const typeLabel = TYPE_LABELS[interview.interview_type || ''] || (interview.interview_type || '线上面试');
  const statusInfo = STATUS_LABELS[interview.status || ''] || { text: interview.status || '已安排', color: 'blue' };
  const position = interview.position_applied || '应聘岗位';
  const interviewerNames = [interview.primary_interviewer, interview.secondary_interviewer, interview.interviewer]
    .filter((name): name is string => Boolean(name && name.trim()));
  const uniqueInterviewers = [...new Set(interviewerNames)];
  const currentTime = interview.interview_time ? dayjs(interview.interview_time, 'YYYY-MM-DD HH:mm') : null;

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(180deg,#EFF6FF 0%,#F8FAFC 240px,#F8FAFC 100%)', padding: '32px 16px' }}>
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        {/* 头部 */}
        <div style={{ background: 'linear-gradient(135deg,#2563EB,#1D4ED8)', borderRadius: 16, padding: '26px 28px', color: '#FFFFFF', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ fontSize: 21, fontWeight: 600 }}>面试详情</div>
            <Tag color={statusInfo.color} style={{ marginInlineEnd: 0 }}>{statusInfo.text}</Tag>
          </div>
          <div style={{ marginTop: 10, fontSize: 14, color: '#BFDBFE' }}>
            {interview.candidate_name} · {position}
            {interview.round ? ` · 第 ${interview.round} 轮` : ''}
          </div>
        </div>

        {/* 面试信息 */}
        <div style={{ background: '#FFFFFF', borderRadius: 16, padding: '8px 24px 4px', boxShadow: '0 1px 3px rgba(15,23,42,0.06)' }}>
          <div style={infoItemStyle}>
            <CalendarOutlined style={infoIconStyle} />
            <div style={{ flex: 1 }}>
              <div style={infoLabelStyle}>面试岗位</div>
              <div style={infoValueStyle}>{position}</div>
            </div>
          </div>
          <div style={infoItemStyle}>
            <ClockCircleOutlined style={infoIconStyle} />
            <div style={{ flex: 1 }}>
              <div style={infoLabelStyle}>面试时间</div>
              <div style={infoValueStyle}>{interview.interview_time || '待定（请与 HR 确认）'}</div>
            </div>
            <Tag color="default" style={{ marginLeft: 8 }}>如需调整请联系 HR</Tag>
          </div>
          <div style={infoItemStyle}>
            <VideoCameraOutlined style={infoIconStyle} />
            <div style={{ flex: 1 }}>
              <div style={infoLabelStyle}>面试形式</div>
              <div style={infoValueStyle}>{typeLabel}</div>
            </div>
          </div>
          <div style={infoItemStyle}>
            <EnvironmentOutlined style={infoIconStyle} />
            <div style={{ flex: 1 }}>
              <div style={infoLabelStyle}>面试地点</div>
              <div style={infoValueStyle}>
                {interview.interview_location || (interview.meeting_link ? '线上（见下方会议链接）' : '—')}
              </div>
            </div>
          </div>
          {uniqueInterviewers.length > 0 && (
            <div style={infoItemStyle}>
              <UserOutlined style={infoIconStyle} />
              <div style={{ flex: 1 }}>
                <div style={infoLabelStyle}>面试官</div>
                <div style={infoValueStyle}>{uniqueInterviewers.join('、')}</div>
              </div>
            </div>
          )}
        </div>

        {/* 会议链接 */}
        <div style={{ background: '#FFFFFF', borderRadius: 16, padding: '20px 24px', marginTop: 16, boxShadow: '0 1px 3px rgba(15,23,42,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <LinkOutlined style={{ color: '#2563EB', fontSize: 16 }} />
            <span style={{ fontSize: 15, fontWeight: 600, color: '#0F172A' }}>视频会议</span>
          </div>
          {interview.meeting_link ? (
            <>
              <Button
                type="primary"
                size="large"
                block
                icon={<VideoCameraOutlined />}
                href={interview.meeting_link}
                target="_blank"
                rel="noreferrer"
              >
                进入视频会议
              </Button>
              <Typography.Paragraph
                copyable={{ text: interview.meeting_link }}
                style={{ margin: '10px 0 0', fontSize: 12, color: '#94A3B8', wordBreak: 'break-all' }}
              >
                {interview.meeting_link}
              </Typography.Paragraph>
            </>
          ) : (
            <div style={{ fontSize: 13, color: '#94A3B8' }}>会议链接将另行提供，请保持电话畅通。</div>
          )}
        </div>

        {/* 提示 */}
        <div style={{ background: '#FFFBEB', borderRadius: 16, padding: '16px 20px', marginTop: 16, fontSize: 13, color: '#92400E', lineHeight: 1.9 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <SafetyOutlined />
            <span style={{ fontWeight: 600 }}>温馨提示</span>
          </div>
          1. 请提前 10 分钟进入会议或到达面试地点，并准备好简历与相关材料；<br />
          2. 面试时间如需调整，请联系 HR 通过系统登录态操作；<br />
          3. 本页面链接 7 天内有效，过期后请联系 HR 重新发送。
        </div>
      </div>

      {/* 修改面试时间弹窗 */}
      <Modal
        title="修改面试时间"
        open={modalOpen}
        onOk={submitReschedule}
        onCancel={() => setModalOpen(false)}
        confirmLoading={submitting}
        okText="保存修改"
        cancelText="取消"
        width={520}
      >
        <div style={{ fontSize: 13, color: '#64748B', marginBottom: 12 }}>
          以下为主面试官未来两个工作日的空闲时段（自动跳过周末与午休），也可手动填写：
        </div>
        {slotLoading ? (
          <div style={{ textAlign: 'center', padding: '20px 0', color: '#94A3B8' }}>正在查询面试官空闲时段...</div>
        ) : slots.length > 0 ? (
          <Radio.Group
            value={selectedSlot}
            onChange={(e) => { setSelectedSlot(e.target.value); setCustomTime(null); }}
            style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}
          >
            {slots.map((s) => (
              <Radio key={s.start} value={s.start} style={{ lineHeight: '28px' }}>
                {s.start} ~ {s.end}
              </Radio>
            ))}
          </Radio.Group>
        ) : (
          <div style={{ color: '#d46b08', fontSize: 13, marginBottom: 12 }}>
            {slotReason || '暂无推荐空闲时段'}
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
          <span style={{ fontSize: 13, color: '#64748B', whiteSpace: 'nowrap' }}>或手动填写：</span>
          <DatePicker
            showTime={{ format: 'HH:mm', minuteStep: 30 }}
            format="YYYY-MM-DD HH:mm"
            value={customTime}
            onChange={(v) => { setCustomTime(v); if (v) setSelectedSlot(null); }}
            placeholder="选择日期与时间"
            style={{ width: 240 }}
            allowClear
          />
        </div>
        <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 12 }}>
          保存后系统面试时间与飞书会议日程将同步更新。
        </div>
      </Modal>
    </div>
  );
};

export default InterviewInvite;
