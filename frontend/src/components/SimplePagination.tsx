import React from 'react';
import { Button, Space } from 'antd';

interface Props {
  current: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}

const SimplePagination: React.FC<Props> = ({ current, pageSize, total, onChange }) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div style={{ marginTop: 12, textAlign: 'right' }}>
      <Space size={4}>
        <Button size="small" disabled={current <= 1} onClick={() => onChange(current - 1)}>上一页</Button>
        <span style={{ color: '#666', fontSize: 13, minWidth: 40, textAlign: 'center' }}>{current} / {totalPages}</span>
        <Button size="small" disabled={current >= totalPages} onClick={() => onChange(current + 1)}>下一页</Button>
        <span style={{ color: '#999', fontSize: 13, marginLeft: 4 }}>共 {total} 条</span>
      </Space>
    </div>
  );
};

export default SimplePagination;
