import React, { useEffect, useState, useCallback } from 'react';
import {
  Card, Table, Button, Space, Tag, Modal, Form, Input, Select,
  message, Popconfirm, Drawer, Descriptions, Typography, Row, Col, Statistic
} from 'antd';
import SimplePagination from '../../components/SimplePagination';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined,
  EyeOutlined, SafetyOutlined
} from '@ant-design/icons';
import request from '../../utils/request';
import dayjs from 'dayjs';

const { TextArea } = Input;
const { Option } = Select;

const statusConfig: Record<string, { color: string; text: string }> = {
  pending: { color: 'default', text: '待背调' },
  in_progress: { color: 'processing', text: '背调中' },
  completed: { color: 'success', text: '已完成' },
};

const resultConfig: Record<string, { color: string; text: string }> = {
  passed: { color: 'success', text: '通过' },
  failed: { color: 'error', text: '不通过' },
  pending_feedback: { color: 'warning', text: '待反馈' },
};

const BackgroundChecksList: React.FC = () => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();
  const [detailVisible, setDetailVisible] = useState(false);
  const [current, setCurrent] = useState<any>(null);
  const [resumes, setResumes] = useState<any[]>([]);
  const [tablePage, setTablePage] = useState(1);
  const pageSize = 10;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request.get('/background-checks');
      setData(res || []);
    } catch (e) { message.error('加载失败'); }
    finally { setLoading(false); }
  }, []);

  const fetchResumes = useCallback(async () => {
    try {
      const res = await request.get('/resumes', { params: { limit: 200 } });
      setResumes(res || []);
    } catch (e) { }
  }, []);

  useEffect(() => { fetchData(); fetchResumes() }, []) // eslint-disable-line;

  const handleCreate = () => {
    setEditing(null); form.resetFields();
    form.setFieldsValue({ status: 'pending' });
    setModalVisible(true);
  };

  const handleEdit = (record: any) => {
    setEditing(record); form.setFieldsValue(record);
    setModalVisible(true);
  };

  const handleResumeChange = (resumeId: string) => {
    if (!resumeId) return;
    const resume = resumes.find((r: any) => r.id === resumeId);
    if (resume) {
      form.setFieldsValue({
        candidate_name: resume.candidate_name || '',
        position_title: resume.position_applied || resume.mapped_position || resume.standard_position || '',
      });
    }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editing) {
        await request.put(`/background-checks/${editing.id}`, values);
        message.success('更新成功');
      } else {
        await request.post('/background-checks', values);
        message.success('创建成功');
      }
      setModalVisible(false); fetchData();
    } catch (e: any) {
      if (e.response) message.error(e.response.data?.detail || '操作失败');
    }
  };

  const handleDelete = async (id: string) => {
    try { await request.delete(`/background-checks/${id}`); message.success('已删除'); fetchData(); }
    catch (e: any) { message.error(e.response?.data?.detail || '删除失败'); }
  };

  const columns = [
    { title: '候选人', dataIndex: 'candidate_name', key: 'candidate_name', width: 120 },
    { title: '应聘岗位', dataIndex: 'position_title', key: 'position_title', width: 130 },
    { title: '状态', dataIndex: 'status', key: 'status', width: 100,
      render: (v: string) => { const c = statusConfig[v] || { color: 'default', text: v }; return <Tag color={c.color}>{c.text}</Tag>; }
    },
    { title: '整体结果', dataIndex: 'overall_result', key: 'overall_result', width: 100,
      render: (v: string) => v ? (resultConfig[v] ? <Tag color={resultConfig[v].color}>{resultConfig[v].text}</Tag> : v) : '-'
    },
    { title: '调查日期', dataIndex: 'conducted_at', key: 'conducted_at', width: 120,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD') : '-'
    },
    { title: '犯罪记录', dataIndex: 'criminal_check', key: 'criminal_check', width: 100,
      render: (v: string) => v ? <Tag color="red">{v}</Tag> : '-'
    },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at', width: 120,
      render: (v: string) => dayjs(v).format('YYYY-MM-DD')
    },
    { title: '操作', align: 'center' as const, key: 'action', width: 180, fixed: 'right' as const,
      render: (_: any, record: any) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => { setCurrent(record); setDetailVisible(true); }}>详情</Button>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>编辑</Button>
          <Popconfirm title="确认删除？" onConfirm={() => handleDelete(record.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      )
    }
  ];

  const pendingCount = data.filter((d: any) => d.status === 'pending').length;
  const inProgressCount = data.filter((d: any) => d.status === 'in_progress').length;
  const completedCount = data.filter((d: any) => d.status === 'completed').length;

  return (
    <div>
      <Card title={<span><SafetyOutlined /> 背景调查管理</span>}
        extra={<Space>
          <Button icon={<ReloadOutlined />} onClick={fetchData}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>发起背调</Button>
        </Space>}>
        <Row gutter={16} style={{ marginBottom: 24 }}>
          <Col span={6}>
            <Card size="small"><Statistic title="背调总数" value={data.length} /></Card>
          </Col>
          <Col span={6}>
            <Card size="small"><Statistic title="待背调" value={pendingCount} valueStyle={{ color: '#8c8c8c' }} /></Card>
          </Col>
          <Col span={6}>
            <Card size="small"><Statistic title="背调中" value={inProgressCount} valueStyle={{ color: '#1677ff' }} /></Card>
          </Col>
          <Col span={6}>
            <Card size="small"><Statistic title="已完成" value={completedCount} valueStyle={{ color: '#52c41a' }} /></Card>
          </Col>
        </Row>
        <Table dataSource={data.slice((tablePage - 1) * pageSize, tablePage * pageSize)} columns={columns} rowKey="id" loading={loading}
          scroll={{ x: 1050 }} pagination={false} />
        <SimplePagination current={tablePage} pageSize={pageSize} total={data.length} onChange={setTablePage} />
      </Card>
      <Modal title={editing ? '编辑背调' : '发起背调'} open={modalVisible}
        onCancel={() => setModalVisible(false)} onOk={handleSubmit} width={640} destroyOnHidden>
        <Form form={form} layout="vertical">
          <Form.Item name="resume_id" label="关联简历" rules={[{ required: true, message: '请选择简历' }]}>
            <Select showSearch placeholder="选择候选人简历" optionFilterProp="children"
              onChange={(val: string) => handleResumeChange(val)}>
              {resumes.map((r: any) => <Option key={r.id} value={r.id}>{r.candidate_name} - {r.position_title || '未知岗位'}</Option>)}
            </Select>
          </Form.Item>
          <Form.Item name="candidate_name" label="候选人姓名" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="position_title" label="应聘岗位">
            <Input />
          </Form.Item>
          {editing && (<>
            <Form.Item name="status" label="状态">
              <Select>{Object.entries(statusConfig).map(([k, v]) => <Option key={k} value={k}>{v.text}</Option>)}</Select>
            </Form.Item>
            <Form.Item name="overall_result" label="整体结果">
              <Select allowClear>{Object.entries(resultConfig).map(([k, v]) => <Option key={k} value={k}>{v.text}</Option>)}</Select>
            </Form.Item>
            <Form.Item name="work_verification" label="工作履历核实">
              <TextArea rows={2} placeholder="请输入工作履历核实信息" />
            </Form.Item>
            <Form.Item name="education_verification" label="学历核实">
              <TextArea rows={2} placeholder="请输入学历核实信息" />
            </Form.Item>
            <Form.Item name="reference_check" label="推荐人核查">
              <TextArea rows={2} placeholder="请输入推荐人核查信息" />
            </Form.Item>
            <Form.Item name="conducted_at" label="调查日期">
              <Input placeholder="YYYY-MM-DD" />
            </Form.Item>
            <Form.Item name="criminal_check" label="犯罪记录核查">
              <Input placeholder="如：无记录 / 有记录（描述）" />
            </Form.Item>
            <Form.Item name="notes" label="备注"><TextArea rows={3} /></Form.Item>
          </>)}
        </Form>
      </Modal>
      <Drawer size="large" title="背调详情" open={detailVisible} onClose={() => setDetailVisible(false)}>
        {current && (
          <Descriptions column={1} bordered>
            <Descriptions.Item label="候选人">{current.candidate_name}</Descriptions.Item>
            <Descriptions.Item label="应聘岗位">{current.position_title || '-'}</Descriptions.Item>
            <Descriptions.Item label="状态">{statusConfig[current.status]?.text || current.status}</Descriptions.Item>
            <Descriptions.Item label="整体结果">{current.overall_result ? (resultConfig[current.overall_result]?.text || current.overall_result) : '-'}</Descriptions.Item>
            <Descriptions.Item label="工作履历核实">{current.work_verification ? JSON.stringify(current.work_verification) : '-'}</Descriptions.Item>
            <Descriptions.Item label="学历核实">{current.education_verification ? JSON.stringify(current.education_verification) : '-'}</Descriptions.Item>
            <Descriptions.Item label="推荐人核查">{current.reference_check ? JSON.stringify(current.reference_check) : '-'}</Descriptions.Item>
            <Descriptions.Item label="犯罪记录">{current.criminal_check || '-'}</Descriptions.Item>
            <Descriptions.Item label="调查日期">{current.conducted_at ? dayjs(current.conducted_at).format('YYYY-MM-DD HH:mm') : '-'}</Descriptions.Item>
            <Descriptions.Item label="备注">{current.notes || '-'}</Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>
    </div>
  );
};

export default BackgroundChecksList;
