import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Table, Button, Space, message, Tag, Modal, Select, Input, AutoComplete, Form, Popconfirm,
  Typography, Card, Tooltip, DatePicker, Radio, Spin
} from 'antd';
import dayjs from 'dayjs';
import SimplePagination from '../../components/SimplePagination';
import {
  ReloadOutlined, EditOutlined, EyeOutlined, SearchOutlined,
  BellOutlined, DownloadOutlined, TeamOutlined, UserOutlined, CloudUploadOutlined, PlusOutlined, DeleteOutlined,
  HomeOutlined, LinkOutlined, CopyOutlined, ClockCircleOutlined
} from '@ant-design/icons';
import request from '../../utils/request';
import { useAuth } from '../../contexts/AuthContext';
import { useOwner } from '../../contexts/OwnerContext';
import { getReminderFeedback, type ReminderDeliveryResponse } from './reminderFeedback';
import { ResponsiveDataView } from '../../components/Responsive';
import { ResponsiveModal } from '../../components/Responsive/ResponsiveModal';
import { buildCreateFromTalentPayload, resolveScheduleInterviewerDefaults, resolveScheduleInterviewerPrefill } from './interviewerDefaults';

const { Text } = Typography;

// =================== 统一候选人面试管理 ===================

const interviewStatusConfig: Record<string, { color: string; text: string }> = {
  awaiting_schedule: { color: 'warning', text: '待确认时间' },
  schedule_queued: { color: 'processing', text: '安排处理中' },
  notification_partial: { color: 'warning', text: '部分通知失败' },
  manual_review: { color: 'error', text: '待人工处理' },
  scheduled: { color: 'processing', text: '待面试' },
  in_progress: { color: 'processing', text: '面试中' },
  analyzing: { color: 'processing', text: 'AI 分析中' },
  completed: { color: 'success', text: '已完成' },
  cancelled: { color: 'default', text: '已取消' },
  pending_onboarding: { color: 'warning', text: '待入职' },
  onboarded: { color: 'success', text: '已入职' },
  failed: { color: 'error', text: '已淘汰' },
};

// 自动化状态弹窗的英文枚举 → 中文（面试管理页内展示全部中文化）
const automationActionLabels: Record<string, string> = {
  auto_business_screening: '业务自动初筛',
  create_next_round: '创建二面',
  schedule: '安排日程',
  reschedule: '调整日程',
  cancel: '取消日程',
  notify_interviewer: '提醒面试官',
  notify_candidate: '通知候选人',
  advance: '推进面试',
};
const automationJobStatusLabels: Record<string, { color: string; text: string }> = {
  queued: { color: 'processing', text: '排队中' },
  running: { color: 'processing', text: '执行中' },
  succeeded: { color: 'success', text: '成功' },
  partial: { color: 'warning', text: '部分成功' },
  failed: { color: 'error', text: '失败' },
  cancelled: { color: 'default', text: '已取消' },
};
const notificationChannelLabels: Record<string, string> = {
  feishu_card: '飞书卡片',
  feishu_file: '飞书文件',
  email: '邮件',
};
const notificationRecipientLabels: Record<string, string> = {
  candidate: '候选人',
  interviewer: '面试官',
  primary_interviewer: '一面面试官',
  secondary_interviewer: '二面面试官',
};
const notificationStatusLabels: Record<string, { color: string; text: string }> = {
  queued: { color: 'processing', text: '排队中' },
  sent: { color: 'success', text: '已发送' },
  failed: { color: 'error', text: '失败' },
  skipped: { color: 'default', text: '已跳过' },
  cancelled: { color: 'default', text: '已取消' },
};

const resultLabels: Record<string, { color: string; text: string }> = {
  passed: { color: 'success', text: '通过' },
  failed: { color: 'error', text: '不通过' },
};

const talentStatusConfig: Record<string, { color: string; text: string }> = {
  approved: { color: 'success', text: '已入库' },
  pending_screening: { color: 'warning', text: '待初筛' },
  rejected: { color: 'error', text: '已淘汰' },
  manual: { color: 'default', text: '手动创建' },
};

interface MergedRow {
  id: string;
  candidate_name: string;
  position: string;
  position_applied: string;
  standard_position: string;
  education: string;
  city: string;
  talent_status: string;          // 候选人入库状态
  interview_id: string | null;    // 有面试记录才有
  interview_status: string;
  interview_time: string;
  interview_location: string;
  result: string;
  result2: string;
  status2: string;
  evaluation: string;
  evaluation2: string;
  feishu_record_id: string;
  resume_id: string;
  interviewer: string;
  primary_interviewer: string;
  secondary_interviewer: string;
  created_at: string;
  create_time: number;           // 飞书多维表格入库时间戳（毫秒），用于排序
}

type PositionAssignment = {
  id: string;
  title: string;
  primary_interviewer?: string | null;
  secondary_interviewer?: string | null;
};

