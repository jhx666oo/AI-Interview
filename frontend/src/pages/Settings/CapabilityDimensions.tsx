import React, { useEffect, useState, useCallback } from 'react';
import {
  Card, Table, Button, Space, Modal, Form, Input, InputNumber, Tag, message,
  Typography, Popconfirm, Tooltip
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined,
  MinusCircleOutlined, AppstoreOutlined, UserOutlined, SearchOutlined
} from '@ant-design/icons';
import request from '../../utils/request';
import { WEIGHTED_GATE_DIMENSIONS, WEIGHTED_SCORING_DIMENSIONS, WEIGHTED_SCREENING_DEFAULT_WEIGHTS } from '../../utils/resumeEvaluation';

const { Text, Title } = Typography;
const { TextArea } = Input;

interface Dimension {
  name: string;
  definition: string;
  behavior: string;
  weight?: number | null;
}

const isWeightedScoringDimension = (name: string): name is (typeof WEIGHTED_SCORING_DIMENSIONS)[number] =>
  (WEIGHTED_SCORING_DIMENSIONS as readonly string[]).includes(name);

const isScreeningGateDimension = (name: string) =>
  (WEIGHTED_GATE_DIMENSIONS as readonly string[]).includes(name);

const defaultDimensions = (): Dimension[] => [
  ...WEIGHTED_SCORING_DIMENSIONS.map((name) => ({ name, definition: '', behavior: '', weight: WEIGHTED_SCREENING_DEFAULT_WEIGHTS[name] })),
  ...WEIGHTED_GATE_DIMENSIONS.map((name) => ({ name, definition: '', behavior: '', weight: null })),
];

