import React, { useEffect, useState } from 'react';
import {
  Card, Button, Space, Typography, message, Modal, Form, Input, Select,
  Table, Tag, Popconfirm, Tooltip
} from 'antd';
import {
  PlusOutlined, PlayCircleOutlined, DeleteOutlined, EditOutlined,
  CopyOutlined, CheckCircleOutlined, SettingOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import request from '../../utils/request';
import { useAuth } from '../../contexts/AuthContext';

const { Title, Text } = Typography;
const { Option } = Select;

interface Workflow {
  id: string;
  name: string;
  description: string;
  status: 'draft' | 'published' | 'archived';
  trigger_type: string;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

const statusMap = {
  draft: { text: '草稿', color: 'default' },
  published: { text: '已发布', color: 'green' },
  archived: { text: '已归档', color: 'red' },
};

const WorkflowsList: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [form] = Form.useForm();

  const role = (user as any)?.role?.value ?? (user as any)?.role;
  const isAdmin = role === 'admin';
  const isHR = role === 'hr' || isAdmin;

  const fetchWorkflows = async () => {
    setLoading(true);
    try {
      const res = await request.get('/workflows');
      setWorkflows(res);
    } catch (e) {
      message.error('获取工作流列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkflows();
  }, []);

  const handleCreate = () => {
    form.resetFields();
    setModalVisible(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const res = await request.post('/workflows', {
        ...values,
        graph: { nodes: [], edges: [] },
      });
      message.success('创建成功');
      setModalVisible(false);
      navigate(`/workflows/${res.id}`);
    } catch (e: any) {
      if (e?.errorFields) return;
      message.error(e?.response?.data?.detail || '创建失败');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await request.delete(`/workflows/${id}`);
      message.success('删除成功');
      fetchWorkflows();
    } catch (e) {
      message.error('删除失败');
    }
  };

  const handlePublish = async (id: string) => {
    try {
      await request.post(`/workflows/${id}/publish`);
      message.success('发布成功');
      fetchWorkflows();
    } catch (e) {
      message.error('发布失败');
    }
  };

  const handleExecute = async (id: string) => {
    try {
      const res = await request.post(`/workflows/${id}/execute`);
      message.success('执行成功');
      if (res.output_data) {
        Modal.info({
          title: '执行结果',
          content: (
            <pre style={{ maxHeight: 400, overflow: 'auto' }}>
              {JSON.stringify(res.output_data, null, 2)}
            </pre>
          ),
          width: 600,
        });
      }
    } catch (e: any) {
      message.error(e?.response?.data?.detail || '执行失败');
    }
  };

  const handleDuplicate = async (workflow: Workflow) => {
    try {
      const res = await request.post('/workflows', {
        name: `${workflow.name} (副本)`,
        description: workflow.description,
        trigger_type: workflow.trigger_type,
      });
      message.success('复制成功');
      navigate(`/workflows/${res.id}`);
    } catch (e) {
      message.error('复制失败');
    }
  };

  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: Workflow) => (
        <a onClick={() => navigate(`/workflows/${record.id}`)}>{text}</a>
      ),
    },
    {
      title: '描述',
      dataIndex: 'description',
      key: 'description',
      ellipsis: true,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: keyof typeof statusMap) => {
        const config = statusMap[status];
        return <Tag color={config.color}>{config.text}</Tag>;
      },
    },
    {
      title: '触发方式',
      dataIndex: 'trigger_type',
      key: 'trigger_type',
      width: 100,
      render: (type: string) => {
        const typeMap: Record<string, string> = {
          manual: '手动触发',
          scheduled: '定时触发',
          webhook: 'Webhook',
        };
        return typeMap[type] || type;
      },
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      key: 'updated_at',
      width: 180,
      render: (date: string) => new Date(date).toLocaleString(),
    },
    {
      title: '操作', align: 'center' as const,
      key: 'action',
      width: 200,
      render: (_: any, record: Workflow) => (
        <Space size="small">
          <Tooltip title="编辑">
            <Button
              type="text"
              icon={<EditOutlined />}
              onClick={() => navigate(`/workflows/${record.id}`)}
            />
          </Tooltip>
          {record.status === 'published' && (
            <Tooltip title="执行">
              <Button
                type="text"
                icon={<PlayCircleOutlined style={{ color: '#52c41a' }} />}
                onClick={() => handleExecute(record.id)}
              />
            </Tooltip>
          )}
          {record.status === 'draft' && (
            <Tooltip title="发布">
              <Button
                type="text"
                icon={<CheckCircleOutlined style={{ color: '#1890ff' }} />}
                onClick={() => handlePublish(record.id)}
              />
            </Tooltip>
          )}
          {!record.is_system && isHR && (
            <>
              <Tooltip title="复制">
                <Button
                  type="text"
                  icon={<CopyOutlined />}
                  onClick={() => handleDuplicate(record)}
                />
              </Tooltip>
              <Popconfirm
                title="确定要删除这个工作流吗？"
                onConfirm={() => handleDelete(record.id)}
              >
                <Tooltip title="删除">
                  <Button
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                  />
                </Tooltip>
              </Popconfirm>
            </>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <Title level={2} style={{ margin: 0 }}>工作流编排</Title>
        <Text type="secondary">可视化设计和编排自动化工作流</Text>
      </div>

      <Card
        extra={
          isHR && (
            <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
              创建工作流
            </Button>
          )
        }
      >
        <Table
          columns={columns}
          dataSource={workflows}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
        />
      </Card>

      <Modal
        title="创建工作流"
        open={modalVisible}
        onOk={handleSubmit}
        onCancel={() => setModalVisible(false)}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input placeholder="工作流名称" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="工作流描述" />
          </Form.Item>
          <Form.Item name="trigger_type" label="触发方式" initialValue="manual">
            <Select>
              <Option value="manual">手动触发</Option>
              <Option value="scheduled">定时触发</Option>
              <Option value="webhook">Webhook</Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default WorkflowsList;