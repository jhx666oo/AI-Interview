import React from 'react';
import { Button, Input, Typography, message } from 'antd';
import { MailOutlined, LockOutlined } from '@ant-design/icons';
import request from '../../utils/request';
import { useAuth } from '../../contexts/AuthContext';
import { useNavigate, useLocation } from 'react-router-dom';
import './login.css';

const { Title, Text } = Typography;

const Login: React.FC = () => {
  const { login, isAuthenticated, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as any)?.from || '/dashboard';
  const [loading, setLoading] = React.useState(false);
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');

  React.useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate(from, { replace: true });
    }
  }, [authLoading, isAuthenticated, navigate, from]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      message.error('请输入邮箱和密码');
      return;
    }
    setLoading(true);
    try {
      const formData = new URLSearchParams();
      formData.append('username', email);
      formData.append('password', password);
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
    <div className="login-split">
      {/* 左侧：品牌图 */}
      <div className="login-left">
        <img src="/login-bg.jpg" alt="智能招聘系统" className="login-left-img" />
      </div>

      {/* 右侧：登录表单 */}
      <div className="login-right">
        <div className="login-right-inner">
          <div className="login-stagger-item" style={{ marginBottom: 24 }}>
            <div className="login-logo-box">
              <img src="/swan.svg" alt="天鹅到家" />
            </div>
          </div>

          <div className="login-stagger-item">
            <Title level={2} style={{ marginBottom: 4, fontWeight: 700, color: '#0F172A' }}>
              欢迎回来
            </Title>
            <Text style={{ color: '#64748B', fontSize: 14 }}>
              请输入账号信息登录系统
            </Text>
          </div>

          <form onSubmit={handleLogin} className="login-form">
            <div className="login-stagger-item">
              <label className="login-label">邮箱地址</label>
              <Input
                prefix={<MailOutlined style={{ color: '#94A3B8' }} />}
                placeholder="email@example.com"
                size="large"
                value={email}
                onChange={e => setEmail(e.target.value)}
                disabled={loading}
                className="login-input"
              />
            </div>

            <div className="login-stagger-item">
              <label className="login-label">密码</label>
              <Input.Password
                prefix={<LockOutlined style={{ color: '#94A3B8' }} />}
                placeholder="••••••••••••"
                size="large"
                value={password}
                onChange={e => setPassword(e.target.value)}
                disabled={loading}
                className="login-input"
              />
            </div>

            <div className="login-stagger-item">
              <Button
                type="primary"
                htmlType="submit"
                loading={loading}
                className="login-btn"
                size="large"
              >
                {loading ? '登录中...' : '登录'}
              </Button>
            </div>
          </form>

          <div className="login-stagger-item">
            <Text style={{ color: '#94A3B8', fontSize: 13 }}>
              © 2026 天鹅到家 · AI 智能招聘系统
            </Text>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
