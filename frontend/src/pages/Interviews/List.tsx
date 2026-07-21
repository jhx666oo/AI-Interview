import React, { useEffect, useState, useCallback } from 'react';
import {
  Table, Button, Space, message, Tag, Modal, Select, Input, Form,
  Radio, Typography, Card, Tooltip, DatePicker
} from 'antd';
import SimplePagination from '../../components/SimplePagination';
import {
  ReloadOutlined, EditOutlined, EyeOutlined, SearchOutlined,
  BellOutlined, DownloadOutlined, TeamOutlined, UserOutlined
} from '@ant-design/icons';
import request from '../../utils/request';
import { useAuth } from '../../contexts/AuthContext';
import { useOwner } from '../../contexts/OwnerContext';

const { TextArea } = Input;
const { Text } = Typography;

// =================== 统一候选人面试管理 ===================

const interviewStatusConfig: Record<string, { color: string; text: string }> = {
  scheduled: { color: 'processing', text: '待面试' },
  completed: { color: 'success', text: '已完成' },
  cancelled: { color: 'default', text: '已取消' },
};

const resultLabels: Record<string, { color: string; text: string }> = {
  passed: { color: 'success', text: '通过' },
  failed: { color: 'error', text: '不通过' },
};

const talentStatusConfig: Record<string, { color: string; text: string }> = {
  approved: { color: 'success', text: '已入库' },
  pending_screening: { color: 'warning', text: '待初筛' },
  rejected: { color: 'error', text: '已淘汰' },
};

interface MergedRow {
  id: string;
  candidate_name: string;
  position: string;
  position_applied: string;
  standard_position: string;
  education: string;
  city: string;
  talent_status: string;          // 候选人入库状态
  interview_id: string | null;    // 有面试记录才有
  interview_status: string;
  interview_time: string;
  interview_location: string;
  result: string;
  result2: string;
  evaluation: string;
  evaluation2: string;
  feishu_record_id: string;
  resume_id: string;
  interviewer: string;
  primary_interviewer: string;
  secondary_interviewer: string;
}

