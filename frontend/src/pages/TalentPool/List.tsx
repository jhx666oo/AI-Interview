import React, { useEffect, useState, useCallback } from 'react';
import {
  Card, Table, Button, Space, Tag, Select, message,
  Input, Typography, Tooltip
} from 'antd';
import SimplePagination from '../../components/SimplePagination';
import {
  ReloadOutlined, SearchOutlined, BellOutlined, LoadingOutlined, DownloadOutlined
} from '@ant-design/icons';
import request from '../../utils/request';
import { useOwner } from '../../contexts/OwnerContext';
import dayjs from 'dayjs';

const { Option } = Select;
const { Text } = Typography;

const statusConfig: Record<string, { color: string; text: string }> = {
  approved: { color: 'success', text: '已入库' },
  pending_screening: { color: 'warning', text: '待初筛' },
  rejected: { color: 'error', text: '已淘汰' },
};

const TalentPoolList: React.FC = () => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string | undefined>();
  const [notifyLoading, setNotifyLoading] = useState<string | null>(null);
  const [tablePage, setTablePage] = useState(1);
  const { selectedOwner } = useOwner();
  const pageSize = 10;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (search) params.candidate_name = search;
      if (filterStatus) params.status = filterStatus;
      if (selectedOwner) params.responsible_person = selectedOwner;
      const res = await request.get('/talent-pool', { params });
      setData(res || []);
    } catch {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  }, [search, filterStatus, selectedOwner]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleNotifyInterviewer = async (record: any) => {
    const name = record.candidate_name || '该候选人';
    setNotifyLoading(record.id);
    try {
      // 创建面试记录
      await request.post('/interviews/create-from-talent', {
        candidate_name: name,
        position_applied: record.position_applied || '',
        standard_position: record.standard_position || record.position_applied || '',
        city: record.city || '',
        feishu_record_id: record.feishu_record_id || record.id,
      });
      message.success(`已安排面试：${name}`);
      fetchData();
    } catch (e: any) {
      message.error(e.response?.data?.detail || '通知失败');
    } finally {
      setNotifyLoading(null);
    }
  };

  const handleDownload = (record: any) => {
    const token = localStorage.getItem('token') || '';
    const url = `/api/resumes/${record.id}/file?download=true&token=${encodeURIComponent(token)}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = (record.candidate_name || 'resume') + '.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const columns = [
    { title: '姓名', dataIndex: 'candidate_name', key: 'candidate_name', width: 100 },
    {
      title: '标准岗位', key: 'position', width: 160,
      render: (_: any, record: any) => {
        const mapped = record.mapped_position || '';
        const standard = record.standard_position || '';
        const original = record.position_applied || '';
        if (mapped) {
          return (
            <Tooltip title={`原始岗位: ${original || '-'}`}>
              <Tag color="blue">{mapped}</Tag>
            </Tooltip>
          );
        }
        return <span>{standard || original || '-'}</span>;
      }
    },
    {
      title: '年龄', dataIndex: 'age', key: 'age', width: 60,
      render: (v: any) => v ? `${v}岁` : '-'
    },
    {
      title: '学历', dataIndex: 'education', key: 'education', width: 80,
      render: (v: string) => v || '-'
    },
    {
      title: '城市', dataIndex: 'city', key: 'city', width: 80,
      render: (v: string) => v || '-'
    },
    {
      title: '性别', dataIndex: 'gender', key: 'gender', width: 60,
      render: (v: string) => {
        if (v === '男') return <span>♂ 男</span>;
        if (v === '女') return <span>♀ 女</span>;
        return v || '-';
      }
    },
    {
      title: 'AI初筛结果', dataIndex: 'screening_result', key: 'screening_result', width: 100,
      render: (v: string) => {
        const map: Record<string, {color: string, text: string}> = {
          '通过': { color: 'success', text: '通过' },
          '不通过': { color: 'error', text: '不通过' },
          '存疑': { color: 'error', text: '不通过' },
          '淘汰': { color: 'error', text: '不通过' },
          '强烈推荐': { color: 'success', text: '通过' },
          '推荐': { color: 'success', text: '通过' },
          '待定': { color: 'error', text: '不通过' },
          '不推荐': { color: 'error', text: '不通过' },
          '强烈不推荐': { color: 'error', text: '不通过' },
        };
        const c = map[v] || { color: 'default', text: v || '-' };
        return <Tag color={c.color}>{c.text}</Tag>;
      }
    },
    {
      title: 'HR复核', dataIndex: 'hr_review', key: 'hr_review', width: 90,
      render: (v: string) => {
        const map: Record<string, {color: string, text: string}> = {
          '通过': { color: 'success', text: '通过' },
          '未通过': { color: 'error', text: '未通过' },
          '可进入面试': { color: 'geekblue', text: '可进入面试' },
        };
        const c = map[v] || { color: 'default', text: v || '-' };
        return <Tag color={c.color}>{c.text}</Tag>;
      }
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 90,
      render: (v: string) => {
        const c = statusConfig[v] || { color: 'default', text: v };
        return <Tag color={c.color}>{c.text}</Tag>;
      }
    },
    {
      title: '创建时间', dataIndex: 'create_time', key: 'create_time', width: 110,
      render: (v: string) => v ? dayjs(v).format('MM-DD HH:mm') : '-'
    },
    {
      title: '操作', align: 'center' as const, key: 'action', width: 180, fixed: 'right' as const,
      render: (_: any, record: any) => (
        <Space size="small">
          <Tooltip title="下载简历">
            <Button type="text" icon={<DownloadOutlined style={{ color: '#22C55E' }} />} onClick={() => handleDownload(record)} />
          </Tooltip>
          <Button
            type="primary"
            size="small"
            icon={notifyLoading === record.id ? <LoadingOutlined /> : <BellOutlined />}
            onClick={() => handleNotifyInterviewer(record)}
            loading={notifyLoading === record.id}
          >
            面试
          </Button>
        </Space>
      )
    },
  ];

  return (
    <div>
      <Card
        title="候选人管理"
        extra={
          <Space>
            <Input placeholder="搜索姓名" prefix={<SearchOutlined />} value={search} onChange={e => setSearch(e.target.value)} onPressEnter={fetchData} style={{ width: 180 }} allowClear />
            <Select placeholder="状态筛选" allowClear style={{ width: 120 }} value={filterStatus} onChange={v => setFilterStatus(v)}>
              {Object.entries(statusConfig).map(([k, v]) => <Option key={k} value={k}>{v.text}</Option>)}
            </Select>
            <Button icon={<ReloadOutlined />} onClick={fetchData}>刷新</Button>
          </Space>
        }
      >
        <Table dataSource={data.slice((tablePage - 1) * pageSize, tablePage * pageSize)} columns={columns} rowKey="id" loading={loading}
          scroll={{ x: 'max-content' }}
          pagination={false}
        />
        <SimplePagination current={tablePage} pageSize={pageSize} total={data.length} onChange={setTablePage} />
      </Card>
    </div>
  );
};

export default TalentPoolList;
