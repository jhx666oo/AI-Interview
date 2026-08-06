import React, { useEffect, useState, useCallback } from 'react';
import {
  Button, Card, Divider, Form, Input, InputNumber, Space, Switch, Typography, message,
  Modal, Table, Tag, Tooltip, Checkbox, Select, Row, Col, Spin, Empty, Alert,
  Statistic,
} from 'antd';
import {
  SaveOutlined, ReloadOutlined, PlusOutlined, DeleteOutlined, EditOutlined,
  ThunderboltOutlined, LoadingOutlined, CheckCircleOutlined, CloseCircleOutlined,
  SyncOutlined, MailOutlined, KeyOutlined, SettingOutlined, HistoryOutlined,
} from '@ant-design/icons';
import request from '../../utils/request';
import { useAuth } from '../../contexts/AuthContext';

const { Title, Text } = Typography;

type MailSyncConfig = {
  id: string;
  imapHost: string;
  imapPort: number;
  emailAccount: string;
  hasPassword: boolean;
  scanMinutes: number;
  defaultPositionId: string | null;
  enabled: boolean;
  updatedAt: string | null;
};

type SyncLogItem = {
  id: string;
  emailId: string;
  subject: string;
  candidateName: string;
  attachmentFilename: string;
  status: 'success' | 'failed' | 'processing';
  errorMessage: string | null;
  resumeId: string | null;
  configId: string | null;
  emailAccount: string;
  processedAt: string;
};

type MailSyncStats = {
  lastScanAt: string | null;
  successCount: number;
  failedCount: number;
  totalCount: number;
};

