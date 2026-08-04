import React, { useEffect, useState, useCallback } from 'react';
import {
  Card, Table, Button, Space, Tag, Modal, Form, Input, DatePicker,
  Select, Switch, message, Popconfirm, Drawer, Descriptions, Row, Col, Statistic
} from 'antd';
import SimplePagination from '../../components/SimplePagination';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined,
  EyeOutlined, CheckCircleOutlined, HomeOutlined
} from '@ant-design/icons';
import request from '../../utils/request';
import dayjs from 'dayjs';

const { TextArea } = Input;
const { Option } = Select;

const statusConfig: Record<string, { color: string; text: string }> = {
  pending: { color: 'default', text: '待入职' },
  in_progress: { color: 'processing', text: '入职中' },
  completed: { color: 'success', text: '已完成' },
  withdrawn: { color: 'error', text: '已放弃' },
};

const OnboardingList: React.FC = () => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();
  const [detailVisible, setDetailVisible] = useState(false);
  const [current, setCurrent] = useState<any>(null);
  const [resumes, setResumes] = useState<any[]>([]);
  const [tablePage, setTablePage] = useState(1);
  const [probationLoading, setProbationLoading] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const pageSize = 10;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // 入职记录 responsible_person 字段暂未填充，先全量显示
      const res = await request.get('/onboarding');
      setData(res || []);
    }
    catch (e) { message.error('加载失败'); }
    finally { setLoading(false); }
  }, []);

  const fetchResumes = useCallback(async () => {
    try { const res = await request.get('/resumes', { params: { limit: 200 } }); const items = Array.isArray(res) ? res : (res.items || []); setResumes(items); }
    catch (e) { }
  }, []);

  useEffect(() => { fetchData(); fetchResumes(); }, [fetchData]);

  const handleCreate = () => {
    setEditing(null); form.resetFields();
    form.setFieldsValue({ contract_type: 'fixed_term', status: 'pending' });
    setModalVisible(true);
  };

  const handleEdit = (record: any) => {
    setEditing(record);
    form.setFieldsValue({
      ...record,
      onboard_date: record.onboard_date ? dayjs(record.onboard_date) : null,
      orientation_date: record.orientation_date ? dayjs(record.orientation_date) : null,
    });
    setModalVisible(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const payload = {
        ...values,
        onboard_date: values.onboard_date ? values.onboard_date.toISOString() : null,
        orientation_date: values.orientation_date ? values.orientation_date.toISOString() : null,
      };
      setSubmitting(true);
      if (editing) {
        await request.put(`/onboarding/${editing.id}`, payload);
        message.success('更新成功');
      } else {
        await request.post('/onboarding', payload);
        message.success('创建成功');
      }
      setModalVisible(false); fetchData();
    } catch (e: any) {
      if (e.response) message.error(e.response.data?.detail || '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try { setDeletingId(id); await request.delete(`/onboarding/${id}`); message.success('已删除'); fetchData(); }
    catch (e: any) { message.error(e.response?.data?.detail || '删除失败'); }
    finally { setDeletingId(null); }
  };

  // == 批量删除 ==
  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先选择要删除的入职记录');
      return;
    }
    Modal.confirm({
      title: '确认批量删除',
      content: `确定要删除选中的 ${selectedRowKeys.length} 条入职记录吗？`,
      okText: '确认',
      cancelText: '取消',
      okType: 'danger',
      onOk: async () => {
        try {
          await Promise.all(selectedRowKeys.map(id => request.delete(`/onboarding/${id}`)));
          message.success(`成功删除 ${selectedRowKeys.length} 条入职记录`);
          setSelectedRowKeys([]);
          fetchData();
        } catch (e: any) {
          message.error(e?.response?.data?.detail || '批量删除失败');
        }
      },
    });
  };

  const handleToProbation = async (id: string) => {
    try {
      setProbationLoading(id);
      const res = await request.post('/probation/sync-from-onboarding');
      message.success(res.message || '已转入试用期');
      fetchData();
    } catch (e: any) {
      message.error(e.response?.data?.detail || '操作失败');
    } finally {
      setProbationLoading(null);
    }
  };

  const columns = [
    { title: '姓名', dataIndex: 'candidate_name', key: 'candidate_name', width: 100 },
    { title: '工号', dataIndex: 'employee_id', key: 'employee_id', width: 90, render: (v: string) => v || '-' },
    { title: '部门', dataIndex: 'department', key: 'department', width: 100, render: (v: string) => v || '-' },
    { title: '职位', dataIndex: 'position_title', key: 'position_title', width: 130, render: (v: string) => v || '-' },
    { title: '入职日期', dataIndex: 'onboard_date', key: 'onboard_date', width: 110,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD') : '-' },
    { title: '合同', dataIndex: 'contract_signed', key: 'contract_signed', width: 70,
      render: (v: boolean) => <Tag color={v ? 'success' : 'default'}>{v ? '已签' : '未签'}</Tag> },
    { title: '账号', dataIndex: 'accounts_created', key: 'accounts_created', width: 70,
      render: (v: boolean) => <Tag color={v ? 'success' : 'default'}>{v ? '已开' : '未开'}</Tag> },
    { title: '设备', dataIndex: 'equipment_assigned', key: 'equipment_assigned', width: 70,
      render: (v: boolean) => <Tag color={v ? 'success' : 'default'}>{v ? '已配' : '未配'}</Tag> },
    { title: '入职引导', dataIndex: 'orientation_completed', key: 'orientation_completed', width: 90,
      render: (v: boolean) => <Tag color={v ? 'success' : 'default'}>{v ? '已完成' : '未完成'}</Tag> },
    { title: '状态', dataIndex: 'status', key: 'status', width: 90,
      render: (v: string) => { const c = statusConfig[v] || { color: 'default', text: v }; return <Tag color={c.color}>{c.text}</Tag>; } },
    { title: '操作', align: 'center' as const, key: 'action', width: 260,
      render: (_: any, record: any) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => { setCurrent(record); setDetailVisible(true); }}>详情</Button>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>编辑</Button>
          {record.status === 'completed' && (
            <Button type="primary" size="small" icon={<CheckCircleOutlined />}
              loading={probationLoading === record.id} disabled={!!probationLoading}
              onClick={() => handleToProbation(record.id)}>转入试用期</Button>
          )}
          <Popconfirm title="确认删除？" onConfirm={() => handleDelete(record.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />} loading={deletingId === record.id}>删除</Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}><Card><Statistic title="入职总数" value={data.length} /></Card></Col>
        <Col span={6}><Card><Statistic title="待入职" value={data.filter(r => r.status === 'pending').length} /></Card></Col>
        <Col span={6}><Card><Statistic title="入职中" value={data.filter(r => r.status === 'in_progress').length} /></Card></Col>
        <Col span={6}><Card><Statistic title="已完成" value={data.filter(r => r.status === 'completed').length} /></Card></Col>
      </Row>
      <Card title={<span><HomeOutlined /> 入职管理</span>}
        extra={<Space>
          <Button size="small" icon={<ReloadOutlined />} onClick={fetchData}>刷新</Button>
          <Button type="primary" size="small" icon={<PlusOutlined />} onClick={handleCreate}>新增入职</Button>
        </Space>}>
        {selectedRowKeys.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <Space>
              <span style={{ color: '#64748B' }}>已选 {selectedRowKeys.length} 项</span>
              <Button danger onClick={handleBatchDelete}>批量删除</Button>
              <Button onClick={() => setSelectedRowKeys([])}>取消选择</Button>
            </Space>
          </div>
        )}
        <Table dataSource={data.slice((tablePage - 1) * pageSize, tablePage * pageSize)} columns={columns} rowKey="id" loading={loading}
          scroll={{ x: 1400 }} pagination={false}
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys,
            columnWidth: 40,
          }}
        />
        <SimplePagination current={tablePage} pageSize={pageSize} total={data.length} onChange={setTablePage} />
      </Card>
      <Modal title={editing ? '编辑入职记录' : '新增入职记录'} open={modalVisible}
        onCancel={() => setModalVisible(false)} onOk={handleSubmit} confirmLoading={submitting} width={640} destroyOnHidden>
        <Form form={form} layout="vertical">
          <Form.Item name="resume_id" label="关联简历" rules={[{ required: true, message: '请选择简历' }]}>
            <Select showSearch placeholder="选择候选人简历" optionFilterProp="children">
              {resumes.map((r: any) => <Option key={r.id} value={r.id}>{r.candidate_name} - {r.position_title || '未知岗位'}</Option>)}
            </Select>
          </Form.Item>
          <Form.Item name="candidate_name" label="候选人姓名" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input />
          </Form.Item>
          <Row gutter={16}>
            <Col span={8}><Form.Item name="employee_id" label="工号"><Input placeholder="如：EMP001" /></Form.Item></Col>
            <Col span={8}><Form.Item name="department" label="部门"><Input /></Form.Item></Col>
            <Col span={8}><Form.Item name="position_title" label="职位"><Input /></Form.Item></Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}><Form.Item name="onboard_date" label="入职日期"><DatePicker style={{ width: '100%' }} /></Form.Item></Col>
            <Col span={8}><Form.Item name="contract_type" label="合同类型">
              <Select>
                <Option value="fixed_term">固定期限</Option>
                <Option value="permanent">无固定期限</Option>
                <Option value="intern">实习协议</Option>
                <Option value="outsourcing">外包</Option>
              </Select>
            </Form.Item></Col>
            <Col span={8}><Form.Item name="status" label="状态">
              <Select>{Object.entries(statusConfig).map(([k, v]) => <Option key={k} value={k}>{v.text}</Option>)}</Select>
            </Form.Item></Col>
          </Row>
          {editing && (<Row gutter={16}>
            <Col span={6}><Form.Item name="contract_signed" label="合同已签" valuePropName="checked"><Switch /></Form.Item></Col>
            <Col span={6}><Form.Item name="accounts_created" label="账号已开" valuePropName="checked"><Switch /></Form.Item></Col>
            <Col span={6}><Form.Item name="equipment_assigned" label="设备已配" valuePropName="checked"><Switch /></Form.Item></Col>
            <Col span={6}><Form.Item name="orientation_completed" label="入职引导完成" valuePropName="checked"><Switch /></Form.Item></Col>
          </Row>)}
          <Form.Item name="notes" label="备注"><TextArea rows={2} /></Form.Item>
        </Form>
      </Modal>
      <Drawer size="large" title="入职详情" open={detailVisible} onClose={() => setDetailVisible(false)}>
        {current && (
          <Descriptions column={1} bordered>
            <Descriptions.Item label="姓名">{current.candidate_name}</Descriptions.Item>
            <Descriptions.Item label="工号">{current.employee_id || '-'}</Descriptions.Item>
            <Descriptions.Item label="部门">{current.department || '-'}</Descriptions.Item>
            <Descriptions.Item label="职位">{current.position_title || '-'}</Descriptions.Item>
            <Descriptions.Item label="入职日期">{current.onboard_date ? dayjs(current.onboard_date).format('YYYY-MM-DD') : '-'}</Descriptions.Item>
            <Descriptions.Item label="合同类型">{current.contract_type || '-'}</Descriptions.Item>
            <Descriptions.Item label="合同已签">{current.contract_signed ? '是' : '否'}</Descriptions.Item>
            <Descriptions.Item label="账号已开">{current.accounts_created ? '是' : '否'}</Descriptions.Item>
            <Descriptions.Item label="设备已配">{current.equipment_assigned ? '是' : '否'}</Descriptions.Item>
            <Descriptions.Item label="入职引导">{current.orientation_completed ? '已完成' : '未完成'}</Descriptions.Item>
            <Descriptions.Item label="状态">{statusConfig[current.status]?.text || current.status}</Descriptions.Item>
            <Descriptions.Item label="备注">{current.notes || '-'}</Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>
    </div>
  );
};

export default OnboardingList;
