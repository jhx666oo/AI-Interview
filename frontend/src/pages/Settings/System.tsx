import React, { useEffect, useRef, useState } from 'react';
import { Button, Card, Form, Input, InputNumber, Space, Typography, message, Tag, Tabs, Tooltip } from 'antd';
import { SaveOutlined, ReloadOutlined, ApiOutlined, HolderOutlined, UpOutlined, DownOutlined } from '@ant-design/icons';
import request from '../../utils/request';
import { useAuth } from '../../contexts/AuthContext';
import { PageHeader, ResponsiveToolbar } from '../../components/Responsive';
import { DEFAULT_SCREENING_RULES, normalizeScreeningRules, type ScreeningRules } from '../../types/screeningRules';

const { Text } = Typography;

type SystemSettings = {
  llm_base_url?: string | null;
  llm_model?: string | null;
  llm_api_key_set?: boolean;
  llm_api_key_last4?: string | null;
  llm2_base_url?: string | null;
  llm2_model?: string | null;
  llm2_api_key_set?: boolean;
  llm2_api_key_last4?: string | null;
  llm3_base_url?: string | null;
  llm3_model?: string | null;
  llm3_api_key_set?: boolean;
  llm3_api_key_last4?: string | null;
  llm4_base_url?: string | null;
  llm4_model?: string | null;
  llm4_api_key_set?: boolean;
  llm4_api_key_last4?: string | null;
};

type LLMBlock = { prefix: string; title: string };

