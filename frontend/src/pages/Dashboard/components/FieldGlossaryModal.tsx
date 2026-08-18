import { useMemo, useState } from 'react';
import { Button, Empty, Space, Tag, Typography } from 'antd';
import { BookOutlined } from '@ant-design/icons';
import { ResponsiveModal } from '../../../components/Responsive';
import {
  FIELD_GLOSSARY,
  FIELD_GLOSSARY_CATEGORIES,
  filterFieldGlossary,
  type FieldGlossaryFilter,
} from '../fieldGlossary';
import styles from '../dashboard.module.css';

const categoryColors: Record<string, string> = {
  核心指标: 'gold',
  基础字段: 'geekblue',
  数据范围: 'blue',
  状态分类: 'green',
  效能指标: 'magenta',
};

export function FieldGlossaryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [activeCategory, setActiveCategory] = useState<FieldGlossaryFilter>('全部');
  const filtered = useMemo(() => filterFieldGlossary(activeCategory), [activeCategory]);

  return (
    <ResponsiveModal title="字段口径说明" open={open} onCancel={onClose} footer={null} destroyOnHidden width={860}>
      <Typography.Paragraph type="secondary" className={styles.glossaryDescription}>
        共 {FIELD_GLOSSARY.length} 个字段定义，按妙搭口径分组展示；点击分类标签可筛选查看。
      </Typography.Paragraph>
      <Space wrap size={[8, 8]} className={styles.glossaryCategories}>
        {FIELD_GLOSSARY_CATEGORIES.map((category) => (
          <Button
            key={category}
            size="small"
            type={activeCategory === category ? 'primary' : 'default'}
            danger={activeCategory === category}
            onClick={() => setActiveCategory(category)}
          >
            {category}{category !== '全部' ? ` (${FIELD_GLOSSARY.filter((item) => item.category === category).length})` : ''}
          </Button>
        ))}
      </Space>
      <div className={styles.glossaryList} role="list">
        {filtered.length === 0 && <Empty description="暂无字段定义" />}
        {filtered.map((item) => (
          <article className={styles.glossaryItem} key={item.name} role="listitem">
            <div className={styles.glossaryItemHeader}>
              <Typography.Text strong>{item.name}</Typography.Text>
              {item.alias && <Typography.Text type="secondary">（{item.alias}）</Typography.Text>}
              <Tag color={categoryColors[item.category]}>{item.category}</Tag>
            </div>
            <Typography.Paragraph>{item.definition}</Typography.Paragraph>
          </article>
        ))}
      </div>
    </ResponsiveModal>
  );
}

export function FieldGlossaryButton({ onClick }: { onClick: () => void }) {
  return <Button icon={<BookOutlined />} onClick={onClick}>字段口径说明</Button>;
}
