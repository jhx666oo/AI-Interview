import React, { useEffect, useState } from 'react';
import { Button, Card, Form, Input, Space, Typography, message, Divider, Tag, Tabs, Tooltip } from 'antd';
import { SaveOutlined, ReloadOutlined } from '@ant-design/icons';
import request from '../../utils/request';
import { useAuth } from '../../contexts/AuthContext';

const { Title, Text } = Typography;

type SystemSettings = {
  llm_base_url?: string | null;
  llm_model: string;
  llm_api_key_set: boolean;
  llm_api_key_last4?: string | null;
};

type PromptConfigItem = {
  system: string;
  user: string;
};

type PromptConfigs = {
  prompts: Record<string, PromptConfigItem>;
};

type PromptVariable = {
  name: string;
  description: string;
};

type PromptVariablesResponse = {
  variables_by_prompt: Record<string, PromptVariable[]>;
  all_variables: Record<string, string>;
};

const promptNames: Record<string, string> = {
  generate_jd: 'JD 生成',
  parse_resume_pdf: 'PDF简历解析',
  generate_resume_markdown: '简历 Markdown 生成',
  generate_daily_report: '招聘日报生成',
  resume_extract_fields: '简历字段提取',
  resume_screening: '简历初筛',
  resume_screening_supplement: '简历初筛补充评分',
};

