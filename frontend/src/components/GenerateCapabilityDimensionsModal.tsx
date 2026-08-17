import React, { useEffect, useState } from 'react';
import {
  Modal, Radio, Input, Button, message, Spin, Typography, Form, InputNumber, Card, Space, Empty, Alert, Tag, Tooltip
} from 'antd';
import { RobotOutlined, DeleteOutlined, PlusOutlined, LinkOutlined, FileTextOutlined } from '@ant-design/icons';

const { Text, Title } = Typography;
const { TextArea } = Input;

export type GeneratedDimension = {
  name: string;
  definition?: string;
  behavior?: string;
  weight?: number | null;
};

interface GenerateCapabilityDimensionsModalProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: (dimensions: GeneratedDimension[]) => void;
  positionTitle: string;
  jobDescription?: string;
  jobRequirements?: string;
}

const WEIGHTED_SCORING_DIMENSIONS = ['核心画像', '核心职责', '任职要求', '企业背景', '加分项'] as const;
const WEIGHTED_GATE_DIMENSIONS = ['关键词匹配', '避坑雷区'] as const;

const isWeightedScoringDimension = (name: string) =>
  (WEIGHTED_SCORING_DIMENSIONS as readonly string[]).includes(name);
const isScreeningGateDimension = (name: string) =>
  (WEIGHTED_GATE_DIMENSIONS as readonly string[]).includes(name);