const InterviewsList: React.FC = () => {
  const { user } = useAuth();
  const { selectedOwner } = useOwner();
  const [data, setData] = useState<MergedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string | undefined>();

  // 安排面试弹窗（从人才库安排）
  const [scheduleModalVisible, setScheduleModalVisible] = useState(false);
  const [scheduleRecord, setScheduleRecord] = useState<MergedRow | null>(null);
  const [scheduleForm] = Form.useForm();
  const [scheduling, setScheduling] = useState(false);
  const [scheduleDefaults, setScheduleDefaults] = useState<ReturnType<typeof resolveScheduleInterviewerDefaults> | null>(null);
  // 推荐空闲时段（按一面面试官自动查询，定日程用）
  const [availableSlots, setAvailableSlots] = useState<Array<{ start: string; end: string }>>([]);
  const [slotLoading, setSlotLoading] = useState(false);
  const [slotReason, setSlotReason] = useState<string | null>(null);
  // 空闲会议室（下拉选项，C5/D1 栋优先，默认选 D1 第一个）
  const [availableRooms, setAvailableRooms] = useState<Array<{ room_id: string; name: string; building: string }>>([]);
  // 上次自动填充的会议室名：切换时段时仅当当前值仍是自动填充值才覆盖（手动改过则不覆盖）
  const lastAutoRoomRef = useRef<string>('');
  const [positions, setPositions] = useState<PositionAssignment[]>([]);

  // 新建面试弹窗（手动创建）
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [createForm] = Form.useForm();
  const [creating, setCreating] = useState(false);
  // 新建面试弹窗里按岗位自动匹配的面试官（供提示展示）
  const [createDefaults, setCreateDefaults] = useState<{ matchedPositionTitle?: string } | null>(null);

  const applyCreatePositionDefaults = () => {
    const positionName = createForm.getFieldValue('position_applied');
    const defaults = resolveScheduleInterviewerDefaults({
      standard_position: positionName,
      position_applied: positionName,
    }, positions);
    if (!defaults.matchedPositionTitle) {
      setCreateDefaults(null);
      return;
    }
    createForm.setFieldsValue({
      interviewer_name: defaults.interviewerName || undefined,
      secondary_interviewer: defaults.secondaryInterviewer || undefined,
      position_applied: defaults.matchedPositionTitle,
    });
    setCreateDefaults({ matchedPositionTitle: defaults.matchedPositionTitle });
  };

  // 编辑面试状态
  // 新建面试提交
  const handleCreateSubmit = async () => {
    try {
      const values = await createForm.validateFields();
      setCreating(true);
      await request.post('/interviews', {
        candidate_name: values.candidate_name,
        position_applied: values.position_applied || '',
        interviewer: values.interviewer_name || '',
        primary_interviewer: values.interviewer_name || '',
        secondary_interviewer: values.secondary_interviewer || '',
        interview_time: values.interview_date
          ? `${values.interview_date.format('YYYY-MM-DD')} ${values.interview_time?.format('HH:mm') || '00:00'}`
          : '',
        interview_location: values.interview_location || '',
        status: 'scheduled',
      });
      message.success('面试已创建');
      setCreateModalVisible(false);
      createForm.resetFields();
      fetchMergedData();
    } catch (e: any) {
      message.error(e.response?.data?.detail || '创建失败');
    } finally {
      setCreating(false);
    }
  };

  // 编辑面试弹窗
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editRecord, setEditRecord] = useState<MergedRow | null>(null);
  const [editForm] = Form.useForm();
  const [editSubmitting, setEditSubmitting] = useState(false);
  // 编辑弹窗里按岗位自动匹配的面试官（面试官为空时默认带出岗位配置 + 提示展示）
  const [editDefaults, setEditDefaults] = useState<ReturnType<typeof resolveScheduleInterviewerDefaults> | null>(null);

  const handleOpenEdit = async (record: MergedRow) => {
    setEditRecord(record);
    // 岗位配置的面试官自动同步：优先已有岗位列表，缺失时先拉取再匹配（同安排面试弹窗）
    let positionList = positions;
    if (positionList.length === 0) positionList = await fetchPositions();
    const defaults = resolveScheduleInterviewerDefaults(record, positionList);
    setEditDefaults(defaults);
    // 打开弹窗前直接填值（同安排面试弹窗模式，避免 afterOpenChange 挂载时序问题导致默认值丢失）
    editForm.resetFields();
    editForm.setFieldsValue({
      position_applied: record.position_applied || record.position || '',
      primary_interviewer: record.primary_interviewer || record.interviewer || defaults.interviewerName || '',
      secondary_interviewer: record.secondary_interviewer || defaults.secondaryInterviewer || '',
      interview_time: record.interview_time ? record.interview_time.substring(0, 16) : '',
      interview_location: record.interview_location || '',
      status: record.interview_status || 'scheduled',
      evaluation: record.evaluation || '',
      evaluation2: record.evaluation2 || '',
      result: record.result || 'pending',
      result2: record.result2 || 'pending',
    });
    setEditModalVisible(true);
  };

  const handleEditSubmit = async () => {
    if (!editRecord) return;
    try {
      const values = await editForm.validateFields();
      setEditSubmitting(true);
      // 原面试状态为空时不要提交 status，避免编辑面试官/时间时被强制置为 scheduled（误触发安排面试）
      if (!editRecord.interview_status) delete values.status;
      if (editRecord.interview_id) {
        await request.put(`/interviews/${editRecord.interview_id}`, values);
      } else {
        // 无面试记录时创建「待安排」面试（awaiting_schedule），不直接置为已安排；
        // 之后用「安排面试」按钮选时间走完整自动化流程（建会议+通知候选人）
        await request.post('/interviews', { ...values, candidate_name: editRecord.candidate_name, status: 'awaiting_schedule' });
      }
      message.success('已保存');
      setEditModalVisible(false);
      fetchMergedData();
    } catch (e: any) {
      message.error(e.response?.data?.detail || '保存失败');
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!editRecord?.interview_id) {
      message.info('仅已安排面试的记录可删除');
      return;
    }
    try {
      setDeletingId(editRecord.interview_id);
      await request.delete(`/interviews/${editRecord.interview_id}`);
      message.success('已删除');
      setEditModalVisible(false);
      fetchMergedData();
    } catch (e: any) {
      message.error(e.response?.data?.detail || '删除失败');
    } finally {
      setDeletingId(null);
    }
  };
  // 按钮加载态
  const [reminderLoading, setReminderLoading] = useState<string | null>(null);
  const [onboardingLoading, setOnboardingLoading] = useState<string | null>(null);
  const [onboardedRecords, setOnboardedRecords] = useState<Set<string>>(new Set());
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  // 查看评价弹窗
  const [viewEvalVisible, setViewEvalVisible] = useState(false);
  const [viewEvalRecord, setViewEvalRecord] = useState<MergedRow | null>(null);
  const [tablePage, setTablePage] = useState(1);
  const pageSize = 10;

  const fetchPositions = useCallback(async () => {
    try {
      const response = await request.get('/positions');
      const items = Array.isArray(response) ? response : (response?.positions || []);
      const mapped = items.map((item: any) => ({
        id: item.id,
        title: item.title,
        primary_interviewer: item.primary_interviewer,
        secondary_interviewer: item.secondary_interviewer,
      }));
      setPositions(mapped);
      return mapped;
    } catch {
      setPositions([]);
      return [];
    }
  }, []);

  const fetchMergedData = useCallback(async () => {
    setLoading(true);
    try {
      // 同时拉候选人 + 面试记录
      const [candidates, interviews] = await Promise.all([
        request.get('/talent-pool', { params: { candidate_name: search || undefined, responsible_person: selectedOwner || undefined } }).catch(() => []),
        request.get('/interviews', { params: { owner_name: selectedOwner || undefined } }).catch(() => []),
      ]);

      // 构建 interview 索引（多维度关联）
      const interviewMap = new Map<string, any>();
      const orphans: any[] = [];
      for (const iv of interviews || []) {
        const keys = [iv.resume_id, iv.candidate_name, iv.comments, iv.interviewer].filter(Boolean);
        if (keys.length > 0) {
          for (const k of keys) interviewMap.set(k, iv);
        } else {
          orphans.push(iv);
        }
      }

      // 合并
      const usedInterviewIds = new Set<string>();
      const merged: MergedRow[] = (candidates || []).map((c: any) => {
        const matchedIv = interviewMap.get(c.feishu_record_id)
          || interviewMap.get(c.id)
          || interviewMap.get(c.candidate_name)
          || (interviews || []).find((iv: any) =>
              iv.resume_id === c.feishu_record_id
              || iv.resume_id === c.candidate_name
              || iv.candidate_name === c.candidate_name
              || iv.comments === c.candidate_name
          );

        if (matchedIv?.id) usedInterviewIds.add(matchedIv.id);

        return {
          id: c.id || c.feishu_record_id,
          candidate_name: c.candidate_name || '未知',
          position: c.standard_position || c.mapped_position || c.position_applied || '',
          position_applied: c.position_applied || '',
          standard_position: c.standard_position || c.position_applied || '',
          education: c.education || '',
          city: c.city || '',
          talent_status: c.status || 'pending_screening',
          interview_id: matchedIv?.id || null,
          interview_status: matchedIv?.status || '',
          interview_time: matchedIv?.interview_time || '',
          interview_location: matchedIv?.interview_location || '',
          result: matchedIv?.result || '',
          result2: matchedIv?.result2 || '',
          status2: matchedIv?.status2 || '',
          evaluation: matchedIv?.evaluation || '',
          evaluation2: matchedIv?.evaluation2 || '',
          feishu_record_id: c.feishu_record_id || c.id || '',
          resume_id: c.id || '',
          interviewer: matchedIv?.interviewer || '',
          primary_interviewer: matchedIv?.primary_interviewer || '',
          secondary_interviewer: matchedIv?.secondary_interviewer || '',
          created_at: matchedIv?.created_at || '',
          create_time: Number(c.create_time) || 0,
        };
      });

      // 追加未关联的手动创建面试
      for (const iv of (interviews || [])) {
        if (usedInterviewIds.has(iv.id)) continue;
        merged.push({
          id: iv.id,
          candidate_name: iv.candidate_name || iv._candidate_name || '未知',
          position: iv._position_title || '',
          position_applied: iv.position_applied || '',
          standard_position: iv._position_title || iv.position_applied || '',
          education: '',
          city: '',
          talent_status: 'manual',
          interview_id: iv.id,
          interview_status: iv.status || '',
          interview_time: iv.interview_time || '',
          interview_location: iv.interview_location || '',
          result: iv.result || '',
          result2: iv.result2 || '',
          status2: iv.status2 || '',
          evaluation: iv.evaluation || '',
          evaluation2: iv.evaluation2 || '',
          feishu_record_id: '',
          resume_id: iv.resume_id || '',
          interviewer: iv.interviewer || '',
          primary_interviewer: iv.primary_interviewer || '',
          secondary_interviewer: iv.secondary_interviewer || '',
          created_at: iv.created_at || '',
          create_time: 0,
        });
      }

      // 按入库时间倒序：最新入库排最前（create_time 毫秒时间戳，无值时回退 created_at 字符串比较）
      merged.sort((a, b) => {
        if (a.create_time && b.create_time) return b.create_time - a.create_time;
        if (a.create_time) return -1;
        if (b.create_time) return 1;
        return (b.created_at || '').localeCompare(a.created_at || '');
      });

      // 过滤状态下拉
      let filtered = merged;
      if (filterStatus === 'pending_interview') {
        filtered = merged.filter(r => r.talent_status === 'approved' && !r.interview_id);
      } else if (filterStatus === 'scheduled') {
        filtered = merged.filter(r => r.interview_status === 'scheduled');
      } else if (filterStatus === 'completed') {
        filtered = merged.filter(r => r.interview_status === 'completed');
      } else if (filterStatus === 'approved') {
        filtered = merged.filter(r => r.talent_status === 'approved');
      } else if (filterStatus === 'passed') {
        filtered = merged.filter(r => r.result === 'passed');
      }

      setData(filtered);

      // 面试卡片固定链接预取：进入面试管理即确保每份简历都有固定链接（已有则复用续期），
      // 点击「面试卡片」直接打开，不再实时生成
      const linkItems = new Map<string, { candidate_name: string; position_applied: string }>();
      for (const row of filtered) {
        if (!row.resume_id || linkItems.has(row.resume_id)) continue;
        linkItems.set(row.resume_id, {
          candidate_name: row.candidate_name,
          position_applied: row.position_applied || row.position || row.standard_position || '',
        });
      }
      if (linkItems.size > 0) {
        try {
          const batch = await request.post('/interview-card-links/batch', {
            items: [...linkItems].map(([resume_id, info]) => ({ resume_id, ...info })),
          }) as { items?: Array<{ resume_id: string; url: string; expires_at: string }> };
          const next: Record<string, { url: string; expires_at: string }> = {};
          for (const item of batch.items || []) {
            if (item?.resume_id && item.url) next[item.resume_id] = { url: item.url, expires_at: item.expires_at || '' };
          }
          setCardLinks(next);
        } catch {
          // 链接预取失败不影响列表展示，点击卡片时再按需创建
        }
      }
    } catch {
      message.error('加载数据失败');
    } finally {
      setLoading(false);
    }
  }, [search, filterStatus, selectedOwner]);

  useEffect(() => { fetchMergedData(); }, [fetchMergedData]);
  useEffect(() => { fetchPositions(); }, [fetchPositions]);

  // == 飞书导入 ==
  const handleFeishuSync = async () => {
    const key = 'interviewSync';
    setSyncLoading(true);
    message.loading({ content: '正在从飞书导入面试数据...', key });
    try {
      const res = await request.post('/interviews/sync-from-feishu') as any;
      message.success({ content: `已同步 ${res.created || 0} 条新增，${res.updated || 0} 条更新`, key });
      fetchMergedData();
    } catch { message.error({ content: '同步失败', key }); }
    finally { setSyncLoading(false); }
  };

  // == 安排面试 ==
  const handleOpenSchedule = async (record: MergedRow) => {
    setScheduleRecord(record);
    scheduleForm.resetFields();
    // 岗位配置的面试官自动同步：优先已有岗位列表，缺失时先拉取再匹配，减少手动填写
    let positionList = positions;
    if (positionList.length === 0) positionList = await fetchPositions();
    const defaults = resolveScheduleInterviewerDefaults(record, positionList);
    setScheduleDefaults(defaults);
    // 弹窗面试官初始值：优先记录已安排的面试官（避免岗位自动匹配覆盖实际安排的面试官）
    const prefill = resolveScheduleInterviewerPrefill(record, defaults);
    scheduleForm.setFieldsValue(prefill);
    setScheduleModalVisible(true);

    // 自动查一面面试官未来空闲时段 → 推荐定日程（点选或自动选中第一个）
    setAvailableSlots([]);
    setSlotReason(null);
    const interviewerName = record.primary_interviewer || record.interviewer || defaults.interviewerName || '';
    if (interviewerName) {
      setSlotLoading(true);
      try {
        const res = await request.get('/interviews/available-slots', { params: { interviewer: interviewerName } });
        const slots = res?.slots || [];
        setAvailableSlots(slots);
        if (res?.reason) setSlotReason(res.reason);
        if (slots.length > 0) {
          const first = slots[0];
          scheduleForm.setFieldsValue({
            interview_date: dayjs(first.start.slice(0, 10)),
            interview_time: dayjs(first.start.slice(11, 16), 'HH:mm'),
            interview_time_slot: first.start,
          });
          // 自动查询空闲会议室（C5/D1 优先）填充「面试地点」下拉
          autoFillMeetingRoom(first.start);
        }
      } catch {
        setSlotReason('空闲时段查询失败，请手动选择时间');
      } finally {
        setSlotLoading(false);
      }
    }
  };

  // 按推荐时段自动查空闲会议室（C5/D1 栋优先）：刷新下拉选项，默认选中 D1 栋第一个空闲会议室
  const autoFillMeetingRoom = async (startAt: string) => {
    try {
      const res = await request.get('/meeting-rooms/available', { params: { start_at: startAt, duration_minutes: 60 } });
      const rooms = (res?.rooms || []) as Array<{ room_id: string; name: string; building: string }>;
      setAvailableRooms(rooms);
      const pick = rooms.find((r) => r.building === 'D1') || rooms[0];
      if (!pick) return;
      const current = scheduleForm.getFieldValue('interview_location');
      // 为空，或当前值仍是上次自动填充的房间（切换时段场景）→ 更新默认值；手动改过则不覆盖
      if (!current || lastAutoRoomRef.current === current) {
        scheduleForm.setFieldsValue({ interview_location: pick.name });
        lastAutoRoomRef.current = pick.name;
      }
    } catch { /* 会议室查询失败不阻塞安排流程 */ }
  };

  const handleScheduleSubmit = async () => {
    if (!scheduleRecord) return;
    try {
      const values = await scheduleForm.validateFields();
      const name = scheduleRecord.candidate_name || '该候选人';
      setScheduling(true);

      let interviewTime = '';
      if (values.interview_date && values.interview_time) {
        interviewTime = `${values.interview_date.format('YYYY-MM-DD')} ${values.interview_time.format('HH:mm')}`;
      } else if (values.interview_date) {
        interviewTime = values.interview_date.format('YYYY-MM-DD');
      }

      if (scheduleRecord.interview_id) {
        if (!values.interview_date || !values.interview_time) {
          message.error('自动化安排面试必须填写日期和时间');
          return;
        }
        const localStart = `${values.interview_date.format('YYYY-MM-DD')}T${values.interview_time.format('HH:mm')}:00+08:00`;
        await request.post(`/interviews/${scheduleRecord.interview_id}/schedule-direct`, {
          start_at: new Date(localStart).toISOString(),
          duration_minutes: 60,
          interview_type: values.interview_type === 'onsite' ? 'onsite' : 'video',
          interview_location: values.interview_location || '',
        });
      } else {
        // 无面试记录：先创建「待安排」面试，再立即触发自动化安排（建会议链接 + 面试官卡片附简历 + 候选人邮件）
        if (!values.interview_date || !values.interview_time) {
          message.error('自动化安排面试必须填写日期和时间');
          return;
        }
        const created = await request.post('/interviews/create-from-talent', buildCreateFromTalentPayload({
          record: scheduleRecord,
          values,
          defaults: scheduleDefaults,
          interviewTime,
        })) as any;
        const interviewId = created?.id || created?.interview_id;
        if (interviewId) {
          const localStart = `${values.interview_date.format('YYYY-MM-DD')}T${values.interview_time.format('HH:mm')}:00+08:00`;
          await request.post(`/interviews/${interviewId}/schedule`, {
            start_at: new Date(localStart).toISOString(),
            duration_minutes: 60,
            interview_type: 'video',
            location: values.interview_location || '',
            timezone: 'Asia/Shanghai',
          });
        } else {
          message.warning('面试记录已创建但未获取到 ID，自动化排期未触发，可在面试管理重新安排');
        }
      }
      message.success(`已安排面试：${name}`);
      setScheduleModalVisible(false);
      setScheduleDefaults(null);
      fetchMergedData();
    } catch (e: any) {
      if (e.errorFields) return;
      message.error(e.response?.data?.detail || '操作失败');
    } finally {
      setScheduling(false);
    }
  };

  // == 下载简历 ==
  const handleDownload = (record: MergedRow) => {
    const token = localStorage.getItem('token') || '';
    const url = `/api/resumes/${record.resume_id}/file?download=true&token=${encodeURIComponent(token)}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = (record.candidate_name || 'resume') + '.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // == 批量删除 ==
  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要删除的面试记录');
      return;
    }
    Modal.confirm({
      title: '确认批量删除',
      content: `确定要删除选中的 ${selectedRowKeys.length} 条面试记录吗？`,
      okText: '确认',
      cancelText: '取消',
      okType: 'danger',
      onOk: async () => {
        try {
          const deletableKeys = selectedRowKeys.filter(k => data.find(r => r.id === k)?.interview_id);
          const skippedCount = selectedRowKeys.length - deletableKeys.length;

          if (deletableKeys.length === 0) {
            message.warning('所选记录均未安排面试，无法删除（仅已安排面试的记录可删除）');
            return;
          }

          await Promise.all(deletableKeys.map(id => {
            const record = data.find(r => r.id === id);
            return request.delete(`/interviews/${record.interview_id}`);
          }));

          if (skippedCount > 0) {
            message.success(`成功删除 ${deletableKeys.length} 条，${skippedCount} 条因未安排面试已跳过`);
          } else {
            message.success(`成功删除 ${deletableKeys.length} 条记录`);
          }
          setSelectedRowKeys([]);
          fetchMergedData();
        } catch (e: any) {
          message.error(e?.response?.data?.detail || '批量删除失败');
        }
      },
    });
  };

  // == 发送面试提醒 ==
  const handleSendReminder = async (record: MergedRow, interviewerName?: string) => {
    const name = interviewerName || record.interviewer;
    try {
      setReminderLoading(record.id);
      const response = await request.post(`/interviews/${record.interview_id}/notify-interviewer`, {
        interviewer_name: name,
      }) as ReminderDeliveryResponse;
      const feedback = getReminderFeedback(response);
      message[feedback.type](feedback.content);
    } catch (error: unknown) {
      const errorResponse = typeof error === 'object' && error !== null && 'response' in error
        ? (error as { response?: { data?: ReminderDeliveryResponse } }).response?.data
        : undefined;
      if (errorResponse?.need_feishu_auth || errorResponse?.need_bind) {
        const feedback = getReminderFeedback(errorResponse);
        message[feedback.type](feedback.content);
      } else {
        message.error(errorResponse?.detail || '发送提醒失败');
      }
    } finally {
      setReminderLoading(null);
    }
  };

  const handleViewEval = (record: MergedRow) => {
    setViewEvalRecord(record);
    setViewEvalVisible(true);
  };

  // == 面试管理卡片链接 ==
  const [cardLinkVisible, setCardLinkVisible] = useState(false);
  const [cardLinkRecord, setCardLinkRecord] = useState<MergedRow | null>(null);
  const [cardLinkUrl, setCardLinkUrl] = useState('');
  const [cardLinkExpires, setCardLinkExpires] = useState('');
  const [cardLinkLoading, setCardLinkLoading] = useState(false);
  // 进入面试管理页时预取的固定链接：resume_id -> { url, expires_at }，一个简历一个固定链接
  const [cardLinks, setCardLinks] = useState<Record<string, { url: string; expires_at: string }>>({});

  // 自动化作业状态与失败通知重试
  const [automationVisible, setAutomationVisible] = useState(false);
  const [automationLoading, setAutomationLoading] = useState(false);
  const [automationRecord, setAutomationRecord] = useState<MergedRow | null>(null);
  const [automationData, setAutomationData] = useState<{ jobs: any[]; notifications: any[] }>({ jobs: [], notifications: [] });
  const [retryingNotification, setRetryingNotification] = useState<string | null>(null);

  const handleViewAutomation = async (record: MergedRow) => {
    if (!record.interview_id) return;
    setAutomationRecord(record);
    setAutomationVisible(true);
    setAutomationLoading(true);
    try {
      const res = await request.get(`/interviews/${record.interview_id}/automation`) as any;
      setAutomationData({
        jobs: Array.isArray(res.jobs) ? res.jobs : [],
        notifications: Array.isArray(res.notifications) ? res.notifications : [],
      });
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '读取自动化状态失败');
    } finally {
      setAutomationLoading(false);
    }
  };

  const handleRetryNotification = async (notificationId: string) => {
    if (!automationRecord?.interview_id) return;
    setRetryingNotification(notificationId);
    try {
      await request.post(`/interviews/${automationRecord.interview_id}/retry`, { notification_id: notificationId });
      message.success('重试任务已提交');
      await handleViewAutomation(automationRecord);
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '提交重试失败');
    } finally {
      setRetryingNotification(null);
    }
  };

  const getCardLinkFullUrl = (urlPath: string) => {
    // 生产域名固定，本地开发用当前 origin
    const base = (window as any).CARD_LINK_BASE || window.location.origin;
    return `${base}${urlPath}`;
  };

  const handleGenCardLink = async (record: MergedRow) => {
    // 每份简历的固定链接在进入面试管理页时已预取，直接打开即可（无需实时生成）
    const prefetched = record.resume_id ? cardLinks[record.resume_id] : undefined;
    if (prefetched?.url) {
      setCardLinkRecord(record);
      setCardLinkUrl(getCardLinkFullUrl(prefetched.url));
      setCardLinkExpires(prefetched.expires_at || '');
      setCardLinkVisible(true);
      return;
    }
    // 手动创建的面试（无简历关联）回退为按姓名生成/复用
    try {
      setCardLinkLoading(true);
      const res = await request.post('/interview-card-links', {
        resume_id: record.resume_id || undefined,
        candidate_name: record.candidate_name,
        position_applied: record.position_applied || record.position || record.standard_position || '',
      });
      setCardLinkRecord(record);
      setCardLinkUrl(getCardLinkFullUrl(res.url));
      setCardLinkExpires(res.expires_at || '');
      setCardLinkVisible(true);
    } catch (e: any) {
      message.error(e.response?.data?.detail || '生成失败');
    } finally {
      setCardLinkLoading(false);
    }
  };

  const handleCopyCardLink = async () => {
    try {
      await navigator.clipboard.writeText(cardLinkUrl);
      message.success('链接已复制');
    } catch {
      message.success(`链接：${cardLinkUrl}`);
    }
  };

  // == 送入入职 ==
  const handleSendToOnboarding = async (record: MergedRow) => {
    try {
      setOnboardingLoading(record.id);
      await request.post('/onboarding', {
        resume_id: record.resume_id || '',
        candidate_name: record.candidate_name,
        position_title: record.position_applied || record.position || '',
      });
      message.success(`已送入入职管理：${record.candidate_name}`);
      setOnboardedRecords(prev => new Set(prev).add(record.id));
      fetchMergedData();
    } catch (e: any) {
      message.error(e.response?.data?.detail || '操作失败');
    } finally {
      setOnboardingLoading(null);
    }
  };

  // == 表格列 ==
  const columns = [
    {
      title: '候选人', key: 'candidate', width: 110,
      render: (_: any, r: MergedRow) => (
        <Space size={2}>
          <UserOutlined style={{ color: '#1677ff' }} />
          <Text strong>{r.candidate_name}</Text>
        </Space>
      ),
    },
    {
      title: '标准岗位', key: 'position', width: 130,
      render: (_: any, r: MergedRow) => {
        if (r.position) {
          return (
            <Tooltip title={`原始岗位: ${r.position_applied || '-'}`}>
              <Tag color="blue">{r.standard_position || r.position}</Tag>
            </Tooltip>
          );
        }
        return <span style={{ color: '#999' }}>{r.standard_position || r.position_applied || '-'}</span>;
      }
    },
    { title: '学历', dataIndex: 'education', key: 'education', width: 64,
      render: (v: string) => v || '-' },
    { title: '城市', dataIndex: 'city', key: 'city', width: 64 },
    {
      title: '候选人状态', key: 'talent_status', width: 100,
      render: (_: any, r: MergedRow) => {
        const cfg = talentStatusConfig[r.talent_status] || { color: 'default', text: r.talent_status || '待初筛' };
        return <Tag color={cfg.color}>{cfg.text}</Tag>;
      }
    },
    {
      title: '面试状态', key: 'interview_status', width: 88,
      render: (_: any, r: MergedRow) => {
        if (!r.interview_id) return <Tag>未安排</Tag>;
        // 动态计算状态
        let statusKey: string;
        const r1Passed = r.result === 'passed';
        const r1Failed = r.result === 'failed';
        const r2Passed = r.result2 === 'passed';
        const r2Failed = r.result2 === 'failed';
        const noR2Result = !r.result2 || r.result2 === 'pending';

        if (r1Failed) {
          statusKey = 'failed';           // 一面未通过
        } else if (r1Passed && r2Failed) {
          statusKey = 'failed';           // 一面过、二面未通过
        } else if (r1Passed && r2Passed) {
          statusKey = onboardedRecords.has(r.id) ? 'onboarded' : 'pending_onboarding'; // 两面通过
        } else if (r1Passed && noR2Result) {
          statusKey = r.interview_status; // 一面过，二面待进行 → 延用后端状态
        } else {
          statusKey = r.interview_status; // 其他情况延用后端状态
        }
        const cfg = interviewStatusConfig[statusKey] || { color: 'default', text: statusKey };
        return <Tag color={cfg.color}>{cfg.text}</Tag>;
      }
    },
    {
      title: '面试时间', key: 'interview_time', width: 130,
      render: (_: any, r: MergedRow) => r.interview_time || '-',
    },
    {
      title: '一面面试官', dataIndex: 'primary_interviewer', key: 'primary_interviewer', width: 84, ellipsis: { showTitle: false },
      render: (v: string, r?: MergedRow) => {
        // 未填写时自动展示岗位管理配置的一面面试官（按岗位名称匹配）
        const auto = resolveScheduleInterviewerDefaults({ standard_position: r?.standard_position, position_applied: r?.position_applied || r?.position }, positions);
        const display = v || auto.interviewerName || '待分配';
        const fromPosition = !v && auto.matchedPositionTitle;
        return (
          <Tooltip title={fromPosition ? `已按岗位「${auto.matchedPositionTitle}」自动匹配` : (v || '')}>
            <span>{display}</span>
          </Tooltip>
        );
      },
    },
    {
      title: '二面面试官', dataIndex: 'secondary_interviewer', key: 'secondary_interviewer', width: 84, ellipsis: { showTitle: false },
      render: (v: string, r?: MergedRow) => {
        const auto = resolveScheduleInterviewerDefaults({ standard_position: r?.standard_position, position_applied: r?.position_applied || r?.position }, positions);
        const display = v || auto.secondaryInterviewer || '-';
        const fromPosition = !v && auto.matchedPositionTitle;
        return (
          <Tooltip title={fromPosition ? `已按岗位「${auto.matchedPositionTitle}」自动匹配` : (v || '')}>
            <span>{display}</span>
          </Tooltip>
        );
      },
    },
    {
      title: '一面结果', key: 'result1', width: 70,
      render: (_: any, r: MergedRow) => {
        if (!r.interview_id || !r.result || r.result === 'pending') return <Tag>待评价</Tag>;
        const cfg = resultLabels[r.result];
        return <Tag color={cfg?.color}>{cfg?.text || r.result}</Tag>;
      }
    },
    {
      title: '二面结果', key: 'result2', width: 70,
      render: (_: any, r: MergedRow) => {
        if (!r.interview_id || !r.result2 || r.result2 === 'pending') return <Tag>待评价</Tag>;
        const cfg = resultLabels[r.result2];
        return <Tag color={cfg?.color}>{cfg?.text || r.result2}</Tag>;
      }
    },
    {
      title: '面试链接', key: 'interview_link', width: 104,
      render: (_: any, r: MergedRow) => {
        const path = r.resume_id ? cardLinks[r.resume_id]?.url : undefined;
        if (!path) return <span style={{ color: '#999', fontSize: 12 }}>—</span>;
        const full = getCardLinkFullUrl(path);
        return (
          <Space size={2}>
            <Typography.Link href={full} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>打开</Typography.Link>
            <Button
              size="small" type="text" icon={<CopyOutlined />}
              onClick={() => { navigator.clipboard.writeText(full).then(() => message.success('链接已复制')).catch(() => message.success(`链接：${full}`)); }}
            />
          </Space>
        );
      }
    },
    {
      title: '操作', align: 'center' as const, key: 'action', width: 380,
      render: (_: any, r: MergedRow) => {
        const canSchedule = r.talent_status === 'approved'
          && (!r.interview_id || ['awaiting_schedule', 'manual_review'].includes(r.interview_status));
        // 未评过 → 提醒一面
        const canRemind1 = r.interview_id && (!r.result || r.result === 'pending');
        // 一面已过，二面未评 → 提醒二面
        const canRemind2 = r.interview_id && r.result === 'passed'
          && (!r.result2 || r.result2 === 'pending');
        // 有评价 → 查看
        const canView = r.interview_id && (r.evaluation || r.evaluation2);
        // 送入入职：一面通过且二面通过（或一面通过且无二面）
        const canSendToOnboarding = r.interview_id && r.result === 'passed'
          && (!r.result2 || r.result2 === 'passed');

        // 统一面试官名：优先取专用字段，回退通用字段
        const iv1 = r.primary_interviewer || r.interviewer;
        const iv2 = r.secondary_interviewer || r.interviewer;

        return (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'space-between', alignItems: 'flex-start' }}>
            {/* 左侧：流程操作（安排/提醒/入职） */}
            <Space size={2} wrap style={{ justifyContent: 'flex-start' }}>
              {canSchedule && (
                <Button type="primary" size="small" icon={<BellOutlined />} onClick={() => handleOpenSchedule(r)}>安排面试</Button>
              )}
              {canRemind1 && (
                <Button type="primary" size="small" icon={<BellOutlined />} loading={reminderLoading === r.id} disabled={!!reminderLoading} onClick={() => handleSendReminder(r, iv1)}>提醒一面</Button>
              )}
              {canRemind2 && (
                <Button type="primary" size="small" icon={<BellOutlined />} loading={reminderLoading === r.id} disabled={!!reminderLoading} onClick={() => handleSendReminder(r, iv2)}>提醒二面</Button>
              )}
              {canSendToOnboarding && (
                <Button type="primary" size="small" icon={<HomeOutlined />} loading={onboardingLoading === r.id} onClick={() => handleSendToOnboarding(r)}>发起入职</Button>
              )}
            </Space>
            {/* 右侧：工具操作（查看/下载/编辑） */}
            <Space size={2} wrap style={{ marginLeft: 'auto', justifyContent: 'flex-end' }}>
              {canView && (
                <Button size="small" icon={<EyeOutlined />} onClick={() => handleViewEval(r)}>查看评价</Button>
              )}
              {r.interview_id && (
                <Button size="small" icon={<ClockCircleOutlined />} onClick={() => handleViewAutomation(r)}>自动化状态</Button>
              )}
              <Tooltip title="面试卡片：该简历的固定链接（进入面试管理自动生成，30 天有效，进入本页自动续期）">
                <Button size="small" icon={<LinkOutlined />} loading={cardLinkLoading} disabled={!!cardLinkLoading} onClick={() => handleGenCardLink(r)}>面试卡片</Button>
              </Tooltip>
              <Tooltip title="下载简历"><Button size="small" icon={<DownloadOutlined />} onClick={() => handleDownload(r)} /></Tooltip>
              <Tooltip title="编辑"><Button size="small" icon={<EditOutlined />} onClick={() => handleOpenEdit(r)} /></Tooltip>
            </Space>
          </div>
        );
      }
    },
  ];

  return (
    <div>
      <Card
        title={
          <Space>
            <TeamOutlined />
            <span>面试管理</span>
          </Space>
        }
        extra={
          <Space wrap>
            <Input
              size="middle"
              placeholder="搜索候选人姓名"
              prefix={<SearchOutlined />}
              allowClear
              style={{ width: 200 }}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <Select size="middle" placeholder="筛选" allowClear style={{ width: 200 }}
              value={filterStatus} onChange={v => setFilterStatus(v)}>
              <Select.Option value="approved">已入库</Select.Option>
              <Select.Option value="pending_interview">待安排面试</Select.Option>
              <Select.Option value="scheduled">待面试</Select.Option>
              <Select.Option value="passed">通过</Select.Option>
              <Select.Option value="completed">已完成</Select.Option>
            </Select>
            <Button icon={<ReloadOutlined />} onClick={fetchMergedData}>刷新</Button>
            <Button icon={<CloudUploadOutlined />} loading={syncLoading} onClick={handleFeishuSync}>飞书导入</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => { createForm.resetFields(); setCreateModalVisible(true); }}>新建面试</Button>
          </Space>
        }
        style={{ borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
      >
        {selectedRowKeys.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <Space>
              <span style={{ color: '#64748B' }}>已选 {selectedRowKeys.length} 项</span>
              <Button danger onClick={handleBatchDelete}>批量删除</Button>
              <Button onClick={() => setSelectedRowKeys([])}>取消选择</Button>
            </Space>
          </div>
        )}
        <ResponsiveDataView
          dataSource={data.slice((tablePage - 1) * pageSize, tablePage * pageSize)}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={false}
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys,
            columnWidth: 40,
          }}
          card={{
            title: record => record.candidate_name || '-',
            subtitle: record => [record.standard_position || record.position_applied || record.position, record.education, record.city, record.interview_time].filter(Boolean).join(' · '),
            status: record => (columns[5] as any).render(null, record),
            fields: [
              { key: 'primary_interviewer', label: '一面面试官', level: 'detail', render: record => (columns[7] as any).render(record.primary_interviewer, record) },
              { key: 'secondary_interviewer', label: '二面面试官', level: 'detail', render: record => (columns[8] as any).render(record.secondary_interviewer, record) },
              { key: 'result1', label: '一面结果', level: 'detail', render: record => (columns[9] as any).render(null, record) },
              { key: 'result2', label: '二面结果', level: 'detail', render: record => (columns[10] as any).render(null, record) },
              { key: 'talent_status', label: '候选人状态', level: 'detail', render: record => record.talent_status || '-' },
            ],
            actions: record => (columns[12] as any).render(null, record),
          }}
        />
        <SimplePagination current={tablePage} pageSize={pageSize} total={data.length} onChange={setTablePage} />
      </Card>

      {/* 安排面试弹窗 */}
      <ResponsiveModal
        title={
          <Space>
            <BellOutlined />
            <span>安排面试 - {scheduleRecord?.candidate_name || ''}</span>
          </Space>
        }
        open={scheduleModalVisible}
        onOk={handleScheduleSubmit}
        onCancel={() => {
          setScheduleModalVisible(false);
          setScheduleDefaults(null);
        }}
        confirmLoading={scheduling}
        okText="确认安排"
        width={520}
        destroyOnHidden
      >
        <Form form={scheduleForm} layout="vertical" preserve={false}>
          <Form.Item
            name="interview_time_slot"
            label="推荐面试时段"
            tooltip="按一面面试官自动查询的空闲时段（1 小时），选择后自动带入日期时间并刷新空闲会议室"
          >
            <Select
              placeholder={slotLoading ? '正在查询空闲时段...' : (slotReason || '暂无推荐时段，请手动选择下方日期时间')}
              loading={slotLoading}
              notFoundContent={slotLoading ? <Spin size="small" /> : (slotReason || '暂无推荐时段，请手动选择下方日期时间')}
              options={availableSlots.map((s) => ({
                value: s.start,
                label: `${s.start.slice(5, 16)} ~ ${s.end.slice(11, 16)}`,
              }))}
              onChange={(val) => {
                const picked = availableSlots.find((x) => x.start === val);
                if (picked) {
                  scheduleForm.setFieldsValue({
                    interview_date: dayjs(picked.start.slice(0, 10)),
                    interview_time: dayjs(picked.start.slice(11, 16), 'HH:mm'),
                  });
                  // 切换推荐时段时同步刷新空闲会议室（手动改过地点则不覆盖）
                  autoFillMeetingRoom(picked.start);
                }
              }}
            />
          </Form.Item>
          <Form.Item name="interview_type" label="面试形式" initialValue="video">
            <Radio.Group>
              <Radio.Button value="video">线上面试</Radio.Button>
              <Radio.Button value="onsite">线下面试</Radio.Button>
            </Radio.Group>
          </Form.Item>
          <Form.Item name="interview_date" label="面试日期">
            <DatePicker style={{ width: '100%' }} placeholder="选择面试日期（可选）" />
          </Form.Item>
          <Form.Item name="interview_time" label="面试时间">
            <DatePicker.TimePicker style={{ width: '100%' }} placeholder="选择面试时间（可选）" format="HH:mm" />
          </Form.Item>
          <Form.Item name="interview_location" label="面试地点 / 会议链接">
            <AutoComplete
              options={availableRooms.map((r) => ({
                value: r.name,
                label: r.building ? `${r.name}（${r.building}栋）` : r.name,
              }))}
              placeholder="选择空闲会议室，或手动输入地点/会议链接"
              allowClear
              onSelect={(val) => { lastAutoRoomRef.current = val; }}
            />
          </Form.Item>
          <Form.Item name="interviewer_name" label="一面面试官">
            <Input placeholder="输入一面面试官姓名" />
          </Form.Item>
          <Form.Item name="secondary_interviewer" label="二面面试官（可选）">
            <Input placeholder="输入二面面试官姓名（可选）" />
          </Form.Item>
          {scheduleDefaults?.matchedPositionTitle ? (
            <div style={{ marginTop: -8, marginBottom: 8, color: '#1677ff', fontSize: 12 }}>
              已按岗位「{scheduleDefaults.matchedPositionTitle}」自动匹配岗位管理的面试官（可修改）
            </div>
          ) : null}
        </Form>
      </ResponsiveModal>

      {/* 查看评价弹窗 */}
      <ResponsiveModal
        title={`面试评价 - ${viewEvalRecord?.candidate_name || ''}`}
        open={viewEvalVisible}
        onCancel={() => setViewEvalVisible(false)}
        footer={<Button onClick={() => setViewEvalVisible(false)}>关闭</Button>}
        width={560}
      >
        {viewEvalRecord && (
          <div>
            <div style={{ marginBottom: 16 }}>
              <Text strong style={{ fontSize: 16 }}>一面评价</Text>
              {viewEvalRecord.evaluation ? (
                <>
                  <div style={{ whiteSpace: 'pre-wrap', background: '#f5f5f5', padding: 12, borderRadius: 6, marginTop: 8 }}>
                    {viewEvalRecord.evaluation}
                  </div>
                  {viewEvalRecord.result && (
                    <div style={{ marginTop: 8 }}>
                      <Text strong>结果：</Text>
                      <Tag color={viewEvalRecord.result === 'passed' ? 'success' : 'error'}>
                        {viewEvalRecord.result === 'passed' ? '通过' : '不通过'}
                      </Tag>
                    </div>
                  )}
                </>
              ) : (
                <div style={{ color: '#999', marginTop: 8 }}>暂未填写</div>
              )}
            </div>
            <div>
              <Text strong style={{ fontSize: 16 }}>二面评价</Text>
              {viewEvalRecord.evaluation2 ? (
                <>
                  <div style={{ whiteSpace: 'pre-wrap', background: '#f5f5f5', padding: 12, borderRadius: 6, marginTop: 8 }}>
                    {viewEvalRecord.evaluation2}
                  </div>
                  {viewEvalRecord.result2 && (
                    <div style={{ marginTop: 8 }}>
                      <Text strong>结果：</Text>
                      <Tag color={viewEvalRecord.result2 === 'passed' ? 'success' : 'error'}>
                        {viewEvalRecord.result2 === 'passed' ? '通过' : '不通过'}
                      </Tag>
                    </div>
                  )}
                </>
              ) : (
                <div style={{ color: '#999', marginTop: 8 }}>暂未填写</div>
              )}
            </div>
          </div>
        )}
      </ResponsiveModal>

      {/* 面试卡片链接弹窗 */}
      <ResponsiveModal
        title={<span><LinkOutlined /> 面试卡片链接 - {cardLinkRecord?.candidate_name || ''}</span>}
        open={cardLinkVisible}
        onCancel={() => setCardLinkVisible(false)}
        footer={
          <Space>
            <Button onClick={() => setCardLinkVisible(false)}>关闭</Button>
            <Button icon={<CopyOutlined />} onClick={handleCopyCardLink}>复制链接</Button>
            <Button type="primary" icon={<EyeOutlined />} href={cardLinkUrl} target="_blank" rel="noreferrer">打开链接</Button>
          </Space>
        }
        width={560}
      >
        <div style={{ marginBottom: 12, fontSize: 13, color: '#475569', lineHeight: 1.8 }}>
          <div>该链接为该简历的固定链接，汇总了候选人简历档案、各轮面试情况、评分评价、备注与进度时间线，可分享给业务方或面试官查看。</div>
          <div style={{ marginTop: 4 }}>
            {cardLinkExpires ? `当前有效期至 ${new Date(cardLinkExpires).toLocaleDateString('zh-CN')}，进入面试管理页会自动续期 30 天。` : ''}
            链接地址固定不变。
          </div>
        </div>
        <Input
          readOnly
          value={cardLinkUrl}
          onFocus={(e) => e.target.select()}
          addonAfter={<CopyOutlined style={{ cursor: 'pointer' }} onClick={handleCopyCardLink} />}
        />
      </ResponsiveModal>
      {/* 面试自动化状态 */}
      <ResponsiveModal
        title={`自动化状态 - ${automationRecord?.candidate_name || ''}`}
        open={automationVisible}
        onCancel={() => setAutomationVisible(false)}
        footer={<Button onClick={() => setAutomationVisible(false)}>关闭</Button>}
        width={700}
      >
        {automationLoading ? <div style={{ padding: 24, textAlign: 'center' }}>加载中...</div> : (
          <Space orientation="vertical" style={{ width: '100%' }}>
            <Text strong>异步作业</Text>
            {automationData.jobs.length === 0 ? <Text type="secondary">暂无自动化作业</Text> : automationData.jobs.map((job: any) => {
              const jobStatusCfg = automationJobStatusLabels[job.status] || { color: 'default', text: job.status };
              return (
                <Card size="small" key={job.id}>
                  <Space wrap>
                    <Tag>{automationActionLabels[job.action] || job.action}</Tag>
                    <Tag color={jobStatusCfg.color}>{jobStatusCfg.text}</Tag>
                    {job.error_message && <Text type="danger">{job.error_message}</Text>}
                  </Space>
                </Card>
              );
            })}
            <Text strong>通知投递</Text>
            {automationData.notifications.length === 0 ? <Text type="secondary">暂无通知记录</Text> : automationData.notifications.map((notification: any) => {
              const nStatusCfg = notificationStatusLabels[notification.status] || { color: 'default', text: notification.status };
              return (
                <Card size="small" key={notification.id}>
                  <Space wrap>
                    <Tag>{notificationChannelLabels[notification.channel] || notification.channel}</Tag>
                    <Tag>{notificationRecipientLabels[notification.recipient_type] || notification.recipient_type}</Tag>
                    <Tag color={nStatusCfg.color}>{nStatusCfg.text}</Tag>
                    {notification.status === 'failed' && <Button size="small" loading={retryingNotification === notification.id} onClick={() => handleRetryNotification(notification.id)}>重试</Button>}
                  </Space>
                  {notification.last_error && <div style={{ color: '#ff4d4f', marginTop: 4 }}>{notification.last_error}</div>}
                </Card>
              );
            })}
          </Space>
        )}
      </ResponsiveModal>
      {/* 新建面试弹窗 */}
      <ResponsiveModal
        title={<span>新建面试</span>}
        open={createModalVisible}
        onOk={handleCreateSubmit}
        onCancel={() => setCreateModalVisible(false)}
        confirmLoading={creating}
        okText="创建"
        width={520}
        destroyOnHidden
      >
        <Form form={createForm} layout="vertical" preserve={false}>
          <Form.Item name="candidate_name" label="候选人姓名" rules={[{ required: true, message: '请输入候选人姓名' }]}>
            <Input placeholder="输入候选人姓名" />
          </Form.Item>
          <Form.Item name="position_applied" label="应聘岗位">
            <Input placeholder="例如：前端工程师（可选）" onBlur={applyCreatePositionDefaults} />
          </Form.Item>
          <Form.Item name="interviewer_name" label="一面面试官">
            <Input placeholder="输入一面面试官姓名（可选）" />
          </Form.Item>
          <Form.Item name="secondary_interviewer" label="二面面试官（可选）">
            <Input placeholder="输入二面面试官姓名（可选）" />
          </Form.Item>
          {createDefaults?.matchedPositionTitle ? (
            <div style={{ marginTop: -8, marginBottom: 8, color: '#1677ff', fontSize: 12 }}>
              已按岗位「{createDefaults.matchedPositionTitle}」自动匹配岗位管理的面试官（可修改）
            </div>
          ) : null}
          <Form.Item name="interview_date" label="面试日期">
            <DatePicker style={{ width: '100%' }} placeholder="选择面试日期（可选）" />
          </Form.Item>
          <Form.Item name="interview_time" label="面试时间">
            <DatePicker.TimePicker style={{ width: '100%' }} placeholder="选择面试时间（可选）" format="HH:mm" />
          </Form.Item>
          <Form.Item name="interview_location" label="面试地点 / 会议链接">
            <Input placeholder="例如：3楼会议室 / 会议链接（可选）" />
          </Form.Item>
        </Form>
      </ResponsiveModal>

      {/* 编辑面试弹窗 */}
      <ResponsiveModal
        title={<span>编辑面试 - {editRecord?.candidate_name || ''}</span>}
        open={editModalVisible}
        onOk={handleEditSubmit}
        onCancel={() => setEditModalVisible(false)}
        confirmLoading={editSubmitting}
        okText="保存"
        width={600}
        destroyOnHidden
        footer={[
          <Popconfirm key="delete" title="确定删除该面试记录？" description="此操作不可恢复"
            onConfirm={handleDelete} okText="确认删除" cancelText="取消"
            okButtonProps={{ danger: true }}>
            <Button danger icon={<DeleteOutlined />} loading={deletingId === editRecord?.interview_id} style={{ float: 'left' }}>删除</Button>
          </Popconfirm>,
          <Button key="cancel" onClick={() => setEditModalVisible(false)}>取消</Button>,
          <Button key="save" type="primary" loading={editSubmitting} onClick={handleEditSubmit}>保存</Button>,
        ]}
        afterOpenChange={(open) => {
          if (open && editRecord) {
            editForm.resetFields();
            editForm.setFieldsValue({
              position_applied: editRecord.position_applied || editRecord.position || '',
              primary_interviewer: editRecord.primary_interviewer || editRecord.interviewer || editDefaults?.interviewerName || '',
              secondary_interviewer: editRecord.secondary_interviewer || editDefaults?.secondaryInterviewer || '',
              interview_time: editRecord.interview_time ? editRecord.interview_time.substring(0, 16) : '',
              interview_location: editRecord.interview_location || '',
              status: editRecord.interview_status || 'scheduled',
              evaluation: editRecord.evaluation || '',
              evaluation2: editRecord.evaluation2 || '',
              result: editRecord.result || 'pending',
              result2: editRecord.result2 || 'pending',
            });
          }
        }}
      >
        <Form form={editForm} layout="vertical" preserve={false}>
          <Form.Item name="position_applied" label="应聘岗位">
            <Input placeholder="应聘岗位" />
          </Form.Item>
          <Form.Item name="primary_interviewer" label="一面面试官">
            <Input placeholder="一面面试官" />
          </Form.Item>
          {editDefaults?.matchedPositionTitle && !(editRecord?.primary_interviewer || editRecord?.interviewer) && (
            <div style={{ fontSize: 12, color: '#8c8c8c', marginTop: -12, marginBottom: 16 }}>
              已按岗位「{editDefaults.matchedPositionTitle}」自动匹配岗位管理的面试官（可修改）
            </div>
          )}
          <Form.Item name="secondary_interviewer" label="二面面试官">
            <Input placeholder="二面面试官" />
          </Form.Item>
          <Form.Item name="interview_time" label="面试时间">
            <Input placeholder="如：2026-07-22 14:00" />
          </Form.Item>
          <Form.Item name="interview_location" label="面试地点">
            <Input placeholder="面试地点或会议链接" />
          </Form.Item>
          <Form.Item name="status" label="面试状态">
            <Select>
              <Select.Option value="awaiting_schedule">待确认时间</Select.Option>
              <Select.Option value="scheduled">待面试</Select.Option>
              <Select.Option value="in_progress">面试中</Select.Option>
              <Select.Option value="completed">已完成</Select.Option>
              <Select.Option value="cancelled">已取消</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="evaluation" label="一面评价">
            <Input.TextArea rows={3} placeholder="一面评价内容" />
          </Form.Item>
          <Form.Item name="result" label="一面结果">
            <Select allowClear>
              <Select.Option value="pending">待评价</Select.Option>
              <Select.Option value="passed">通过</Select.Option>
              <Select.Option value="failed">不通过</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="evaluation2" label="二面评价">
            <Input.TextArea rows={3} placeholder="二面评价内容" />
          </Form.Item>
          <Form.Item name="result2" label="二面结果">
            <Select allowClear>
              <Select.Option value="pending">待评价</Select.Option>
              <Select.Option value="passed">通过</Select.Option>
              <Select.Option value="failed">不通过</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </ResponsiveModal>
    </div>
  );
};

export default InterviewsList;
