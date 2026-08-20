import React, { useEffect, useMemo, useState } from 'react';
import { Form, Input, Button, Card, message, Select, AutoComplete, Typography, Switch } from 'antd';
import { useNavigate, useParams } from 'react-router-dom';
import { RobotOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import request from '../../utils/request';
import JDGeneratorModal from '../../components/JDGeneratorModal';
import GenerateCapabilityDimensionsModal from '../../components/GenerateCapabilityDimensionsModal';
import { PageHeader } from '../../components/Responsive/PageHeader';
import { buildInterviewerOptions, INTERVIEWER_DIRECTORY_CACHE_KEY } from './interviewerOptions';
import ScreeningRulesFields from '../../components/ScreeningRulesFields';
import { DEFAULT_SCREENING_RULES, parseScreeningRules, serializeScreeningRules } from '../../types/screeningRules';
import CapabilityDimensionsField from './CapabilityDimensionsField';

const { Title, Text } = Typography;

const PositionForm: React.FC = () => {
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const { id } = useParams();
  const [loading, setLoading] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [interviewers, setInterviewers] = useState<any[]>([]);
  const [jdModalVisible, setJdModalVisible] = useState(false);
  const [dimGenVisible, setDimGenVisible] = useState(false);
  const [allDimensionNames, setAllDimensionNames] = useState<string[]>([]);
  const primaryInterviewer = Form.useWatch('primary_interviewer', form);
  const secondaryInterviewer = Form.useWatch('secondary_interviewer', form);

  useEffect(() => {
    if (id) {
      fetchPosition(id);
    }
    fetchUsers();
    fetchInterviewers();
    fetchDimensionNames();
  }, [id]);

  const fetchPosition = async (positionId: string) => {
    try {
      const res = await request.get(`/positions/${positionId}`);
      // 解析 capability_dimensions JSON 字符串为数组
      if (typeof res.capability_dimensions === 'string') {
        try { res.capability_dimensions = JSON.parse(res.capability_dimensions); } catch { res.capability_dimensions = []; }
      }
      const screeningRules = parseScreeningRules(res.screening_rules);
      res.screening_rules_config = {
        enabled: !!screeningRules,
        values: screeningRules || { ...DEFAULT_SCREENING_RULES },
      };
      form.setFieldsValue(res);
    } catch (error) {
      message.error('获取岗位详情失败');
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await request.get('/auth/users');
      setUsers(res);
    } catch (error) {
      console.error('Failed to fetch users');
    }
  };

  const fetchInterviewers = async () => {
    const cached = sessionStorage.getItem(INTERVIEWER_DIRECTORY_CACHE_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setInterviewers(parsed);
          return;
        }
      } catch {
        // ignore malformed cache
      }
    }
    try {
      const res = await request.get('/auth/interviewers');
      const directory = Array.isArray(res) ? res : [];
      if (directory.length > 0) {
        sessionStorage.setItem(INTERVIEWER_DIRECTORY_CACHE_KEY, JSON.stringify(directory));
      }
      setInterviewers(directory);
    } catch (error) {
      console.error('Failed to fetch interviewers');
    }
  };

  const fetchDimensionNames = async () => {
    try {
      const res = await request.get('/capability-dimension-names');
      setAllDimensionNames(Array.isArray(res) ? res : []);
    } catch {
      // ignore
    }
  };

  const handleOpenJDModal = async () => {
    try {
      const values = await form.validateFields(['title']);
      if (!values.title) {
        message.error('请先填写岗位名称');
        return;
      }
      setJdModalVisible(true);
    } catch {
      message.error('请先填写岗位名称');
    }
  };

  const handleJDConfirm = (description: string, requirements: string) => {
    form.setFieldsValue({
      description,
      requirements
    });
  };

  const handleOpenDimGen = () => {
    setDimGenVisible(true);
  };

  const handleDimGenConfirm = (dimensions: any[]) => {
    form.setFieldValue('capability_dimensions', dimensions);
    message.success(`已生成 ${dimensions.length} 个评分维度，可继续调整后提交`);
  };

  const onFinish = async (values: any) => {
    setLoading(true);
    try {
      // capability_dimensions 是数组，序列化为 JSON 字符串
      if (Array.isArray(values.capability_dimensions)) {
        values.capability_dimensions = JSON.stringify(values.capability_dimensions);
      }
      const screeningRulesConfig = values.screening_rules_config;
      values.screening_rules = screeningRulesConfig?.enabled
        ? serializeScreeningRules(screeningRulesConfig.values)
        : '';
      delete values.screening_rules_config;
      if (id) {
        await request.put(`/positions/${id}`, values);
        message.success('更新成功');
      } else {
        await request.post('/positions', values);
        message.success('创建成功');
      }
      navigate('/positions');
    } catch (error) {
      message.error('提交失败');
    } finally {
      setLoading(false);
    }
  };

  const primaryInterviewerOptions = useMemo(
    () => buildInterviewerOptions(interviewers, [primaryInterviewer, secondaryInterviewer], '杜雁玲'),
    [interviewers, primaryInterviewer, secondaryInterviewer],
  );
  const secondaryInterviewerOptions = useMemo(
    () => buildInterviewerOptions(interviewers, [primaryInterviewer, secondaryInterviewer], '何雨菱'),
    [interviewers, primaryInterviewer, secondaryInterviewer],
  );

  return (
    <div>
      <PageHeader title={id ? '编辑岗位' : '新增岗位'} actions={<Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/positions')}>返回列表</Button>} />
      
      <Card>
        <Form
          form={form}
          layout="vertical"
          onFinish={onFinish}
          initialValues={{
            status: 'open',
            urgency: 'medium',
            position_type: 'full_time',
            headcount: 1,
            screening_rules_config: { enabled: false, values: { ...DEFAULT_SCREENING_RULES } },
            auto_business_screening_enabled: false,
            primary_interviewer: '杜雁玲',
            secondary_interviewer: '何雨菱',
          }}
          style={{ maxWidth: 800 }}
        >
          <Form.Item
            name="title"
            label="岗位名称"
            rules={[{ required: true, message: '请输入岗位名称' }]}
          >
            <Input placeholder="例如：高级前端工程师" size="large" />
          </Form.Item>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px' }}>
            <Form.Item
              name="department"
              label="所属部门"
            >
              <Input placeholder="例如：研发部" size="large" />
            </Form.Item>

            <Form.Item
              name="location"
              label="工作地点"
            >
              <Input placeholder="例如：北京" size="large" />
            </Form.Item>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px' }}>
            <Form.Item
              name="salary_range"
              label="薪资范围"
            >
              <Input placeholder="例如：20k-30k" size="large" />
            </Form.Item>

            <Form.Item
              name="headcount"
              label="招聘人数"
            >
              <Input type="number" min={1} placeholder="1" size="large" />
            </Form.Item>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px' }}>
            <Form.Item
              name="position_type"
              label="岗位类型"
            >
              <Select size="large">
                <Select.Option value="full_time">全职</Select.Option>
                <Select.Option value="part_time">兼职</Select.Option>
                <Select.Option value="contract">合同</Select.Option>
                <Select.Option value="internship">实习</Select.Option>
              </Select>
            </Form.Item>

            <Form.Item
              name="urgency"
              label="紧急程度"
            >
              <Select size="large">
                <Select.Option value="low">低</Select.Option>
                <Select.Option value="medium">中</Select.Option>
                <Select.Option value="high">高</Select.Option>
                <Select.Option value="urgent">紧急</Select.Option>
              </Select>
            </Form.Item>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px' }}>
            <Form.Item name="primary_interviewer" label="一面面试官">
              <AutoComplete
                size="large"
                allowClear
                placeholder="选择或输入一面面试官"
                filterOption={(inputValue, option) => String(option?.label || option?.value || '').toLowerCase().includes(inputValue.toLowerCase())}
                options={primaryInterviewerOptions}
              />
            </Form.Item>
            <Form.Item name="secondary_interviewer" label="二面面试官">
              <AutoComplete
                size="large"
                allowClear
                placeholder="选择或输入二面面试官"
                filterOption={(inputValue, option) => String(option?.label || option?.value || '').toLowerCase().includes(inputValue.toLowerCase())}
                options={secondaryInterviewerOptions}
              />
            </Form.Item>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '20px' }}>
            <Form.Item
              name="hiring_manager_id"
              label="招聘负责人"
            >
              <Select size="large" allowClear placeholder="选择招聘负责人" showSearch optionFilterProp="children">
                {users.map(user => (
                  <Select.Option key={user.id} value={user.id}>{user.full_name} ({user.email})</Select.Option>
                ))}
              </Select>
            </Form.Item>

      
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text strong>岗位职责</Text>
            <Button 
              type="link" 
              icon={<RobotOutlined />} 
              onClick={handleOpenJDModal}
            >
              AI 生成 JD
            </Button>
          </div>
          <Form.Item
            name="description"
            rules={[{ required: true, message: '请输入岗位职责' }]}
          >
            <Input.TextArea rows={6} placeholder="请输入详细的岗位职责描述" showCount maxLength={2000} />
          </Form.Item>

          <Form.Item
            name="requirements"
            label="任职要求"
          >
            <Input.TextArea rows={6} placeholder="请输入任职资格要求" showCount maxLength={2000} />
          </Form.Item>

          <Form.Item
            name="status"
            label="状态"
          >
            <Select size="large">
              <Select.Option value="open">待发布</Select.Option>
              <Select.Option value="published">招聘中</Select.Option>
              <Select.Option value="closed">已关闭</Select.Option>
            </Select>
          </Form.Item>

          <Form.Item
            name="auto_business_screening_enabled"
            label="面试自动化"
            valuePropName="checked"
            extra="开启后，AI 初筛通过的候选人会异步进入业务筛选与面试安排；默认关闭，可先灰度验证。"
          >
            <Switch checkedChildren="开启" unCheckedChildren="关闭" />
          </Form.Item>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text strong>能力维度（AI 评分维度）</Text>
            <Button
              type="link"
              icon={<RobotOutlined />}
              onClick={handleOpenDimGen}
            >
              AI 一键生成
            </Button>
          </div>
          <Form.Item
            name="capability_dimensions"
            extra="粘贴飞书链接或岗位要求文本，一键生成评分维度；也可手动添加或从已有维度选择。"
          >
            <CapabilityDimensionsField allDimensionNames={allDimensionNames} />
          </Form.Item>

          <Form.Item label="AI 初筛条件" extra="默认沿用系统设置；如需单独调整当前岗位，请开启岗位覆盖。">
            <ScreeningRulesFields />
          </Form.Item>

          <Form.Item style={{ marginTop: 32 }}>
            <Button type="primary" htmlType="submit" loading={loading} size="small">
              提交
            </Button>
            <Button style={{ marginLeft: 12 }} onClick={() => navigate('/positions')} size="small">
              取消
            </Button>
          </Form.Item>
        </Form>
      </Card>

      <JDGeneratorModal
        visible={jdModalVisible}
        onCancel={() => setJdModalVisible(false)}
        onConfirm={handleJDConfirm}
        title={form.getFieldValue('title') || ''}
        department={form.getFieldValue('department')}
        location={form.getFieldValue('location')}
        salary_range={form.getFieldValue('salary_range')}
      />

      <GenerateCapabilityDimensionsModal
        open={dimGenVisible}
        onCancel={() => setDimGenVisible(false)}
        onConfirm={handleDimGenConfirm}
        positionTitle={form.getFieldValue('title') || ''}
        jobDescription={form.getFieldValue('description') || ''}
        jobRequirements={form.getFieldValue('requirements') || ''}
      />
    </div>
  );
};

export default PositionForm;