const LLM_BLOCKS: LLMBlock[] = [
  { prefix: 'llm', title: '配置 1' },
  { prefix: 'llm2', title: '配置 2' },
  { prefix: 'llm3', title: '配置 3' },
  { prefix: 'llm4', title: '配置 4' },
];

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
  const [editing, setEditing] = useState<Record<string, boolean>>({});
  const [testing, setTesting] = useState<string | null>(null);
  // 4 个 AI 配置槽位的展示顺序（llm → llm4 即优先级从高到低），拖拽后保存即生效
  const [order, setOrder] = useState<string[]>(['llm', 'llm2', 'llm3', 'llm4']);
  const dragFromRef = useRef<string | null>(null);
  const [screeningRules, setScreeningRules] = useState<ScreeningRules>({ ...DEFAULT_SCREENING_RULES });
  const [screeningRulesLoading, setScreeningRulesLoading] = useState(false);
  const [screeningRulesSaving, setScreeningRulesSaving] = useState(false);
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
      const values: any = {};
      for (const block of LLM_BLOCKS) {
        values[`${block.prefix}_base_url`] = res[`${block.prefix}_base_url`] || undefined;
        values[`${block.prefix}_model`] = res[`${block.prefix}_model`] || (block.prefix === 'llm' ? 'qwen3.5-plus' : undefined);
        values[`${block.prefix}_api_key`] = '';
      }
      form.setFieldsValue(values);
      setOrder(['llm', 'llm2', 'llm3', 'llm4']);
      setEditing({});
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

  const fetchScreeningRules = async () => {
    setScreeningRulesLoading(true);
    try {
      const res = await request.get('/settings/screening-rules') as { rules?: unknown };
      setScreeningRules(normalizeScreeningRules(res.rules));
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 403) message.error('无权限访问初筛条件');
      else message.error('获取初筛条件失败');
    } finally {
      setScreeningRulesLoading(false);
    }
  };

  useEffect(() => {
    if (role !== 'admin') return;
    fetchSettings();
    fetchScreeningRules();
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
      const payload: any = {};
      for (const block of LLM_BLOCKS) {
        const p = block.prefix;
        const baseUrl = ((values[`${p}_base_url`] as string) || '').trim();
        const model = ((values[`${p}_model`] as string) || '').trim();
        const apiKey = ((values[`${p}_api_key`] as string) || '').trim();
        payload[`${p}_base_url`] = baseUrl || null;
        payload[`${p}_model`] = model || null;
        if (apiKey) payload[`${p}_api_key`] = apiKey;
      }
      setSaving(true);
      await request.put('/settings/system', payload);
      const reset: any = {};
      for (const block of LLM_BLOCKS) reset[`${block.prefix}_api_key`] = '';
      form.setFieldsValue(reset);
      setEditing({});
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

  const handleTest = async (prefix: string) => {
    const blockIndex = LLM_BLOCKS.findIndex(b => b.prefix === prefix);
    const p = LLM_BLOCKS[blockIndex].prefix;
    const baseUrl = form.getFieldValue(`${p}_base_url`);
    const model = form.getFieldValue(`${p}_model`);
    const typedKey = ((form.getFieldValue(`${p}_api_key`) as string) || '').trim();
    const savedKeySet = !!meta?.[`${p}_api_key_set`];
    if (!typedKey && !savedKeySet) {
      message.warning(`请先填写「配置 ${blockIndex + 1}」的 API Key`);
      return;
    }
    setTesting(p);
    try {
      const payload: any = typedKey
        ? { base_url: baseUrl, model, api_key: typedKey }
        : { index: blockIndex };
      const res = (await request.post('/settings/system/test', payload)) as { ok?: boolean; message?: string };
      if (res.ok) message.success(res.message || '连接成功');
      else message.error(res.message || '连接失败');
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.response?.data?.detail || '测试失败，请检查配置');
    } finally {
      setTesting(null);
    }
  };

  // 拖拽 / 上下箭头交换两个槽位：连同表单值、meta（已设置/末4位）、编辑态一起交换，
  // 保存时按 llm→llm4 槽位写入 DB，即完成优先级调整
  const swapBlocks = (a: string, b: string) => {
    if (a === b) return;
    const fieldKeys = ['base_url', 'model', 'api_key'] as const;
    const values: Record<string, unknown> = {};
    for (const key of fieldKeys) {
      values[`${a}_${key}`] = form.getFieldValue(`${a}_${key}`);
      values[`${b}_${key}`] = form.getFieldValue(`${b}_${key}`);
    }
    const swapped: Record<string, unknown> = {};
    for (const key of fieldKeys) {
      swapped[`${a}_${key}`] = values[`${b}_${key}`];
      swapped[`${b}_${key}`] = values[`${a}_${key}`];
    }
    form.setFieldsValue(swapped);
    setMeta(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        [`${a}_api_key_set`]: prev[`${b}_api_key_set`],
        [`${b}_api_key_set`]: prev[`${a}_api_key_set`],
        [`${a}_api_key_last4`]: prev[`${b}_api_key_last4`],
        [`${b}_api_key_last4`]: prev[`${a}_api_key_last4`],
      };
    });
    setEditing(prev => {
      const next = { ...prev };
      next[a] = !!prev[b];
      next[b] = !!prev[a];
      return next;
    });
    setOrder(prev => {
      const next = [...prev];
      const ia = next.indexOf(a);
      const ib = next.indexOf(b);
      if (ia < 0 || ib < 0) return prev;
      [next[ia], next[ib]] = [next[ib], next[ia]];
      return next;
    });
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

  const handleSaveScreeningRules = async () => {
    setScreeningRulesSaving(true);
    try {
      await request.put('/settings/screening-rules', screeningRules);
      message.success('AI 初筛通过条件已保存');
      await fetchScreeningRules();
    } catch (e: any) {
      const status = e?.response?.status;
      if (status === 403) message.error('无权限保存初筛条件');
      else message.error(e?.response?.data?.detail || '保存初筛条件失败');
    } finally {
      setScreeningRulesSaving(false);
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
      <PageHeader title="系统设置" description="配置 AI 模型参数与提示词模板" />

      {/* 模型配置 */}
      <Card
        title="AI 模型配置"
        style={{ marginBottom: 24 }}
        loading={loading}
      >
        <ResponsiveToolbar
          actions={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={fetchSettings}>刷新</Button>
            <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>保存</Button>
          </Space>}
        >
          <span />
        </ResponsiveToolbar>
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          最多可配置 4 组模型，调用时按优先级从上到下依次尝试，上一组失败（超时 / 格式错误 / 空响应）后自动降级到下一组。拖动左侧手柄或使用 ↑↓ 箭头调整优先级，保存后立即生效。
        </Text>
        <Form form={form} layout="vertical" autoComplete="off">
          <input type="text" name="username" autoComplete="username" style={{ display: 'none' }} />
          <input type="password" name="password" autoComplete="current-password" style={{ display: 'none' }} />

          {order.map((prefix, idx) => {
            const block = LLM_BLOCKS.find(b => b.prefix === prefix) as LLMBlock;
            const p = block.prefix;
            const keySet = !!meta?.[`${p}_api_key_set`];
            const keyLast4 = meta?.[`${p}_api_key_last4`];
            const isEditing = !!editing[p];
            const title = `配置 ${idx + 1}`;
            return (
              <div
                key={p}
                style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: 16, marginBottom: 16, background: '#fafafa' }}
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragFromRef.current && dragFromRef.current !== p) swapBlocks(dragFromRef.current, p);
                  dragFromRef.current = null;
                }}
              >
                <Space style={{ marginBottom: 12 }} align="center" wrap>
                  <span
                    draggable
                    onDragStart={(e) => { dragFromRef.current = p; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', p); }}
                    onDragEnd={() => { dragFromRef.current = null; }}
                    style={{ cursor: 'grab', fontSize: 18, color: '#999', padding: '0 4px' }}
                    title="按住拖拽调整优先级"
                  >
                    <HolderOutlined />
                  </span>
                  <Button type="text" size="small" icon={<UpOutlined />} disabled={idx === 0} onClick={() => swapBlocks(p, order[idx - 1])} />
                  <Button type="text" size="small" icon={<DownOutlined />} disabled={idx === order.length - 1} onClick={() => swapBlocks(p, order[idx + 1])} />
                  <Text strong>
                    {title}
                    {idx === 0 ? '（首选）' : '（备用）'}
                  </Text>
                  <Text type="secondary">
                    {idx === 0 ? '调用 AI 时优先使用' : `${title} 失败后自动降级到本配置`}
                  </Text>
                </Space>

                <Form.Item name={`${p}_base_url`} label="Base URL" style={{ marginBottom: 12 }}>
                  <Input placeholder="https://api.deepseek.com/v1" autoComplete="off" />
                </Form.Item>

                <Form.Item
                  name={`${p}_model`}
                  label="模型名称"
                  rules={idx === 0 ? [{ required: true, message: '请输入模型名称' }] : []}
                >
                  <Input placeholder="deepseek-chat / qwen-plus" autoComplete="off" />
                </Form.Item>

                <Form.Item
                  name={`${p}_api_key`}
                  label="API Key"
                  extra={
                    <Text type="secondary">
                      {keySet
                        ? `已设置${keyLast4 ? `（末 4 位：${keyLast4}）` : ''}`
                        : (idx === 0 ? '未设置，将降级使用 Cloudflare Workers AI（免费，Llama 模型）' : '未设置，该配置不会被使用')}
                    </Text>
                  }
                  rules={[
                    {
                      validator: async (_, value) => {
                        const trimmed = ((value as string) || '').trim();
                        if (isEditing && !trimmed) throw new Error('请输入新的 API Key');
                      },
                    },
                  ]}
                >
                  <Input.Password
                    placeholder={keySet && !isEditing ? '已设置（不会回显）' : '输入后会覆盖当前 Key'}
                    autoComplete="new-password"
                    disabled={!!(keySet && !isEditing)}
                  />
                </Form.Item>

                <Space>
                  <Button onClick={() => handleTest(p)} loading={testing === p} icon={<ApiOutlined />}>
                    测试连通性
                  </Button>
                  {keySet && !isEditing && (
                    <Button
                      type="link"
                      onClick={() => setEditing(prev => ({ ...prev, [p]: true }))}
                      style={{ padding: 0, height: 'auto' }}
                    >
                      更换 API Key
                    </Button>
                  )}
                </Space>
              </div>
            );
          })}
        </Form>
      </Card>

      {/* AI 初筛阈值 */}
      <Card
        title="AI 初筛通过条件"
        style={{ marginBottom: 24 }}
        loading={screeningRulesLoading}
        extra={<Button type="primary" icon={<SaveOutlined />} onClick={handleSaveScreeningRules} loading={screeningRulesSaving}>保存条件</Button>}
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          三项条件必须同时满足才判定为“通过”。这里设置的是系统默认值；岗位编辑页可以为单个岗位单独覆盖。
        </Text>
        <Space wrap size={[24, 16]}>
          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>关键词匹配最低分</Text>
            <InputNumber
              min={0}
              max={5}
              step={1}
              precision={0}
              value={screeningRules.keyword_match_min_score}
              onChange={(value) => value !== null && setScreeningRules((current) => ({ ...current, keyword_match_min_score: value }))}
            />
          </div>
          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>避坑雷区最低分</Text>
            <InputNumber
              min={0}
              max={5}
              step={1}
              precision={0}
              value={screeningRules.red_flag_min_score}
              onChange={(value) => value !== null && setScreeningRules((current) => ({ ...current, red_flag_min_score: value }))}
            />
          </div>
          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>五项能力加权最低分</Text>
            <InputNumber
              min={0}
              max={5}
              step={0.1}
              precision={1}
              value={screeningRules.weighted_score_min}
              onChange={(value) => value !== null && setScreeningRules((current) => ({ ...current, weighted_score_min: value }))}
            />
          </div>
        </Space>
      </Card>

      {/* 提示词配置 */}
      <Card
        title="提示词模板"
        loading={promptLoading}
      >
        <ResponsiveToolbar actions={<Button icon={<ReloadOutlined />} onClick={fetchPromptConfigs}>刷新</Button>}>
          <span />
        </ResponsiveToolbar>
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          自定义各功能的 AI 提示词模板。修改后下次调用对应功能时生效。
        </Text>
        <Tabs activeKey={activePromptKey} onChange={setActivePromptKey} items={promptTabs} />
      </Card>
    </div>
  );
};

export default SystemSettingsPage;
