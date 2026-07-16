import React, { useEffect, useState, useCallback } from 'react';
import {
  Card, Table, Button, Space, Modal, Form, Input, Tag, message,
  Typography, Select, Popconfirm, Tooltip, Divider
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined, SyncOutlined, UserOutlined
} from '@ant-design/icons';
import request from '../../utils/request';

const { Text } = Typography;

interface PositionGroup {
  key: string;
  mapped_name: string;
  raw_names: string[];
  _ids: string[];
  responsible_person: string;
  responsible_person_open_id: string;
  interviewers: Array<{ name: string; open_id: string }>;
}

const PositionMappings: React.FC = () => {
  const [data, setData] = useState<PositionGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<PositionGroup | null>(null);
  const [form] = Form.useForm();
  const [search, setSearch] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (search) params.raw_name = search;
      const res: any[] = await request.get('/position-mappings', { params });
      // 按标准岗位名分组
      const groups: Record<string, PositionGroup> = {};
      (res || []).forEach((r: any) => {
        const key = r.mapped_name;
        if (!groups[key]) {
          let ivs: Array<{ name: string; open_id: string }> = [];
          try { ivs = JSON.parse(r.interviewers || '[]'); } catch { ivs = []; }
          groups[key] = {
            key,
            mapped_name: key,
            raw_names: [],
            _ids: [],
            responsible_person: r.responsible_person || '',
            responsible_person_open_id: r.responsible_person_open_id || '',
            interviewers: ivs,
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
      responsible_person: '',
      interviewers: [],
    });
    setModalVisible(true);
  };

  const handleEdit = (record: PositionGroup) => {
    setEditing(record);
    form.setFieldsValue({
      mapped_name: record.mapped_name,
      raw_names: record.raw_names,
      responsible_person: record.responsible_person,
      interviewers: record.interviewers.map(iv => iv.name).join(', '),
    });
    setModalVisible(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const { mapped_name, raw_names, responsible_person, interviewers } = values;
      if (!raw_names || raw_names.length === 0) {
        message.warning('请至少输入一个 BOSS 岗位名称');
        return;
      }
      // 解析面试官字符串为数组
      const interviewerArr = interviewers
        ? interviewers.split(/[,，、]/).map((n: string) => n.trim()).filter(Boolean).map((name: string) => ({ name, open_id: '' }))
        : [];
      
      await request.post('/position-mappings/batch-save', {
        mapped_name,
        raw_names: Array.isArray(raw_names) ? raw_names : [raw_names],
        responsible_person: responsible_person || '',
        responsible_person_open_id: '',
        interviewers: interviewerArr,
      });
      message.success(editing ? '更新成功' : '创建成功');
      setModalVisible(false);
      fetchData();
    } catch (e: any) {
      if (e.errorFields) return;
      message.error(e.response?.data?.detail || '操作失败');
    }
  };

  const handleDelete = async (record: PositionGroup) => {
    try {
      for (const id of record._ids) {
        await request.delete(`/position-mappings/${id}`);
      }
      message.success('删除成功');
      fetchData();
    } catch {
      message.error('删除失败');
    }
  };

  const handleSync = async () => {
    Modal.confirm({
      title: '从飞书同步',
      content: '将从飞书年度招聘任务表的「责任人」「业务一面」「HR二面」「终面」字段同步到岗位映射表，更新已存在的映射。',
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
      title: '面试官',
      key: 'interviewers',
      width: 240,
      render: (_: any, record: PositionGroup) => (
        record.interviewers.length > 0
          ? <Space wrap size={[4, 4]}>
              {record.interviewers.map((iv, i) => (
                <Tag key={i} color="geekblue">{iv.name}</Tag>
              ))}
            </Space>
          : <Text type="secondary">-</Text>
      ),
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
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card
      title="岗位映射管理"
      extra={
        <Space>
          <Input.Search
            placeholder="搜索标准岗位名"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onSearch={fetchData}
            style={{ width: 200 }}
            allowClear
          />
          <Button icon={<SyncOutlined />} onClick={handleSync} loading={syncing}>
            从飞书同步
          </Button>
          <Button icon={<ReloadOutlined />} onClick={fetchData} loading={loading}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            新增映射
          </Button>
        </Space>
      }
    >
      <Table
        columns={columns}
        dataSource={data}
        rowKey="key"
        loading={loading}
        scroll={{ x: 930 }}
        pagination={{ pageSize: 20 }}
      />
      <Modal
        title={editing ? '编辑映射' : '新增映射'}
        open={modalVisible}
        onOk={handleSubmit}
        onCancel={() => setModalVisible(false)}
        width={560}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="mapped_name" label="标准岗位名" rules={[{ required: true, message: '请输入标准岗位名' }]}>
            <Input placeholder="如：招商专员（地招）" />
          </Form.Item>
          <Form.Item name="raw_names" label="BOSS岗位名称（可多个）" rules={[{ required: true, message: '请至少输入一个' }]}>
            <Select mode="tags" placeholder="输入后回车添加" tokenSeparators={[',', '，', '\n']} />
          </Form.Item>
          <Divider />
          <Form.Item name="responsible_person" label="负责人">
            <Input placeholder="输入负责人姓名（从飞书同步后自动填充）" />
          </Form.Item>
          <Form.Item name="interviewers" label="面试官（多个用逗号分隔）">
            <Input placeholder="如：张三, 李四, 王五" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
};

export default PositionMappings;
