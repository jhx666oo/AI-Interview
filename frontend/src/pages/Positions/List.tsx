import React, { useEffect, useState, useMemo } from 'react';
import { Table, Button, Space, message, Modal, Form, Input, InputNumber, Select, Tag, Tooltip, Popover, Typography, Drawer, Descriptions, Divider, Progress, Badge, Spin, Popconfirm, Alert, Checkbox, Collapse } from 'antd';
import SimplePagination from '../../components/SimplePagination';
import { PlusOutlined, EditOutlined, DeleteOutlined, EyeOutlined, GlobalOutlined, StopOutlined, RobotOutlined, SyncOutlined, AppstoreOutlined, MinusCircleOutlined, RadarChartOutlined, MergeCellsOutlined } from '@ant-design/icons';
import request from '../../utils/request';
import { useAuth } from '../../contexts/AuthContext';
import { useOwner } from '../../contexts/OwnerContext';
import JDGeneratorModal from '../../components/JDGeneratorModal';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { buildPositionCapabilitySave } from './capabilitySave';
import { WEIGHTED_GATE_DIMENSIONS, WEIGHTED_SCORING_DIMENSIONS, WEIGHTED_SCREENING_DEFAULT_WEIGHTS } from '../../utils/resumeEvaluation';

const { Title, Text } = Typography;

interface PositionStats {
  total_resumes: number;
  pending_screening: number;
  pending_interview: number;
  interview_completed: number;
  offer_pending: number;
  offer_accepted: number;
  rejected: number;
}

interface QuestionBankBrief {
  id: string;
  name: string;
  category: string;
  question_count: number;
}

interface Position {
  id: string;
  title: string;
  description: string;
  requirements: string | null;
  salary_range: string | null;
  location: string | null;
  department: string | null;
  status: string;
  urgency: string;
  position_type: string;
  headcount: number;
  hiring_manager_id: string | null;
  hiring_manager_name: string | null;
  responsible_person: string | null;
  personalized_requirements: string | null;
  capability_dimensions: string | null;
  primary_interviewer: string | null;
  secondary_interviewer: string | null;
  created_at: string;
  updated_at: string;
  stats: PositionStats;
  linked_question_banks?: QuestionBankBrief[];
}

const urgencyConfig: Record<string, { color: string; text: string }> = {
  low: { color: 'default', text: '低' },
  medium: { color: 'warning', text: '中' },
  high: { color: 'orange', text: '高' },
  urgent: { color: 'red', text: '紧急' },
};

const positionTypeConfig: Record<string, { color: string; text: string }> = {
  full_time: { color: 'blue', text: '全职' },
  part_time: { color: 'cyan', text: '兼职' },
  contract: { color: 'purple', text: '合同' },
  internship: { color: 'green', text: '实习' },
};

type CapabilityDimensionValue = { name: string; description?: string; definition?: string; behavior?: string; weight?: number | null };

const isWeightedScoringDimension = (name: string): name is (typeof WEIGHTED_SCORING_DIMENSIONS)[number] =>
  (WEIGHTED_SCORING_DIMENSIONS as readonly string[]).includes(name);

const isScreeningGateDimension = (name: string) =>
  (WEIGHTED_GATE_DIMENSIONS as readonly string[]).includes(name);

const defaultCapabilityDimensions = (): CapabilityDimensionValue[] => [
  ...WEIGHTED_SCORING_DIMENSIONS.map((name) => ({ name, description: '', weight: WEIGHTED_SCREENING_DEFAULT_WEIGHTS[name] })),
  ...WEIGHTED_GATE_DIMENSIONS.map((name) => ({ name, description: '', weight: null })),
];

