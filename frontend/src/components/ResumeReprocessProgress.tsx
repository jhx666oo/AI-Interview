import React, { useState } from 'react';
import { Card, Progress, Tag, Space, Typography, Modal, Button } from 'antd';
import { ExclamationCircleOutlined } from '@ant-design/icons';
import type { ReprocessBatchView } from '../utils/resumeReprocess';

const { Text } = Typography;

interface ResumeReprocessProgressProps {
  batch: ReprocessBatchView | null;
  onShowFailed?: (items: ReprocessBatchView['failed_items']) => void;
  onCancel?: () => Promise<void> | void;
}

const ResumeReprocessProgress: React.FC<ResumeReprocessProgressProps> = ({ batch, onShowFailed, onCancel }) => {
  const [failedVisible, setFailedVisible] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  if (!batch) return null;

  const scopeLabel = batch.scope === 'all' ? '全部重评' : '重评未评估/失败简历';
  const isActive = batch.status === 'queued' || batch.status === 'running';
  const statusColor = batch.status === 'completed' ? 'success' : batch.status === 'failed' ? 'error' : batch.status === 'cancelled' ? 'default' : 'processing';
  const statusLabel = batch.status === 'completed' ? '已完成' : batch.status === 'failed' ? '已失败' : batch.status === 'cancelled' ? '已停止' : '评估中';

  const handleCancel = () => {
    Modal.confirm({
      title: '停止批量重新评估？',
      content: '已完成的评估会保留，排队中的任务会停止；正在执行的单份评估可能会自然结束。',
      okText: '停止处理',
      cancelText: '继续处理',
      okButtonProps: { danger: true },
      onOk: async () => {
        setCancelling(true);
        try {
          await onCancel?.();
        } finally {
          setCancelling(false);
        }
      },
    });
  };

  return (
    <>
      <Card
        size="small"
        style={{ marginBottom: 16, border: '1px solid #f0f0f0', background: '#fafafa' }}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={4}>
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Text strong>{scopeLabel}</Text>
            <Space size="small">
              {isActive && onCancel && (
                <Button size="small" danger loading={cancelling} onClick={handleCancel}>停止处理</Button>
              )}
              <Tag color={statusColor}>{statusLabel}</Tag>
            </Space>
          </Space>
          <Progress
            percent={batch.percent}
            showInfo={false}
            status={batch.status === 'failed' ? 'exception' : undefined}
            strokeColor={batch.status === 'cancelled' ? '#bfbfbf' : { '0%': '#1677ff', '100%': '#3f8600' }}
          />
          <Space wrap size="large">
            <Text type="secondary">已完成 {batch.completed} / {batch.total}</Text>
            {batch.queued > 0 && <Text type="secondary">排队中 {batch.queued}</Text>}
            {batch.processing > 0 && <Text type="secondary">评估中 {batch.processing}</Text>}
            {batch.pending > 0 && <Text type="secondary">待处理 {batch.pending}</Text>}
            {batch.failed > 0 && (
              <Button
                type="link"
                size="small"
                danger
                icon={<ExclamationCircleOutlined />}
                onClick={() => setFailedVisible(true)}
              >
                失败 {batch.failed}
              </Button>
            )}
            {batch.skipped > 0 && <Text type="secondary">跳过 {batch.skipped}</Text>}
          </Space>
          {batch.current && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              当前：{batch.current.candidate_name} · {batch.current.step === 'screening' ? 'AI 评分中' : batch.current.step || '处理中'}
            </Text>
          )}
        </Space>
      </Card>

      <Modal
        title="失败明细"
        open={failedVisible}
        footer={[
          <Button key="close" onClick={() => setFailedVisible(false)}>关闭</Button>,
          <Button key="retry" type="primary" onClick={() => { setFailedVisible(false); onShowFailed?.([]); }}>
            重新评估失败项
          </Button>,
        ]}
        onCancel={() => setFailedVisible(false)}
      >
        {batch.failed_items.length === 0 ? (
          <Text>暂无失败记录</Text>
        ) : (
          <Space direction="vertical" style={{ width: '100%' }} size={8}>
            {batch.failed_items.map((item) => (
              <div key={item.resume_id} style={{ padding: '8px 12px', background: '#fff2f0', border: '1px solid #ffccc7', borderRadius: 4 }}>
                <Space direction="vertical" size={2}>
                  <Text strong>{item.candidate_name}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {item.error_code && `错误码: ${item.error_code} `}
                    {item.error_message && `原因: ${item.error_message}`}
                  </Text>
                </Space>
              </div>
            ))}
          </Space>
        )}
      </Modal>
    </>
  );
};

export default ResumeReprocessProgress;
