import React, { useEffect, useState, useCallback } from 'react';
import {
  Card, Table, Button, Space, Tag, Modal, Form, Input, DatePicker, InputNumber,
  Select, message, Popconfirm, Drawer, Descriptions, Timeline, Row, Col, Statistic,
  Typography
} from 'antd';
import SimplePagination from '../../components/SimplePagination';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined,
  EyeOutlined, CheckCircleOutlined, FileTextOutlined,
  ThunderboltOutlined, LoadingOutlined
} from '@ant-design/icons';
import request from '../../utils/request';
import dayjs from 'dayjs';
import { ResponsiveDataView } from '../../components/Responsive';
import { ResponsiveModal } from '../../components/Responsive/ResponsiveModal';

const { TextArea } = Input;
const { Option } = Select;

const resultConfig: Record<string, { color: string; text: string }> = {
  pending: { color: 'processing', text: '试用中' },
  confirmed: { color: 'success', text: '已转正' },
  extended: { color: 'warning', text: '延长试用' },
  terminated: { color: 'error', text: '未通过' },
};

const ProbationList: React.FC = () => {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form] = Form.useForm();
  const [detailVisible, setDetailVisible] = useState(false);
  const [current, setCurrent] = useState<any>(null);
  const [reviewVisible, setReviewVisible] = useState(false);
  const [reviewTarget, setReviewTarget] = useState<any>(null);
  const [reviewForm] = Form.useForm();
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [aiAssessVisible, setAiAssessVisible] = useState(false);
  const [aiAssessResult, setAiAssessResult] = useState('');
  const [tablePage, setTablePage] = useState(1);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const pageSize = 10;

  const handleAIAssessment = async (id: string) => {
    setAiLoading(id);
    try {
      const res = await request.post(`/probation/${id}/ai-assessment`) as any;
      if (res && !res.detail) {
        setAiAssessResult(res.final_assessment || '');
        setAiAssessVisible(true);
        fetchData();
      } else {
        message.error(res?.detail || 'AI评估失败');
      }
    } catch (e: any) {
      message.error(e.response?.data?.detail || 'AI评估失败');
    } finally {
      setAiLoading(null);
    }
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // 试用期记录 responsible_person 字段暂未填充，先全量显示
      const res = await request.get('/probation');
      setData(res || []);
    }
    catch (e) { message.error('加载失败'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCreate = () => {
    setEditing(null); form.resetFields();
    form.setFieldsValue({ probation_months: 3 });
    setModalVisible(true);
  };

  const handleEdit = (record: any) => {
    setEditing(record);
    form.setFieldsValue({
      ...record,
      probation_start: record.probation_start ? dayjs(record.probation_start) : null,
    });
    setModalVisible(true);
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      const payload = {
        ...values,
        probation_start: values.probation_start ? values.probation_start.toISOString() : null,
      };
      setSubmitting(true);
      if (editing) {
        await request.put(`/probation/${editing.id}`, payload);
        message.success('更新成功');
      } else {
        await request.post('/probation', payload);
        message.success('创建成功');
      }
      setModalVisible(false); fetchData();
    } catch (e: any) {
      if (e.response) message.error(e.response.data?.detail || '操作失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirm = async (id: string) => {
    try { setConfirmingId(id); await request.post(`/probation/${id}/confirm`); message.success('已确认转正'); fetchData(); }
    catch (e: any) { message.error(e.response?.data?.detail || '操作失败'); }
    finally { setConfirmingId(null); }
  };

  const handleAddReview = (record: any) => {
    setReviewTarget(record); reviewForm.resetFields(); setReviewVisible(true);
  };

  const handleReviewSubmit = async () => {
    try {
      const values = await reviewForm.validateFields();
      setReviewSubmitting(true);
      await request.post(`/probation/${reviewTarget.id}/review`, values);
      message.success('月度评估已添加');
      setReviewVisible(false); fetchData();
    } catch (e: any) {
      if (e.response) message.error(e.response.data?.detail || '操作失败');
    } finally {
      setReviewSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try { setDeletingId(id); await request.delete(`/probation/${id}`); message.success('已删除'); fetchData(); }
    catch (e: any) { message.error(e.response?.data?.detail || '删除失败'); }
    finally { setDeletingId(null); }
  };

  const handleBatchDelete = async () => {
    if (selectedRowKeys.length === 0) { message.warning('请先选择'); return; }
    Modal.confirm({
      title: '确认批量删除',
      content: `确定要删除选中的 ${selectedRowKeys.length} 条试用记录吗？`,
      onOk: async () => {
        try {
          await Promise.all(selectedRowKeys.map(id => request.delete(`/probation/${id}`)));
          message.success(`成功删除 ${selectedRowKeys.length} 条试用记录`);
          setSelectedRowKeys([]);
          fetchData();
        } catch (e: any) { message.error(e?.response?.data?.detail || '批量操作失败'); }
      }
    });
  };

  const columns = [
    { title: '姓名', dataIndex: 'employee_name', key: 'employee_name', width: 100 },
    { title: '工号', dataIndex: 'employee_id', key: 'employee_id', width: 90, render: (v: string) => v || '-' },
    { title: '试用开始', dataIndex: 'probation_start', key: 'probation_start', width: 110,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD') : '-' },
    { title: '试用结束', dataIndex: 'probation_end', key: 'probation_end', width: 110,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD') : '-' },
    { title: '期限', dataIndex: 'probation_months', key: 'probation_months', width: 70,
      render: (v: number) => `${v || 3}个月` },
    { title: '月度评估', key: 'reviews', width: 90,
      render: (_: any, r: any) => `${(r.monthly_reviews || []).length}次` },
    { title: '结果', dataIndex: 'result', key: 'result', width: 100,
      render: (v: string) => { const c = resultConfig[v] || { color: 'default', text: v }; return <Tag color={c.color}>{c.text}</Tag>; } },
    { title: '转正日期', dataIndex: 'confirmed_at', key: 'confirmed_at', width: 110,
      render: (v: string) => v ? dayjs(v).format('YYYY-MM-DD') : '-' },
    { title: '操作', align: 'center' as const, key: 'action', width: 300,
      render: (_: any, record: any) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => { setCurrent(record); setDetailVisible(true); }}>详情</Button>
          <Button type="link" size="small" icon={aiLoading === record.id ? <LoadingOutlined /> : <ThunderboltOutlined />} onClick={() => handleAIAssessment(record.id)}>AI评估</Button>
          {record.result === 'pending' && (<>
            <Button type="link" size="small" icon={<FileTextOutlined />} onClick={() => handleAddReview(record)}>评估</Button>
            <Popconfirm title="确认转正？" onConfirm={() => handleConfirm(record.id)}>
              <Button type="primary" size="small" icon={<CheckCircleOutlined />} loading={confirmingId === record.id}>转正</Button>
            </Popconfirm>
          </>)}
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
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={24} sm={12} md={6}><Card><Statistic title="试用总数" value={data.length} /></Card></Col>
        <Col xs={24} sm={12} md={6}><Card><Statistic title="试用中" value={data.filter(r => r.result === 'pending').length} /></Card></Col>
        <Col xs={24} sm={12} md={6}><Card><Statistic title="已转正" value={data.filter(r => r.result === 'confirmed').length} /></Card></Col>
        <Col xs={24} sm={12} md={6}><Card><Statistic title="未通过" value={data.filter(r => r.result === 'terminated').length} /></Card></Col>
      </Row>
      <Card title={<span><CheckCircleOutlined /> 试用期与转正管理</span>}
        extra={<Space>
          <Button size="small" icon={<ReloadOutlined />} onClick={fetchData}>刷新</Button>
          <Button type="primary" size="small" icon={<PlusOutlined />} onClick={handleCreate}>新增试用</Button>
        </Space>}>
        {selectedRowKeys.length > 0 && (
          <div style={{ marginBottom: 12, padding: '8px 12px', background: '#e6f7ff', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span>已选 {selectedRowKeys.length} 项</span>
            <Button size="small" danger onClick={handleBatchDelete}>批量删除</Button>
          </div>
        )}
        <ResponsiveDataView dataSource={data.slice((tablePage - 1) * pageSize, tablePage * pageSize)} columns={columns} rowKey="id" loading={loading}
          scroll={{ x: 1500 }} pagination={false}
          rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys, columnWidth: 40 }}
          card={{
            title: record => record.employee_name || '-',
            subtitle: record => [record.probation_start ? dayjs(record.probation_start).format('YYYY-MM-DD') : '', record.probation_end ? dayjs(record.probation_end).format('YYYY-MM-DD') : ''].filter(Boolean).join(' · '),
            status: record => (columns[6] as any).render(record.result),
            fields: [
              { key: 'employee_id', label: '工号', level: 'detail', render: record => record.employee_id || '-' },
              { key: 'probation_months', label: '期限', level: 'detail', render: record => (columns[4] as any).render(record.probation_months) },
              { key: 'reviews', label: '月度评估', level: 'detail', render: record => (columns[5] as any).render(null, record) },
              { key: 'confirmed_at', label: '转正日期', level: 'detail', render: record => (columns[7] as any).render(record.confirmed_at) },
            ],
            actions: record => (columns[8] as any).render(null, record),
          }}
        />
        <SimplePagination current={tablePage} pageSize={pageSize} total={data.length} onChange={setTablePage} />
      </Card>
      <ResponsiveModal title={editing ? '编辑试用记录' : '新增试用记录'} open={modalVisible}
        onCancel={() => setModalVisible(false)} onOk={handleSubmit} confirmLoading={submitting} width={560} destroyOnHidden>
        <Form form={form} layout="vertical">
          <Form.Item name="employee_name" label="员工姓名" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input />
          </Form.Item>
          <Row gutter={16}>
            <Col xs={24} sm={12} md={8}><Form.Item name="employee_id" label="工号"><Input placeholder="如：EMP001" /></Form.Item></Col>
            <Col xs={24} sm={12} md={8}><Form.Item name="probation_months" label="试用期（月）"><InputNumber min={1} max={12} style={{ width: '100%' }} /></Form.Item></Col>
          </Row>
          <Form.Item name="probation_start" label="试用开始日期"><DatePicker style={{ width: '100%' }} /></Form.Item>
          {editing && (<>
            <Form.Item name="final_assessment" label="最终评估"><TextArea rows={3} placeholder="试用期述职评估" /></Form.Item>
            <Form.Item name="result" label="结果">
              <Select>{Object.entries(resultConfig).map(([k, v]) => <Option key={k} value={k}>{v.text}</Option>)}</Select>
            </Form.Item>
            <Row gutter={16}>
              <Col xs={24} sm={12} md={8}><Form.Item name="new_title" label="转正后职位"><Input /></Form.Item></Col>
              <Col xs={24} sm={12} md={8}><Form.Item name="salary_adjustment" label="薪资调整（%）"><InputNumber style={{ width: '100%' }} placeholder="如：10" /></Form.Item></Col>
            </Row>
            <Form.Item name="notes" label="备注"><TextArea rows={2} /></Form.Item>
          </>)}
        </Form>
      </ResponsiveModal>
      <ResponsiveModal title="添加月度评估" open={reviewVisible} onCancel={() => setReviewVisible(false)}
        onOk={handleReviewSubmit} confirmLoading={reviewSubmitting} width={520} destroyOnHidden>
        <Form form={reviewForm} layout="vertical">
          <Form.Item name="month" label="评估月份" rules={[{ required: true, message: '请输入月份' }]}>
            <Input placeholder="如：第1个月" />
          </Form.Item>
          <Form.Item name="performance" label="工作表现" rules={[{ required: true, message: '请输入评估' }]}>
            <TextArea rows={3} placeholder="工作能力、态度、成果等" />
          </Form.Item>
          <Form.Item name="issues" label="存在问题"><TextArea rows={2} placeholder="需要改进的方面" /></Form.Item>
          <Form.Item name="suggestion" label="导师建议"><TextArea rows={2} /></Form.Item>
        </Form>
      </ResponsiveModal>
      <Drawer size="large" title="试用期详情" open={detailVisible} onClose={() => setDetailVisible(false)}>
        {current && (<>
          <Descriptions column={1} bordered style={{ marginBottom: 24 }}>
            <Descriptions.Item label="姓名">{current.employee_name}</Descriptions.Item>
            <Descriptions.Item label="工号">{current.employee_id || '-'}</Descriptions.Item>
            <Descriptions.Item label="试用开始">{current.probation_start ? dayjs(current.probation_start).format('YYYY-MM-DD') : '-'}</Descriptions.Item>
            <Descriptions.Item label="试用结束">{current.probation_end ? dayjs(current.probation_end).format('YYYY-MM-DD') : '-'}</Descriptions.Item>
            <Descriptions.Item label="期限">{current.probation_months || 3}个月</Descriptions.Item>
            <Descriptions.Item label="结果">{resultConfig[current.result]?.text || current.result}</Descriptions.Item>
            <Descriptions.Item label="转正日期">{current.confirmed_at ? dayjs(current.confirmed_at).format('YYYY-MM-DD') : '-'}</Descriptions.Item>
            <Descriptions.Item label="转正后职位">{current.new_title || '-'}</Descriptions.Item>
            <Descriptions.Item label="薪资调整">{current.salary_adjustment ? `${current.salary_adjustment}%` : '-'}</Descriptions.Item>
            <Descriptions.Item label="最终评估">{current.final_assessment || '-'}</Descriptions.Item>
          </Descriptions>
          <h4>月度评估记录</h4>
          <Timeline
            items={(current.monthly_reviews || []).map((rv: any, i: number) => ({
              children: (
                <div>
                  <p><strong>{rv.month || `第${i+1}次`}</strong></p>
                  <p>表现：{rv.performance}</p>
                  {rv.issues && <p>问题：{rv.issues}</p>}
                  {rv.suggestion && <p>建议：{rv.suggestion}</p>}
                  {rv.reviewed_at && <p style={{ color: '#999' }}>{dayjs(rv.reviewed_at).format('YYYY-MM-DD HH:mm')}</p>}
                </div>
              ),
            }))}
          />
        </>)}
      </Drawer>

      <ResponsiveModal
        title="AI试用期评估"
        open={aiAssessVisible}
        onCancel={() => setAiAssessVisible(false)}
        footer={null}
        width={700}
      >
        <div style={{ whiteSpace: 'pre-wrap', maxHeight: '60vh', overflowY: 'auto' }}>
          {aiAssessResult}
        </div>
      </ResponsiveModal>
    </div>
  );
};

export default ProbationList;
