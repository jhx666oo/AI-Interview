import React, { useState } from 'react';
import { Layout, Menu, Button, Avatar, Space, Dropdown, theme, Badge } from 'antd';
import {
  DashboardOutlined,
  UserOutlined,
  FileTextOutlined,
  TeamOutlined,
  LogoutOutlined,
  BellOutlined,
  SettingOutlined,
  ApartmentOutlined,
  FileProtectOutlined,
  UsergroupAddOutlined,
  SafetyOutlined,
  HomeOutlined,
  CheckCircleOutlined,
  FilterOutlined,
  BarChartOutlined,
  FolderOpenOutlined,
  PartitionOutlined,
  MailOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import request from '../../utils/request';

const { Header, Sider, Content } = Layout;

const AppLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout, user } = useAuth();
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();
  const role = (user as any)?.role?.value ?? (user as any)?.role;
  const [collapsed, setCollapsed] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const menuItems = [
    {
      key: '/dashboard',
      icon: <DashboardOutlined />,
      label: '仪表盘',
    },
    {
      key: '/requisitions',
      icon: <FileProtectOutlined />,
      label: '需求管理',
      roles: ['admin', 'hr'],
    },
    {
      key: '/positions',
      icon: <UserOutlined />,
      label: '岗位管理',
      roles: ['admin', 'hr'],
    },
    {
      key: '/resumes',
      icon: <FileTextOutlined />,
      label: '简历管理',
    },
    {
      key: '/interviews',
      icon: <TeamOutlined />,
      label: '面试管理',
    },
    {
      key: '/onboarding',
      icon: <HomeOutlined />,
      label: '入职管理',
      roles: ['admin', 'hr'],
    },
    {
      key: '/probation',
      icon: <CheckCircleOutlined />,
      label: '试用期管理',
      roles: ['admin', 'hr'],
    },
    {
      key: '/daily-reports',
      icon: <BarChartOutlined />,
      label: '招聘日报',
      roles: ['admin', 'hr'],
    },
    {
      key: '/settings/position-mappings',
      icon: <FolderOpenOutlined />,
      label: '岗位映射',
      roles: ['admin'],
    },
    {
      key: '/settings/interviewer-mappings',
      icon: <TeamOutlined />,
      label: '面试官管理',
      roles: ['admin'],
    },
    {
      key: '/users',
      icon: <SettingOutlined />,
      label: '用户管理',
      roles: ['admin'],
    },
    {
      key: '/settings/mail',
      icon: <MailOutlined />,
      label: '邮件设置',
      roles: ['admin'],
    },
  ];

  const filteredMenuItems = (menuItems || []).filter(item => {
    if (!item.roles) return true;
    return item.roles.some(r => r.toLowerCase() === role?.toLowerCase());
  });

  const pageTitle =
    location.pathname.startsWith('/settings/profile')
      ? '个人设置'
      : location.pathname.startsWith('/settings/system')
        ? '系统设置'
        : location.pathname.startsWith('/settings/mail')
          ? '邮件设置'
          : location.pathname.startsWith('/workflows/')
            ? '工作流编辑'
            : menuItems.find(item => item.key === location.pathname)?.label || 'AI 面试助手';

  const userMenuItems: any[] = [
    {
      key: 'profile',
      label: '个人中心',
      icon: <UserOutlined />,
      onClick: () => navigate('/settings/profile'),
    },
  ];

  if (role?.toLowerCase() === 'admin') {
    userMenuItems.push({
      key: 'settings',
      label: '系统设置',
      icon: <SettingOutlined />,
      onClick: () => navigate('/settings/system'),
    });
  }

  userMenuItems.push(
    { type: 'divider' },
    {
      key: 'logout',
      label: '退出登录',
      icon: <LogoutOutlined />,
      onClick: handleLogout,
    }
  );

  const userMenu = { items: userMenuItems };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider 
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        width={200}
        theme="light"
        style={{
          borderRight: '1px solid #f0f0f0',
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          zIndex: 100
        }}
      >
        <div style={{ 
          height: 64, 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          color: '#0F172A',
          fontSize: '18px',
          fontWeight: 700,
          letterSpacing: '-0.025em',
          borderBottom: '1px solid #f0f0f0',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          padding: '0 12px'
        }}>
          <img src="/swan.svg" alt="天鹅到家" style={{ height: 28, width: 'auto', flexShrink: 0 }} />
          {!collapsed && <>&nbsp;<span style={{ color: '#3B82F6' }}>AI</span>&nbsp;Interview</>}
        </div>
        <Menu
          theme="light"
          mode="inline"
          selectedKeys={[location.pathname]}
          items={filteredMenuItems}
          onClick={({ key }) => navigate(key)}
          style={{ padding: '16px 8px', borderRight: 0, overflowY: 'auto', maxHeight: 'calc(100vh - 64px)' }}
        />
      </Sider>
      <Layout style={{ marginLeft: collapsed ? 80 : 200, transition: 'margin-left 0.2s' }}>
        <Header style={{ 
          padding: '0 32px', 
          display: 'flex', 
          justifyContent: 'space-between', 
          alignItems: 'center',
          background: 'rgba(255, 255, 255, 0.8)',
          backdropFilter: 'blur(12px)'
        }}>
          <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 600, color: '#0F172A' }}>
            {pageTitle}
          </h2>
          <Space size="large">
            <Button type="text" icon={<BellOutlined style={{ fontSize: '18px', color: '#64748B' }} />} />
            <Dropdown menu={userMenu}>
              <Space style={{ cursor: 'pointer' }}>
                <Avatar style={{ backgroundColor: '#3B82F6' }} icon={<UserOutlined />} />
                <span style={{ fontWeight: 500, color: '#0F172A' }}>{user?.full_name || user?.email}</span>
              </Space>
            </Dropdown>
          </Space>
        </Header>
        <Content style={{ margin: '32px', minHeight: 280 }}>
          <div className="page-container">
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
};

export default AppLayout;