const PositionsList: React.FC = () => {
  const [data, setData] = useState<Position[]>([]);
  const [loading, setLoading] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewingRecord, setViewingRecord] = useState<Position | null>(null);
  const { user } = useAuth();
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [jdModalVisible, setJdModalVisible] = useState(false);
  const [aiMatchingId, setAiMatchingId] = useState<string | null>(null);
  const [aiMatchResult, setAiMatchResult] = useState<any>(null);
  const [aiMatchVisible, setAiMatchVisible] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  // 评估维度相关
  const [dimModalVisible, setDimModalVisible] = useState(false);
  const [dimPositionId, setDimPositionId] = useState<string | null>(null);
  const [dimPositionName, setDimPositionName] = useState('');
  const [dimLoading, setDimLoading] = useState(false);
  const [dimSaving, setDimSaving] = useState(false);
  const [dimForm] = Form.useForm();
  const [dimensionsMap, setDimensionsMap] = useState<Record<string, any>>({}); // position_name → record
  const [allDimNames, setAllDimNames] = useState<string[]>([]);

  const [searchTitle, setSearchTitle] = useState<string>('');
  const [searchStatus, setSearchStatus] = useState<string | undefined>(undefined);
  const [syncLoading, setSyncLoading] = useState(false);
  const [deduping, setDeduping] = useState(false);
  const [publishingId, setPublishingId] = useState<string | null>(null);
  const [tablePage, setTablePage] = useState(1);
  const pageSize = 10;
  const { selectedOwner } = useOwner();

  // 检测重复岗位
  const duplicateGroups = useMemo(() => {
    const map = new Map<string, Position[]>();
    data.forEach(item => {
      if (!map.has(item.title)) map.set(item.title, []);
      map.get(item.title)!.push(item);
    });
    return Array.from(map.entries()).filter(([_, items]) => items.length > 1);
  }, [data]);

  // 一键去重：保留创建时间最早的，删除其余
  const handleDedup = async () => {
    setDeduping(true);
    try {
      const toDelete: string[] = [];
      const toKeep: string[] = [];
      duplicateGroups.forEach(([title, items]) => {
        // 按创建时间排序，保留最早的
        const sorted = [...items].sort((a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
        toKeep.push(sorted[0].id);
        sorted.slice(1).forEach(item => toDelete.push(item.id));
      });
      await Modal.confirm({
        title: `确认去重`,
        content: `将清除岗位中的冗余字段（责任人/面试官/城市等已移至需求管理），并删除 ${toDelete.length} 条重复岗位记录。`,
        okText: '确认去重',
        cancelText: '取消',
        okType: 'danger',
      });
      // 1. 后端清除冗余字段
      await request.post('/positions/dedup');
      // 2. 逐个删除重复项
      let deleted = 0;
      const failedIds: string[] = [];
      for (const id of toDelete) {
        try {
          await request.delete(`/positions/${id}`);
          deleted++;
        } catch { failedIds.push(id); }
      }
      if (failedIds.length > 0) {
        message.warning(`去重完成：删除了 ${deleted} 条，${failedIds.length} 条失败 (${failedIds.join(', ')})`);
      } else {
        message.success(`去重完成：删除了 ${deleted} 条重复记录`);
      }
      fetchPositions();
    } catch (e: any) {
      if (e?.errorFields) return; // Modal 取消
      message.error('去重失败');
    } finally {
      setDeduping(false);
    }
  };

  const handleSyncFromFeishu = async () => {
    setSyncLoading(true);
    try {
      const res = await request.post('/positions/sync-from-feishu') as any;
      if (res.ok) {
        message.success(res.message);
        fetchPositions();
      } else {
        message.error(res.detail || '同步失败');
      }
    } catch (error: any) {
      message.error(error?.response?.data?.detail || '同步失败，请检查网络');
    } finally {
      setSyncLoading(false);
    }
  };

  const fetchPositions = async () => {
    setLoading(true);
    try {
      const res = await request.get('/positions', {
          params: {
              title: searchTitle,
              status: searchStatus,
              responsible_person: (user as any)?.role !== 'admin' ? (user as any)?.full_name : (selectedOwner || undefined),
          }
      });
      setData(res);
    } catch (error) {
      message.error('获取岗位列表失败');
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await request.get('/auth/users');
      setUsers(res);
    } catch (error) {
      console.error('Failed to fetch users');
    }
  };

  useEffect(() => {
    fetchPositions();
    fetchUsers();
    fetchDimensionsMap();
    fetchAllDimNames();
  }, [searchTitle, searchStatus, selectedOwner]);

  const fetchAllDimNames = async () => {
    try {
      const res = await request.get('/capability-dimension-names');
      if (Array.isArray(res)) setAllDimNames(res);
    } catch { /* 静默 */ }
  };

  const fetchDimensionsMap = async () => {
    try {
      const res = await request.get('/capability-dimensions', { params: { page_size: 200 } });
      const map: Record<string, any> = {};
      if (Array.isArray(res)) {
        res.forEach((item: any) => {
          map[item.position_name] = item;
        });
      }
      setDimensionsMap(map);
    } catch {
      // 静默失败
    }
  };

  const handleAIMatch = async (record: Position) => {
    setAiMatchingId(record.id);
    try {
      const res = await request.post(`/positions/${record.id}/ai-match`) as any;
      setAiMatchResult({ position: record, rankings: res.rankings || [] });
      setAiMatchVisible(true);
    } catch (error: any) {
      message.error(error?.response?.data?.detail || 'AI候选人匹配失败');
    } finally {
      setAiMatchingId(null);
    }
  };

  const handleAdd = () => {
    setEditingId(null);
    form.resetFields();
    form.setFieldsValue({
      status: 'open',
      urgency: 'medium',
      position_type: 'full_time',
      headcount: 1,
      capability_dimensions: defaultCapabilityDimensions(),
    });
    setIsModalVisible(true);
  };

  const handleEdit = async (record: Position) => {
    setEditingId(record.id);
    try {
      const res = await request.get(`/positions/${record.id}`);
      const formVals: any = { ...res };
      // 能力维度 — transformRow 可能已自动解析了 JSON 字符串为数组
      if (res.capability_dimensions) {
        if (Array.isArray(res.capability_dimensions)) {
          formVals.capability_dimensions = res.capability_dimensions;
        } else if (typeof res.capability_dimensions === 'string') {
          try { formVals.capability_dimensions = JSON.parse(res.capability_dimensions); } catch { formVals.capability_dimensions = []; }
        }
      } else {
        // 如果岗位自身没有能力维度，从 capability_dimensions 表查找
        try {
          const dimRes = await request.get('/capability-dimensions', {
            params: { position_name: res.title }
          });
          if (Array.isArray(dimRes) && dimRes.length > 0) {
            const dimRecord = dimRes[0];
            let dims: any[] = [];
            if (dimRecord.dimensions_json) {
              try { dims = JSON.parse(dimRecord.dimensions_json); } catch {}
            }
            if (dims.length > 0) {
              formVals.capability_dimensions = dims.map((d: any) =>
                typeof d === 'string' ? { name: d, description: '', weight: isWeightedScoringDimension(d) ? WEIGHTED_SCREENING_DEFAULT_WEIGHTS[d] : null } : d
              ).filter((d: any) => d?.name);
            }
          }
        } catch {}
      }
      // 任职要求 JSON 字符串 → 多选数组
      if (res.requirements) {
        try {
          formVals.requirements = JSON.parse(res.requirements);
        } catch {
          // 旧的文本格式，保持原样（tags 组件会当单选显示）
        }
      }
      form.setFieldsValue(formVals);
      setIsModalVisible(true);
    } catch (error) {
      message.error('获取岗位详情失败');
    }
  };

  const handleView = async (record: Position) => {
    try {
      const res = await request.get(`/positions/${record.id}`);
      setViewingRecord(res);
      setIsDrawerVisible(true);
    } catch (error) {
      message.error('获取岗位详情失败');
    }
  };

  const handleDelete = (id: string) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这个岗位吗？',
      okText: '确认',
      cancelText: '取消',
      okType: 'danger',
      onOk: async () => {
        try {
          await request.delete(`/positions/${id}`);
          message.success('删除成功');
          fetchPositions();
        } catch (error) {
          message.error('删除失败');
        }
      },
    });
  };

  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要删除的岗位');
      return;
    }
    Modal.confirm({
      title: '确认批量删除',
      content: `确定要删除选中的 ${selectedRowKeys.length} 个岗位吗？`,
      okText: '确认',
      cancelText: '取消',
      okType: 'danger',
      onOk: async () => {
        try {
          await Promise.all(selectedRowKeys.map(id => request.delete(`/positions/${id}`)));
          message.success(`成功删除 ${selectedRowKeys.length} 个岗位`);
          setSelectedRowKeys([]);
          fetchPositions();
        } catch (e: any) {
          message.error(e?.response?.data?.detail || '批量删除失败');
        }
      },
    });
  };

  const handleBatchPublish = (publish: boolean) => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要操作的岗位');
      return;
    }
    Modal.confirm({
      title: publish ? '确认批量发布' : '确认批量下架',
      content: `确定要${publish ? '发布' : '下架'}选中的 ${selectedRowKeys.length} 个岗位吗？`,
      okText: '确认',
      cancelText: '取消',
      onOk: async () => {
        try {
          await Promise.all(selectedRowKeys.map(id => request.put(`/positions/${id}`, { status: publish ? 'published' : 'closed' })));
          message.success(`成功${publish ? '发布' : '下架'} ${selectedRowKeys.length} 个岗位`);
          setSelectedRowKeys([]);
          fetchPositions();
        } catch (e: any) {
          message.error(e?.response?.data?.detail || '操作失败');
        }
      },
    });
  };

  const handlePublish = async (id: string, publish: boolean) => {
    setPublishingId(id);
    try {
      await request.put(`/positions/${id}`, { status: publish ? 'published' : 'closed' });
      message.success(publish ? '岗位已发布' : '岗位已下架');
      fetchPositions();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '操作失败');
    } finally {
      setPublishingId(null);
    }
  };

  const handleCopyLink = (id: string) => {
    const url = `${window.location.origin}/public/jobs/${id}`;
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url).then(() => {
        message.success('岗位链接已复制');
      });
    } else {
      const textArea = document.createElement('textarea');
      textArea.value = url;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      try {
        document.execCommand('copy');
        message.success('岗位链接已复制');
      } catch (err) {
        message.error('复制失败');
      }
      document.body.removeChild(textArea);
    }
  };

  // === 评估维度相关函数 ===
  /** 解析 full_text 为维度数组 */
  const parseFullText = (fullText: string): { name: string; definition: string; behavior: string }[] => {
    if (!fullText) return [];
    const parts = fullText.split(/\d+\.\s*-\s*/).filter(Boolean);
    return parts.map((part) => {
      const lines = part.trim().split('\n');
      const name = lines[0]?.replace(/^- /, '').trim() || '';
      const definition = lines.find(l => l.includes('简要定义'))?.replace(/^- 简要定义[：:]\s*/, '').trim() || '';
      const behavior = lines.find(l => l.includes('典型行为表现'))?.replace(/^- 典型行为表现[：:]\s*/, '').trim() || '';
      return { name, definition, behavior };
    }).filter(d => d.name);
  };

  /** 合并维度数组为 full_text */
  const buildFullText = (dims: { name: string; definition: string; behavior: string }[]): string => {
    return dims.map((d, i) => {
      let text = `${i + 1}. - ${d.name}`;
      if (d.definition) text += `\n- 简要定义：${d.definition}`;
      if (d.behavior) text += `\n- 典型行为表现：${d.behavior}`;
      return text;
    }).join('\n');
  };

  /** 打开维度编辑弹窗 */
  const handleOpenDimensions = async (record: Position) => {
    setDimPositionId(record.id);
    setDimPositionName(record.title);
    setDimLoading(true);
    setDimModalVisible(true);
    try {
      // 查询该岗位已有的能力维度配置
      const res = await request.get('/capability-dimensions', { params: { position_name: record.title } });
      const existingRecord = Array.isArray(res) && res.length > 0 ? res[0] : null;
      if (existingRecord) {
        const dims = existingRecord.dimensions_json
          ? JSON.parse(existingRecord.dimensions_json)
          : parseFullText(existingRecord.full_text || '');
        dimForm.setFieldsValue({
          dimensions: dims.length > 0 ? dims : defaultCapabilityDimensions(),
        });
        // 同时同步到 positions 表的 capability_dimensions 字段
        try {
          const posRes = await request.get('/positions', { params: { title: dimPositionName } });
          if (Array.isArray(posRes)) {
            for (const pos of posRes) {
              await request.put(`/positions/${pos.id}`, { capability_dimensions: JSON.stringify(dims) });
            }
          }
        } catch { /* 同步失败不影响主流程 */ }
      } else {
        dimForm.setFieldsValue({ dimensions: defaultCapabilityDimensions() });
      }
    } catch {
      dimForm.setFieldsValue({ dimensions: defaultCapabilityDimensions() });
    } finally {
      setDimLoading(false);
    }
  };

  /** 保存维度 */
  const handleSaveDimensions = async () => {
    setDimSaving(true);
    try {
      const values = await dimForm.validateFields();
      const dims = (values.dimensions || []).filter((d: any) => d.name);
      const fullText = buildFullText(dims);
      const payload = {
        position_name: dimPositionName,
        dimensions_json: JSON.stringify(dims),
        full_text: fullText,
      };

      // 检查是否已有记录（通过查询现有记录确定是新增还是更新）
      const res = await request.get('/capability-dimensions', { params: { position_name: dimPositionName } });
      const existingRecord = Array.isArray(res) && res.length > 0 ? res[0] : null;

      // 同时同步到 positions 表的 capability_dimensions 字段
      try {
        const posRes = await request.get('/positions', { params: { title: dimPositionName } });
        if (Array.isArray(posRes)) {
          for (const pos of posRes) {
            await request.put(`/positions/${pos.id}`, { capability_dimensions: JSON.stringify(dims) });
          }
        }
      } catch { /* 同步失败不影响主流程 */ }

      if (existingRecord) {
        await request.put(`/capability-dimensions/${existingRecord.id}`, payload);
        message.success('维度更新成功');
      } else {
        await request.post('/capability-dimensions', payload);
        message.success('维度创建成功');
      }
      setDimModalVisible(false);
    } catch (e: any) {
      if (e.errorFields) return;
      message.error(e.response?.data?.detail || '操作失败');
    } finally {
      setDimSaving(false);
    }
  };

  const handleOpenJDModal = async () => {
    try {
      const values = await form.validateFields(['title']);
      if (!values.title) {
        message.error('请先填写岗位名称');
        return;
      }
      setJdModalVisible(true);
    } catch {
      message.error('请先填写岗位名称');
    }
  };

  const handleJDConfirm = (description: string, requirements: string) => {
    form.setFieldsValue({
      description,
      requirements
    });
  };

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      const payloadInput = { ...values };
      if (payloadInput.requirements) {
        // 多选/标签输入 → JSON 字符串数组
        if (Array.isArray(payloadInput.requirements)) {
          payloadInput.requirements = JSON.stringify(payloadInput.requirements);
        }
      }
      const { payload } = buildPositionCapabilitySave(payloadInput);
      if (editingId) {
        await request.put(`/positions/${editingId}`, payload);
        message.success('更新成功');
      } else {
        await request.post('/positions', payload);
        message.success('创建成功');
      }
      setIsModalVisible(false);
      fetchPositions();
    } catch (e: any) {
      if (e?.errorFields) return; // Validation error from form
      message.error(e?.response?.data?.detail || '保存失败');
    } finally {
      setSubmitting(false);
    }
  };

  const renderStats = (stats: PositionStats | undefined) => {
    if (!stats) return <Text type="secondary">-</Text>;
    const total = stats.total_resumes || 0;
    if (total === 0) return <Text type="secondary">暂无简历</Text>;
    
    return (
      <Tooltip title={
        <div>
          <div>待筛选: {stats.pending_screening}</div>
          <div>待面试: {stats.pending_interview}</div>
          <div>面试完成: {stats.interview_completed}</div>
          <div>Offer待定: {stats.offer_pending}</div>
          <div>已入职: {stats.offer_accepted}</div>
          <div>已淘汰: {stats.rejected}</div>
        </div>
      }>
        <Space size={4}>
          <Badge count={total} style={{ backgroundColor: '#3B82F6' }} />
          <Progress 
            percent={Math.round((stats.offer_accepted / total) * 100) || 0} 
            size="small" 
            style={{ width: 60 }}
            showInfo={false}
            strokeColor="#10B981"
          />
        </Space>
      </Tooltip>
    );
  };

  const columns = [
    { 
      title: '岗位名称',
      dataIndex: 'title', 
      key: 'title',
      width: 180,
      render: (text: string) => <span style={{ fontWeight: 500, color: '#0F172A' }}>{text}</span>
    },
    { title: '部门', dataIndex: 'department', key: 'department', width: 100, render: (v: string) => v || '-' },
    { 
      title: '类型', 
      dataIndex: 'position_type', 
      key: 'position_type',
      width: 90,
      render: (type: string) => {
        const config = positionTypeConfig[type] || { color: 'default', text: type };
        return <Tag color={config.color} style={{ border: 'none' }}>{config.text}</Tag>;
      }
    },
    { 
      title: '紧急度', 
      dataIndex: 'urgency', 
      key: 'urgency',
      width: 80,
      render: (urgency: string) => {
        const config = urgencyConfig[urgency] || { color: 'default', text: urgency };
        return <Tag color={config.color} style={{ border: 'none' }}>{config.text}</Tag>;
      }
    },
    { 
      title: '状态', 
      dataIndex: 'status', 
      key: 'status',
      width: 80,
      render: (status: string) => {
        let color = 'default';
        let text = '已关闭';
        if (status === 'open') {
            color = 'warning';
            text = '待发布';
        } else if (status === 'published') {
            color = 'processing';
            text = '招聘中';
        }
        return <Tag color={color} style={{ border: 'none' }}>{text}</Tag>;
      }
    },
    { 
      title: '招聘进度', 
      key: 'stats',
      width: 130,
      render: (_: any, record: Position) => renderStats(record.stats)
    },
    { 
      title: '责任人', 
      dataIndex: 'responsible_person', 
      key: 'responsible_person',
      width: 90,
      render: (v: string) => v || <Text type="secondary">-</Text>
    },
    { 
      title: '一面面试官', 
      dataIndex: 'primary_interviewer', 
      key: 'primary_interviewer',
      width: 110,
      render: (v: string) => v || <Text type="secondary">-</Text>
    },
    { 
      title: '二面面试官', 
      dataIndex: 'secondary_interviewer', 
      key: 'secondary_interviewer',
      width: 110,
      render: (v: string) => v || <Text type="secondary">-</Text>
    },
    {
      title: '能力维度',
      key: 'dimensions',
      width: 280,
      render: (_: any, record: Position) => {
        // 优先读岗位自身的 capability_dimensions（transformRow 可能已解析为数组）
        let dimNames: string[] = [];
        const cd = record.capability_dimensions;
        if (cd) {
          if (Array.isArray(cd)) {
            dimNames = cd;
          } else if (typeof cd === 'string') {
            try { dimNames = JSON.parse(cd); } catch {}
          }
        }
        // 兜底：从 dimensionsMap 取
        if (dimNames.length === 0) {
          const dimRecord = dimensionsMap[record.title];
          if (dimRecord) {
            let dims: any[] = [];
            try {
              dims = dimRecord.dimensions_json
                ? JSON.parse(dimRecord.dimensions_json)
                : parseFullText(dimRecord.full_text || '');
            } catch {}
            dimNames = dims.map((d: any) => d.name).filter(Boolean);
          }
        }
        if (dimNames.length === 0) return <Text type="secondary" style={{ cursor: 'pointer', fontSize: 12 }}>暂无</Text>;
        const showCount = Math.min(dimNames.length, 4);
        const extra = dimNames.length - showCount;
        return (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {dimNames.slice(0, showCount).map((d: any, i: number) => {
              const name = d.name || d;
              const desc = d.description || '';
              const def = d.definition || '';
              const beh = d.behavior || '';
              const hasDetail = desc || def || beh;
              const popContent = (
                <div style={{ maxWidth: 340, wordBreak: 'break-word' }}>
                  <div style={{ fontWeight: 600, marginBottom: 6, fontSize: 14 }}>{name}</div>
                  {desc && <div style={{ marginBottom: 4, color: '#1e293b', lineHeight: 1.5 }}>{desc}</div>}
                  {def && <div style={{ marginBottom: 4, color: '#475569' }}><Text type="secondary">定义：</Text>{def}</div>}
                  {beh && <div style={{ color: '#475569' }}><Text type="secondary">典型行为：</Text>{beh}</div>}
                  {!hasDetail && <Text type="secondary">暂无详细信息</Text>}
                </div>
              );
              return (
                <Popover key={i} content={popContent} title={null} trigger="hover" placement="top">
                  <span style={{
                    display: 'inline-block',
                    padding: '2px 10px',
                    background: '#eff6ff',
                    border: '1px solid #bfdbfe',
                    borderRadius: 6,
                    fontSize: 12,
                    color: '#1e40af',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}>{name}</span>
                </Popover>
              );
            })}
            {extra > 0 && <span style={{ fontSize: 11, color: '#94a3b8', lineHeight: '24px' }}>+{extra}</span>}
          </div>
        );
      }
    },
    { 
      title: '创建时间', 
      dataIndex: 'created_at', 
      key: 'created_at',
      width: 110,
      render: (date: string) => <span style={{ color: '#64748B', fontSize: 13 }}>{new Date(date).toLocaleDateString()}</span>
    },
    {
      title: '操作', align: 'center' as const,
      key: 'action',
      width: 150,
      render: (_: any, record: Position) => (
        <Space size="small">
          <Tooltip title="编辑">
            <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
          </Tooltip>
          {record.status === 'published' ? (
             <Tooltip title="下架">
                <Button type="link" size="small" icon={<StopOutlined />} loading={publishingId === record.id} onClick={() => handlePublish(record.id, false)} />
             </Tooltip>
          ) : (
             <Tooltip title="发布">
                <Button type="link" size="small" icon={<GlobalOutlined />} loading={publishingId === record.id} onClick={() => handlePublish(record.id, true)} />
             </Tooltip>
          )}
          <Tooltip title="删除">
            <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record.id)} />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <Title level={2} style={{ margin: 0, fontWeight: 700 }}>岗位管理</Title>
          <Text type="secondary">管理企业的招聘岗位信息</Text>
        </div>
        <Space>
          <Button type="primary" size="small" icon={<PlusOutlined />} onClick={handleAdd}>新增岗位</Button>
          <Button size="small" icon={<SyncOutlined />} loading={syncLoading} onClick={handleSyncFromFeishu}>从飞书同步</Button>
        </Space>
      </div>

      {/* 重复岗位提醒 */}
      {duplicateGroups.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16, borderRadius: 8 }}
          message={
            <Space>
              <span>检测到 <strong>{duplicateGroups.length}</strong> 个岗位名称存在重复记录（共 <strong>{duplicateGroups.reduce((sum, [_, items]) => sum + items.length, 0)}</strong> 条）</span>
              <Button size="small" danger icon={<MergeCellsOutlined />} loading={deduping} onClick={handleDedup}>
                一键去重（保留最早创建）
              </Button>
            </Space>
          }
        />
      )}
      
      <div style={{ marginBottom: 24, padding: '24px', background: '#fff', borderRadius: '12px', border: '1px solid #E2E8F0', display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
          <Input 
              placeholder="搜索岗位名称" 
              prefix={<EyeOutlined style={{ color: '#94A3B8' }} />} 
              style={{ width: 200 }} 
              allowClear
              onChange={(e) => setSearchTitle(e.target.value)}
          />
          <Select
              placeholder="岗位状态"
              style={{ width: 150 }}
              allowClear
              onChange={(value) => setSearchStatus(value)}
          >
              <Select.Option value="open">待发布</Select.Option>
              <Select.Option value="published">招聘中</Select.Option>
              <Select.Option value="closed">已关闭</Select.Option>
          </Select>
          {selectedRowKeys.length > 0 && (
            <Space>
              <span style={{ color: '#64748B' }}>已选 {selectedRowKeys.length} 项</span>
              <Button onClick={() => handleBatchPublish(true)} type="primary" ghost>批量发布</Button>
              <Button onClick={() => handleBatchPublish(false)}>批量下架</Button>
              <Button danger onClick={handleBatchDelete}>批量删除</Button>
              <Button onClick={() => setSelectedRowKeys([])}>取消选择</Button>
            </Space>
          )}
      </div>
      
      <Table 
        columns={columns} 
        dataSource={data.slice((tablePage - 1) * pageSize, tablePage * pageSize)} 
        loading={loading} 
        rowKey="id" 
        scroll={{ x: 1700 }}
        pagination={false}
        rowSelection={{
          selectedRowKeys,
          onChange: setSelectedRowKeys,
          columnWidth: 40,
        }}
      />
        <SimplePagination current={tablePage} pageSize={pageSize} total={data.length} onChange={setTablePage} />

      <Modal
        title={editingId ? '编辑岗位' : '新增岗位'}
        open={isModalVisible}
        onCancel={() => setIsModalVisible(false)}
        confirmLoading={submitting}
        width={880}
        centered
        footer={
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
            <Space>
              <Button onClick={() => setIsModalVisible(false)}>取消</Button>
              <Button type="primary" loading={submitting} onClick={handleOk}>保存</Button>
            </Space>
          </div>
        }
      >
        <Form
          form={form}
          layout="vertical"
          style={{ marginTop: 24 }}
        >
          <Form.Item
            name="title"
            label="岗位名称"
            rules={[{ required: true, message: '请输入岗位名称' }]}
          >
            <Input placeholder="例如：高级前端工程师" size="large" />
          </Form.Item>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <Form.Item name="department" label="所属部门">
              <Input placeholder="例如：研发部" size="large" />
            </Form.Item>
            <Form.Item name="location" label="工作地点">
              <Input placeholder="例如：北京" size="large" />
            </Form.Item>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <Form.Item name="salary_range" label="薪资范围">
              <Input placeholder="例如：20k-30k" size="large" />
            </Form.Item>
            <Form.Item name="headcount" label="招聘人数">
              <Input type="number" min={1} placeholder="1" size="large" />
            </Form.Item>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <Form.Item name="position_type" label="岗位类型">
              <Select size="large">
                <Select.Option value="full_time">全职</Select.Option>
                <Select.Option value="part_time">兼职</Select.Option>
                <Select.Option value="contract">合同</Select.Option>
                <Select.Option value="internship">实习</Select.Option>
              </Select>
            </Form.Item>
            <Form.Item name="urgency" label="紧急程度">
              <Select size="large">
                <Select.Option value="low">低</Select.Option>
                <Select.Option value="medium">中</Select.Option>
                <Select.Option value="high">高</Select.Option>
                <Select.Option value="urgent">紧急</Select.Option>
              </Select>
            </Form.Item>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <Form.Item name="hiring_manager_id" label="招聘负责人">
              <Select size="large" allowClear placeholder="选择招聘负责人" showSearch optionFilterProp="children">
                {users.map(user => (
                  <Select.Option key={user.id} value={user.id}>{user.full_name} ({user.email})</Select.Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item name="responsible_person" label="责任人">
              <Input placeholder="从飞书同步或手动填写" size="large" />
            </Form.Item>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <Form.Item name="primary_interviewer" label="一面面试官" initialValue="杜雁玲">
              <Input placeholder="默认：杜雁玲" size="large" />
            </Form.Item>
            <Form.Item name="secondary_interviewer" label="二面面试官" initialValue="何雨菱">
              <Input placeholder="默认：何雨菱" size="large" />
            </Form.Item>
          </div>

          {/* 能力维度 — 复选框列表 + 可展开描述 */}
          <Form.Item
            name="capability_dimensions"
            label={
              <Space>
                <RadarChartOutlined />
                <span>能力维度</span>
              </Space>
            }
            extra="勾选维度后展开描述区域，填写该维度的具体表现和评分标准"
          >
            <CapabilityDimensionEditor 
              allDimNames={allDimNames} 
              setAllDimNames={setAllDimNames}
            />
          </Form.Item>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text strong>岗位职责</Text>
            <Button type="link" icon={<RobotOutlined />} onClick={handleOpenJDModal}>
              AI 生成 JD
            </Button>
          </div>
          <Form.Item name="description" rules={[{ required: true, message: '请输入岗位职责' }]}>
            <Input.TextArea rows={4} placeholder="请输入详细的岗位职责描述" showCount maxLength={2000} style={{ padding: '8px 12px' }} />
          </Form.Item>

          <Form.Item name="status" label="状态">
            <Select size="large">
              <Select.Option value="open">待发布</Select.Option>
              <Select.Option value="published">招聘中</Select.Option>
              <Select.Option value="closed">已关闭</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="AI候选人匹配排名" open={aiMatchVisible} onCancel={() => setAiMatchVisible(false)} footer={<Button onClick={() => setAiMatchVisible(false)}>关闭</Button>} width={640}>
        {aiMatchResult?.rankings?.map((item: any, idx: number) => (
          <div key={idx} style={{ padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span><Tag color={idx === 0 ? 'green' : 'blue'}>第{idx+1}名</Tag> {item.candidate_name}</span>
              <Tag color="geekblue">{item.match_score}分</Tag>
            </div>
            <div style={{ color: '#64748B', fontSize: 13, marginTop: 4 }}>{item.ranking_reason}</div>
          </div>
        ))}
      </Modal>
      <JDGeneratorModal
        visible={jdModalVisible}
        onCancel={() => setJdModalVisible(false)}
        onConfirm={handleJDConfirm}
        title={form.getFieldValue('title') || ''}
        department={form.getFieldValue('department')}
        location={form.getFieldValue('location')}
        salary_range={form.getFieldValue('salary_range')}
      />

      {/* 评估维度编辑弹窗 */}
      <Modal
        title={
          <Space>
            <RadarChartOutlined />
            <span>评估维度配置 — {dimPositionName}</span>
          </Space>
        }
        open={dimModalVisible}
        onCancel={() => setDimModalVisible(false)}
        onOk={handleSaveDimensions}
        width={800}
        centered
        destroyOnHidden
        okText="保存"
        cancelText="取消"
        confirmLoading={dimSaving}
      >
        <Form form={dimForm} layout="vertical" preserve={false}>
          <div style={{ marginBottom: 8 }}>
            <Text strong style={{ fontSize: 14 }}>
              <AppstoreOutlined style={{ marginRight: 6 }} />
              能力维度要求
            </Text>
            <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
              添加该岗位需要考察的各个能力维度
            </Text>
          </div>
          <Form.List name="dimensions">
            {(fields, { add, remove }) => (
              <>
                {fields.map(({ key, name, ...restField }, index) => (
                  <div
                    key={key}
                    style={{
                      padding: '16px',
                      marginBottom: 16,
                      border: '1px solid #E2E8F0',
                      borderRadius: 8,
                      background: '#FAFBFC',
                      position: 'relative'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
                      <Tag color="blue" style={{ marginRight: 8 }}>维度 {index + 1}</Tag>
                      {fields.length > 1 && (
                        <Button
                          type="text"
                          danger
                          icon={<MinusCircleOutlined />}
                          onClick={() => remove(name)}
                          style={{ position: 'absolute', right: 8, top: 8 }}
                        />
                      )}
                    </div>
                    <Form.Item
                      {...restField}
                      name={[name, 'name']}
                      label="维度名称"
                      rules={[{ required: true, message: '请输入维度名称' }]}
                    >
                      <Input placeholder="例：市场洞察能力" />
                    </Form.Item>
                    {isWeightedScoringDimension(String(dimForm.getFieldValue(['dimensions', name, 'name']) || '')) ? (
                      <Form.Item
                        {...restField}
                        name={[name, 'weight']}
                        label="评分权重"
                        extra="仅五项能力计入加权分；总权重不必手动校验。"
                      >
                        <InputNumber min={0} max={100} precision={0} addonAfter="%" style={{ width: '100%' }} />
                      </Form.Item>
                    ) : (
                      <Tag color={isScreeningGateDimension(String(dimForm.getFieldValue(['dimensions', name, 'name']) || '')) ? 'orange' : 'default'}>
                        {isScreeningGateDimension(String(dimForm.getFieldValue(['dimensions', name, 'name']) || '')) ? '硬门槛（不计入加权分）' : '非加权维度'}
                      </Tag>
                    )}
                    <Form.Item
                      {...restField}
                      name={[name, 'definition']}
                      label="简要定义"
                    >
                      <Input.TextArea rows={2} placeholder="该维度的简要定义" showCount maxLength={500} />
                    </Form.Item>
                    <Form.Item
                      {...restField}
                      name={[name, 'behavior']}
                      label="典型行为表现"
                    >
                      <Input.TextArea rows={2} placeholder="描述典型的行为表现" showCount maxLength={500} />
                    </Form.Item>
                  </div>
                ))}
                {fields.length < 10 && (
                  <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
                    添加维度
                  </Button>
                )}
              </>
            )}
          </Form.List>
        </Form>
      </Modal>

      <Drawer
        title="岗位详情"
        size="large"
        onClose={() => setIsDrawerVisible(false)}
        open={isDrawerVisible}
        extra={
          <Space>
            <Button onClick={() => {
              setIsDrawerVisible(false);
              if (viewingRecord) handleEdit(viewingRecord);
            }}>编辑</Button>
            <Button type="primary" onClick={() => setIsDrawerVisible(false)}>关闭</Button>
          </Space>
        }
      >
        {viewingRecord && (
          <div>
            <div style={{ marginBottom: 24 }}>
              <Title level={3} style={{ margin: 0 }}>{viewingRecord.title}</Title>
              <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
                <Tag color={viewingRecord.status === 'published' ? 'processing' : 'default'} style={{ border: 'none' }}>
                  {viewingRecord.status === 'published' ? '招聘中' : viewingRecord.status === 'open' ? '待发布' : '已关闭'}
                </Tag>
                <Tag color={urgencyConfig[viewingRecord.urgency]?.color || 'default'} style={{ border: 'none' }}>
                  {urgencyConfig[viewingRecord.urgency]?.text || viewingRecord.urgency}
                </Tag>
                <Tag color={positionTypeConfig[viewingRecord.position_type]?.color || 'default'} style={{ border: 'none' }}>
                  {positionTypeConfig[viewingRecord.position_type]?.text || viewingRecord.position_type}
                </Tag>
                <Text type="secondary" style={{ marginLeft: 8 }}>
                  创建于 {new Date(viewingRecord.created_at).toLocaleDateString()}
                </Text>
              </div>
            </div>

            <Descriptions column={2} size="middle" labelStyle={{ color: '#64748B' }} contentStyle={{ fontWeight: 500, color: '#0F172A' }}>
              <Descriptions.Item label="所属部门">{viewingRecord.department || '-'}</Descriptions.Item>
              <Descriptions.Item label="工作地点">{viewingRecord.location || '-'}</Descriptions.Item>
              <Descriptions.Item label="薪资范围">{viewingRecord.salary_range || '-'}</Descriptions.Item>
              <Descriptions.Item label="招聘人数">{viewingRecord.headcount || 1} 人</Descriptions.Item>
              <Descriptions.Item label="招聘负责人">{viewingRecord.hiring_manager_name || '-'}</Descriptions.Item>
              <Descriptions.Item label="责任人">{viewingRecord.responsible_person || '-'}</Descriptions.Item>
            </Descriptions>

            <Divider style={{ margin: '24px 0' }} />

            <div style={{ marginBottom: 24 }}>
              <Title level={5} style={{ marginBottom: 12 }}>招聘进度</Title>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ background: '#F8FAFC', padding: '12px 16px', borderRadius: 8 }}>
                  <Text type="secondary">总简历</Text>
                  <div style={{ fontSize: 24, fontWeight: 600, color: '#3B82F6' }}>{viewingRecord.stats?.total_resumes || 0}</div>
                </div>
                <div style={{ background: '#F8FAFC', padding: '12px 16px', borderRadius: 8 }}>
                  <Text type="secondary">待筛选</Text>
                  <div style={{ fontSize: 24, fontWeight: 600, color: '#F59E0B' }}>{viewingRecord.stats?.pending_screening || 0}</div>
                </div>
                <div style={{ background: '#F8FAFC', padding: '12px 16px', borderRadius: 8 }}>
                  <Text type="secondary">待面试</Text>
                  <div style={{ fontSize: 24, fontWeight: 600, color: '#8B5CF6' }}>{viewingRecord.stats?.pending_interview || 0}</div>
                </div>
                <div style={{ background: '#F8FAFC', padding: '12px 16px', borderRadius: 8 }}>
                  <Text type="secondary">已入职</Text>
                  <div style={{ fontSize: 24, fontWeight: 600, color: '#10B981' }}>{viewingRecord.stats?.offer_accepted || 0}</div>
                </div>
              </div>
            </div>

            <Divider style={{ margin: '24px 0' }} />

            <div style={{ marginBottom: 24 }}>
              <Title level={5} style={{ marginBottom: 12 }}>岗位职责</Title>
              <div style={{ 
                background: '#F8FAFC', 
                padding: '16px', 
                borderRadius: '8px', 
                color: '#334155',
                lineHeight: 1.8
              }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {viewingRecord.description || '暂无描述'}
                </ReactMarkdown>
              </div>
            </div>

            <div style={{ marginBottom: 24 }}>
              <Title level={5} style={{ marginBottom: 12 }}>任职要求</Title>
              <div style={{ 
                background: '#F8FAFC', 
                padding: '16px', 
                borderRadius: '8px', 
                color: '#334155',
                lineHeight: 1.8
              }}>
                {(() => {
                  if (!viewingRecord.requirements) return '暂无要求';
                  try {
                    const items = JSON.parse(viewingRecord.requirements);
                    if (Array.isArray(items)) {
                      return (
                        <div style={{ lineHeight: '22px' }}>
                          {items.map((item: string, i: number) => (
                            <Tag key={i} color="blue" style={{ margin: '1px 2px', fontSize: 12, lineHeight: '20px' }}>{item}</Tag>
                          ))}
                        </div>
                      );
                    }
                  } catch {}
                  return viewingRecord.requirements;
                })()}
              </div>
            </div>

            <Divider style={{ margin: '24px 0' }} />

            <div style={{ marginBottom: 24 }}>
              <Title level={5} style={{ marginBottom: 12 }}>关联题库</Title>
              {viewingRecord.linked_question_banks && viewingRecord.linked_question_banks.length > 0 ? (
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {viewingRecord.linked_question_banks.map((bank: QuestionBankBrief) => (
                    <div 
                      key={bank.id}
                      style={{ 
                        background: '#F8FAFC', 
                        padding: '12px 16px', 
                        borderRadius: 8,
                        border: '1px solid #E2E8F0',
                        minWidth: 200
                      }}
                    >
                      <div style={{ fontWeight: 500, color: '#0F172A' }}>{bank.name}</div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                        <Tag color="blue" style={{ border: 'none', margin: 0 }}>{bank.category}</Tag>
                        <Text type="secondary" style={{ fontSize: 12 }}>{bank.question_count} 道题</Text>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ 
                  background: '#F8FAFC', 
                  padding: '16px', 
                  borderRadius: '8px', 
                  color: '#64748B',
                  textAlign: 'center'
                }}>
                  暂无关联题库，可在题库管理中关联到此岗位
                </div>
              )}
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
};

// 能力维度编辑器 —— 复选框列表 + 可展开描述
const CapabilityDimensionEditor: React.FC<{
  value?: any;
  onChange?: (value: CapabilityDimensionValue[]) => void;
  allDimNames: string[];
  setAllDimNames: React.Dispatch<React.SetStateAction<string[]>>;
}> = ({ value = [], onChange, allDimNames, setAllDimNames }) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [customName, setCustomName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const dims: CapabilityDimensionValue[] = (Array.isArray(value) ? value : []).map((d: any) => {
    if (typeof d === 'string') return { name: d, description: '', weight: isWeightedScoringDimension(d) ? WEIGHTED_SCREENING_DEFAULT_WEIGHTS[d] : null };
    const desc = d?.description || [d?.definition, d?.behaviors].filter(Boolean).join('；') || '';
    const name = String(d?.name || d || '');
    const weight = Number(d?.weight);
    return {
      ...d,
      name,
      description: desc,
      weight: isWeightedScoringDimension(name)
        ? (Number.isFinite(weight) ? weight : WEIGHTED_SCREENING_DEFAULT_WEIGHTS[name])
        : null,
    };
  }).filter(d => d.name);

  const checkedNames = new Set(dims.map(d => d.name));
  const descMap: Record<string, string> = {};
  dims.forEach(d => { descMap[d.name] = d.description || ''; });

  const handleToggle = (name: string, checked: boolean) => {
    let newDims: CapabilityDimensionValue[];
    if (checked) {
      newDims = [...dims, { name, description: '', weight: isWeightedScoringDimension(name) ? WEIGHTED_SCREENING_DEFAULT_WEIGHTS[name] : null }];
      setExpanded(prev => new Set(prev).add(name));
    } else {
      newDims = dims.filter(d => d.name !== name);
    }
    onChange?.(newDims);
  };

  const handleDescChange = (name: string, desc: string) => {
    onChange?.(dims.map(d => d.name === name ? { ...d, description: desc } : d));
  };

  const handleWeightChange = (name: string, weight: number | null) => {
    onChange?.(dims.map(d => d.name === name ? { ...d, weight } : d));
  };

  // 删除维度 — 打开确认弹窗
  const handleDeleteDim = (name: string) => {
    setDeleteTarget(name);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    // 从后端删除该维度名称
    try { await request.delete(`/capability-dimension-names/${encodeURIComponent(deleteTarget)}`); } catch {}
    // 从全局预设池中移除
    setAllDimNames(prev => prev.filter(n => n !== deleteTarget));
    // 从当前岗位中移除勾选
    const newDims = dims.filter(d => d.name !== deleteTarget);
    onChange?.(newDims);
    setDeleteTarget(null);
  };

  const toggleExpand = (name: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const handleAddCustom = async () => {
    const name = customName.trim();
    if (!name) return;
    if (checkedNames.has(name)) { message.warning('该维度已存在'); return; }
    try { await request.post('/capability-dimension-names', { name }); } catch {}
    setAllDimNames(prev => [...new Set([...prev, name])]);
    onChange?.([...dims, { name, description: '', weight: isWeightedScoringDimension(name) ? WEIGHTED_SCREENING_DEFAULT_WEIGHTS[name] : null }]);
    setExpanded(prev => new Set(prev).add(name));
    setCustomName('');
  };

  return (
    <div style={{ border: '1px solid #d9d9d9', borderRadius: 8, padding: '12px 16px', background: '#fafafa', maxHeight: 360, overflow: 'auto' }}>
      {allDimNames.length === 0 && checkedNames.size === 0 && <Text type="secondary" style={{ fontSize: 12 }}>暂无预设维度，请在下方添加</Text>}
      {[...new Set([...WEIGHTED_SCORING_DIMENSIONS, ...WEIGHTED_GATE_DIMENSIONS, ...allDimNames, ...dims.map(d => d.name)])].map(name => (
        <div key={name} style={{ marginBottom: 4 }}>
          <Checkbox checked={checkedNames.has(name)} onChange={e => handleToggle(name, e.target.checked)} style={{ fontWeight: 500, marginBottom: 2 }}>{name}</Checkbox>
          {checkedNames.has(name) && (<>
            <DeleteOutlined 
              onClick={() => handleDeleteDim(name)} 
              style={{ fontSize: 11, color: '#ff4d4f', cursor: 'pointer', marginLeft: 4 }} 
              title="删除此维度"
            />
            {isWeightedScoringDimension(name) ? (
              <span style={{ marginLeft: 12 }}>
                <Text type="secondary" style={{ fontSize: 12, marginRight: 6 }}>评分权重</Text>
                <InputNumber min={0} max={100} precision={0} value={dims.find(d => d.name === name)?.weight ?? WEIGHTED_SCREENING_DEFAULT_WEIGHTS[name]}
                  onChange={value => handleWeightChange(name, value == null ? null : Number(value))} addonAfter="%" size="small" />
              </span>
            ) : isScreeningGateDimension(name) ? (
              <Tag color="orange" style={{ marginLeft: 8 }}>硬门槛，不计入加权分</Tag>
            ) : null}
            <div style={{ marginLeft: 24, marginBottom: 8 }}>
              <a onClick={() => toggleExpand(name)} style={{ fontSize: 11, display: 'block', marginBottom: expanded.has(name) ? 6 : 2 }}>
                {expanded.has(name) ? '收起描述 ▲' : '展开描述 ▼'}
              </a>
              {expanded.has(name) && (
                <>
                  <Input.TextArea rows={2} placeholder={`描述「${name}」的具体表现、考察要点或评分标准...`} value={descMap[name] || ''}
                    onChange={e => handleDescChange(name, e.target.value)} showCount maxLength={500} style={{ fontSize: 12 }} />
                </>
              )}
            </div>
          </>)}
        </div>
      ))}
      <Divider style={{ margin: '8px 0' }} />
      <Space.Compact style={{ width: '100%' }}>
        <Input size="small" placeholder="输入新维度名称" value={customName}
          onChange={e => setCustomName(e.target.value)} onPressEnter={handleAddCustom}
          style={{ flex: 1 }} />
        <Button size="small" type="primary" ghost onClick={handleAddCustom}>添加</Button>
      </Space.Compact>

      {/* 删除确认弹窗 */}
      <Modal
        title={`删除维度「${deleteTarget || ''}」`}
        open={!!deleteTarget}
        onCancel={() => setDeleteTarget(null)}
        onOk={confirmDelete}
        okText="确认删除"
        okButtonProps={{ danger: true }}
      >
        <p>确定要删除维度「<strong>{deleteTarget}</strong>」吗？</p>
        <p style={{ color: '#ef4444', fontSize: 13 }}>
          删除后将从此页面和所有岗位的预设维度列表中移除，不可恢复。
        </p>
      </Modal>
    </div>
  );
};

export default PositionsList;
