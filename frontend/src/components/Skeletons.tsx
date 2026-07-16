import React from 'react';
import { Skeleton, Card, Row, Col } from 'antd';

/** 表格页骨架屏（3 行 5 列 + 表头） */
export const TableSkeleton: React.FC<{ rows?: number }> = ({ rows = 3 }) => (
  <div style={{ padding: '16px 0' }}>
    {/* 搜索栏 */}
    <div style={{ marginBottom: 16 }}>
      <Skeleton.Input active style={{ width: 200, height: 32 }} />
      <Skeleton.Input active style={{ width: 120, height: 32, marginLeft: 8 }} />
    </div>
    {/* 表头 */}
    <div style={{ display: 'flex', gap: 24, marginBottom: 8, padding: '12px 16px', background: '#fafafa' }}>
      {[180, 120, 150, 100, 80].map((w, i) => (
        <Skeleton key={i} active paragraph={false} title={{ width: w, style: { margin: 0 } }} />
      ))}
    </div>
    {/* 行 */}
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} style={{ display: 'flex', gap: 24, padding: '16px 16px', borderBottom: '1px solid #f0f0f0' }}>
        {[180, 120, 150, 100, 80].map((w, j) => (
          <Skeleton key={j} active paragraph={false} title={{ width: w, style: { margin: 0 } }} />
        ))}
      </div>
    ))}
  </div>
);

/** 详情页骨架屏 */
export const DetailSkeleton: React.FC = () => (
  <Card>
    <Skeleton active avatar paragraph={{ rows: 4 }} />
  </Card>
);

/** 表单页骨架屏 */
export const FormSkeleton: React.FC = () => (
  <Card>
    {Array.from({ length: 4 }).map((_, i) => (
      <div key={i} style={{ marginBottom: 24, display: 'flex', gap: 16, alignItems: 'center' }}>
        <Skeleton.Input active style={{ width: 80 }} />
        <Skeleton.Input active style={{ width: i === 2 ? 400 : 300 }} />
      </div>
    ))}
  </Card>
);

/** 统计卡片骨架屏（Dashboard / 简历列表顶部） */
export const StatsCardSkeleton: React.FC = () => (
  <Row gutter={12}>
    {[1, 2, 3, 4].map((_, i) => (
      <Col span={6} key={i}>
        <Card size="small">
          <Skeleton active paragraph={{ rows: 1 }} title={{ width: '60%' }} />
        </Card>
      </Col>
    ))}
  </Row>
);