const MailSettingsPage: React.FC = () => {
  const { user } = useAuth();
  const role = (user as any)?.role?.value ?? (user as any)?.role;

  const [smtpForm] = Form.useForm();
  const [configForm] = Form.useForm();

  // SMTP 状态
  const [smtpLoading, setSmtpLoading] = useState(false);
  const [smtpSaving, setSmtpSaving] = useState(false);
  const [smtpMeta, setSmtpMeta] = useState<any>(null);
  const [editingPassword, setEditingPassword] = useState(false);

  // 邮箱同步状态
  const [configs, setConfigs] = useState<MailSyncConfig[]>([]);
  const [configsLoading, setConfigsLoading] = useState(false);
  const [selectedConfigIds, setSelectedConfigIds] = useState<string[]>([]);
  const [syncingIds, setSyncingIds] = useState<Set<string>>(new Set());
  const [scanStatuses, setScanStatuses] = useState<Record<string, any>>({});

  // 添加/编辑配置弹窗
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<MailSyncConfig | null>(null);
  const [configSaving, setConfigSaving] = useState(false);

  // 同步日志
  const [logs, setLogs] = useState<SyncLogItem[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsStats, setLogsStats] = useState<MailSyncStats | null>(null);
  const [logConfigFilter, setLogConfigFilter] = useState<string>('');

  // 轮询定时器
  const [pollingTimers, setPollingTimers] = useState<Record<string, any>>({});

  // ===== SMTP 配置 =====
  const fetchSmtpSettings = async () => {
    setSmtpLoading(true);
    try {
      const res = await request.get('/settings/mail') as any;
      setSmtpMeta(res);
      smtpForm.setFieldsValue({
        smtp_host: res.smtp_host || undefined,
        smtp_port: res.smtp_port ?? 465,
        smtp_username: res.smtp_username || undefined,
        mail_from: res.mail_from || undefined,
        mail_from_name: res.mail_from_name || '招聘系统',
        mail_enabled: res.mail_enabled ?? false,
        frontend_url: res.frontend_url || undefined,
        smtp_password: '',
      });
      setEditingPassword(false);
    } catch { message.error('获取邮件设置失败'); }
    finally { setSmtpLoading(false); }
  };

  const handleSaveSmtp = async () => {
    try {
      const values = await smtpForm.validateFields();
      const payload: any = {
        smtp_host: values.smtp_host || null,
        smtp_port: values.smtp_port || 465,
        smtp_username: values.smtp_username || null,
        mail_from: values.mail_from || null,
        mail_from_name: values.mail_from_name || '招聘系统',
        mail_enabled: values.mail_enabled || false,
        frontend_url: values.frontend_url || null,
      };
      if (values.smtp_password && values.smtp_password.trim()) {
        payload.smtp_password = values.smtp_password.trim();
      }
      setSmtpSaving(true);
      await request.put('/settings/mail', payload);
      smtpForm.setFieldsValue({ smtp_password: '' });
      await fetchSmtpSettings();
      message.success('邮件配置已保存');
    } catch (e: any) {
      message.error('保存失败: ' + (e.response?.data?.detail || e.message));
    } finally { setSmtpSaving(false); }
  };

  // ===== 邮箱同步配置 =====
  const fetchConfigs = useCallback(async () => {
    setConfigsLoading(true);
    try {
      const res = await request.get('/settings/mail/sync') as MailSyncConfig[];
      setConfigs(Array.isArray(res) ? res : []);
    } catch { message.error('获取邮箱配置失败'); }
    finally { setConfigsLoading(false); }
  }, []);

  const fetchLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      let path = '/mail/sync/logs?page=1&pageSize=20';
      if (logConfigFilter) path += '&configId=' + logConfigFilter;
      const res = await request.get(path) as any;
      setLogs(res.items || []);
    } catch {}
    finally { setLogsLoading(false); }
  }, [logConfigFilter]);

  const fetchLogsStats = useCallback(async () => {
    try {
      let path = '/mail/sync/logs/stats';
      if (logConfigFilter) path += '?configId=' + logConfigFilter;
      const res = await request.get(path) as MailSyncStats;
      setLogsStats(res);
    } catch {}
  }, [logConfigFilter]);

  useEffect(() => {
    if (role !== 'admin') return;
    fetchSmtpSettings();
    fetchConfigs();
    fetchLogs();
    fetchLogsStats();
  }, [role]);

  // 轮询扫描进度
  const startPolling = (configId: string) => {
    if (pollingTimers[configId]) return;
    const timer = setInterval(async () => {
      try {
        const res = await request.get('/mail/sync/status/' + configId) as any;
        setScanStatuses(prev => ({ ...prev, [configId]: res }));
        if (res.status === 'completed' || res.status === 'failed') {
          clearInterval(timer);
          setPollingTimers(prev => { const n = { ...prev }; delete n[configId]; return n; });
          setSyncingIds(prev => { const n = new Set(prev); n.delete(configId); return n; });
          // 刷新日志和统计
          fetchLogs();
          fetchLogsStats();
          fetchConfigs();
          if (res.status === 'completed') {
            message.success('邮箱同步完成: 找到 ' + res.emailsFound + ' 封邮件，成功 ' + res.successCount + ' 份');
          } else if (res.errorMessage) {
            message.error('同步失败: ' + res.errorMessage);
          }
        }
      } catch {}
    }, 3000);
    setPollingTimers(prev => ({ ...prev, [configId]: timer }));
  };

  // 触发同步
  const handleTriggerSync = async (configId?: string) => {
    const ids = configId ? [configId] : selectedConfigIds;
    if (ids.length === 0) { message.warning('请先选择要同步的邮箱'); return; }

    for (const id of ids) {
      setSyncingIds(prev => new Set(prev).add(id));
    }
    try {
      const res = await request.post('/mail/sync/trigger', { configIds: ids }) as any;
      if (res.results) {
        for (const r of res.results) {
          startPolling(r.configId);
        }
      }
    } catch (e: any) {
      message.error('触发同步失败: ' + (e.response?.data?.detail || e.message));
      for (const id of ids) {
        setSyncingIds(prev => { const n = new Set(prev); n.delete(id); return n; });
      }
    }
  };

  // 打开添加配置弹窗
  const handleOpenAdd = () => {
    setEditingConfig(null);
    configForm.resetFields();
    configForm.setFieldsValue({ imapHost: 'imap.feishu.cn', imapPort: 993, scanMinutes: 30 });
    setConfigModalOpen(true);
  };

  // 打开编辑配置弹窗
  const handleOpenEdit = (config: MailSyncConfig) => {
    setEditingConfig(config);
    configForm.setFieldsValue({
      emailAccount: config.emailAccount,
      imapHost: config.imapHost,
      imapPort: config.imapPort,
      scanMinutes: config.scanMinutes,
      defaultPositionId: config.defaultPositionId || '',
      password: '',
    });
    setConfigModalOpen(true);
  };

  // 保存配置
  const handleSaveConfig = async () => {
    try {
      const values = await configForm.validateFields();
      setConfigSaving(true);
      const payload = {
        emailAccount: values.emailAccount,
        password: values.password || undefined,
        imapHost: values.imapHost,
        imapPort: values.imapPort,
        scanMinutes: values.scanMinutes,
        defaultPositionId: values.defaultPositionId || undefined,
      };

      if (editingConfig) {
        await request.put('/settings/mail/sync/' + editingConfig.id, payload);
        message.success('邮箱配置已更新');
      } else {
        await request.post('/settings/mail/sync', payload);
        message.success('邮箱配置已添加');
      }
      setConfigModalOpen(false);
      fetchConfigs();
    } catch (e: any) {
      if (e.errorFields) return;
      message.error('保存失败: ' + (e.response?.data?.detail || e.message));
    } finally { setConfigSaving(false); }
  };

  // 删除配置
  const handleDeleteConfig = (config: MailSyncConfig) => {
    Modal.confirm({
      title: '删除邮箱配置',
      content: `确定删除 ${config.emailAccount} 的配置吗？`,
      onOk: async () => {
        try {
          await request.delete('/settings/mail/sync/' + config.id);
          message.success('已删除');
          fetchConfigs();
        } catch (e: any) {
          message.error('删除失败: ' + (e.response?.data?.detail || e.message));
        }
      },
    });
  };

  // 测试连接
  const handleTestConnection = async (config: MailSyncConfig) => {
    try {
      const res = await request.post('/mail/sync/test', { configId: config.id }) as any;
      if (res.success) {
        message.success('连接成功: ' + (res.message || ''));
      } else {
        message.warning('连接失败: ' + (res.message || ''));
      }
    } catch (e: any) {
      message.error('测试失败: ' + (e.response?.data?.detail || e.message));
    }
  };

  // 重试失败
  const handleRetryFailed = async (configId?: string) => {
    try {
      const id = configId || logConfigFilter;
      if (!id) { message.warning('请先选择一个邮箱'); return; }
      const res = await request.post('/mail/sync/retry-failed', { configId: id }) as any;
      message.success('已重试 ' + (res.retryCount || 0) + ' 条失败记录');
      fetchLogs();
    } catch (e: any) {
      message.error('重试失败: ' + (e.response?.data?.detail || e.message));
    }
  };

  // 清理定时器
  useEffect(() => {
    return () => {
      for (const timer of Object.values(pollingTimers)) {
        clearInterval(timer as any);
      }
    };
  }, [pollingTimers]);

  if (role !== 'admin') {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Text type="secondary">仅管理员可查看邮件设置</Text>
      </div>
    );
  }

  const statusColor = (status: string) => {
    switch (status) {
      case 'success': return 'green';
      case 'failed': return 'red';
      case 'processing': return 'blue';
      default: return 'default';
    }
  };

  const statusText = (status: string) => {
    switch (status) {
      case 'success': return '成功';
      case 'failed': return '失败';
      case 'processing': return '处理中';
      default: return status;
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <Title level={2} style={{ margin: 0 }}>邮件设置</Title>
        <Text type="secondary">配置 SMTP 邮件服务与邮箱简历同步</Text>
      </div>

      {/* SMTP 配置 */}
      <Card
        title="SMTP 配置"
        style={{ marginBottom: 24 }}
        loading={smtpLoading}
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={fetchSmtpSettings}>刷新</Button>
            <Button type="primary" icon={<SaveOutlined />} onClick={handleSaveSmtp} loading={smtpSaving}>保存</Button>
          </Space>
        }
      >
        <Form form={smtpForm} layout="vertical" autoComplete="off">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="smtp_host" label="SMTP 主机">
                <Input placeholder="smtp.example.com" autoComplete="off" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="smtp_port" label="SMTP 端口">
                <InputNumber min={1} max={65535} style={{ width: '100%' }} placeholder="465" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="smtp_username" label="SMTP 用户名">
                <Input placeholder="noreply@example.com" autoComplete="off" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                name="smtp_password"
                label="SMTP 密码"
                extra={
                  smtpMeta?.smtp_password_set && !editingPassword ? (
                    <Button type="link" onClick={() => setEditingPassword(true)} style={{ padding: 0, height: 'auto' }}>
                      更换密码
                    </Button>
                  ) : null
                }
              >
                <Input.Password
                  placeholder={smtpMeta?.smtp_password_set && !editingPassword ? '已设置（不会回显）' : '输入后会覆盖当前密码'}
                  autoComplete="new-password"
                  disabled={!!(smtpMeta?.smtp_password_set && !editingPassword)}
                />
              </Form.Item>
            </Col>
          </Row>
          <Divider />
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="mail_from" label="发件人地址">
                <Input placeholder="noreply@example.com" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="mail_from_name" label="发件人名称">
                <Input placeholder="招聘系统" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="frontend_url" label="前端地址">
            <Input placeholder="https://your-app.com" />
          </Form.Item>
          <Form.Item name="mail_enabled" label="启用邮件服务" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Card>

      {/* 邮箱简历同步 */}
      <Card
        title={
          <Space>
            <MailOutlined />
            <span>邮箱简历同步</span>
          </Space>
        }
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={() => { fetchConfigs(); fetchLogs(); fetchLogsStats(); }}>刷新</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleOpenAdd}>添加邮箱</Button>
          </Space>
        }
      >
        {/* 统计信息 */}
        {logsStats && (
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col span={6}>
              <Card size="small">
                <Statistic title="总同步次数" value={logsStats.totalCount} prefix={<SyncOutlined />} />
              </Card>
            </Col>
            <Col span={6}>
              <Card size="small">
                <Statistic title="成功" value={logsStats.successCount} valueStyle={{ color: '#52c41a' }} prefix={<CheckCircleOutlined />} />
              </Card>
            </Col>
            <Col span={6}>
              <Card size="small">
                <Statistic title="失败" value={logsStats.failedCount} valueStyle={{ color: '#ff4d4f' }} prefix={<CloseCircleOutlined />} />
              </Card>
            </Col>
            <Col span={6}>
              <Card size="small">
                <Statistic title="上次同步" value={logsStats.lastScanAt ? new Date(logsStats.lastScanAt).toLocaleString('zh-CN') : '无'} />
              </Card>
            </Col>
          </Row>
        )}

        {/* 邮箱配置列表 */}
        <div style={{ marginBottom: 16 }}>
          <Text strong style={{ fontSize: 15 }}>已配置邮箱</Text>
        </div>

        {configsLoading ? (
          <div style={{ textAlign: 'center', padding: 24 }}><Spin tip="加载中..." /></div>
        ) : configs.length === 0 ? (
          <Empty description="暂无邮箱配置，点击「添加邮箱」开始配置" />
        ) : (
          <div>
            {configs.map(config => {
              const isSyncing = syncingIds.has(config.id);
              const scanStatus = scanStatuses[config.id];
              return (
                <Card
                  key={config.id}
                  size="small"
                  style={{ marginBottom: 8, borderLeft: config.enabled ? '3px solid #52c41a' : '3px solid #d9d9d9' }}
                >
                  <Row align="middle" gutter={16}>
                    <Col span={1}>
                      <Checkbox
                        checked={selectedConfigIds.includes(config.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedConfigIds([...selectedConfigIds, config.id]);
                          } else {
                            setSelectedConfigIds(selectedConfigIds.filter(id => id !== config.id));
                          }
                        }}
                      />
                    </Col>
                    <Col span={5}>
                      <Space>
                        <MailOutlined />
                        <Text strong>{config.emailAccount}</Text>
                      </Space>
                    </Col>
                    <Col span={3}>
                      <Tag color={config.enabled ? 'green' : 'default'}>
                        {config.enabled ? '已启用' : '已停用'}
                      </Tag>
                      {config.hasPassword ? (
                        <Tag color="blue" style={{ marginLeft: 4 }}>已配置密码</Tag>
                      ) : (
                        <Tag color="warning" style={{ marginLeft: 4 }}>未配置密码</Tag>
                      )}
                    </Col>
                    <Col span={4}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        IMAP: {config.imapHost}:{config.imapPort}
                      </Text>
                    </Col>
                    <Col span={3}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        扫描间隔: {config.scanMinutes}分钟
                      </Text>
                    </Col>
                    <Col span={3}>
                      {isSyncing ? (
                        <Space>
                          <LoadingOutlined />
                          <Text type="secondary">扫描中...</Text>
                        </Space>
                      ) : scanStatus ? (
                        <Text type="secondary">
                          上次: {scanStatus.successCount}/{scanStatus.emailsFound} 份
                        </Text>
                      ) : config.updatedAt ? (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          更新: {new Date(config.updatedAt).toLocaleString('zh-CN')}
                        </Text>
                      ) : null}
                    </Col>
                    <Col span={5}>
                      <Space size="small">
                        <Button
                          size="small"
                          type="primary"
                          icon={<ThunderboltOutlined />}
                          loading={isSyncing}
                          onClick={() => handleTriggerSync(config.id)}
                        >
                          同步
                        </Button>
                        <Tooltip title="测试连接">
                          <Button size="small" icon={<SyncOutlined />} onClick={() => handleTestConnection(config)} />
                        </Tooltip>
                        <Tooltip title="编辑">
                          <Button size="small" icon={<EditOutlined />} onClick={() => handleOpenEdit(config)} />
                        </Tooltip>
                        <Tooltip title="删除">
                          <Button size="small" danger icon={<DeleteOutlined />} onClick={() => handleDeleteConfig(config)} />
                        </Tooltip>
                      </Space>
                    </Col>
                  </Row>
                </Card>
              );
            })}
          </div>
        )}

        {/* 批量操作 */}
        <div style={{ marginTop: 12, marginBottom: 16 }}>
          <Space>
            <Button
              type="primary"
              icon={<ThunderboltOutlined />}
              onClick={() => handleTriggerSync()}
              disabled={selectedConfigIds.length === 0}
            >
              同步选中邮箱 ({selectedConfigIds.length})
            </Button>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => handleRetryFailed()}
              disabled={!logConfigFilter}
            >
              重试失败记录
            </Button>
          </Space>
        </div>

        <Divider />

        {/* 同步日志 */}
        <div style={{ marginBottom: 12 }}>
          <Space style={{ marginBottom: 12 }}>
            <Text strong style={{ fontSize: 15 }}>同步记录</Text>
            <Select
              style={{ width: 280 }}
              placeholder="筛选邮箱"
              allowClear
              value={logConfigFilter || undefined}
              onChange={(val) => { setLogConfigFilter(val || ''); }}
              options={configs.map(c => ({ value: c.id, label: c.emailAccount }))}
            />
          </Space>
        </div>

        {logsLoading ? (
          <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
        ) : logs.length === 0 ? (
          <Empty description="暂无同步记录" />
        ) : (
          <Table
            dataSource={logs}
            rowKey="id"
            size="small"
            pagination={false}
            columns={[
              {
                title: '时间',
                dataIndex: 'processedAt',
                key: 'processedAt',
                width: 160,
                render: (v: string) => v ? new Date(v).toLocaleString('zh-CN') : '-',
              },
              {
                title: '邮箱',
                dataIndex: 'emailAccount',
                key: 'emailAccount',
                width: 200,
              },
              {
                title: '候选人',
                dataIndex: 'candidateName',
                key: 'candidateName',
                width: 120,
              },
              {
                title: '邮件主题',
                dataIndex: 'subject',
                key: 'subject',
                ellipsis: true,
              },
              {
                title: '附件',
                dataIndex: 'attachmentFilename',
                key: 'attachmentFilename',
                width: 150,
                ellipsis: true,
              },
              {
                title: '状态',
                dataIndex: 'status',
                key: 'status',
                width: 80,
                render: (v: string) => (
                  <Tag color={statusColor(v)}>{statusText(v)}</Tag>
                ),
              },
              {
                title: '操作',
                key: 'action',
                width: 100,
                render: (_: any, record: SyncLogItem) => (
                  record.status === 'failed' ? (
                    <Button
                      size="small"
                      type="link"
                      onClick={async () => {
                        try {
                          await request.post('/mail/sync/retry-single', { logId: record.id });
                          message.success('已重试');
                          fetchLogs();
                        } catch (e: any) {
                          message.error('重试失败');
                        }
                      }}
                    >
                      重试
                    </Button>
                  ) : null
                ),
              },
            ]}
          />
        )}
      </Card>

      {/* 添加/编辑配置弹窗 */}
      <Modal
        title={editingConfig ? '编辑邮箱配置' : '添加邮箱'}
        open={configModalOpen}
        onOk={handleSaveConfig}
        onCancel={() => setConfigModalOpen(false)}
        confirmLoading={configSaving}
        okText={editingConfig ? '保存' : '添加'}
        cancelText="取消"
        width={520}
      >
        <Form form={configForm} layout="vertical" autoComplete="off">
          <Form.Item
            name="emailAccount"
            label="邮箱地址"
            rules={[{ required: true, message: '请输入邮箱地址' }]}
          >
            <Input placeholder="hr@example.com" />
          </Form.Item>
          <Form.Item
            name="password"
            label="邮箱密码"
            extra={editingConfig?.hasPassword ? '留空则不修改密码' : undefined}
          >
            <Input.Password
              placeholder={editingConfig?.hasPassword ? '输入新密码覆盖旧密码' : '请输入邮箱密码或应用专用密码'}
              autoComplete="new-password"
            />
          </Form.Item>
          <Row gutter={16}>
            <Col span={16}>
              <Form.Item
                name="imapHost"
                label="IMAP 服务器"
                rules={[{ required: true, message: '请输入 IMAP 服务器地址' }]}
              >
                <Input placeholder="imap.feishu.cn" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                name="imapPort"
                label="端口"
                rules={[{ required: true, message: '请输入端口' }]}
              >
                <InputNumber min={1} max={65535} style={{ width: '100%' }} placeholder="993" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            name="scanMinutes"
            label="扫描间隔（分钟）"
            rules={[{ required: true, message: '请选择扫描间隔' }]}
          >
            <Select
              options={[
                { value: 5, label: '5 分钟' },
                { value: 15, label: '15 分钟' },
                { value: 30, label: '30 分钟' },
                { value: 60, label: '60 分钟' },
              ]}
            />
          </Form.Item>
          <Form.Item name="defaultPositionId" label="默认投递岗位">
            <Input placeholder="可选，留空则自动匹配" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default MailSettingsPage;
