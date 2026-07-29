import React, { useEffect, useState, useCallback } from 'react';
import {
  Card, Table, Button, Space, Tag, Modal, Form, Input, InputNumber, DatePicker,
  Select, message, Popconfirm, Row, Col, Statistic, Typography, Tooltip, Pagination
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined,
  ReloadOutlined, SearchOutlined,
  ThunderboltOutlined, LoadingOutlined, CloudUploadOutlined
} from '@ant-design/icons';
import request from '../../utils/request';
import SimplePagination from '../../components/SimplePagination';
import JDGeneratorModal from '../../components/JDGeneratorModal';
import { useOwner } from '../../contexts/OwnerContext';
import dayjs from 'dayjs';

const { Title } = Typography;
const { TextArea } = Input;
const { Option } = Select;

const statusConfig: Record<string, { color: string; text: string }> = {
  draft: { color: 'warning', text: '草稿' },
  pending: { color: 'processing', text: '待审批' },
  approved: { color: 'success', text: '已批准' },
  rejected: { color: 'error', text: '已驳回' },
  closed: { color: '#8c8c8c', text: '已关闭' },
  // 飞书 Bitable 返回的中文状态
  '招聘中': { color: 'processing', text: '招聘中' },
  '待招聘': { color: 'blue', text: '待招聘' },
  '已入职': { color: 'success', text: '已入职' },
  '入职中': { color: 'processing', text: '入职中' },
  '暂停': { color: 'warning', text: '暂停' },
  '已完成': { color: '#8c8c8c', text: '已完成' },
  '已关闭': { color: '#8c8c8c', text: '已关闭' },
  '已终止': { color: 'error', text: '已终止' },
  open: { color: 'processing', text: '招聘中' },
  recruiting: { color: 'blue', text: '待招聘' },
  hired: { color: 'success', text: '已入职' },
  onboarding: { color: 'processing', text: '入职中' },
  paused: { color: 'warning', text: '暂停' },
  cancelled: { color: 'error', text: '已终止' },
  pool: { color: 'blue', text: '储备简历' },
};

const urgencyConfig: Record<string, { color: string; text: string }> = {
  low: { color: 'green', text: '低' },
  medium: { color: 'blue', text: '中' },
  high: { color: 'orange', text: '高' },
  urgent: { color: 'red', text: '紧急' },
  normal: { color: 'blue', text: '中' },  // 兼容旧数据
  // 飞书 Bitable 返回的中文紧急度
  '低': { color: 'green', text: '低' },
  '中': { color: 'blue', text: '中' },
  '高': { color: 'orange', text: '高' },
  '紧急': { color: 'red', text: '紧急' },
  '普通': { color: 'blue', text: '中' },
  '不急': { color: 'green', text: '低' },
};

