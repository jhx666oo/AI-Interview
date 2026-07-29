import React, { useEffect, useState } from 'react';
import { Button, Card, Divider, Form, Input, Space, Typography, message, Tag, Tooltip } from 'antd';
import { CopyOutlined, KeyOutlined } from '@ant-design/icons';
import request from '../../utils/request';
import { useAuth } from '../../contexts/AuthContext';

const { Title, Text } = Typography;

const ProfileSettings: React.FC = () => {
  const { user, refreshUser } = useAuth();
  const [profileForm] = Form.useForm();
  const [passwordForm] = Form.useForm();
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [feishuBinding, setFeishuBinding] = useState(false);
  const [token, setToken] = useState<string>('');
  const [tokenLoading, setTokenLoading] = useState(false);

  // 检查 URL query 参数（来自飞书 OAuth 回调）
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('feishu_bound') === '1') {
      message.success('飞书身份绑定成功');
      refreshUser();
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('feishu_error') === '1') {
      const errDetail = params.get('err');
      message.error(errDetail ? `飞书绑定失败: ${errDetail}` : '飞书身份绑定失败，请重试');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [refreshUser]);

  useEffect(() => {
    if (!user) return;
    profileForm.setFieldsValue({
      email: user.email,
      role: user.role,
      full_name: user.full_name,
    });
  }, [user, profileForm]);

  const fetchToken = async () => {
    setTokenLoading(true);
    try {
      const res = await request.get('/auth/me/token');
      setToken((res as any).token);
    } catch {
      // ignore
    } finally {
      setTokenLoading(false);
    }
  };

  useEffect(() => {
    fetchToken();
  }, []);

  const copyToken = () => {
    if (!token) return;
    navigator.clipboard.writeText(token).then(() => {
      message.success('Token 已复制到剪贴板');
    }).catch(() => {
      // 降级：让用户手动选择
      message.info('请手动复制');
    });
  };

  const bindFeishu = async () => {
    setFeishuBinding(true);
    try {
      const res = await request.get('/auth/feishu-oauth-url') as any;
      if (res.url) {
        window.location.href = res.url;
      } else {
        message.error('获取授权链接失败');
      }
    } catch {
      message.error('获取授权链接失败');
    } finally {
      setFeishuBinding(false);
    }
  };

  const saveProfile = async () => {
    try {
      const values = await profileForm.validateFields();
      setSavingProfile(true);
      await request.put('/auth/me', { full_name: values.full_name });
      await refreshUser();
      message.success('个人信息已保存');
    } catch (e) {
      message.error('保存失败');
    } finally {
      setSavingProfile(false);
    }
  };

  const changePassword = async () => {
    try {
      const values = await passwordForm.validateFields();
      setSavingPassword(true);
      await request.post('/auth/change-password', {
        current_password: values.current_password,
        new_password: values.new_password,
      });
      passwordForm.resetFields();
      message.success('密码已更新');
    } catch (e) {
      message.error('更新密码失败');
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div>
      <div style={{ marginBottom: 32 }}>
        <Title level={2} style={{ margin: 0 }}>个人设置</Title>
        <Text type="secondary">更新你的个人资料与登录密码</Text>
      </div>

      <Space orientation="vertical" size="large" style={{ width: '100%' }}>
        <Card title="个人资料" styles={{ body: { paddingTop: 8 } }}>
          <Form form={profileForm} layout="vertical">
            <Form.Item label="邮箱" name="email">
              <Input disabled />
            </Form.Item>
            <Form.Item label="角色" name="role">
              <Input disabled />
            </Form.Item>
            <Form.Item
              label="姓名"
              name="full_name"
              rules={[{ required: true, message: '请输入姓名' }]}
            >
              <Input placeholder="请输入姓名" />
            </Form.Item>
            <Form.Item label="飞书身份">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Text>{(user as any)?.feishu_name ? `已绑定: ${(user as any).feishu_name}` : '未绑定'}</Text>
                {(user as any)?.feishu_token_failed && <Tag color="error" style={{ marginLeft: 8 }}>授权已过期</Tag>}
                <Button onClick={bindFeishu} loading={feishuBinding} size="small">
                  {(user as any)?.feishu_token_failed ? '重新授权' : '绑定飞书'}
                </Button>
              </div>
            </Form.Item>
            <Button type="primary" onClick={saveProfile} loading={savingProfile}>
              保存
            </Button>
          </Form>
        </Card>

        <Card title="修改密码" styles={{ body: { paddingTop: 8 } }}>
          <Form form={passwordForm} layout="vertical">
            <Form.Item
              label="当前密码"
              name="current_password"
              rules={[{ required: true, message: '请输入当前密码' }]}
            >
              <Input.Password />
            </Form.Item>
            <Form.Item
              label="新密码"
              name="new_password"
              rules={[{ required: true, message: '请输入新密码' }, { min: 6, message: '至少 6 位' }]}
            >
              <Input.Password />
            </Form.Item>
            <Form.Item
              label="确认新密码"
              name="confirm_password"
              dependencies={['new_password']}
              rules={[
                { required: true, message: '请再次输入新密码' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('new_password') === value) return Promise.resolve();
                    return Promise.reject(new Error('两次输入的密码不一致'));
                  },
                }),
              ]}
            >
              <Input.Password />
            </Form.Item>
            <Divider style={{ margin: '8px 0 16px' }} />
            <Button type="primary" onClick={changePassword} loading={savingPassword}>
              更新密码
            </Button>
          </Form>
        </Card>

        <Card
          title={<span><KeyOutlined /> 登录 Token</span>}
          styles={{ body: { paddingTop: 8 } }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 12, color: '#999', display: 'block', marginBottom: 8 }}>
                此 Token 用于 API 调用身份验证，请勿泄露给他人
              </Text>
              <div
                style={{
                  background: '#f5f5f5',
                  border: '1px solid #d9d9d9',
                  borderRadius: 6,
                  padding: '8px 12px',
                  fontFamily: 'monospace',
                  fontSize: 12,
                  wordBreak: 'break-all',
                  maxHeight: 120,
                  overflow: 'auto',
                }}
              >
                {token}
              </div>
            </div>
            <Button
              icon={<CopyOutlined />}
              onClick={copyToken}
              loading={tokenLoading}
              style={{ flexShrink: 0, marginTop: 26 }}
            >
              复制
            </Button>
          </div>
          <div style={{ marginTop: 8 }}>
            <Text style={{ fontSize: 12, color: '#999' }}>
              Token 有效期为 30 天，过期后重新登录将自动获取新的 Token
            </Text>
          </div>
        </Card>
      </Space>
    </div>
  );
};

export default ProfileSettings;
