import React, { useEffect, useState, useCallback } from 'react';
import {
  Card, Table, Button, Space, Modal, Form, Input, Tag, message,
  Typography, Select, Popconfirm, Tooltip
} from 'antd';
import SimplePagination from '../../components/SimplePagination';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined, SyncOutlined, UserOutlined, SearchOutlined
} from '@ant-design/icons';
import request from '../../utils/request';
import { PageHeader, ResponsiveDataView, ResponsiveModal, ResponsiveToolbar } from '../../components/Responsive';

const { Text } = Typography;

interface PositionGroup {
  key: string;
  mapped_name: string;
  raw_names: string[];
  _ids: string[];
  responsible_person: string;
  responsible_person_open_id: string;
  primary_interviewer: string;
  secondary_interviewer: string;
}

const PositionMappings: React.FC = () => {
  const [data, setData] = useState<PositionGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [oldRawNames, setOldRawNames] = useState<string[]>([]);  // 编辑时记录旧的 raw_names 列表
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<PositionGroup | null>(null);
  const [tablePage, setTablePage] = useState(1);
  const pageSize = 10;
  const [form] = Form.useForm();
  const [search, setSearch] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (search) params.raw_name = search;
      const [res, positions] = await Promise.all([
        request.get('/position-mappings', { params }) as Promise<any[]>,
        request.get('/positions') as Promise<any[]>,
      ]);
      const positionByTitle = new Map((positions || []).map((position: any) => [position.title, position]));
      // 按标准岗位名分组
      const groups: Record<string, PositionGroup> = {};
      (res || []).forEach((r: any) => {
        const key = r.mapped_name;
        if (!groups[key]) {
          const position = positionByTitle.get(key);
          groups[key] = {
            key,
            mapped_name: key,
            raw_names: [],
            _ids: [],
            responsible_person: position?.responsible_person || r.responsible_person || '',
            responsible_person_open_id: r.responsible_person_open_id || '',
            primary_interviewer: position?.primary_interviewer || '',
            secondary_interviewer: position?.secondary_interviewer || '',
          };
        }
        if (!groups[key].raw_names.includes(r.raw_name)) {
          groups[key].raw_names.push(r.raw_name);
        }
        groups[key]._ids.push(r.id);
      });
      setData(Object.values(groups));
    } catch {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      mapped_name: '',
      raw_names: [],
    });
    setModalVisible(true);
  };

  const handleEdit = (record: PositionGroup) => {
    setEditing(record);
    setOldRawNames([...record.raw_names]);  // 保存旧的 BOSS岗位名列表
    form.setFieldsValue({
      mapped_name: record.mapped_name,
      raw_names: record.raw_names,
    });
    setModalVisible(true);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const values = await form.validateFields();
      const { mapped_name, raw_names } = values;
      if (!raw_names || raw_names.length === 0) {
        message.warning('请至少输入一个 BOSS 岗位名称');
        setSubmitting(false);
        return;
      }
      const newRawNames: string[] = Array.isArray(raw_names) ? raw_names : [raw_names];

      // 编辑时：删除用户在界面中移除的旧 BOSS岗位名
      if (editing && oldRawNames.length > 0) {
        const removedNames = oldRawNames.filter(n => !newRawNames.includes(n));
        for (const name of removedNames) {
          try {
            // 查找并删除对应的 position_mappings 记录
            const existing = (await request.get('/position-mappings', { params: { raw_name: name } })) as any[];
            const toDelete = (existing || []).filter((r: any) => r.raw_name === name && r.mapped_name === mapped_name);
            for (const r of toDelete) {
              await request.delete(`/position-mappings/${r.id}`);
            }
          } catch {}
        }
      }

      await request.post('/position-mappings/batch-save', {
        mapped_name,
        raw_names: newRawNames,
      });
      message.success(editing ? '更新成功' : '创建成功');
      setModalVisible(false);
      fetchData();
    } catch (e: any) {
      if (e.errorFields) return;
      message.error(e.response?.data?.detail || '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (record: PositionGroup) => {
    setDeletingId(record.key);
    try {
      for (const id of record._ids) {
        await request.delete(`/position-mappings/${id}`);
      }
      message.success('删除成功');
      fetchData();
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '删除失败');
    } finally {
      setDeletingId(null);
    }
  };

  const handleBatchDelete = async () => {
    if (selectedRowKeys.length === 0) { message.warning('请先选择要删除的项'); return; }
    Modal.confirm({
      title: '确认批量删除',
      content: `确定要删除选中的 ${selectedRowKeys.length} 条记录吗？`,
      onOk: async () => {
        try {
          const records = data.filter(r => selectedRowKeys.includes(r.key));
          for (const record of records) {
            for (const id of record._ids) {
              await request.delete(`/position-mappings/${id}`);
            }
          }
          message.success(`已删除 ${selectedRowKeys.length} 条`);
          setSelectedRowKeys([]);
          fetchData();
        } catch (e: any) {
          message.error(e?.response?.data?.detail || '批量删除失败');
        }
      }
    });
  };

  const handleSync = async () => {
    Modal.confirm({
      title: '从飞书同步',
      content: '只同步飞书岗位名称并维护原始岗位名到标准岗位名的映射。负责人和一面/二面默认面试官请在岗位管理维护。',
      okText: '同步',
      cancelText: '取消',
      onOk: async () => {
        setSyncing(true);
        try {
          const res = await request.post('/position-mappings/sync-from-feishu');
          message.success(res.message || '同步完成');
          fetchData();
        } catch (e: any) {
          message.error('同步失败: ' + (e.response?.data?.detail || e.message));
        } finally {
          setSyncing(false);
        }
      },
    });
  };

  const columns = [
    {
      title: '标准岗位名',
      dataIndex: 'mapped_name',
      key: 'mapped_name',
      width: 180,
      fixed: 'left' as const,
      render: (v: string) => <Text strong>{v}</Text>,
    },
    {
      title: 'BOSS岗位名称',
      dataIndex: 'raw_names',
      key: 'raw_names',
      width: 260,
      render: (names: string[]) => (
        <Space wrap size={[4, 4]}>
          {names.map((n, i) => <Tag key={i} color="blue">{n}</Tag>)}
        </Space>
      ),
    },
    {
      title: '负责人',
      key: 'responsible_person',
      width: 130,
      render: (_: any, record: PositionGroup) => (
        record.responsible_person
          ? <Tag icon={<UserOutlined />} color="orange">{record.responsible_person}</Tag>
          : <Text type="secondary">-</Text>
      ),
    },
    {
      title: '默认一面',
      key: 'primary_interviewer',
      width: 120,
      render: (_: any, record: PositionGroup) => record.primary_interviewer || <Text type="secondary">请到岗位管理配置</Text>,
    },
    {
      title: '默认二面',
      key: 'secondary_interviewer',
      width: 120,
      render: (_: any, record: PositionGroup) => record.secondary_interviewer || <Text type="secondary">请到岗位管理配置</Text>,
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      fixed: 'right' as const,
      render: (_: any, record: PositionGroup) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
          <Popconfirm title={`删除「${record.mapped_name}」?`} onConfirm={() => handleDelete(record)}>
            <Button size="small" danger icon={<DeleteOutlined />} loading={deletingId === record.key} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const positionMappingCard = {
    title: (record: PositionGroup) => record.mapped_name,
    subtitle: (record: PositionGroup) => record.raw_names.length ? record.raw_names.map((name) => <Tag key={name} color="blue">{name}</Tag>) : '—',
    fields: [
      { key: 'responsible', label: '负责人', level: 'secondary' as const, render: (record: PositionGroup) => record.responsible_person ? <Tag icon={<UserOutlined />} color="orange">{record.responsible_person}</Tag> : '—' },
      { key: 'primaryInterviewer', label: '默认一面', level: 'secondary' as const, render: (record: PositionGroup) => record.primary_interviewer || '请到岗位管理配置' },
      { key: 'secondaryInterviewer', label: '默认二面', level: 'secondary' as const, render: (record: PositionGroup) => record.secondary_interviewer || '请到岗位管理配置' },
      { key: 'openId', label: '负责人 Open ID', level: 'detail' as const, render: (record: PositionGroup) => record.responsible_person_open_id || '—' },
      { key: 'rawNames', label: '全部 BOSS 岗位名称', level: 'detail' as const, render: (record: PositionGroup) => record.raw_names.join('、') || '—' },
    ],
    actions: (record: PositionGroup) => (
      <Space>
        <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
        <Popconfirm title={`删除「${record.mapped_name}」?`} onConfirm={() => handleDelete(record)}>
          <Button size="small" danger icon={<DeleteOutlined />} loading={deletingId === record.key} />
        </Popconfirm>
      </Space>
    ),
  };

  return (
    <div>
      <PageHeader title="岗位映射管理" />
      <Card>
      <ResponsiveToolbar
        actions={<Space wrap>
          <Button icon={<SyncOutlined />} onClick={handleSync} loading={syncing}>
            从飞书同步
          </Button>
          <Button icon={<ReloadOutlined />} onClick={fetchData} loading={loading}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            新增映射
          </Button>
        </Space>}
      >
        <Input
          placeholder="搜索标准岗位名"
          prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onPressEnter={fetchData}
          style={{ width: '100%', maxWidth: 280 }}
          allowClear
        />
      </ResponsiveToolbar>
      {selectedRowKeys.length > 0 && (
        <div style={{ marginBottom: 16, padding: '8px 16px', background: '#e6f7ff', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>已选 <strong>{selectedRowKeys.length}</strong> 项</span>
          <Space>
            <Button danger size="small" onClick={handleBatchDelete}>批量删除</Button>
            <Button size="small" onClick={() => setSelectedRowKeys([])}>取消选择</Button>
          </Space>
        </div>
      )}
      <ResponsiveDataView
        columns={columns}
        dataSource={data.slice((tablePage - 1) * pageSize, tablePage * pageSize)}
        rowKey="key"
        loading={loading}
        card={positionMappingCard}
        scroll={{ x: 930 }}
        pagination={false}
        rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys, columnWidth: 40 }}
      />
        <SimplePagination current={tablePage} pageSize={pageSize} total={data.length} onChange={setTablePage} />
      <ResponsiveModal
        title={editing ? '编辑映射' : '新增映射'}
        open={modalVisible}
        onOk={handleSubmit}
        onCancel={() => setModalVisible(false)}
        confirmLoading={submitting}
        width={560}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="mapped_name" label="标准岗位名" rules={[{ required: true, message: '请输入标准岗位名' }]}>
            <Input placeholder="如：招商专员（地招）" />
          </Form.Item>
          <Form.Item name="raw_names" label="BOSS岗位名称（可多个）" rules={[{ required: true, message: '请至少输入一个' }]}>
            <Select mode="tags" placeholder="输入后回车添加" tokenSeparators={[',', '，', '\n']} />
          </Form.Item>
          <Typography.Text type="secondary">
            负责人及默认一面/二面面试官统一在“岗位管理”维护，本页面只维护岗位名称映射。
          </Typography.Text>
        </Form>
      </ResponsiveModal>
    </Card>
    </div>
  );
};

export default PositionMappings;
