import React, { useEffect, useState } from 'react';
import { Table, Button, Space, message, Tag, Modal, Form, Input, Select, Card, Typography, Popconfirm, Tooltip } from 'antd';
import SimplePagination from '../../components/SimplePagination';
import { PlusOutlined, ReloadOutlined, EditOutlined, DeleteOutlined, StopOutlined, CheckCircleOutlined, KeyOutlined, CopyOutlined } from '@ant-design/icons';
import request from '../../utils/request';
import { useAuth } from '../../contexts/AuthContext';

const { Title, Text } = Typography;

interface User {
  id: string;
  email: string;
  full_name: string;
  role: string;
  is_active: boolean;
  has_password: boolean;
  created_at: string;
  feishu_token?: string;
}

const UsersList: React.FC = () => {
  const { user } = useAuth();
  const role = (user as any)?.role?.value ?? (user as any)?.role;
  const [data, setData] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [isEditModal, setIsEditModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm();
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [createdPassword, setCreatedPassword] = useState<string>('');
  const [feishuUrl, setFeishuUrl] = useState<string>('');
  const [feishuUrlLoading, setFeishuUrlLoading] = useState(false);
  const [tablePage, setTablePage] = useState(1);
  const pageSize = 10;

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await request.get('/auth/users');
      setData(res);
    } catch (error) {
      message.error('获取用户列表失败（权限不足？）');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleAdd = () => {
    form.resetFields();
    setIsEditModal(false);
    setEditingUser(null);
    setIsModalVisible(true);
  };

  const handleEdit = (record: User) => {
    setEditingUser(record);
    setIsEditModal(true);
    form.setFieldsValue({
      full_name: record.full_name,
      role: record.role,
      feishu_token: record.feishu_token || '',
    });
    setIsModalVisible(true);
  };

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);

      if (isEditModal && editingUser) {
        const payload: any = { full_name: values.full_name };
        if (values.password) payload.password = values.password;
        if (values.role !== editingUser.role) payload.role = values.role;
        if (values.feishu_token) payload.feishu_token = values.feishu_token;
        await request.put(`/auth/users/${editingUser.id}`, payload);
        if (values.password) {
          message.success(`用户已更新，新密码: ${values.password}（请告知用户自行修改）`);
        } else {
          message.success('用户更新成功');
        }
      } else {
        await request.post('/auth/users', values);
        // 安全修复 2026-07-24：后端不再回传明文密码，改用本地输入值（未填则为默认 123456）
        const plainPwd = values.password || '123456';
        message.success(`用户创建成功！\n登录密码: ${plainPwd}\n请复制后告知用户，并提醒其首次登录后修改`);
        // 在弹窗里显示密码（不关闭弹窗也能看到）
        setCreatedPassword(plainPwd);
        fetchUsers();
        // 延迟关闭，给用户时间复制密码
        setTimeout(() => {
          setIsModalVisible(false);
          setCreatedPassword('');
        }, 5000);
      }

      setIsModalVisible(false);
      fetchUsers();
    } catch (error: any) {
      const errorMsg = error?.response?.data?.detail || (isEditModal ? '更新用户失败' : '创建用户失败');
      message.error(errorMsg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (record: User) => {
    try {
      const res = await request.put(`/auth/users/${record.id}/status`);
      message.success(res.is_active ? '用户已启用' : '用户已禁用');
      fetchUsers();
    } catch (error: any) {
      const errorMsg = error?.response?.data?.detail || '操作失败';
      message.error(errorMsg);
    }
  };

  const handleDelete = async (userId: string) => {
    try {
      await request.delete(`/auth/users/${userId}`);
      message.success('用户已删除');
      fetchUsers();
    } catch (error: any) {
      const errorMsg = error?.response?.data?.detail || '删除失败';
      message.error(errorMsg);
    }
  };

  // 安全修复 2026-07-24：后端不再回传明文密码。改由 admin 输入新密码，前端本地已知后再展示。
  const handleResetPassword = async (record: User) => {
    let inputPwd = '';
    Modal.confirm({
      title: `重置「${record.full_name}」的密码`,
      content: (
        <div>
          <p style={{ marginBottom: 8 }}>请输入新密码（留空则使用默认密码 <b>123456</b>）：</p>
          <Input.Password
            placeholder="新密码，至少 6 位"
            onChange={(e) => { inputPwd = e.target.value; }}
          />
        </div>
      ),
      okText: '确认重置',
      cancelText: '取消',
      onOk: async () => {
        const payload = inputPwd ? { password: inputPwd } : {};
        try {
          await request.put(`/auth/users/${record.id}/password`, payload);
          const shownPwd = inputPwd || '123456';
          Modal.success({
            title: '密码已重置',
            content: (
              <div>
                <p>用户 <b>{record.full_name}</b> 的新密码：</p>
                <div
                  style={{
                    background: '#f5f5f5',
                    border: '1px solid #d9d9d9',
                    borderRadius: 6,
                    padding: '8px 12px',
                    fontFamily: 'monospace',
                    fontSize: 16,
                    fontWeight: 'bold',
                    textAlign: 'center',
                    margin: '12px 0',
                    userSelect: 'all',
                  }}
                >
                  {shownPwd}
                </div>
                <p style={{ color: '#999', fontSize: 12 }}>请复制并告知用户，提醒其登录后自行修改</p>
              </div>
            ),
            okText: '已复制，关闭',
          });
          fetchUsers();
        } catch (error: any) {
          message.error(error?.response?.data?.detail || '重置密码失败');
        }
      },
    });
  };

  const generateFeishuUrl = async (email: string) => {
    setFeishuUrlLoading(true);
    try {
      const res = await request.post('/auth/feishu-oauth-url', { email });
      setFeishuUrl((res as any).url || '');
    } catch (error: any) {
      message.error(error?.response?.data?.detail || '获取飞书授权链接失败');
    } finally {
      setFeishuUrlLoading(false);
    }
  };

  const handleCloseModal = () => {
    setIsModalVisible(false);
    setCreatedPassword('');
    setFeishuUrl('');
  };

  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要删除的用户');
      return;
    }
    Modal.confirm({
      title: '确认批量删除',
      content: `确定要删除选中的 ${selectedRowKeys.length} 个用户吗？`,
      okText: '确认',
      cancelText: '取消',
      okType: 'danger',
      onOk: async () => {
        try {
          await Promise.all(selectedRowKeys.map(id => request.delete(`/auth/users/${id}`)));
          message.success(`成功删除 ${selectedRowKeys.length} 个用户`);
          setSelectedRowKeys([]);
          fetchUsers();
        } catch (error) {
          message.error('批量删除失败');
        }
      },
    });
  };

  const getRoleTag = (role: string) => {
    const roleConfig: Record<string, { color: string; label: string }> = {
      admin: { color: 'red', label: '管理员' },
      hr: { color: 'blue', label: 'HR' },
      interviewer: { color: 'green', label: '面试官' },
    };
    const config = roleConfig[role] || { color: 'default', label: role };
    return <Tag color={config.color}>{config.label}</Tag>;
  };

  const columns = [
    { title: '姓名', dataIndex: 'full_name', key: 'full_name', width: 150, fixed: 'left' as const },
    { title: '邮箱', dataIndex: 'email', key: 'email', width: 200, fixed: 'left' as const },
    {
      title: '密码',
      key: 'password',
      width: 200,
      render: (_: any, record: User) => (
        <Space>
          <Text style={{ fontFamily: 'monospace' }}>
            {record.has_password ? '******' : '—'}
          </Text>
        </Space>
      ),
    },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      width: 120,
      render: (role: string) => getRoleTag(role),
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 100,
      render: (active: boolean) => (
        <Tag color={active ? 'success' : 'error'}>{active ? '启用' : '禁用'}</Tag>
      ),
    },
    {
      title: '飞书 Token',
      dataIndex: 'feishu_token',
      key: 'feishu_token',
      width: 200,
      ellipsis: true,
      render: (token: string) => token ? <Tooltip title={token}><Tag color="purple">已绑定</Tag></Tooltip> : <span style={{ color: '#bbb' }}>—</span>,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 180,
      render: (date: string) => (date ? new Date(date).toLocaleString('zh-CN') : '-'),
    },
    {
      title: '操作',
      key: 'action',
      width: 280,
      render: (_: any, record: User) => (
        <Space size="small">
          <Tooltip title="重置密码（123456）">
            <Button
              type="text"
              icon={<KeyOutlined />}
              onClick={() => handleResetPassword(record)}
            />
          </Tooltip>
          <Tooltip title="编辑">
            <Button
              type="text"
              icon={<EditOutlined />}
              onClick={() => handleEdit(record)}
            />
          </Tooltip>
          <Tooltip title={record.is_active ? '禁用' : '启用'}>
            <Button
              type="text"
              icon={record.is_active ? <StopOutlined /> : <CheckCircleOutlined />}
              onClick={() => handleToggleStatus(record)}
              style={{ color: record.is_active ? '#ff4d4f' : '#52c41a' }}
            />
          </Tooltip>
          <Popconfirm
            title="确定删除该用户吗？"
            description="此操作不可恢复"
            onConfirm={() => handleDelete(record.id)}
            okText="确定"
            cancelText="取消"
          >
            <Tooltip title="删除">
              <Button type="text" danger icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  if (role !== 'admin') {
    return (
      <div style={{ padding: 40, textAlign: 'center' }}>
        <Text type="secondary">仅管理员可查看用户管理</Text>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <Title level={2} style={{ margin: 0 }}>用户管理</Title>
          <Text type="secondary">管理系统用户及权限分配</Text>
        </div>
        <Space>
          {selectedRowKeys.length > 0 && (
            <>
              <span style={{ lineHeight: '32px' }}>已选 {selectedRowKeys.length} 项</span>
              <Button danger onClick={handleBatchDelete}>批量删除</Button>
              <Button onClick={() => setSelectedRowKeys([])}>取消选择</Button>
            </>
          )}
          <Button icon={<ReloadOutlined />} onClick={fetchUsers}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>新增用户</Button>
        </Space>
      </div>

      <Table
        columns={columns}
        dataSource={data}
        loading={loading}
        rowKey="id"
        scroll={{ x: 1550 }}
        pagination={false}
        rowSelection={{
          selectedRowKeys,
          onChange: (keys) => setSelectedRowKeys(keys),
          columnWidth: 48,
        }}
      />
        <SimplePagination current={tablePage} pageSize={pageSize} total={data.length} onChange={setTablePage} />

      <Modal
        title={isEditModal ? '编辑用户' : '新增用户'}
        open={isModalVisible}
        onOk={handleOk}
        onCancel={handleCloseModal}
        confirmLoading={submitting}
        destroyOnHidden
        width={560}
      >
        <Form form={form} layout="vertical">
          {!isEditModal && (
            <Form.Item name="email" label="邮箱" rules={[{ required: true, type: 'email', message: '请输入有效的邮箱地址' }]}>
              <Input placeholder="请输入邮箱" />
            </Form.Item>
          )}
          <Form.Item name="full_name" label="姓名" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input placeholder="请输入姓名" />
          </Form.Item>
          {!isEditModal ? (
            <Form.Item name="password" label="密码" rules={[
              { required: true, message: '请输入密码' },
              { min: 8, message: '密码至少8位' },
              { pattern: /[A-Za-z]/, message: '密码必须包含字母' },
              { pattern: /\d/, message: '密码必须包含数字' },
            ]}>
              <Input.Password placeholder="至少8位，含字母和数字" />
            </Form.Item>
          ) : (
            <Form.Item name="password" label="重置密码（留空不修改）">
              <Input.Password placeholder="输入新密码，留空则不修改" />
            </Form.Item>
          )}
          <Form.Item name="role" label="角色" initialValue="interviewer" rules={[{ required: true }]}>
            <Select getPopupContainer={() => document.body}>
              <Select.Option value="admin">管理员 (Admin)</Select.Option>
              <Select.Option value="hr">HR</Select.Option>
              <Select.Option value="interviewer">面试官 (Interviewer)</Select.Option>
            </Select>
          </Form.Item>
          {isEditModal && editingUser && (
            <Form.Item label="用户邮箱（用于飞书授权）">
              <Input value={editingUser.email} disabled />
            </Form.Item>
          )}
          <Form.Item label="飞书身份绑定">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Button
                onClick={() => {
                  const email = editingUser?.email;
                  if (!email) { message.warning('用户数据中缺少邮箱'); return; }
                  generateFeishuUrl(email);
                }}
                loading={feishuUrlLoading}
                icon={<KeyOutlined />}
                style={{ alignSelf: 'flex-start' }}
              >
                生成飞书授权链接
              </Button>
              {feishuUrl && (
                <div
                  style={{
                    background: '#f5f5f5',
                    border: '1px solid #d9d9d9',
                    borderRadius: 6,
                    padding: '8px 12px',
                    wordBreak: 'break-all',
                    fontSize: 12,
                    fontFamily: 'monospace',
                  }}
                >
                  <a href={feishuUrl} target="_blank" rel="noopener noreferrer">{feishuUrl}</a>
                  <Button
                    type="link"
                    size="small"
                    icon={<CopyOutlined />}
                    onClick={() => {
                      navigator.clipboard.writeText(feishuUrl).then(() => {
                        message.success('授权链接已复制，发给用户去飞书授权');
                      });
                    }}
                    style={{ float: 'right' }}
                  />
                </div>
              )}
              <Text style={{ fontSize: 12, color: '#999' }}>
                点击按钮生成飞书 OAuth 授权链接，复制链接发给对应用户去飞书授权
              </Text>
            </div>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default UsersList;