const GenerateCapabilityDimensionsModal: React.FC<GenerateCapabilityDimensionsModalProps> = ({
  open,
  onCancel,
  onConfirm,
  positionTitle,
  jobDescription,
  jobRequirements,
}) => {
  const [sourceMode, setSourceMode] = useState<'text' | 'link'>('text');
  const [textValue, setTextValue] = useState('');
  const [linkValue, setLinkValue] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [dimensions, setDimensions] = useState<GeneratedDimension[]>([]);
  const [error, setError] = useState('');
  const [form] = Form.useForm();

  // 打开时预填岗位职责/任职要求，清空上次结果
  useEffect(() => {
    if (open) {
      const desc = (jobDescription || '').trim();
      const reqs = (jobRequirements || '').trim();
      setTextValue([desc, reqs].filter(Boolean).join('\n\n'));
      setLinkValue('');
      setSourceMode('text');
      setGenerated(false);
      setDimensions([]);
      setError('');
      form.resetFields();
    }
  }, [open, jobDescription, jobRequirements, form]);

  const handleGenerate = async () => {
    setError('');
    if (sourceMode === 'link') {
      if (!linkValue.trim()) {
        message.error('请粘贴飞书链接');
        return;
      }
    } else if (!textValue.trim()) {
      message.error('请填写岗位要求文本');
      return;
    }

    setGenerating(true);
    setGenerated(false);
    setDimensions([]);
    try {
      const res = await fetch('/api/positions/generate-capability-dimensions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: JSON.stringify({
          title: positionTitle || '',
          source_link: sourceMode === 'link' ? linkValue.trim() : '',
          source_text: sourceMode === 'text' ? textValue.trim() : '',
          job_description: jobDescription || '',
          job_requirements: jobRequirements || '',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.detail || '生成失败');
      }
      const dims: GeneratedDimension[] = Array.isArray(data.dimensions) ? data.dimensions : [];
      if (!dims.length) {
        throw new Error('AI 未返回有效维度');
      }
      setDimensions(dims);
      // 回填预览表单
      form.setFieldsValue({
        dimensions: dims.map((d) => ({
          name: d.name || '',
          weight: isWeightedScoringDimension(d.name)
            ? (Number.isFinite(Number(d.weight)) ? Number(d.weight) : 20)
            : isScreeningGateDimension(d.name) ? 0 : (Number.isFinite(Number(d.weight)) ? Number(d.weight) : null),
          definition: d.definition || '',
          behavior: d.behavior || '',
        })),
      });
      setGenerated(true);
    } catch (e: any) {
      setError(e?.message || '生成失败，请重试');
      message.error(e?.message || '生成失败，请重试');
    } finally {
      setGenerating(false);
    }
  };

  const handleConfirm = async () => {
    try {
      const values = await form.validateFields();
      const dims: GeneratedDimension[] = (values.dimensions || [])
        .filter((d: any) => d && String(d.name || '').trim())
        .map((d: any) => ({
          name: String(d.name).trim(),
          definition: String(d.definition || '').trim(),
          behavior: String(d.behavior || '').trim(),
          weight: Number.isFinite(Number(d.weight)) ? Number(d.weight) : null,
        }));
      if (!dims.length) {
        message.error('至少保留一个维度');
        return;
      }
      onConfirm(dims);
      onCancel();
    } catch {
      // validateFields 失败时 antd 已有提示
    }
  };

  const handleCancel = () => {
    setGenerating(false);
    setGenerated(false);
    setError('');
    onCancel();
  };

  return (
    <Modal
      title={
        <Space>
          <RobotOutlined style={{ color: '#1677ff' }} />
          <span>AI 一键生成评分维度</span>
          {generating && <Spin size="small" />}
        </Space>
      }
      open={open}
      onCancel={handleCancel}
      width={860}
      zIndex={1100}
      footer={[
        <Button key="generate" type="primary" icon={<RobotOutlined />} onClick={handleGenerate} loading={generating} disabled={generated && dimensions.length > 0}>
          {generated && dimensions.length > 0 ? '重新生成' : '开始生成'}
        </Button>,
        <Button key="cancel" onClick={handleCancel}>取消</Button>,
        <Button key="confirm" type="primary" ghost icon={<PlusOutlined />} onClick={handleConfirm} disabled={!generated}>
          确认并填入岗位
        </Button>,
      ]}
    >
      <div style={{ maxHeight: '70vh', overflow: 'auto', paddingRight: 4 }}>
        {/* 输入来源 */}
        <Card size="small" style={{ marginBottom: 16 }} title="1. 选择内容来源">
          <Radio.Group
            value={sourceMode}
            onChange={(e) => setSourceMode(e.target.value)}
            style={{ marginBottom: 12 }}
          >
            <Radio.Button value="text"><FileTextOutlined /> 岗位要求文本</Radio.Button>
            <Radio.Button value="link"><LinkOutlined /> 飞书链接</Radio.Button>
          </Radio.Group>

          {sourceMode === 'text' ? (
            <TextArea
              rows={5}
              placeholder="粘贴岗位要求文本（可直接从飞书复制），系统会自动附带表单中的岗位职责与任职要求"
              value={textValue}
              onChange={(e) => setTextValue(e.target.value)}
              disabled={generating}
            />
          ) : (
            <Input
              placeholder="粘贴飞书链接，例如 https://xxx.feishu.cn/docx/xxxxx 或 /base/xxxxx?table=xxxx"
              value={linkValue}
              onChange={(e) => setLinkValue(e.target.value)}
              disabled={generating}
              allowClear
            />
          )}
          <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
            支持飞书文档（docx）、多维表格（base）、知识库（wiki）、电子表格（sheets）链接，需当前飞书应用可访问。
          </Text>
        </Card>

        {error && (
          <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} />
        )}

        {/* 生成结果预览与编辑 */}
        {generating && (
          <Card size="small" style={{ marginBottom: 16, background: '#f8fafc' }}>
            <Space>
              <Spin size="small" />
              <Text type="secondary">AI 正在根据岗位要求设计评分维度，请稍候...</Text>
            </Space>
          </Card>
        )}

        {generated && (
          <Card size="small" title="2. 预览与调整（可修改名称/权重/定义/行为表现）">
            <Form form={form} layout="vertical" preserve={false}>
              <Form.List name="dimensions">
                {(fields, { add, remove }) => (
                  <div>
                    {fields.length === 0 && <Empty description="暂无维度，点击下方添加" />}
                    {fields.map(({ key, name, ...restField }) => (
                      <Card
                        key={key}
                        size="small"
                        style={{ marginBottom: 12, background: '#fafafa' }}
                        type="inner"
                        title={`维度 ${name + 1}`}
                        extra={
                          <Button type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => remove(name)}>
                            删除
                          </Button>
                        }
                      >
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 12 }}>
                          <Form.Item
                            {...restField}
                            name={[name, 'name']}
                            label="维度名称"
                            rules={[{ required: true, message: '请输入维度名称' }]}
                            style={{ marginBottom: 8 }}
                          >
                            <Input placeholder="例：专业技能" />
                          </Form.Item>
                          <Form.Item
                            {...restField}
                            name={[name, 'weight']}
                            label={
                              <Space size={4}>
                                <span>权重</span>
                                <Tooltip title="0 表示硬门槛（一票否决），不参与加权分；其余为百分比权重">
                                  <Tag style={{ fontSize: 10, margin: 0 }} color={isScreeningGateDimension(String(form.getFieldValue(['dimensions', name, 'name']) || '')) ? 'orange' : 'blue'}>
                                    {isScreeningGateDimension(String(form.getFieldValue(['dimensions', name, 'name']) || '')) ? '硬门槛' : '加权%'}
                                  </Tag>
                                </Tooltip>
                              </Space>
                            }
                            style={{ marginBottom: 8 }}
                          >
                            <InputNumber min={0} max={100} precision={0} style={{ width: '100%' }} addonAfter="%" />
                          </Form.Item>
                        </div>
                        <Form.Item
                          {...restField}
                          name={[name, 'definition']}
                          label="简要定义"
                          style={{ marginBottom: 8 }}
                        >
                          <Input.TextArea rows={1} placeholder="该维度的简要定义…" />
                        </Form.Item>
                        <Form.Item
                          {...restField}
                          name={[name, 'behavior']}
                          label="典型行为表现"
                          style={{ marginBottom: 0 }}
                        >
                          <Input.TextArea rows={1} placeholder="该维度的典型行为表现或考察要点…" />
                        </Form.Item>
                      </Card>
                    ))}
                    <Button type="dashed" onClick={() => add({ name: '', weight: null, definition: '', behavior: '' })} block icon={<PlusOutlined />}>
                      添加维度
                    </Button>
                  </div>
                )}
              </Form.List>
            </Form>
          </Card>
        )}
      </div>
    </Modal>
  );
};

export default GenerateCapabilityDimensionsModal;
