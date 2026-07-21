import React, { useEffect, useState, useCallback } from 'react';
import {
  Card, Table, Button, Space, Tag, Modal, Form, Input, InputNumber, DatePicker,
  Select, message, Popconfirm, Row, Col, Statistic, Typography, Tooltip, Pagination
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined,
  ReloadOutlined, SearchOutlined,
  ThunderboltOutlined, LoadingOutlined
} from '@ant-design/icons';
import request from '../../utils/request';
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
};

const urgencyConfig: Record<string, { color: string; text: string }> = {
  low: { color: 'green', text: '低' },
  medium: { color: 'blue', text: '中' },
  high: { color: 'orange', text: '高' },
  urgent: { color: 'red', text: '紧急' },
  // 飞书 Bitable 返回的中文紧急度
  '低': { color: 'green', text: '低' },
  '中': { color: 'blue', text: '中' },
  '高': { color: 'orange', text: '高' },
  '紧急': { color: 'red', text: '紧急' },
  '普通': { color: 'green', text: '普通' },
};

const RequisitionsList: React.FC = () => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();
  const [searchDept, setSearchDept] = useState('');
  const [filterStatus, setFilterStatus] = useState<string | undefined>();
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const { selectedOwner } = useOwner();
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
      setData(res || []);
    } catch (e) {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  }, [searchDept, filterStatus, selectedOwner]);

  useEffect(() => { fetchData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
    });
    setModalVisible(true);
  };

  const handleSubmit = async () => {
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
      if (e.response) message.error(e.response.data?.detail || '操作失败');
    }
  };

  const handleApprove = async (id: string) => {
    try {
      await request.post(`/requisitions/${id}/approve`);
      message.success('已批准');
      fetchData();
    } catch (e: any) {
      message.error(e.response?.data?.detail || '操作失败');
    }
  };

  const handleReject = async (id: string) => {
    try {
      await request.post(`/requisitions/${id}/reject`);
      message.success('已驳回');
      fetchData();
    } catch (e: any) {
      message.error(e.response?.data?.detail || '操作失败');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await request.delete(`/requisitions/${id}`);
      message.success('已删除');
      fetchData();
    } catch (e: any) {
      message.error(e.response?.data?.detail || '删除失败');
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
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
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
            <Button icon={<ReloadOutlined />} onClick={fetchData}>刷新</Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>提报需求</Button>
          </Space>
        }
      >
        <Table dataSource={data.slice((tablePage - 1) * pageSize, tablePage * pageSize)} columns={columns} rowKey="id" loading={loading}
          scroll={{ x: 1400 }}
          pagination={false}
        />
        <div style={{ marginTop: 12, textAlign: 'right' }}>
          <Space>
            <Button size="small" disabled={tablePage <= 1} onClick={() => setTablePage(p => p - 1)}>上一页</Button>
            <span style={{ color: '#666' }}>{tablePage} / {Math.max(1, Math.ceil(data.length / pageSize))}</span>
            <Button size="small" disabled={tablePage >= Math.ceil(data.length / pageSize)} onClick={() => setTablePage(p => p + 1)}>下一页</Button>
            <span style={{ color: '#999', marginLeft: 8 }}>共 {data.length} 条</span>
          </Space>
        </div>
      </Card>

      <Modal title={editing ? '编辑需求' : '提报人力需求'} open={modalVisible} onCancel={() => setModalVisible(false)}
        onOk={handleSubmit} width={640} destroyOnHidden>
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
                  {Object.entries(urgencyConfig).map(([k, v]) => <Option key={k} value={k}>{v.text}</Option>)}
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
          <Form.Item name="description" label="岗位描述">
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
    </div>
  );
};

export default RequisitionsList;
