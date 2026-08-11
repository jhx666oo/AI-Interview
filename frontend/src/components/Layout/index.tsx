import React, { useState, useEffect } from 'react';
import { Layout, Menu, Button, Avatar, Space, Dropdown, Drawer, Popover, Select } from 'antd';
import {
  DashboardOutlined,
  UserOutlined,
  FileTextOutlined,
  TeamOutlined,
  LogoutOutlined,
  BellOutlined,
  SettingOutlined,
  FileProtectOutlined,
  UsergroupAddOutlined,
  HomeOutlined,
  CheckCircleOutlined,
  FilterOutlined,
  BarChartOutlined,
  FolderOpenOutlined,
  MailOutlined,
  MenuOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useOwner } from '../../contexts/OwnerContext';
import request from '../../utils/request';
import { getLayoutMode, useViewportWidth } from './responsive';

const { Header, Sider, Content } = Layout;

const AppLayout: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout, user } = useAuth();
  const { selectedOwner, setSelectedOwner } = useOwner();
  const viewportWidth = useViewportWidth();
  const layoutMode = getLayoutMode(viewportWidth);
  const isMobile = layoutMode === 'mobile' || layoutMode === 'narrow';
  const isCompact = layoutMode === 'compact';
  const role = (user as any)?.role?.value ?? (user as any)?.role;
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [ownerList, setOwnerList] = useState<string[]>([]);

  // 加载负责人列表
  useEffect(() => {
    request.get('/positions').then((res: any) => {
      const names: string[] = [];
      (res || []).forEach((p: any) => {
        if (p.responsible_person) names.push(p.responsible_person);
      });
      setOwnerList([...new Set(names)].sort());
    }).catch(() => {});
  }, []);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

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

  const ownerSelector = (
    <Select
      aria-label="筛选负责人"
      placeholder="筛选负责人"
      value={selectedOwner}
      onChange={setSelectedOwner}
      allowClear
      showSearch
      className="app-shell__owner-select"
      options={ownerList.map(n => ({ value: n, label: n }))}
      onClear={() => setSelectedOwner(undefined)}
    />
  );

  const navigationMenu = (closeAfterNavigate = false) => (
    <Menu
      theme="light"
      mode="inline"
      selectedKeys={[location.pathname]}
      items={filteredMenuItems}
      onClick={({ key }) => {
        if (closeAfterNavigate) setMobileMenuOpen(false);
        navigate(key);
      }}
      className="app-shell__menu"
    />
  );

  return (
    <Layout className="app-shell" data-layout-mode={layoutMode} style={{ margin: 0, minHeight: '100vh' }}>
      {isMobile ? (
        <Drawer
          className="app-shell__drawer"
          open={mobileMenuOpen}
          onClose={() => setMobileMenuOpen(false)}
          placement="left"
          width={280}
          title={<span><span className="app-shell__brand-accent">AI</span> Interview</span>}
        >
          {navigationMenu(true)}
        </Drawer>
      ) : (
        <Sider
          collapsible={!isCompact}
          collapsed={isCompact || collapsed}
          onCollapse={setCollapsed}
          width={200}
          theme="light"
          className="app-shell__sider"
        >
          <div className="app-shell__brand">
            <img src="/swan.svg" alt="天鹅到家" />
            {!(isCompact || collapsed) && <>&nbsp;<span className="app-shell__brand-accent">AI</span>&nbsp;Interview</>}
          </div>
          {navigationMenu()}
        </Sider>
      )}
      <Layout
        className="app-shell__main"
      >
        <Header className="app-shell__header">
          <div className="app-shell__heading">
            {isMobile && (
              <Button
                type="text"
                aria-label="打开导航菜单"
                icon={<MenuOutlined />}
                onClick={() => setMobileMenuOpen(true)}
              />
            )}
            <h2 className="app-shell__title">
              {pageTitle}
            </h2>
          </div>
          <Space className="app-shell__actions" size={isMobile ? 4 : isCompact ? 12 : 'large'}>
            {isMobile ? (
              <Popover content={ownerSelector} trigger="click" placement="bottomRight">
                <Button type="text" aria-label="筛选负责人" icon={<FilterOutlined />} />
              </Popover>
            ) : ownerSelector}
            <Button type="text" icon={<BellOutlined style={{ fontSize: '18px', color: '#64748B' }} />} />
            <Dropdown menu={userMenu}>
              <Space className="app-shell__user">
                <Avatar style={{ backgroundColor: '#3B82F6' }} icon={<UserOutlined />} />
                {!isCompact && !isMobile && (
                  <span className="app-shell__username">{user?.full_name || user?.email}</span>
                )}
              </Space>
            </Dropdown>
          </Space>
        </Header>
        <Content className="app-shell__content">
          <div className="page-container">
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
};

export default AppLayout;
