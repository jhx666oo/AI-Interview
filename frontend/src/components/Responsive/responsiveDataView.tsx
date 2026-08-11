import { Spin, Table, type TableProps } from 'antd';
import { useRef } from 'react';
import { ResponsiveCardList } from './responsiveCardList';
import { useResponsiveMode, type ResponsiveMode } from './responsiveMode';
import type { ResponsiveCardConfig } from './responsiveTypes';
import { TableViewport } from './TableViewport';

export interface ResponsiveDataViewProps<RecordType extends object> extends TableProps<RecordType> {
  card: ResponsiveCardConfig<RecordType>;
  className?: string;
  testWidth?: number;
}

function getEmptyText<RecordType>(locale: TableProps<RecordType>['locale']) {
  const emptyText = locale?.emptyText;
  return typeof emptyText === 'function' ? emptyText() : emptyText;
}

export function ResponsiveDataView<RecordType extends object>({
  card,
  className,
  dataSource,
  locale,
  loading,
  pagination,
  rowSelection,
  testWidth,
  ...tableProps
}: ResponsiveDataViewProps<RecordType>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mode = useResponsiveMode(containerRef, testWidth);
  const wrapperClassName = ['responsive-data-view', className].filter(Boolean).join(' ');
  const table = (
    <Table<RecordType>
      {...tableProps}
      dataSource={dataSource}
      locale={locale}
      loading={loading}
      pagination={pagination}
      rowSelection={rowSelection}
    />
  );

  return (
    <div
      ref={containerRef}
      className={wrapperClassName}
      data-responsive-mode={mode as ResponsiveMode}
      data-testid="responsive-data-view"
    >
      {mode === 'full' ? (
        <TableViewport>{table}</TableViewport>
      ) : (
        <Spin spinning={Boolean(loading)}>
          <ResponsiveCardList
            data={dataSource ?? []}
            card={card}
            rowSelection={rowSelection}
            emptyText={getEmptyText(locale)}
          />
        </Spin>
      )}
    </div>
  );
}