const CapabilityDimensions: React.FC = () => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();
  const [search, setSearch] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (search) params.position_name = search;
      const res = await request.get('/capability-dimensions', { params });
      setData(res || []);
    } catch {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { fetchData(); }, [fetchData]);

  /** 解析已有的 full_text 为 dimensions 数组 */
  const parseFullText = (fullText: string): Dimension[] => {
    if (!fullText) return [];
    // 按 "数字. - " 分割
    const parts = fullText.split(/\d+\.\s*-\s*/).filter(Boolean);
    return parts.map((part) => {
      const lines = part.trim().split('\n');
      const name = lines[0]?.replace(/^- /, '').trim() || '';
      const definition = lines.find(l => l.includes('简要定义'))?.replace(/^- 简要定义[：:]\s*/, '').trim() || '';
      const behavior = lines.find(l => l.includes('典型行为表现'))?.replace(/^- 典型行为表现[：:]\s*/, '').trim() || '';
      return { name, definition, behavior };
    }).filter(d => d.name);
  };

  /** 合并 dimensions 为 full_text */
  const buildFullText = (dims: Dimension[]): string => {
    return dims.map((d, i) => {
      let text = `${i + 1}. - ${d.name}`;
      if (d.definition) text += `\n- 简要定义：${d.definition}`;
      if (d.behavior) text += `\n- 典型行为表现：${d.behavior}`;
      return text;
    }).join('\n');
  };

  const handleCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ dimensions: defaultDimensions() });
    setModalVisible(true);
  };

  const handleEdit = (record: any) => {
    setEditing(record);
    const raw = record.dimensions_json;
    // transformRow 可能已自动 JSON.parse 了字符串列，兼容两种格式
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const dims = Array.isArray(parsed)
      ? parsed
      : parseFullText(record.full_text || '');
    form.setFieldsValue({
      position_name: record.position_name,
      dimensions: dims.length > 0 ? dims.map((dimension: Dimension) => ({
        ...dimension,
        weight: isWeightedScoringDimension(dimension.name)
          ? (Number.isFinite(Number(dimension.weight)) ? Number(dimension.weight) : WEIGHTED_SCREENING_DEFAULT_WEIGHTS[dimension.name])
          : null,
      })) : defaultDimensions(),
      personalized_requirements: record.personalized_requirements || '',
    });
    setModalVisible(true);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const values = await form.validateFields();
      const dims: Dimension[] = (values.dimensions || []).filter((d: Dimension) => d.name);
      const fullText = buildFullText(dims);

      const payload = {
        position_name: values.position_name,
        dimensions_json: JSON.stringify(dims),
        personalized_requirements: values.personalized_requirements || '',
        full_text: fullText,
      };

      if (editing) {
        await request.put(`/capability-dimensions/${editing.id}`, payload);
        message.success('更新成功');
      } else {
        await request.post('/capability-dimensions', payload);
        message.success('创建成功');
      }
      setModalVisible(false);
      fetchData();
    } catch (e: any) {
      if (e.errorFields) return;
      message.error(e.response?.data?.detail || '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await request.delete(`/capability-dimensions/${id}`);
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
          await Promise.all(selectedRowKeys.map(id => request.delete(`/capability-dimensions/${id}`)));
          message.success(`已删除 ${selectedRowKeys.length} 条`);
          setSelectedRowKeys([]);
          fetchData();
        } catch (e: any) {
          message.error(e?.response?.data?.detail || '批量删除失败');
        }
      }
    });
  };

  /** 获取某个记录的 dimensions 数组 */
  const getDimensions = (record: any): Dimension[] => {
    if (record.dimensions_json) {
      try { return JSON.parse(record.dimensions_json); } catch { }
    }
    return parseFullText(record.full_text || '');
  };

  const columns = [
    {
      title: '岗位名称',
      dataIndex: 'position_name',
      key: 'position_name',
      width: 180,
      fixed: 'left' as const,
      render: (v: string) => (
        <Space>
          <AppstoreOutlined style={{ color: '#1890ff' }} />
          <Text strong>{v}</Text>
        </Space>
      ),
    },
    {
      title: '能力维度',
      key: 'dimensions',
      width: 360,
      render: (_: any, record: any) => {
        const dims = getDimensions(record);
        return (
          <div style={{ maxWidth: 340 }}>
            <Space wrap size={[4, 4]}>
              {dims.length > 0 ? dims.map((d, i) => (
                <Tooltip key={i} title={
                  <div style={{ whiteSpace: 'pre-wrap' }}>
                    <div><strong>{d.name}</strong></div>
                    {d.definition && <div style={{ marginTop: 4 }}>📌 {d.definition}</div>}
                    {d.behavior && <div style={{ marginTop: 4 }}>🎯 {d.behavior}</div>}
                  </div>
                }>
                  <Tag color="blue" style={{ cursor: 'pointer', margin: 2, maxWidth: 320 }}>
                    {d.name}{isWeightedScoringDimension(d.name) ? ` · ${d.weight ?? WEIGHTED_SCREENING_DEFAULT_WEIGHTS[d.name]}%` : isScreeningGateDimension(d.name) ? ' · 硬门槛' : ''}
                  </Tag>
                </Tooltip>
              )) : <Text type="secondary">-</Text>}
            </Space>
          </div>
        );
      },
    },
    {
      title: '个性化需求',
      key: 'personalized_requirements',
      width: 240,
      ellipsis: true,
      render: (_: any, record: any) => {
        const text = record.personalized_requirements || '';
        if (!text) return <Text type="secondary">-</Text>;
        return (
          <Tooltip
            title={<div style={{ whiteSpace: 'pre-wrap', maxWidth: 400 }}>{text}</div>}
            overlayStyle={{ maxWidth: 450 }}
          >
            <div
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                cursor: 'pointer',
                fontSize: 13,
                color: '#fa8c16',
              }}
            >
              🏷️ {text}
            </div>
          </Tooltip>
        );
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      fixed: 'right' as const,
      render: (_: any, record: any) => (
        <Space>
          <Tooltip title="编辑">
            <Button size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)} />
          </Tooltip>
          <Popconfirm title="确认删除?" onConfirm={() => handleDelete(record.id)}>
            <Tooltip title="删除">
              <Button size="small" danger icon={<DeleteOutlined />} loading={deletingId === record.id} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Card
        title={
          <Space>
            <AppstoreOutlined />
            <span>能力维度管理</span>
          </Space>
        }
        extra={
          <Space>
            <Input
              placeholder="搜索岗位名称"
              prefix={<SearchOutlined style={{ color: '#bfbfbf' }} />}
              value={search}
              onChange={e => setSearch(e.target.value)}
              onPressEnter={fetchData}
              style={{ width: 200 }}
              allowClear
            />
            <Button icon={<ReloadOutlined />} onClick={fetchData} loading={loading}>
              刷新
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
              新增
            </Button>
          </Space>
        }
        style={{ borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
      >
        {selectedRowKeys.length > 0 && (
          <div style={{ marginBottom: 16, padding: '8px 16px', background: '#e6f7ff', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>已选 <strong>{selectedRowKeys.length}</strong> 项</span>
            <Space>
              <Button danger size="small" onClick={handleBatchDelete}>批量删除</Button>
              <Button size="small" onClick={() => setSelectedRowKeys([])}>取消选择</Button>
            </Space>
          </div>
        )}
        <div style={{ marginBottom: 16 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            共 {data.length} 个岗位配置
          </Text>
        </div>

        <Table
          dataSource={data}
          columns={columns}
          rowKey="id"
          loading={loading}
          scroll={{ x: 880 }}
          rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys, columnWidth: 40 }}
          pagination={{
            pageSize: 20,
            showSizeChanger: false,
            showTotal: (total) => `共 ${total} 条`,
          }}
        />
      </Card>

      <Modal
        title={editing ? '编辑能力维度' : '新增能力维度'}
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={handleSubmit}
        confirmLoading={submitting}
        width={800}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item
            name="position_name"
            label="岗位名称"
            rules={[{ required: true, message: '请输入岗位名称' }]}
          >
            <Input placeholder="例：大客户经理" />
          </Form.Item>

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
              <div style={{ background: '#fafafa', padding: 16, borderRadius: 8, marginBottom: 16 }}>
                {fields.map(({ key, name, ...restField }) => (
                  <Card
                    key={key}
                    size="small"
                    style={{ marginBottom: 12, background: '#fff' }}
                    type="inner"
                    title={`维度 ${name + 1}`}
                    extra={
                      fields.length > 1 && (
                        <Button
                          type="text"
                          danger
                          icon={<MinusCircleOutlined />}
                          onClick={() => remove(name)}
                        >
                          删除
                        </Button>
                      )
                    }
                  >
                    <Space orientation="vertical" style={{ width: '100%' }}>
                      <Form.Item
                        {...restField}
                        name={[name, 'name']}
                        label="维度名称"
                        rules={[{ required: true, message: '请输入维度名称' }]}
                      >
                        <Input placeholder="例：市场洞察能力" />
                      </Form.Item>
                      {isWeightedScoringDimension(String(form.getFieldValue(['dimensions', name, 'name']) || '')) ? (
                        <Form.Item
                          {...restField}
                          name={[name, 'weight']}
                          label="评分权重"
                          extra="仅五项能力参与加权分。"
                        >
                          <InputNumber min={0} max={100} precision={0} addonAfter="%" style={{ width: '100%' }} />
                        </Form.Item>
                      ) : isScreeningGateDimension(String(form.getFieldValue(['dimensions', name, 'name']) || '')) ? (
                        <Tag color="orange">硬门槛（不计入加权分）</Tag>
                      ) : null}
                      <Form.Item
                        {...restField}
                        name={[name, 'definition']}
                        label="简要定义"
                      >
                        <TextArea rows={2} placeholder="该维度的简要定义说明…" />
                      </Form.Item>
                      <Form.Item
                        {...restField}
                        name={[name, 'behavior']}
                        label="典型行为表现"
                      >
                        <TextArea rows={2} placeholder="该维度的典型行为表现…" />
                      </Form.Item>
                    </Space>
                  </Card>
                ))}
                <Button type="dashed" onClick={() => add({ name: '', definition: '', behavior: '' })} block>
                  + 添加维度
                </Button>
              </div>
            )}
          </Form.List>

          <Form.Item
            name="personalized_requirements"
            label={
              <Space>
                <UserOutlined />
                <span>个性化需求</span>
              </Space>
            }
          >
            <TextArea
              rows={3}
              placeholder="该岗位的个性化要求，如：需要有大客户资源、要求英语口语流利…"
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default CapabilityDimensions;
