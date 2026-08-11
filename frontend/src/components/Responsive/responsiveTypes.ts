import type { ReactNode } from 'react';
import type { TableRowSelection } from 'antd/es/table/interface';

export interface ResponsiveField<RecordType> {
  key: string;
  label: ReactNode;
  level: 'secondary' | 'detail';
  render: (record: RecordType, index: number) => ReactNode;
  hideWhenEmpty?: boolean;
}

export interface ResponsiveCardConfig<RecordType> {
  getKey?: (record: RecordType, index: number) => string | number;
  title: (record: RecordType, index: number) => ReactNode;
  subtitle?: (record: RecordType, index: number) => ReactNode;
  status?: (record: RecordType, index: number) => ReactNode;
  fields: ResponsiveField<RecordType>[];
  actions?: (record: RecordType, index: number) => ReactNode;
}

export interface ResponsiveCardListProps<RecordType> {
  data: RecordType[];
  card: ResponsiveCardConfig<RecordType>;
  rowSelection?: TableRowSelection<RecordType>;
  className?: string;
  emptyText?: ReactNode;
}
