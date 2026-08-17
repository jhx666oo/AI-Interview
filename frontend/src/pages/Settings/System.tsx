import React, { useEffect, useState } from 'react';
import { Button, Card, Form, Input, InputNumber, Space, Typography, message, Tag, Tabs, Tooltip } from 'antd';
import { SaveOutlined, ReloadOutlined, ApiOutlined, PlusOutlined, DeleteOutlined, CaretRightOutlined } from '@ant-design/icons';
import request from '../../utils/request';
import { useAuth } from '../../contexts/AuthContext';
import { PageHeader, ResponsiveToolbar } from '../../components/Responsive';
import { DEFAULT_SCREENING_RULES, normalizeScreeningRules, type ScreeningRules } from '../../types/screeningRules';

const { Text } = Typography;

const LLM_SLOT_MAX = 20;

type LLMSlot = {
  id?: string;
  baseUrl?: string | null;
  model?: string | null;
  apiKey?: string | null;
  apiKeySet?: boolean;
  apiKeyLast4?: string | null;
};

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
  llm_slots?: LLMSlot[];
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
  generate_capability_dimensions: '评分维度生成',
  parse_resume_pdf: 'PDF简历解析',
  generate_resume_markdown: '简历 Markdown 生成',
  generate_daily_report: '招聘日报生成',
  resume_extract_fields: '简历字段提取',
  resume_screening: '简历初筛',
  resume_screening_supplement: '简历初筛补充评分',
  resume_custom_screen: '自定义筛选',
};

