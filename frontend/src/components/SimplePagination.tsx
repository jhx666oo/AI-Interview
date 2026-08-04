import React from 'react';
import { Button, Pagination, Space } from 'antd';

interface Props {
  current: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
  pageSizeOptions?: number[];
  onPageSizeChange?: (pageSize: number) => void;
  showQuickJumper?: boolean;
  showLastPage?: boolean;
}

const SimplePagination: React.FC<Props> = ({
  current,
  pageSize,
  total,
  onChange,
  pageSizeOptions,
  onPageSizeChange,
  showQuickJumper = false,
  showLastPage = false,
}) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const handlePaginationChange = (page: number, nextPageSize: number) => {
    if (nextPageSize !== pageSize) {
      onPageSizeChange?.(nextPageSize);
      return;
    }
    onChange(page);
  };
  const enhanced = showQuickJumper || Boolean(onPageSizeChange && pageSizeOptions?.length);
  return (
    <div style={{ marginTop: 12, textAlign: 'right' }}>
      <Space size={4}>
        {enhanced ? (
          <Pagination
            size="small"
            current={current}
            pageSize={pageSize}
            total={total}
            showLessItems
            showQuickJumper={showQuickJumper ? { goButton: '跳转' } : false}
            showSizeChanger={Boolean(onPageSizeChange && pageSizeOptions?.length)}
            pageSizeOptions={pageSizeOptions?.map(String)}
            onChange={handlePaginationChange}
            locale={{ items_per_page: '条/页' }}
          />
        ) : (
          <>
            <Button size="small" disabled={current <= 1} onClick={() => onChange(current - 1)}>上一页</Button>
            <span style={{ color: '#666', fontSize: 13, minWidth: 40, textAlign: 'center' }}>{current} / {totalPages}</span>
            <Button size="small" disabled={current >= totalPages} onClick={() => onChange(current + 1)}>下一页</Button>
          </>
        )}
        {showLastPage && <Button size="small" disabled={current >= totalPages} onClick={() => onChange(totalPages)}>末页</Button>}
        {!enhanced && <span style={{ color: '#999', fontSize: 13, marginLeft: 4 }}>共 {total} 条</span>}
      </Space>
    </div>
  );
};

export default SimplePagination;
