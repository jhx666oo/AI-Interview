import React from 'react';
import { Form, InputNumber, Space, Switch, Typography } from 'antd';

const { Text } = Typography;

type ScreeningRulesFieldsProps = {
  name?: string;
};

/** Reusable position-level override editor for the three screening gates. */
const ScreeningRulesFields: React.FC<ScreeningRulesFieldsProps> = ({ name = 'screening_rules_config' }) => (
  <div style={{ border: '1px solid #E2E8F0', borderRadius: 8, padding: 16, background: '#FAFBFC' }}>
    <Form.Item name={[name, 'enabled']} valuePropName="checked" style={{ marginBottom: 8 }}>
      <Switch checkedChildren="启用岗位覆盖" unCheckedChildren="使用系统默认" />
    </Form.Item>
    <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
      开启后，只有当前岗位使用这组三项阈值；关闭则沿用系统设置中的默认值。
    </Text>
    <Form.Item noStyle shouldUpdate={(prev, next) => (
      prev?.[name]?.enabled !== next?.[name]?.enabled
    )}>
      {({ getFieldValue }) => getFieldValue([name, 'enabled']) ? (
        <Space wrap size={[24, 16]}>
          <Form.Item
            name={[name, 'values', 'keyword_match_min_score']}
            label="关键词匹配最低分"
            rules={[{ required: true, message: '请输入关键词匹配最低分' }]}
            style={{ marginBottom: 0 }}
          >
            <InputNumber min={0} max={5} step={1} precision={0} />
          </Form.Item>
          <Form.Item
            name={[name, 'values', 'red_flag_min_score']}
            label="避坑雷区最低分"
            rules={[{ required: true, message: '请输入避坑雷区最低分' }]}
            style={{ marginBottom: 0 }}
          >
            <InputNumber min={0} max={5} step={1} precision={0} />
          </Form.Item>
          <Form.Item
            name={[name, 'values', 'weighted_score_min']}
            label="普通能力加权最低分"
            rules={[{ required: true, message: '请输入普通能力加权最低分' }]}
            style={{ marginBottom: 0 }}
          >
            <InputNumber min={0} max={5} step={0.1} precision={1} />
          </Form.Item>
        </Space>
      ) : null}
    </Form.Item>
  </div>
);

export default ScreeningRulesFields;