const InterviewsList: React.FC = () => {
  const { user } = useAuth();
  const { selectedOwner } = useOwner();
  const [data, setData] = useState<MergedRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<string | undefined>();

  // 安排面试弹窗
  const [scheduleModalVisible, setScheduleModalVisible] = useState(false);
  const [scheduleRecord, setScheduleRecord] = useState<MergedRow | null>(null);
  const [scheduleForm] = Form.useForm();
  const [scheduling, setScheduling] = useState(false);

  // 评价弹窗
  const [evalModalVisible, setEvalModalVisible] = useState(false);
  const [evalRecord, setEvalRecord] = useState<MergedRow | null>(null);
  const [evalRound, setEvalRound] = useState<1 | 2>(1);
  const [evalForm] = Form.useForm();
  const [evalSubmitting, setEvalSubmitting] = useState(false);

  // 查看评价弹窗
  const [viewEvalVisible, setViewEvalVisible] = useState(false);
  const [viewEvalRecord, setViewEvalRecord] = useState<MergedRow | null>(null);
  const [tablePage, setTablePage] = useState(1);
  const pageSize = 10;

  const fetchMergedData = useCallback(async () => {
    setLoading(true);
    try {
      // 同时拉候选人 + 面试记录
      const [candidates, interviews] = await Promise.all([
        request.get('/talent-pool', { params: { candidate_name: search || undefined } }).catch(() => []),
        request.get('/interviews', { params: { owner_name: selectedOwner || undefined } }).catch(() => []),
      ]);

      // 构建 interview 索引（按 resume_id/feishu_record_id/候选人名 关联）
      const interviewMap = new Map<string, any>();
      for (const iv of interviews || []) {
        // 尝试多种关联 key
        const keys = [iv.resume_id, iv.comments, iv.interviewer].filter(Boolean);
        for (const k of keys) interviewMap.set(k, iv);
      }

      // 合并
      const merged: MergedRow[] = (candidates || []).map((c: any) => {
        const matchedIv = interviewMap.get(c.feishu_record_id)
          || interviewMap.get(c.id)
          || interviewMap.get(c.candidate_name)
          || (interviews || []).find((iv: any) =>
              iv.comments === c.candidate_name || iv.resume_id === c.feishu_record_id);

        return {
          id: c.id || c.feishu_record_id,
          candidate_name: c.candidate_name || '未知',
          position: c.mapped_position || '',
          position_applied: c.position_applied || '',
          standard_position: c.standard_position || c.position_applied || '',
          education: c.education || '',
          city: c.city || '',
          talent_status: c.status || 'pending_screening',
          interview_id: matchedIv?.id || null,
          interview_status: matchedIv?.status || '',
          interview_time: matchedIv?.interview_time || '',
          interview_location: matchedIv?.interview_location || '',
          result: matchedIv?.result || '',
          result2: matchedIv?.result2 || '',
          evaluation: matchedIv?.evaluation || '',
          evaluation2: matchedIv?.evaluation2 || '',
          feishu_record_id: c.feishu_record_id || c.id || '',
          resume_id: c.id || '',
          interviewer: matchedIv?.interviewer || '',
          primary_interviewer: matchedIv?.primary_interviewer || '',
          secondary_interviewer: matchedIv?.secondary_interviewer || '',
        };
      });

      // 过滤状态下拉
      let filtered = merged;
      if (filterStatus === 'pending_interview') {
        filtered = merged.filter(r => r.talent_status === 'approved' && !r.interview_id);
      } else if (filterStatus === 'scheduled') {
        filtered = merged.filter(r => r.interview_status === 'scheduled');
      } else if (filterStatus === 'completed') {
        filtered = merged.filter(r => r.interview_status === 'completed');
      } else if (filterStatus === 'approved') {
        filtered = merged.filter(r => r.talent_status === 'approved');
      }

      setData(filtered);
    } catch {
      message.error('加载数据失败');
    } finally {
      setLoading(false);
    }
  }, [search, filterStatus, selectedOwner]);

  useEffect(() => { fetchMergedData(); }, []) // eslint-disable-line;

  // == 安排面试 ==
  const handleOpenSchedule = (record: MergedRow) => {
    setScheduleRecord(record);
    scheduleForm.resetFields();
    setScheduleModalVisible(true);
  };

  const handleScheduleSubmit = async () => {
    if (!scheduleRecord) return;
    try {
      const values = await scheduleForm.validateFields();
      const name = scheduleRecord.candidate_name || '该候选人';
      setScheduling(true);

      let interviewTime = '';
      if (values.interview_date && values.interview_time) {
        interviewTime = `${values.interview_date.format('YYYY-MM-DD')} ${values.interview_time.format('HH:mm')}`;
      } else if (values.interview_date) {
        interviewTime = values.interview_date.format('YYYY-MM-DD');
      }

      await request.post('/interviews/create-from-talent', {
        candidate_name: name,
        position_applied: scheduleRecord.position_applied,
        standard_position: scheduleRecord.standard_position,
        city: scheduleRecord.city || '',
        feishu_record_id: scheduleRecord.feishu_record_id || scheduleRecord.resume_id,
        interview_time: interviewTime,
        interview_location: values.interview_location || '',
        interviewer_name: values.interviewer_name || '杜雁玲',
      });
      message.success(`已安排面试：${name}`);
      setScheduleModalVisible(false);
      fetchMergedData();
    } catch (e: any) {
      if (e.errorFields) return;
      message.error(e.response?.data?.detail || '操作失败');
    } finally {
      setScheduling(false);
    }
  };

  // == 下载简历 ==
  const handleDownload = (record: MergedRow) => {
    const token = localStorage.getItem('token') || '';
    const url = `/api/resumes/${record.resume_id}/file?download=true&token=${encodeURIComponent(token)}`;
    const a = document.createElement('a');
    a.href = url;
    a.download = (record.candidate_name || 'resume') + '.pdf';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // == 评价 ==
  const handleEvalRound1 = (record: MergedRow) => {
    setEvalRecord(record);
    setEvalRound(1);
    evalForm.resetFields();
    setEvalModalVisible(true);
  };

  const handleEvalRound2 = (record: MergedRow) => {
    setEvalRecord(record);
    setEvalRound(2);
    evalForm.resetFields();
    setEvalModalVisible(true);
  };

  const handleSubmitEval = async () => {
    try {
      const values = await evalForm.validateFields();
      setEvalSubmitting(true);
      await request.post(`/interviews/${evalRecord!.interview_id}/evaluate`, {
        evaluation: values.evaluation || '',
        result: values.result || '',
        round: evalRound,
      });
      message.success(`第${evalRound}面评价已提交`);
      setEvalModalVisible(false);
      fetchMergedData();
    } catch (e: any) {
      if (e.response) {
        message.error(e.response.data?.detail || '提交失败');
      }
    } finally {
      setEvalSubmitting(false);
    }
  };

  // == 发送面试提醒 ==
  const handleSendReminder = async (record: MergedRow, interviewerName?: string) => {
    const name = interviewerName || record.interviewer || '杜雁玲';
    try {
      await request.post(`/interviews/${record.interview_id}/notify-interviewer`, {
        candidate_name: record.candidate_name,
        position_applied: record.position_applied || record.position || '',
        city: record.city || '',
        interviewer_name: name,
        interview_time: record.interview_time || '',
      });
      message.success(`已提醒面试官：${name}`);
    } catch (e: any) {
      message.error(e.response?.data?.detail || '发送提醒失败');
    }
  };

  const handleViewEval = (record: MergedRow) => {
    setViewEvalRecord(record);
    setViewEvalVisible(true);
  };

  // == 表格列 ==
  const columns = [
    {
      title: '候选人', key: 'candidate', width: 130,
      render: (_: any, r: MergedRow) => (
        <Space>
          <UserOutlined style={{ color: '#1677ff' }} />
          <Text strong>{r.candidate_name}</Text>
        </Space>
      ),
    },
    {
      title: '标准岗位', key: 'position', width: 150,
      render: (_: any, r: MergedRow) => {
        if (r.position) {
          return (
            <Tooltip title={`原始岗位: ${r.position_applied || '-'}`}>
              <Tag color="blue">{r.position}</Tag>
            </Tooltip>
          );
        }
        return <span style={{ color: '#999' }}>{r.standard_position || r.position_applied || '-'}</span>;
      }
    },
    { title: '学历', dataIndex: 'education', key: 'education', width: 80,
      render: (v: string) => v || '-' },
    { title: '城市', dataIndex: 'city', key: 'city', width: 80 },
    {
      title: '候选人状态', key: 'talent_status', width: 130,
      render: (_: any, r: MergedRow) => {
        const cfg = talentStatusConfig[r.talent_status] || { color: 'default', text: r.talent_status || '待初筛' };
        return <Tag color={cfg.color}>{cfg.text}</Tag>;
      }
    },
    {
      title: '面试状态', key: 'interview_status', width: 100,
      render: (_: any, r: MergedRow) => {
        if (!r.interview_id) return <Tag>未安排</Tag>;
        const cfg = interviewStatusConfig[r.interview_status] || { color: 'default', text: r.interview_status };
        return <Tag color={cfg.color}>{cfg.text}</Tag>;
      }
    },
    {
      title: '面试时间', key: 'interview_time', width: 150,
      render: (_: any, r: MergedRow) => r.interview_time || '-',
    },
    {
      title: '面试官', key: 'interviewer', width: 120,
      render: (_: any, r: MergedRow) => {
        if (!r.interview_id) return '-';
        return (
          <Space size={4} wrap>
            {r.primary_interviewer && <Tag color="blue">一面：{r.primary_interviewer}</Tag>}
            {r.secondary_interviewer && <Tag color="orange">二面：{r.secondary_interviewer}</Tag>}
            {!r.primary_interviewer && !r.secondary_interviewer && <Tag color="purple">{r.interviewer || '待分配'}</Tag>}
          </Space>
        );
      }
    },
    {
      title: '一面结果', key: 'result1', width: 90,
      render: (_: any, r: MergedRow) => {
        if (!r.interview_id || !r.result || r.result === 'pending') return <Tag>待评价</Tag>;
        const cfg = resultLabels[r.result];
        return <Tag color={cfg?.color}>{cfg?.text || r.result}</Tag>;
      }
    },
    {
      title: '二面结果', key: 'result2', width: 90,
      render: (_: any, r: MergedRow) => {
        if (!r.interview_id || !r.result2 || r.result2 === 'pending') return <Tag>待评价</Tag>;
        const cfg = resultLabels[r.result2];
        return <Tag color={cfg?.color}>{cfg?.text || r.result2}</Tag>;
      }
    },
    {
      title: '操作', align: 'center' as const, key: 'action', width: 340,
      render: (_: any, r: MergedRow) => {
        // 已入库但未安排面试 → 安排面试
        const canSchedule = r.talent_status === 'approved' && !r.interview_id;
        // 有面试且待面试 → 一面评价
        const canEval1 = r.interview_id && r.interview_status === 'scheduled';
        // 有面试且一面已完成、二面待评价 → 二面评价
        const canEval2 = r.interview_id && r.interview_status === 'completed'
          && r.result && r.result !== 'pending' && (!r.result2 || r.result2 === 'pending');
        // 有评价 → 查看
        const canView = r.interview_id && (r.evaluation || r.evaluation2);
        // 有面试记录 → 可发送面试提醒
        const canRemind = r.interview_id;

        return (
          <Space size="small" wrap>
            {canSchedule && (
              <Button type="primary" size="small" icon={<BellOutlined />}
                onClick={() => handleOpenSchedule(r)}>
                安排面试
              </Button>
            )}
            {canEval1 && (
              <Button type="primary" size="small" icon={<EditOutlined />}
                onClick={() => handleEvalRound1(r)}>
                一面评价
              </Button>
            )}
            {canEval2 && (
              <Button size="small" icon={<EditOutlined />}
                onClick={() => handleEvalRound2(r)}>
                二面评价
              </Button>
            )}
            {canView && (
              <Button size="small" icon={<EyeOutlined />}
                onClick={() => handleViewEval(r)}>
                查看评价
              </Button>
            )}
            <Tooltip title="下载简历">
              <Button size="small" icon={<DownloadOutlined />}
                onClick={() => handleDownload(r)} />
            </Tooltip>
            {canRemind && (
              <>
                {r.primary_interviewer && (
                  <Button size="small" icon={<BellOutlined />}
                    onClick={() => handleSendReminder(r, r.primary_interviewer)}>
                    提醒一面
                  </Button>
                )}
                {r.secondary_interviewer && (
                  <Button size="small" icon={<BellOutlined />}
                    onClick={() => handleSendReminder(r, r.secondary_interviewer)}>
                    提醒二面
                  </Button>
                )}
                {!r.primary_interviewer && !r.secondary_interviewer && (
                  <Button size="small" icon={<BellOutlined />}
                    onClick={() => handleSendReminder(r, '杜雁玲')}>
                    提醒面试官
                  </Button>
                )}
              </>
            )}
          </Space>
        );
      }
    },
  ];

  return (
    <div>
      <Card
        title={
          <Space>
            <TeamOutlined />
            <span>面试管理</span>
          </Space>
        }
        extra={
          <Space>
            <Input
              size="middle"
              placeholder="搜索候选人姓名"
              prefix={<SearchOutlined />}
              allowClear
              style={{ width: 200 }}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <Select size="middle" placeholder="筛选" allowClear style={{ width: 200 }}
              value={filterStatus} onChange={v => setFilterStatus(v)}>
              <Select.Option value="approved">已入库</Select.Option>
              <Select.Option value="pending_interview">待安排面试</Select.Option>
              <Select.Option value="scheduled">待面试</Select.Option>
              <Select.Option value="completed">已完成</Select.Option>
            </Select>
            <Button icon={<ReloadOutlined />} onClick={fetchMergedData}>刷新</Button>
          </Space>
        }
        style={{ borderRadius: 8, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
      >
        <Table
          dataSource={data}
          columns={columns}
          rowKey="id"
          loading={loading}
          scroll={{ x: 'max-content' }}
          pagination={false}
        />
        <SimplePagination current={tablePage} pageSize={pageSize} total={data.length} onChange={setTablePage} />
      </Card>

      {/* 安排面试弹窗 */}
      <Modal
        title={
          <Space>
            <BellOutlined />
            <span>安排面试 - {scheduleRecord?.candidate_name || ''}</span>
          </Space>
        }
        open={scheduleModalVisible}
        onOk={handleScheduleSubmit}
        onCancel={() => setScheduleModalVisible(false)}
        confirmLoading={scheduling}
        okText="确认安排"
        width={520}
        destroyOnHidden
      >
        <Form form={scheduleForm} layout="vertical" preserve={false}>
          <Form.Item name="interview_date" label="面试日期">
            <DatePicker style={{ width: '100%' }} placeholder="选择面试日期（可选）" />
          </Form.Item>
          <Form.Item name="interview_time" label="面试时间">
            <DatePicker.TimePicker style={{ width: '100%' }} placeholder="选择面试时间（可选）" format="HH:mm" />
          </Form.Item>
          <Form.Item name="interview_location" label="面试地点 / 会议链接">
            <Input placeholder="例如：3楼会议室 / https://meeting.tencent.com/xxx（可选）" />
          </Form.Item>
          <Form.Item name="interviewer_name" label="面试官" initialValue="杜雁玲">
            <Input placeholder="输入面试官姓名（默认杜雁玲，后期可修改）" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 评价弹窗 */}
      <Modal
        title={`填写第${evalRound}面评价 - ${evalRecord?.candidate_name || ''}`}
        open={evalModalVisible}
        onOk={handleSubmitEval}
        onCancel={() => setEvalModalVisible(false)}
        confirmLoading={evalSubmitting}
        okText={`提交第${evalRound}面评价`}
        width={520}
      >
        <Form form={evalForm} layout="vertical">
          <Form.Item
            name="evaluation"
            label={`第${evalRound}面评价`}
            rules={[{ required: true, message: `请填写第${evalRound}面评价` }]}
          >
            <TextArea rows={6} placeholder={`请填写面试官对候选人的第${evalRound}面评价...`} />
          </Form.Item>
          <Form.Item name="result" label={`第${evalRound}面结果`} rules={[{ required: true, message: '请选择面试结果' }]}>
            <Radio.Group>
              <Radio value="passed"><span style={{ color: '#52c41a' }}>✅ 通过</span></Radio>
              <Radio value="failed"><span style={{ color: '#ff4d4f' }}>❌ 不通过</span></Radio>
            </Radio.Group>
          </Form.Item>
        </Form>
      </Modal>

      {/* 查看评价弹窗 */}
      <Modal
        title={`面试评价 - ${viewEvalRecord?.candidate_name || ''}`}
        open={viewEvalVisible}
        onCancel={() => setViewEvalVisible(false)}
        footer={<Button onClick={() => setViewEvalVisible(false)}>关闭</Button>}
        width={560}
      >
        {viewEvalRecord && (
          <div>
            <div style={{ marginBottom: 16 }}>
              <Text strong style={{ fontSize: 16 }}>一面评价</Text>
              {viewEvalRecord.evaluation ? (
                <>
                  <div style={{ whiteSpace: 'pre-wrap', background: '#f5f5f5', padding: 12, borderRadius: 6, marginTop: 8 }}>
                    {viewEvalRecord.evaluation}
                  </div>
                  {viewEvalRecord.result && (
                    <div style={{ marginTop: 8 }}>
                      <Text strong>结果：</Text>
                      <Tag color={viewEvalRecord.result === 'passed' ? 'success' : 'error'}>
                        {viewEvalRecord.result === 'passed' ? '通过' : '不通过'}
                      </Tag>
                    </div>
                  )}
                </>
              ) : (
                <div style={{ color: '#999', marginTop: 8 }}>暂未填写</div>
              )}
            </div>
            <div>
              <Text strong style={{ fontSize: 16 }}>二面评价</Text>
              {viewEvalRecord.evaluation2 ? (
                <>
                  <div style={{ whiteSpace: 'pre-wrap', background: '#f5f5f5', padding: 12, borderRadius: 6, marginTop: 8 }}>
                    {viewEvalRecord.evaluation2}
                  </div>
                  {viewEvalRecord.result2 && (
                    <div style={{ marginTop: 8 }}>
                      <Text strong>结果：</Text>
                      <Tag color={viewEvalRecord.result2 === 'passed' ? 'success' : 'error'}>
                        {viewEvalRecord.result2 === 'passed' ? '通过' : '不通过'}
                      </Tag>
                    </div>
                  )}
                </>
              ) : (
                <div style={{ color: '#999', marginTop: 8 }}>暂未填写</div>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default InterviewsList;
