import React, { useEffect, useState, useCallback } from 'react';
import {
  Table, Button, Space, message, Tag, Modal, Select, Input, Form, Popconfirm,
  Radio, Typography, Card, Tooltip, DatePicker
} from 'antd';
import SimplePagination from '../../components/SimplePagination';
import {
  ReloadOutlined, EditOutlined, EyeOutlined, SearchOutlined,
  BellOutlined, DownloadOutlined, TeamOutlined, UserOutlined, CloudUploadOutlined, PlusOutlined, DeleteOutlined,
  HomeOutlined
} from '@ant-design/icons';
import request from '../../utils/request';
import { useAuth } from '../../contexts/AuthContext';
import { useOwner } from '../../contexts/OwnerContext';

const { TextArea } = Input;
const { Text } = Typography;

// =================== 统一候选人面试管理 ===================

const interviewStatusConfig: Record<string, { color: string; text: string }> = {
  scheduled: { color: 'processing', text: '待面试' },
  completed: { color: 'success', text: '已完成' },
  cancelled: { color: 'default', text: '已取消' },
  pending_onboarding: { color: 'warning', text: '待入职' },
  onboarded: { color: 'success', text: '已入职' },
  failed: { color: 'error', text: '已淘汰' },
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

  // 新建面试弹窗（手动创建）
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [createForm] = Form.useForm();
  const [creating, setCreating] = useState(false);

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

  const handleOpenEdit = (record: MergedRow) => {
    setEditRecord(record);
    setEditModalVisible(true);
  };

  const handleEditSubmit = async () => {
    if (!editRecord) return;
    try {
      const values = await editForm.validateFields();
      setEditSubmitting(true);
      if (editRecord.interview_id) {
        await request.put(`/interviews/${editRecord.interview_id}`, values);
      } else {
        // 无面试记录时创建新的
        await request.post('/interviews', { ...values, status: values.status || 'scheduled' });
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
  const [evalModalVisible, setEvalModalVisible] = useState(false);
  const [evalRecord, setEvalRecord] = useState<MergedRow | null>(null);
  const [evalRound, setEvalRound] = useState<1 | 2>(1);
  const [evalForm] = Form.useForm();
  const [evalSubmitting, setEvalSubmitting] = useState(false);

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

  const fetchMergedData = useCallback(async () => {
    setLoading(true);
    try {
      // 同时拉候选人 + 面试记录
      const [candidates, interviews] = await Promise.all([
        request.get('/talent-pool', { params: { candidate_name: search || undefined } }).catch(() => []),
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
          position: c.mapped_position || '',
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
          standard_position: '',
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
    } catch {
      message.error('加载数据失败');
    } finally {
      setLoading(false);
    }
  }, [search, filterStatus, selectedOwner]);

  useEffect(() => { fetchMergedData(); }, [fetchMergedData]);

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
  const handleOpenSchedule = (record: MergedRow) => {
    setScheduleRecord(record);
    scheduleForm.resetFields();
    setScheduleModalVisible(true);
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

      await request.post('/interviews/create-from-talent', {
        candidate_name: name,
        position_applied: scheduleRecord.position_applied,
        standard_position: scheduleRecord.standard_position,
        city: scheduleRecord.city || '',
        feishu_record_id: scheduleRecord.feishu_record_id || scheduleRecord.resume_id,
        interview_time: interviewTime,
        interview_location: values.interview_location || '',
        interviewer_name: values.interviewer_name || '',
      });
      message.success(`已安排面试：${name}`);
      setScheduleModalVisible(false);
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

  // == 评价 ==
  const handleEvalRound1 = (record: MergedRow) => {
    setEvalRecord(record);
    setEvalRound(1);
    evalForm.resetFields();
    setEvalModalVisible(true);
  };

  const handleEvalRound2 = (record: MergedRow) => {
    setEvalRecord(record);
    setEvalRound(2);
    evalForm.resetFields();
    setEvalModalVisible(true);
  };

  const handleSubmitEval = async () => {
    try {
      const values = await evalForm.validateFields();
      setEvalSubmitting(true);
      await request.post(`/interviews/${evalRecord!.interview_id}/evaluate`, {
        evaluation: values.evaluation || '',
        result: values.result || '',
        round: evalRound,
      });
      message.success(`第${evalRound}面评价已提交`);
      setEvalModalVisible(false);
      fetchMergedData();
    } catch (e: any) {
      if (e.response) {
        message.error(e.response.data?.detail || '提交失败');
      }
    } finally {
      setEvalSubmitting(false);
    }
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
      await request.post(`/interviews/${record.interview_id}/notify-interviewer`, {
        candidate_name: record.candidate_name,
        position_applied: record.position_applied || record.position || '',
        city: record.city || '',
        interviewer_name: name,
        interview_time: record.interview_time || '',
      });
      message.success(`已提醒面试官：${name}`);
    } catch (e: any) {
      message.error(e.response?.data?.detail || '发送提醒失败');
    } finally {
      setReminderLoading(null);
    }
  };

  const handleViewEval = (record: MergedRow) => {
    setViewEvalRecord(record);
    setViewEvalVisible(true);
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
      title: '候选人', key: 'candidate', width: 130,
      render: (_: any, r: MergedRow) => (
        <Space>
          <UserOutlined style={{ color: '#1677ff' }} />
          <Text strong>{r.candidate_name}</Text>
        </Space>
      ),
    },
    {
      title: '标准岗位', key: 'position', width: 150,
      render: (_: any, r: MergedRow) => {
        if (r.position) {
          return (
            <Tooltip title={`原始岗位: ${r.position_applied || '-'}`}>
              <Tag color="blue">{r.position}</Tag>
            </Tooltip>
          );
        }
        return <span style={{ color: '#999' }}>{r.standard_position || r.position_applied || '-'}</span>;
      }
    },
    { title: '学历', dataIndex: 'education', key: 'education', width: 80,
      render: (v: string) => v || '-' },
    { title: '城市', dataIndex: 'city', key: 'city', width: 80 },
    {
      title: '候选人状态', key: 'talent_status', width: 130,
      render: (_: any, r: MergedRow) => {
        const cfg = talentStatusConfig[r.talent_status] || { color: 'default', text: r.talent_status || '待初筛' };
        return <Tag color={cfg.color}>{cfg.text}</Tag>;
      }
    },
    {
      title: '面试状态', key: 'interview_status', width: 100,
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
      title: '面试时间', key: 'interview_time', width: 150,
      render: (_: any, r: MergedRow) => r.interview_time || '-',
    },
    {
      title: '一面面试官', dataIndex: 'primary_interviewer', key: 'primary_interviewer', width: 100, ellipsis: { showTitle: false },
      render: (v: string) => (
        <Tooltip title={v || ''}>
          <span>{v || '-'}</span>
        </Tooltip>
      ),
    },
    {
      title: '二面面试官', dataIndex: 'secondary_interviewer', key: 'secondary_interviewer', width: 100, ellipsis: { showTitle: false },
      render: (v: string) => (
        <Tooltip title={v || ''}>
          <span>{v || '-'}</span>
        </Tooltip>
      ),
    },
    {
      title: '一面结果', key: 'result1', width: 90,
      render: (_: any, r: MergedRow) => {
        if (!r.interview_id || !r.result || r.result === 'pending') return <Tag>待评价</Tag>;
        const cfg = resultLabels[r.result];
        return <Tag color={cfg?.color}>{cfg?.text || r.result}</Tag>;
      }
    },
    {
      title: '二面结果', key: 'result2', width: 90,
      render: (_: any, r: MergedRow) => {
        if (!r.interview_id || !r.result2 || r.result2 === 'pending') return <Tag>待评价</Tag>;
        const cfg = resultLabels[r.result2];
        return <Tag color={cfg?.color}>{cfg?.text || r.result2}</Tag>;
      }
    },
    {
      title: '操作', align: 'center' as const, key: 'action', width: 500,
      render: (_: any, r: MergedRow) => {
        const canSchedule = r.talent_status === 'approved' && !r.interview_id;
        // 未评过 → 提醒一面 + 一面评价 同时出现
        const canRemind1 = r.interview_id && (!r.result || r.result === 'pending');
        // 一面已过，二面未评 → 提醒二面 + 二面评价 同时出现
        const canRemind2 = r.interview_id && r.result === 'passed'
          && (!r.result2 || r.result2 === 'pending');
        // 无一面结果 → 一面评价（与提醒一面同时出现）
        const canEval1 = r.interview_id && (!r.result || r.result === 'pending');
        // 一面已过，二面无结果 → 二面评价（与提醒二面同时出现）
        const canEval2 = r.interview_id && r.result === 'passed'
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
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
            {canSchedule && (
              <Button type="primary" icon={<BellOutlined />} onClick={() => handleOpenSchedule(r)}>安排面试</Button>
            )}
            {canRemind1 && (
              <Button type="primary" icon={<BellOutlined />} loading={reminderLoading === r.id} disabled={!!reminderLoading} onClick={() => handleSendReminder(r, iv1)}>提醒一面</Button>
            )}
            {canEval1 && (
              <Button type="primary" icon={<EditOutlined />} onClick={() => handleEvalRound1(r)}>一面评价</Button>
            )}
            {canRemind2 && (
              <Button type="primary" icon={<BellOutlined />} loading={reminderLoading === r.id} disabled={!!reminderLoading} onClick={() => handleSendReminder(r, iv2)}>提醒二面</Button>
            )}
            {canEval2 && (
              <Button type="primary" icon={<EditOutlined />} onClick={() => handleEvalRound2(r)}>二面评价</Button>
            )}
            {canSendToOnboarding && (
              <Button type="primary" icon={<HomeOutlined />} loading={onboardingLoading === r.id} onClick={() => handleSendToOnboarding(r)}>发起入职</Button>
            )}
            {canView && (
              <Button size="small" icon={<EyeOutlined />} onClick={() => handleViewEval(r)}>查看评价</Button>
            )}
            <Tooltip title="下载简历"><Button size="small" icon={<DownloadOutlined />} onClick={() => handleDownload(r)} /></Tooltip>
            <Tooltip title="编辑"><Button size="small" icon={<EditOutlined />} onClick={() => handleOpenEdit(r)} /></Tooltip>
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
        <Table
          dataSource={data.slice((tablePage - 1) * pageSize, tablePage * pageSize)}
          columns={columns}
          rowKey="id"
          loading={loading}
          scroll={{ x: 'max-content' }}
          pagination={false}
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys,
            columnWidth: 40,
          }}
        />
        <SimplePagination current={tablePage} pageSize={pageSize} total={data.length} onChange={setTablePage} />
      </Card>

      {/* 安排面试弹窗 */}
      <Modal
        title={
          <Space>
            <BellOutlined />
            <span>安排面试 - {scheduleRecord?.candidate_name || ''}</span>
          </Space>
        }
        open={scheduleModalVisible}
        onOk={handleScheduleSubmit}
        onCancel={() => setScheduleModalVisible(false)}
        confirmLoading={scheduling}
        okText="确认安排"
        width={520}
        destroyOnHidden
      >
        <Form form={scheduleForm} layout="vertical" preserve={false}>
          <Form.Item name="interview_date" label="面试日期">
            <DatePicker style={{ width: '100%' }} placeholder="选择面试日期（可选）" />
          </Form.Item>
          <Form.Item name="interview_time" label="面试时间">
            <DatePicker.TimePicker style={{ width: '100%' }} placeholder="选择面试时间（可选）" format="HH:mm" />
          </Form.Item>
          <Form.Item name="interview_location" label="面试地点 / 会议链接">
            <Input placeholder="例如：3楼会议室 / https://meeting.tencent.com/xxx（可选）" />
          </Form.Item>
          <Form.Item name="interviewer_name" label="一面面试官">
            <Input placeholder="输入一面面试官姓名" />
          </Form.Item>
          <Form.Item name="secondary_interviewer" label="二面面试官（可选）">
            <Input placeholder="输入二面面试官姓名（可选）" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 评价弹窗 */}
      <Modal
        title={`填写第${evalRound}面评价 - ${evalRecord?.candidate_name || ''}`}
        open={evalModalVisible}
        onOk={handleSubmitEval}
        onCancel={() => setEvalModalVisible(false)}
        confirmLoading={evalSubmitting}
        okText={`提交第${evalRound}面评价`}
        width={520}
      >
        <Form form={evalForm} layout="vertical">
          <Form.Item
            name="evaluation"
            label={`第${evalRound}面评价`}
            rules={[{ required: true, message: `请填写第${evalRound}面评价` }]}
          >
            <TextArea rows={6} placeholder={`请填写面试官对候选人的第${evalRound}面评价...`} />
          </Form.Item>
          <Form.Item name="result" label={`第${evalRound}面结果`} rules={[{ required: true, message: '请选择面试结果' }]}>
            <Radio.Group>
              <Radio value="passed"><span style={{ color: '#52c41a' }}>✅ 通过</span></Radio>
              <Radio value="failed"><span style={{ color: '#ff4d4f' }}>❌ 不通过</span></Radio>
            </Radio.Group>
          </Form.Item>
        </Form>
      </Modal>

      {/* 查看评价弹窗 */}
      <Modal
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
      </Modal>

      {/* 新建面试弹窗 */}
      <Modal
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
            <Input placeholder="例如：前端工程师（可选）" />
          </Form.Item>
          <Form.Item name="interviewer_name" label="一面面试官">
            <Input placeholder="输入一面面试官姓名（可选）" />
          </Form.Item>
          <Form.Item name="secondary_interviewer" label="二面面试官（可选）">
            <Input placeholder="输入二面面试官姓名（可选）" />
          </Form.Item>
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
      </Modal>

      {/* 编辑面试弹窗 */}
      <Modal
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
              primary_interviewer: editRecord.primary_interviewer || '',
              secondary_interviewer: editRecord.secondary_interviewer || '',
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
              <Select.Option value="scheduled">待面试</Select.Option>
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
      </Modal>
    </div>
  );
};

export default InterviewsList;