const SystemSettingsPage: React.FC = () => {
  const { user } = useAuth();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [meta, setMeta] = useState<SystemSettings | null>(null);
  const [dirty, setDirty] = useState(false);
  const [testing, setTesting] = useState<number | null>(null);
  const [slots, setSlots] = useState<LLMSlot[]>([]);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [dragging, setDragging] = useState<number | null>(null);
  const [editing, setEditing] = useState<Record<number, boolean>>({});
  const [screeningRules, setScreeningRules] = useState<ScreeningRules>({ ...DEFAULT_SCREENING_RULES });
  const [screeningRulesLoading, setScreeningRulesLoading] = useState(false);
  const [screeningRulesSaving, setScreeningRulesSaving] = useState(false);
  const role = (user as any)?.role?.value ?? (user as any)?.role;

  const [promptLoading, setPromptLoading] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptConfigs, setPromptConfigs] = useState<PromptConfigs | null>(null);
  const [activePromptKey, setActivePromptKey] = useState('generate_jd');
  const [promptForm] = Form.useForm();
  const [promptVariables, setPromptVariables] = useState<PromptVariablesResponse | null>(null);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const res = (await request.get('/settings/system')) as SystemSettings;
      setMeta(res);
      const rawSlots = Array.isArray(res.llm_slots) && res.llm_slots.length > 0 ? res.llm_slots : null;
      const initSlots: LLMSlot[] = rawSlots || [
        { baseUrl: res.llm_base_url, model: res.llm_model || 'qwen3.5-plus', apiKeySet: !!res.llm_api_key_set, apiKeyLast4: res.llm_api_key_last4 },
        ...(res.llm2_api_key_set ? [{ baseUrl: res.llm2_base_url, model: res.llm2_model, apiKeySet: true, apiKeyLast4: res.llm2_api_key_last4 }] : []),
        ...(res.llm3_api_key_set ? [{ baseUrl: res.llm3_base_url, model: res.llm3_model, apiKeySet: true, apiKeyLast4: res.llm3_api_key_last4 }] : []),
        ...(res.llm4_api_key_set ? [{ baseUrl: res.llm4_base_url, model: res.llm4_model, apiKeySet: true, apiKeyLast4: res.llm4_api_key_last4 }] : []),
      ].filter(Boolean);
      setSlots(initSlots.map(s => ({ ...s, apiKey: '' })));
      setEditing({});
      setDirty(false);
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
        promptForm.setFieldsValue({ system: currentPrompt.system, user: currentPrompt.user });
      }
    } catch { /* ignore */ }
    finally { setPromptLoading(false); }
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
    } finally { setScreeningRulesLoading(false); }
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

  const addSlot = () => { if (slots.length < LLM_SLOT_MAX) setSlots(prev => [...prev, { baseUrl: '', model: '', apiKey: '' }]); };
  const removeSlot = (idx: number) => { setSlots(prev => prev.filter((_, i) => i !== idx)); setEditing(prev => { const n = { ...prev }; delete n[idx]; return n; }); setDirty(true); };
  const moveSlot = (from: number, to: number) => {
    setSlots(prev => { const next = [...prev]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next; });
    setDirty(true);
  };
  const toggleEdit = (idx: number) => { setEditing(prev => ({ ...prev, [idx]: !prev[idx] })); };
  const toggleExpand = (idx: number) => setExpanded(prev => ({ ...prev, [idx]: !prev[idx] }));
  const handleSlotChange = (idx: number, field: keyof LLMSlot, value: any) => {
    setSlots(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
    setDirty(true);
  };

  const handleSave = async () => {
    try {
      // 已保存的槽位（apiKeySet=true 或带 id，未重填 key）必须随请求一起提交，后端会沿用原 key；
      // 只剔除「既未保存过、也没填 key」的空配置，避免已有模型被覆盖掉
      const slotsPayload = slots.map(s => ({
        id: s.id || undefined,
        baseUrl: (s.baseUrl || '').trim() || null,
        model: (s.model || '').trim() || null,
        apiKey: (s.apiKey || '').trim(),
      }));
      const keep = slotsPayload.filter((s, i) => s.apiKey || s.id || !!slots[i]?.apiKeySet);

      // 前端去重提示：相同的 baseUrl+model+key 视为重复（后端同样会去重）
      const seen = new Set<string>();
      let dupCount = 0;
      for (const s of keep) {
        if (!s.apiKey) continue;
        const dedupeKey = `${s.baseUrl || ''}\u0000${s.model || ''}\u0000${s.apiKey}`;
        if (seen.has(dedupeKey)) dupCount++;
        seen.add(dedupeKey);
      }

      const payload: any = { llm_slots: keep };
      setSaving(true);
      await request.put('/settings/system', payload);
      setDirty(false);
      await fetchSettings();
      message.success(dupCount > 0 ? `模型配置已保存（已自动去重 ${dupCount} 条重复配置）` : '模型配置已保存');
    } catch (e) {
      const status = (e as any)?.response?.status;
      if (status === 403) message.error('无权限保存');
      else if (status === 400) message.error((e as any)?.response?.data?.detail || '参数不合法');
      else message.error('保存失败');
    } finally { setSaving(false); }
  };

  const handleTest = async (idx: number) => {
    const slot = slots[idx];
    if (!slot) return;
    const baseUrl = slot.baseUrl || '';
    const model = slot.model || '';
    const typedKey = (slot.apiKey || '').trim();
    const savedKeySet = !!slot.apiKeySet;
    if (!typedKey && !savedKeySet) { message.warning(`请先填写「配置 ${idx + 1}」的 API Key`); return; }
    setTesting(idx);
    try {
      const payload: any = typedKey ? { base_url: baseUrl, model, api_key: typedKey } : { index: idx };
      const res = (await request.post('/settings/system/test', payload)) as { ok?: boolean; message?: string };
      if (res.ok) message.success(res.message || '连接成功');
      else message.error(res.message || '连接失败');
    } catch (e: any) {
      message.error(e?.response?.data?.message || e?.response?.data?.detail || '测试失败，请检查配置');
    } finally { setTesting(null); }
  };

  const handleSavePrompt = async () => {
    try {
      const values = await promptForm.validateFields();
      setPromptSaving(true);
      await request.put('/settings/prompts/' + activePromptKey, { system: values.system, user: values.user });
      message.success('提示词已保存');
      await fetchPromptConfigs();
    } catch (e: any) { if (e.errorFields) return; message.error('保存提示词失败'); }
    finally { setPromptSaving(false); }
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
    } finally { setScreeningRulesSaving(false); }
  };

  const handleInsertVariable = (variableName: string) => {
    const variableText = `{${variableName}}`;
    const currentValue = promptForm.getFieldValue('user') || '';
    promptForm.setFieldsValue({ user: currentValue + variableText });
  };

  if (role !== 'admin') {
    return (<div style={{ padding: 40, textAlign: 'center' }}><Text type="secondary">仅管理员可查看系统设置</Text></div>);
  }

  const promptTabs = promptConfigs ? Object.keys(promptConfigs.prompts).map(key => ({
    key,
    label: promptNames[key] || key,
    children: (
      <Form form={promptForm} layout="vertical" autoComplete="off" key={key}>
        <Form.Item name="system" label="System Prompt" rules={[{ required: true, message: '请输入 System Prompt' }]}>
          <Input.TextArea rows={4} placeholder="系统提示词，定义 AI 的角色和行为" />
        </Form.Item>
        <Form.Item name="user" label="User Prompt" rules={[{ required: true, message: '请输入 User Prompt' }]}>
          <Input.TextArea rows={10} placeholder="用户提示词模板，包含具体任务指令" />
        </Form.Item>
        {promptVariables?.variables_by_prompt[key] && (
          <div style={{ marginBottom: 16 }}>
            <Text strong style={{ marginRight: 8 }}>可用变量：</Text>
            <div style={{ marginTop: 8 }}>
              {promptVariables.variables_by_prompt[key].map(variable => (
                <Tooltip key={variable.name} title={variable.description}>
                  <Tag color="blue" style={{ cursor: 'pointer', marginBottom: 4 }} onClick={() => handleInsertVariable(variable.name)}>{`{${variable.name}}`}</Tag>
                </Tooltip>
              ))}
            </div>
          </div>
        )}
        <Button type="primary" onClick={handleSavePrompt} loading={promptSaving}>保存提示词</Button>
      </Form>
    ),
  })) : [];

  return (
    <div>
      <PageHeader title="系统设置" description="配置 AI 模型参数与提示词模板" />

      {/* AI 模型配置 */}
      <Card title="AI 模型配置" style={{ marginBottom: 24 }} loading={loading}>
        <ResponsiveToolbar actions={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={fetchSettings}>刷新</Button>
            <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>保存</Button>
          </Space>
        }>
          <span />
        </ResponsiveToolbar>
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          最多可配置 {LLM_SLOT_MAX} 组模型，调用时按优先级从上到下依次尝试，上一组失败（超时 / 格式错误 / 空响应）后自动降级到下一组。拖拽左侧手柄调整优先级，保存后立即生效。
        </Text>
        <Button type="dashed" icon={<PlusOutlined />} onClick={addSlot} disabled={slots.length >= LLM_SLOT_MAX} style={{ width: '100%', marginBottom: 16 }}>
          添加模型配置（当前 {slots.length} / {LLM_SLOT_MAX}）
        </Button>
        {slots.map((slot, idx) => {
          const isEditing = !!editing[idx];
          const keySet = !!slot.apiKeySet;
          const keyLast4 = slot.apiKeyLast4;
          const isExpanded = !!expanded[idx];
          return (
            <div
              key={`slot-${idx}`}
              draggable
              onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(idx)); setDragging(idx); }}
              onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
              onDragEnd={() => setDragging(null)}
              onDrop={e => {
                e.preventDefault();
                const from = parseInt(e.dataTransfer.getData('text/plain'));
                const to = idx;
                if (!isNaN(from) && from !== to) moveSlot(from, to);
                setDragging(null);
              }}
              style={{
                border: '1px solid #d9d9d9',
                borderRadius: 8,
                marginBottom: 8,
                backgroundColor: dragging === idx ? '#e6f4ff' : '#fafafa',
                transition: 'background-color 0.2s',
                boxShadow: dragging === idx ? '0 2px 8px rgba(0,0,0,0.15)' : 'none',
              }}
            >
              {/* 标题栏 */}
              <div
                onClick={() => toggleExpand(idx)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', cursor: 'pointer', borderBottom: isExpanded ? '1px solid #f0f0f0' : 'none' }}
              >
                <Space>
                  <span style={{ fontSize: 16, color: '#999', cursor: 'grab', userSelect: 'none', lineHeight: 1 }}>⠿</span>
                  <CaretRightOutlined style={{ fontSize: 10, color: '#bbb', transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
                  <Text strong>配置 {idx + 1} {idx === 0 ? '（首选）' : '（备用）'}</Text>
                  {slot.model && <Tag color="blue">{slot.model}</Tag>}
                  {slot.baseUrl && <Tag color="default">{String(slot.baseUrl).replace(/^https?:\/\//, '').split('/')[0]}</Tag>}
                </Space>
                <Space>
                  <Text type="secondary" style={{ fontSize: 12 }}>{idx === 0 ? '调用 AI 时优先使用' : '上一组失败后自动降级'}</Text>
                  <Button type="text" size="small" icon={<DeleteOutlined />} danger disabled={slots.length <= 1}
                    onClick={e => { e.stopPropagation(); removeSlot(idx); }} title="删除此配置" />
                </Space>
              </div>
              {/* 内容区 */}
              {isExpanded && (
                <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {keyLast4 && <Text type="secondary" style={{ fontSize: 12 }}>末 4 位：{keyLast4}</Text>}
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ flex: '1 1 300px' }}>
                      <Text strong style={{ fontSize: 12 }}>Base URL</Text>
                      <Input value={slot.baseUrl || ''} placeholder="https://api.deepseek.com/v1" autoComplete="off"
                        onChange={e => handleSlotChange(idx, 'baseUrl', e.target.value)} style={{ marginTop: 4 }} />
                    </div>
                    <div style={{ flex: '1 1 200px' }}>
                      <Text strong style={{ fontSize: 12 }}>模型名称</Text>
                      <Input value={slot.model || ''} placeholder="deepseek-chat / qwen-plus" autoComplete="off"
                        onChange={e => handleSlotChange(idx, 'model', e.target.value)} style={{ marginTop: 4 }} />
                    </div>
                  </div>
                  <div>
                    <Text strong style={{ fontSize: 12 }}>API Key</Text>
                    <Input.Password value={slot.apiKey || ''}
                      placeholder={keySet && !isEditing ? '已设置（不会回显）' : '输入后会覆盖当前 Key'}
                      autoComplete="new-password" disabled={!!(keySet && !isEditing)}
                      onChange={e => handleSlotChange(idx, 'apiKey', e.target.value)} style={{ marginTop: 4 }} />
                    {keySet && !isEditing && (
                      <Button type="link" size="small" style={{ padding: 0, height: 'auto', fontSize: 12 }}
                        onClick={() => toggleEdit(idx)}>更换 API Key</Button>
                    )}
                    {isEditing && !slot.apiKey?.trim() && <Text type="danger" style={{ fontSize: 12 }}>请输入新的 API Key</Text>}
                  </div>
                  <Button onClick={() => handleTest(idx)} loading={testing === idx} icon={<ApiOutlined />} size="small">测试连通性</Button>
                </div>
              )}
            </div>
          );
        })}
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginTop: 8 }}>
          {dirty && <Text type="warning">有未保存的修改，请点保存</Text>}
          <Button icon={<ReloadOutlined />} onClick={fetchSettings}>放弃修改</Button>
          <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>保存模型配置</Button>
        </div>
      </Card>

      {/* AI 初筛阈值 */}
      <Card title="AI 初筛通过条件" style={{ marginBottom: 24 }} loading={screeningRulesLoading}
        extra={<Button type="primary" icon={<SaveOutlined />} onClick={handleSaveScreeningRules} loading={screeningRulesSaving}>保存条件</Button>}>
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          三项条件必须同时满足才判定为"通过"。这里设置的是系统默认值；岗位编辑页可以为单个岗位单独覆盖。
        </Text>
        <Space wrap size={[24, 16]}>
          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>关键词匹配最低分</Text>
            <InputNumber min={0} max={5} step={1} precision={0}
              value={screeningRules.keyword_match_min_score}
              onChange={(value) => value !== null && setScreeningRules((current) => ({ ...current, keyword_match_min_score: value }))} />
          </div>
          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>避坑雷区最低分</Text>
            <InputNumber min={0} max={5} step={1} precision={0}
              value={screeningRules.red_flag_min_score}
              onChange={(value) => value !== null && setScreeningRules((current) => ({ ...current, red_flag_min_score: value }))} />
          </div>
          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>五项能力加权最低分</Text>
            <InputNumber min={0} max={5} step={0.1} precision={1}
              value={screeningRules.weighted_score_min}
              onChange={(value) => value !== null && setScreeningRules((current) => ({ ...current, weighted_score_min: value }))} />
          </div>
        </Space>
      </Card>

      {/* 提示词配置 */}
      <Card title="提示词模板" loading={promptLoading}>
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
