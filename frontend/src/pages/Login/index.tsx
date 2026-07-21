import React from 'react';
import { Form, Input, Button, Card, Typography, message } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import request from '../../utils/request';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';

const { Title, Text } = Typography;

const Login: React.FC = () => {
  const { login, isAuthenticated, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as any)?.from || '/dashboard';
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate(from, { replace: true });
    }
  }, [authLoading, isAuthenticated, navigate, from]);

  const onFinish = async (values: any) => {
    setLoading(true);
    try {
      const formData = new URLSearchParams();
      formData.append('username', values.email);
      formData.append('password', values.password);
      const res = await request.post('/auth/token', formData, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      await login((res as any).access_token);
      message.success('登录成功');
      navigate(from, { replace: true });
    } catch (error: any) {
      const status = error?.response?.status;
      const detail = error?.response?.data?.detail;
      if (status === 400) {
        message.error('请输入邮箱和密码');
      } else if (detail?.includes('禁用')) {
        message.error('该账号已被禁用，请联系管理员');
      } else {
        message.error('登录失败，请检查邮箱和密码是否正确');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '100vh',
      background: '#F8FAFC',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      <Card
        style={{
          width: 420,
          borderRadius: 20,
          boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
          border: '1px solid #E2E8F0',
          overflow: 'hidden',
        }}
        bodyStyle={{ padding: 0 }}
      >
        {/* 顶部品牌区 */}
        <div style={{
          background: '#fff',
          padding: '48px 40px 24px',
          textAlign: 'center',
        }}>
          <div style={{
            width: 80, height: 80, borderRadius: 18,
            background: '#EFF6FF',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 20px',
          }}>
            <img src="/swan.svg" alt="天鹅到家" style={{ height: 54, width: 'auto' }} />
          </div>
          <Title level={3} style={{ color: '#0F172A', marginBottom: 4, fontWeight: 700, fontSize: 24 }}>
            天鹅到家
          </Title>
          <Text style={{ color: '#64748B', fontSize: 14 }}>
            AI 智能招聘系统
          </Text>
        </div>

        {/* 登录表单区 */}
        <div style={{ padding: '40px 40px 32px' }}>
          <Form
            name="login"
            initialValues={{ remember: true }}
            onFinish={onFinish}
            size="large"
          >
            <Form.Item
              name="email"
              rules={[{ required: true, message: '请输入邮箱' }]}
            >
              <Input
                prefix={<UserOutlined style={{ color: '#9E9E9E' }} />}
                placeholder="邮箱地址"
                style={{ borderRadius: 10, height: 48 }}
              />
            </Form.Item>

            <Form.Item
              name="password"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password
                prefix={<LockOutlined style={{ color: '#9E9E9E' }} />}
                placeholder="密码"
                style={{ borderRadius: 10, height: 48 }}
              />
            </Form.Item>

            <Form.Item style={{ marginBottom: 12, marginTop: 28 }}>
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                style={{
                  width: '100%', height: 48, borderRadius: 10,
                  fontSize: 16, fontWeight: 600,
                }}
              >
                登录
              </Button>
            </Form.Item>
          </Form>
        </div>
      </Card>
    </div>
  );
};

export default Login;
