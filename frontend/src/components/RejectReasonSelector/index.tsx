import React from 'react';
import { Form, Select, Input, Space } from 'antd';

const REJECT_REASONS = [
  { value: 'skills_mismatch', label: '技能不符合要求' },
  { value: 'experience_insufficient', label: '经验不足' },
  { value: 'education_mismatch', label: '学历不符' },
  { value: 'salary_expectation', label: '薪资期望不符' },
  { value: 'culture_fit', label: '文化匹配度低' },
  { value: 'candidate_withdraw', label: '候选人放弃' },
  { value: 'other', label: '其他原因' },
];

interface RejectReasonSelectorProps {
  form?: any;
  layout?: 'horizontal' | 'vertical' | 'inline';
  showDetail?: boolean;
}

const RejectReasonSelector: React.FC<RejectReasonSelectorProps> = ({
  form,
  layout = 'vertical',
  showDetail = true
}) => {
  return (
    <Space orientation="vertical" style={{ width: '100%' }} size="middle">
      <Form.Item
        name="reject_reason_category"
        label="淘汰原因"
        rules={[{ required: true, message: '请选择淘汰原因' }]}
      >
        <Select placeholder="请选择淘汰原因" size="large">
          {REJECT_REASONS.map((reason) => (
            <Select.Option key={reason.value} value={reason.value}>
              {reason.label}
            </Select.Option>
          ))}
        </Select>
      </Form.Item>

      {showDetail && (
        <Form.Item
          name="reject_reason_detail"
          label="详细说明"
        >
          <Input.TextArea
            placeholder="请输入详细说明（可选）"
            rows={3}
            maxLength={500}
            showCount
          />
        </Form.Item>
      )}
    </Space>
  );
};

export default RejectReasonSelector;
export { REJECT_REASONS };