const SystemSettingsPage: React.FC = () => {
  const { user } = useAuth();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [meta, setMeta] = useState<SystemSettings | null>(null);
  const [editingKey, setEditingKey] = useState(false);
  const role = (user as any)?.role?.value ?? (user as any)?.role;

  // 提示词配置
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptConfigs, setPromptConfigs] = useState<PromptConfigs | null>(null);
  const [activePromptKey, setActivePromptKey] = useState('generate_jd');
  const [promptForm] = Form.useForm();
  const [promptVariables, setPromptVariables] = useState<PromptVariablesResponse | null>(null);
  const [userPromptRef, setUserPromptRef] = useState<React.RefObject<any>>(React.createRef());

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const res = (await request.get('/settings/system')) as SystemSettings;
      setMeta(res);
      form.setFieldsValue({
        llm_base_url: res.llm_base_url || undefined,
        llm_model: res.llm_model || 'qwen3.5-plus',
        llm_api_key: '',
      });
      setEditingKey(false);
    } catch (e) {
      const status = (e as any)?.response?.status;
      if (status === 403) message.error('无权限访问系统设置');
      else message.error('获取系统设置失败');
    } finally {
      setLoading(false);
    }
  };

  const fetchPromptConfigs = async () => {
    setPromptLoading(true);
    try {
      const res = (await request.get('/settings/prompts')) as PromptConfigs;
      setPromptConfigs(res);
      const currentPrompt = res.prompts[activePromptKey];
      if (currentPrompt) {
        promptForm.setFieldsValue({
          system: currentPrompt.system,
          user: currentPrompt.user,
        });
      }
    } catch {
      // 提示词接口可能不存在
    } finally {
      setPromptLoading(false);
    }
  };

  const fetchPromptVariables = async () => {
    try {
      const res = (await request.get('/settings/prompts/variables')) as PromptVariablesResponse;
      setPromptVariables(res);
    } catch { /* ignore */ }
  };

  useEffect(() => {
    if (role !== 'admin') return;
    fetchSettings();
    fetchPromptConfigs();
    fetchPromptVariables();
  }, [role]);

  useEffect(() => {
    if (promptConfigs?.prompts?.[activePromptKey]) {
      promptForm.setFieldsValue({
        system: promptConfigs.prompts[activePromptKey].system,
        user: promptConfigs.prompts[activePromptKey].user,
      });
    }
  }, [activePromptKey, promptConfigs, promptForm]);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const payload: any = {
        llm_base_url: values.llm_base_url || null,
        llm_model: values.llm_model,
      };
      if (values.llm_api_key && values.llm_api_key.trim()) {
        payload.llm_api_key = values.llm_api_key.trim();
      }
      setSaving(true);
      await request.put('/settings/system', payload);
      form.setFieldsValue({ llm_api_key: '' });
      await fetchSettings();
      message.success('模型配置已保存');
    } catch (e) {
      const status = (e as any)?.response?.status;
      if (status === 403) message.error('无权限保存');
      else if (status === 400) message.error((e as any)?.response?.data?.detail || '参数不合法');
      else message.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleSavePrompt = async () => {
    try {
      const values = await promptForm.validateFields();
      setPromptSaving(true);
      await request.put('/settings/prompts/' + activePromptKey, {
        system: values.system,
        user: values.user,
      });
      message.success('提示词已保存');
      await fetchPromptConfigs();
    } catch (e: any) {
      if (e.errorFields) return;
      message.error('保存提示词失败');
    } finally {
      setPromptSaving(false);
    }
  };

  const handleInsertVariable = (variableName: string) => {
    const variableText = `{${variableName}}`;
    const currentValue = promptForm.getFieldValue('user') || '';
    promptForm.setFieldsValue({ user: currentValue + variableText });
  };

  if (role !== 'admin') {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Text type="secondary">仅管理员可查看系统设置</Text>
      </div>
    );
  }

  // 提示词 Tabs
  const promptTabs = promptConfigs ? Object.keys(promptConfigs.prompts).map(key => ({
    key,
    label: promptNames[key] || key,
    children: (
      <Form form={promptForm} layout="vertical" autoComplete="off" key={key}>
        <Form.Item
          name="system"
          label="System Prompt"
          rules={[{ required: true, message: '请输入 System Prompt' }]}
        >
          <Input.TextArea rows={4} placeholder="系统提示词，定义 AI 的角色和行为" />
        </Form.Item>
        <Form.Item
          name="user"
          label="User Prompt"
          rules={[{ required: true, message: '请输入 User Prompt' }]}
        >
          <Input.TextArea rows={10} placeholder="用户提示词模板，包含具体任务指令" />
        </Form.Item>
        {promptVariables?.variables_by_prompt[key] && (
          <div style={{ marginBottom: 16 }}>
            <Text strong style={{ marginRight: 8 }}>可用变量：</Text>
            <div style={{ marginTop: 8 }}>
              {promptVariables.variables_by_prompt[key].map(variable => (
                <Tooltip key={variable.name} title={variable.description}>
                  <Tag color="blue" style={{ cursor: 'pointer', marginBottom: 4 }} onClick={() => handleInsertVariable(variable.name)}>
                    {`{${variable.name}}`}
                  </Tag>
                </Tooltip>
              ))}
            </div>
          </div>
        )}
        <Button type="primary" onClick={handleSavePrompt} loading={promptSaving}>
          保存提示词
        </Button>
      </Form>
    ),
  })) : [];

  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <Title level={2} style={{ margin: 0 }}>系统设置</Title>
        <Text type="secondary">配置 AI 模型参数与提示词模板</Text>
      </div>

      {/* 模型配置 */}
      <Card
        title="AI 模型配置"
        style={{ marginBottom: 24 }}
        loading={loading}
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={fetchSettings}>刷新</Button>
            <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>保存</Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical" autoComplete="off">
          <input type="text" name="username" autoComplete="username" style={{ display: 'none' }} />
          <input type="password" name="password" autoComplete="current-password" style={{ display: 'none' }} />

          <Form.Item name="llm_base_url" label="Base URL">
            <Input placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1" autoComplete="off" />
          </Form.Item>

          <Form.Item
            name="llm_model"
            label="模型名称"
            rules={[{ required: true, message: '请输入模型名称' }]}
          >
            <Input placeholder="qwen-plus / qwen3.5-plus" autoComplete="off" />
          </Form.Item>

          <Form.Item
            name="llm_api_key"
            label="API Key"
            extra={
              <Space orientation="vertical" size={4}>
                <Text type="secondary">
                  {meta?.llm_api_key_set
                    ? `已设置${meta?.llm_api_key_last4 ? `（末 4 位：${meta.llm_api_key_last4}）` : ''}`
                    : '未设置，将降级使用 Cloudflare Workers AI（免费，Llama 模型）'}
                </Text>
                {meta?.llm_api_key_set && !editingKey && (
                  <Button type="link" onClick={() => setEditingKey(true)} style={{ padding: 0, height: 'auto' }}>
                    更换 API Key
                  </Button>
                )}
              </Space>
            }
            rules={[
              {
                validator: async (_, value) => {
                  const trimmed = (value || '').trim();
                  if (editingKey && !trimmed) throw new Error('请输入新的 API Key');
                },
              },
            ]}
          >
            <Input.Password
              placeholder={meta?.llm_api_key_set && !editingKey ? '已设置（不会回显）' : '输入后会覆盖当前 Key'}
              autoComplete="new-password"
              disabled={!!(meta?.llm_api_key_set && !editingKey)}
            />
          </Form.Item>
        </Form>
      </Card>

      {/* 提示词配置 */}
      <Card
        title="提示词模板"
        loading={promptLoading}
        extra={
          <Button icon={<ReloadOutlined />} onClick={fetchPromptConfigs}>刷新</Button>
        }
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          自定义各功能的 AI 提示词模板。修改后下次调用对应功能时生效。
        </Text>
        <Tabs activeKey={activePromptKey} onChange={setActivePromptKey} items={promptTabs} />
      </Card>
    </div>
  );
};

export default SystemSettingsPage;
