import React, { useEffect, useState } from 'react';
import { Button, Card, Divider, Form, Input, InputNumber, Space, Switch, Typography, message } from 'antd';
import { SaveOutlined, ReloadOutlined } from '@ant-design/icons';
import request from '../../utils/request';
import { useAuth } from '../../contexts/AuthContext';

const { Title, Text } = Typography;

type MailSettings = {
  smtp_host?: string | null;
  smtp_port?: number;
  smtp_username?: string | null;
  smtp_password_set: boolean;
  mail_from?: string | null;
  mail_from_name: string;
  mail_enabled: boolean;
  frontend_url?: string | null;
};

const MailSettingsPage: React.FC = () => {
  const { user } = useAuth();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [meta, setMeta] = useState<MailSettings | null>(null);
  const [editingPassword, setEditingPassword] = useState(false);
  const role = (user as any)?.role?.value ?? (user as any)?.role;

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const res = (await request.get('/settings/mail')) as MailSettings;
      setMeta(res);
      form.setFieldsValue({
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
    } catch {
      message.error('获取邮件设置失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (role !== 'admin') return;
    fetchSettings();
  }, [role]);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
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
      setSaving(true);
      await request.put('/settings/mail', payload);
      form.setFieldsValue({ smtp_password: '' });
      await fetchSettings();
      message.success('邮件配置已保存');
    } catch (e: any) {
      message.error('保存失败: ' + (e.response?.data?.detail || e.message));
    } finally {
      setSaving(false);
    }
  };

  if (role !== 'admin') {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Text type="secondary">仅管理员可查看邮件设置</Text>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <Title level={2} style={{ margin: 0 }}>邮件设置</Title>
        <Text type="secondary">配置 SMTP 邮件服务，用于发送面试通知等邮件</Text>
      </div>

      <Card
        title="SMTP 配置"
        loading={loading}
        extra={
          <Space>
            <Button icon={<ReloadOutlined />} onClick={fetchSettings}>刷新</Button>
            <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving}>保存</Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical" autoComplete="off">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Form.Item name="smtp_host" label="SMTP 主机">
              <Input placeholder="smtp.example.com" autoComplete="off" />
            </Form.Item>
            <Form.Item name="smtp_port" label="SMTP 端口">
              <InputNumber min={1} max={65535} style={{ width: '100%' }} placeholder="465" />
            </Form.Item>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Form.Item name="smtp_username" label="SMTP 用户名">
              <Input placeholder="noreply@example.com" autoComplete="off" />
            </Form.Item>
            <Form.Item
              name="smtp_password"
              label="SMTP 密码"
              extra={
                meta?.smtp_password_set && !editingPassword ? (
                  <Button type="link" onClick={() => setEditingPassword(true)} style={{ padding: 0, height: 'auto' }}>
                    更换密码
                  </Button>
                ) : null
              }
            >
              <Input.Password
                placeholder={
                  meta?.smtp_password_set && !editingPassword
                    ? '已设置（不会回显）'
                    : '输入后会覆盖当前密码'
                }
                autoComplete="new-password"
                disabled={!!(meta?.smtp_password_set && !editingPassword)}
              />
            </Form.Item>
          </div>
          <Divider />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <Form.Item name="mail_from" label="发件人地址">
              <Input placeholder="noreply@example.com" />
            </Form.Item>
            <Form.Item name="mail_from_name" label="发件人名称">
              <Input placeholder="招聘系统" />
            </Form.Item>
          </div>
          <Form.Item name="frontend_url" label="前端地址">
            <Input placeholder="https://your-app.com" />
          </Form.Item>
          <Form.Item name="mail_enabled" label="启用邮件服务" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
};

export default MailSettingsPage;
