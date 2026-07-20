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
  useLocation();
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!authLoading && isAuthenticated) {
      navigate('/dashboard', { replace: true });
    }
  }, [authLoading, isAuthenticated, navigate]);

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
      navigate('/dashboard', { replace: true });
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
      background: 'linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 30%, #BFDBFE 60%, #60A5FA 100%)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    }}>
      <Card
        style={{
          width: 420,
          borderRadius: 20,
          boxShadow: '0 20px 60px rgba(0,0,0,0.1)',
          border: 'none',
          overflow: 'hidden',
        }}
        bodyStyle={{ padding: 0 }}
      >
        {/* 顶部品牌区 */}
        <div style={{
          background: 'linear-gradient(135deg, #1D4ED8 0%, #3B82F6 100%)',
          padding: '48px 40px 40px',
          textAlign: 'center',
        }}>
          <div style={{
            width: 80, height: 80, borderRadius: 18,
            background: 'rgba(255,255,255,0.15)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 20px', backdropFilter: 'blur(4px)',
          }}>
            <svg viewBox="0 0 5943 1024" width="52" height="52">
              <path d="M3628.997106 713.690111h255.54932v-43.808455h-255.54932v43.808455z m887.121212-401.577504h-65.712682v65.712683h65.712682V312.112607z m-657.126824 204.439457h-229.994388v32.856341h229.994388v-32.856341z m1777.89313 69.363387h-288.405662v116.822546h288.405662V585.915451z m-562.208505-7.30141h-215.39157v124.123956h215.39157v-124.123956z m-558.557801-153.329592h-65.712682v65.712682h65.712682v-65.712682z m1306.95224-288.405662h-2409.465022c-62.061978 0-109.521137 47.45916-109.521138 109.521138v511.098641c0 62.061978 47.45916 109.521137 109.521138 109.521137h2409.465022c62.061978 0 109.521137-47.45916 109.521137-109.521137v-511.098641c0-58.411273-47.45916-109.521137-109.521137-109.521138zM3552.33231 239.098516l54.760568 10.952113c-3.650705 10.952114-7.301409 18.253523-10.952114 29.205637h146.028184V330.36613h-87.61691c10.952114 14.602818 18.253523 29.205637 25.554932 43.808455l-51.109864 18.253523c-10.952114-21.904227-21.904227-40.15775-32.856342-62.061978h-25.554932c-14.602818 21.904227-25.554932 40.15775-43.808455 58.411273l-47.459159-29.205636c32.856341-36.507046 58.411273-76.664796 73.014092-120.473251z m386.974685 543.954982h-54.760569v-21.904228h-255.54932v21.904228h-54.760569v-310.309889h339.515526v124.123955h-284.754957v29.205637h310.309889v156.980297zM4005.019677 330.36613h-94.918319c10.952114 14.602818 18.253523 25.554932 21.904228 36.507046l-47.45916 18.253523-32.856341-54.760569h-29.205637l-32.856341 54.760569-29.205636-21.904228c3.650705 10.952114 7.301409 21.904227 14.602818 32.856341h219.042275v113.171842h-54.760569v-65.712682H3545.0309v65.712682h-54.760568v-113.171842h226.343684c-3.650705-10.952114-10.952114-21.904227-14.602819-32.856341l47.45916-7.301409-10.952114-7.301409c25.554932-36.507046 47.45916-73.014092 58.411273-113.171842l54.760569 10.952114c-3.650705 10.952114-7.301409 18.253523-10.952114 29.205636h160.631002V330.36613z m51.109864 324.912708c25.554932-3.650705 47.45916-10.952114 73.014092-14.602819v-135.076069h-58.411273v-54.760569h58.411273V330.36613h-65.712682V275.605561h189.836638V330.36613h-65.712683v124.123956h58.411273v54.760568h-58.411273v116.822547c18.253523-7.301409 40.15775-14.602818 58.411273-21.904228V658.929542c-54.760569 21.904227-109.521137 40.15775-171.583115 54.760569l-18.253523-58.411273z m540.304278 109.521137h-354.118344v-54.760569h149.678888v-62.061978h-127.774661v-51.109864h127.774661v-58.411273H4271.521112V261.002743h295.70707v281.104253h-120.473251v58.411273h127.774661v51.109864h-127.774661v62.061978h149.678888v51.109864z m533.002869 18.253523H5074.676119v-21.904228h-215.39157v21.904228h-54.760569v-255.549321h324.912708v255.549321z m43.808455-324.912708h-416.180322v7.301409c-3.650705 131.425365-29.205637 237.295798-76.664797 313.960594l-40.15775-43.808455c40.15775-65.712682 62.061978-156.980297 65.712682-270.152139v-182.535229c153.329592 0 292.056366-14.602818 412.529618-36.507045l29.205636 51.109864c-113.171842 21.904227-240.946502 32.856341-383.32398 36.507046V403.380222h416.180322v54.760568z m522.050754 324.912708h-54.760568v-25.554932h-288.405662v25.554932H5293.718394v-248.247912h401.577503v248.247912z m10.952114-259.200025c-14.602818-25.554932-29.205637-47.45916-40.15775-69.363387-120.473251 10.952114-259.200025 18.253523-408.878913 25.554932l-10.952114-51.109864c43.808455-10.952114 105.870433-73.014092 182.535229-186.185934l58.411273 18.253523c-47.45916 65.712682-94.918319 120.473251-146.028183 164.281706 98.569024-3.650705 193.487343-10.952114 288.405662-18.253523-18.253523-29.205637-36.507046-54.760569-58.411273-76.664796l51.109864-25.554932c47.45916 58.411273 91.267614 124.123956 135.076069 193.487343l-51.109864 25.554932z m-1379.966331-32.856342h69.363387v-65.712682h-69.363387v65.712682z m0-113.171841h69.363387V312.112607h-69.363387v65.712683z" fill="#fff" />
            </svg>
          </div>
          <Title level={3} style={{ color: '#fff', marginBottom: 4, fontWeight: 700, fontSize: 24 }}>
            天鹅到家
          </Title>
          <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14 }}>
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
                  background: 'linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)',
                  border: 'none', boxShadow: '0 4px 14px rgba(59,130,246,0.35)',
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