const RequisitionsList: React.FC = () => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [jdModalVisible, setJdModalVisible] = useState(false);
  const [jdFormData, setJdFormData] = useState<Record<string, any>>({});
  const [form] = Form.useForm();
  const [searchDept, setSearchDept] = useState('');
  const [filterStatus, setFilterStatus] = useState<string | undefined>();
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const { selectedOwner } = useOwner();
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [tablePage, setTablePage] = useState(1);
  const pageSize = 10;

  const handleAIJD = async (id: string) => {
    setAiLoading(id);
    try {
      const res = await request.post(`/requisitions/${id}/ai-jd`) as any;
      if (res && !res.detail) {
        message.success('AI已生成岗位描述和要求');
        fetchData();
      } else {
        message.error(res?.detail || 'AI生成失败');
      }
    } catch (e: any) {
      message.error(e.response?.data?.detail || 'AI生成失败');
    } finally {
      setAiLoading(null);
    }
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (searchDept) params.department = searchDept;
      if (filterStatus) params.status = filterStatus;
      if (selectedOwner) params.responsible_person = selectedOwner;
      const res = await request.get('/requisitions', { params });
      const list = (res || []) as any[];
      list.sort((a: any, b: any) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      setData(list);
    } catch (e) {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  }, [searchDept, filterStatus, selectedOwner]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ headcount: 1, urgency: 'medium', employment_type: 'full_time' });
    setModalVisible(true);
  };

  const handleEdit = (record: any) => {
    setEditing(record);
    form.setFieldsValue({
      ...record,
      expected_date: record.expected_date ? dayjs(record.expected_date) : null,
      city: Array.isArray(record.city) ? record.city : (record.city ? [record.city] : []),
    });
    setModalVisible(true);
  };

  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) { message.warning('请先选择要删除的需求'); return; }
    Modal.confirm({
      title: '确认批量删除',
      content: `确定要删除选中的 ${selectedRowKeys.length} 个需求吗？`,
      okText: '确认', cancelText: '取消', okType: 'danger',
      onOk: async () => {
        try {
          await Promise.all(selectedRowKeys.map(id => request.delete(`/requisitions/${id}`)));
          message.success(`成功删除 ${selectedRowKeys.length} 个需求`);
          setSelectedRowKeys([]);
          fetchData();
        } catch (e: any) { message.error(e?.response?.data?.detail || '批量删除失败'); }
      },
    });
  };

  const handleBatchStatus = (status: string) => {
    if (selectedRowKeys.length === 0) { message.warning('请先选择要操作的需求'); return; }
    Modal.confirm({
      title: '确认批量修改状态',
      content: `确定要将选中的 ${selectedRowKeys.length} 个需求状态改为"${statusConfig[status]?.text || status}"吗？`,
      okText: '确认', cancelText: '取消',
      onOk: async () => {
        try {
          await Promise.all(selectedRowKeys.map(id => request.put(`/requisitions/${id}`, { status })));
          message.success(`成功更新 ${selectedRowKeys.length} 个需求`);
          setSelectedRowKeys([]);
          fetchData();
        } catch (e: any) { message.error(e?.response?.data?.detail || '批量操作失败'); }
      },
    });
  };

  const handleOpenJDModal = async () => {
    try {
      const values = await form.validateFields(['title']);
      if (!values.title) { message.error('请先填写岗位名称'); return; }
      setJdFormData({
        title: form.getFieldValue('title') || '',
        department: form.getFieldValue('department') || '',
        location: form.getFieldValue('city') || '',
        salary_range: form.getFieldValue('salary_range') || '',
      });
      setJdModalVisible(true);
    } catch { message.error('请先填写岗位名称'); }
  };

  const handleJDConfirm = (description: string, requirements: string) => {
    form.setFieldsValue({ description, requirements });
    setJdModalVisible(false);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const values = await form.validateFields();
      const payload = {
        ...values,
        expected_date: values.expected_date ? values.expected_date.toISOString() : null,
      };
      if (editing) {
        await request.put(`/requisitions/${editing.id}`, payload);
        message.success('更新成功');
      } else {
        await request.post('/requisitions', payload);
        message.success('创建成功');
      }
      setModalVisible(false);
      fetchData();
    } catch (e: any) {
      if (e?.errorFields) return; // Validation error
      if (e.response) message.error(e.response.data?.detail || '操作失败');
      else message.error('操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (id: string) => {
    setActionLoading(id);
    try {
      await request.post(`/requisitions/${id}/approve`);
      message.success('已批准');
      fetchData();
    } catch (e: any) {
      message.error(e.response?.data?.detail || '操作失败');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (id: string) => {
    setActionLoading(id);
    try {
      await request.post(`/requisitions/${id}/reject`);
      message.success('已驳回');
      fetchData();
    } catch (e: any) {
      message.error(e.response?.data?.detail || '操作失败');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await request.delete(`/requisitions/${id}`);
      message.success('已删除');
      fetchData();
    } catch (e: any) {
      message.error(e.response?.data?.detail || '删除失败');
    } finally {
      setDeletingId(null);
    }
  };

  const handleFeishuSync = async () => {
    setSyncLoading(true);
    try {
      const res = await request.post('/requisitions/sync-from-feishu') as any;
      if (res && res.ok) {
        message.success(res.message || `同步完成：新增 ${res.created} 条，更新 ${res.updated} 条`);
        fetchData();
      } else {
        message.error(res?.detail || '飞书导入失败');
      }
    } catch (e: any) {
      message.error(e.response?.data?.detail || '飞书导入失败');
    } finally {
      setSyncLoading(false);
    }
  };

  const columns = [
    { title: '岗位名称', dataIndex: 'title', key: 'title', width: 180 },
    { title: '部门', dataIndex: 'department', key: 'department', width: 120 },
    {
      title: '城市', dataIndex: 'city', key: 'city', width: 160,
      render: (v: any) => {
        const cities = Array.isArray(v) ? v : (typeof v === 'string' ? v.split(',').filter(Boolean) : []);
        return cities.length ? cities.map((c: string) => <Tag key={c} color="blue">{c}</Tag>) : '-';
      }
    },
    { title: '招聘人数', dataIndex: 'headcount', key: 'headcount', width: 80 },
    {
      title: '紧急程度', dataIndex: 'urgency', key: 'urgency', width: 100,
      render: (v: string) => {
        const c = urgencyConfig[v] || { color: 'default', text: v };
        return <Tag color={c.color}>{c.text}</Tag>;
      }
    },
    {
      title: '薪资范围', dataIndex: 'salary_range', key: 'salary_range', width: 120,
      render: (v: string) => v || '-'
    },
    {
      title: '预算', dataIndex: 'budget', key: 'budget', width: 100,
      render: (v: number) => v ? `${v}万` : '-'
    },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 100,
      render: (v: string) => {
        const c = statusConfig[v] || { color: 'default', text: v };
        return <Tag color={c.color}>{c.text}</Tag>;
      }
    },
    {
      title: '期望到岗', dataIndex: 'expected_date', key: 'expected_date', width: 120,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD') : '-'
    },
    {
      title: '操作', align: 'center' as const, key: 'action', width: 220,
      render: (_: any, record: any) => (
        <Space size="small">
          <Button type="link" size="small" icon={aiLoading === record.id ? <LoadingOutlined /> : <ThunderboltOutlined />} onClick={() => handleAIJD(record.id)}>AI生成JD</Button>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>编辑</Button>
          <Popconfirm title="确认删除？" onConfirm={() => handleDelete(record.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />} loading={deletingId === record.id}>删除</Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  return (
    <div>
      <Card
        title="人力需求管理"
        extra={
          <Space wrap>
            <Input size="middle" placeholder="搜索部门" prefix={<SearchOutlined />} value={searchDept} onChange={e => setSearchDept(e.target.value)} onPressEnter={fetchData} style={{ width: 200 }} allowClear />
            <Select size="middle" placeholder="状态筛选" allowClear style={{ width: 200 }} value={filterStatus} onChange={v => setFilterStatus(v)}>
              {Object.entries(statusConfig).map(([k, v]) => <Option key={k} value={k}>{v.text}</Option>)}
            </Select>
            <Button size="small" icon={<ReloadOutlined />} onClick={fetchData}>刷新</Button>
            <Button type="primary" size="small" icon={<CloudUploadOutlined />} loading={syncLoading} onClick={handleFeishuSync}>飞书导入</Button>
            <Button type="primary" size="small" icon={<PlusOutlined />} onClick={handleCreate}>提报需求</Button>
          </Space>
        }
      >
        {selectedRowKeys.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <Space>
              <span style={{ color: '#64748B' }}>已选 {selectedRowKeys.length} 项</span>
              <Select size="small" placeholder="批量改状态" style={{ width: 140 }} onChange={v => v && handleBatchStatus(v)} value={undefined}>
                {Object.entries(statusConfig).map(([k, v]) => <Option key={k} value={k}>{v.text}</Option>)}
              </Select>
              <Button danger size="small" onClick={handleBatchDelete}>批量删除</Button>
              <Button size="small" onClick={() => setSelectedRowKeys([])}>取消选择</Button>
            </Space>
          </div>
        )}
        <Table dataSource={data.slice((tablePage - 1) * pageSize, tablePage * pageSize)} columns={columns} rowKey="id" loading={loading}
          scroll={{ x: 1400 }}
          pagination={false}
          rowSelection={{
            selectedRowKeys,
            onChange: setSelectedRowKeys,
            columnWidth: 40,
          }}
        />
        <SimplePagination current={tablePage} pageSize={pageSize} total={data.length} onChange={setTablePage} />
      </Card>

      <Modal title={editing ? '编辑需求' : '提报人力需求'} open={modalVisible} onCancel={() => setModalVisible(false)}
        onOk={handleSubmit} width={640} confirmLoading={submitting}>
        <Form form={form} layout="vertical">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="title" label="岗位名称" rules={[{ required: true, message: '请输入岗位名称' }]}>
                <Input placeholder="如：高级前端工程师" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="department" label="部门" rules={[{ required: true, message: '请输入部门' }]}>
                <Input placeholder="如：技术部" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="headcount" label="招聘人数" rules={[{ required: true }]}>
                <InputNumber min={1} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="employment_type" label="用工类型">
                <Select>
                  <Option value="full_time">全职</Option>
                  <Option value="part_time">兼职</Option>
                  <Option value="intern">实习</Option>
                  <Option value="contract">外包</Option>
                </Select>
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="urgency" label="紧急程度">
                <Select>
                  {Object.entries(urgencyConfig)
                    .filter(([k]) => ['low', 'medium', 'high', 'urgent'].includes(k))
                    .map(([k, v]) => <Option key={k} value={k}>{v.text}</Option>)}
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={24}>
              <Form.Item name="city" label="招聘城市（多选）">
                <Select mode="multiple" placeholder="选择城市" allowClear>
                  <Option value="北京">北京</Option><Option value="上海">上海</Option>
                  <Option value="广州">广州</Option><Option value="深圳">深圳</Option>
                  <Option value="成都">成都</Option><Option value="长沙">长沙</Option>
                  <Option value="杭州">杭州</Option><Option value="武汉">武汉</Option>
                  <Option value="南京">南京</Option><Option value="西安">西安</Option>
                  <Option value="重庆">重庆</Option><Option value="天津">天津</Option>
                  <Option value="苏州">苏州</Option><Option value="郑州">郑州</Option>
                </Select>
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="salary_range" label="薪资范围">
                <Input placeholder="如：15-25K" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="budget" label="预算（万/年）">
                <InputNumber min={0} style={{ width: '100%' }} placeholder="如：30" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="expected_date" label="期望到岗日期">
                <DatePicker style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="reporting_to" label="汇报对象">
            <Input placeholder="如：技术总监" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={8}>
              <Form.Item name="hr_interviewer" label="HR面试官">
                <Input placeholder="HR面试官" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="biz_interviewer" label="业务面试官">
                <Input placeholder="业务面试官" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="final_interviewer" label="终面面试官">
                <Input placeholder="终面面试官" />
              </Form.Item>
            </Col>
          </Row>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontWeight: 500 }}>岗位描述</span>
            <Button type="link" icon={<ThunderboltOutlined />} onClick={handleOpenJDModal}>AI 生成 JD</Button>
          </div>
          <Form.Item name="description">
            <TextArea rows={3} placeholder="岗位职责描述" />
          </Form.Item>
          <Form.Item name="requirements" label="任职要求">
            <TextArea rows={3} placeholder="学历、经验、技能等要求" />
          </Form.Item>
          <Form.Item name="hard_requirements" label="硬性要求（一票否决，不对外公开）">
            <TextArea rows={2} placeholder="如：年龄45岁以上不考虑、学历必须大专以上" />
          </Form.Item>
          <Form.Item name="personalized_requirements" label="个性化需求（按城市，不写在BOSS JD里）">
            <TextArea rows={3} placeholder="如：成都需男性、长沙需地推经验、上海需外企经验" />
          </Form.Item>
          <Form.Item name="channel_plan" label="渠道规划">
            <TextArea rows={2} placeholder="招聘渠道计划" />
          </Form.Item>
        </Form>
      </Modal>
      <JDGeneratorModal
        visible={jdModalVisible}
        onCancel={() => setJdModalVisible(false)}
        onConfirm={handleJDConfirm}
        title={jdFormData.title || ''}
        department={jdFormData.department}
        location={jdFormData.location}
        salary_range={jdFormData.salary_range}
      />
    </div>
  );
};

export default RequisitionsList;
