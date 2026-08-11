import { Pagination, Spin, Table, type TableProps } from 'antd';
import { useRef, useState } from 'react';
import type { Key, TablePaginationConfig } from 'antd/es/table/interface';
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

function getRowKey<RecordType extends object>(
  rowKey: TableProps<RecordType>['rowKey'],
): (record: RecordType, index: number) => Key {
  if (typeof rowKey === 'function') return rowKey;

  const keyField = rowKey ?? 'key';
  return (record, index) => (record[keyField as keyof RecordType] as Key | undefined) ?? index;
}

function getCardPaginationConfig<RecordType>(
  data: readonly RecordType[],
  pagination: TableProps<RecordType>['pagination'],
) {
  if (pagination === false) return null;

  const config: TablePaginationConfig = pagination ?? {};
  const total = config.total ?? data.length;
  const hidden = config.position?.every((position) => position === 'none') ?? false;

  return {
    config,
    hidden,
    total,
  };
}

export function ResponsiveDataView<RecordType extends object>({
  card,
  className,
  dataSource,
  locale,
  loading,
  pagination,
  rowKey,
  rowSelection,
  testWidth,
  ...tableProps
}: ResponsiveDataViewProps<RecordType>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [internalCurrent, setInternalCurrent] = useState(() => {
    if (pagination === false) return 1;
    return pagination?.defaultCurrent ?? 1;
  });
  const [internalPageSize, setInternalPageSize] = useState(() => {
    if (pagination === false) return 10;
    return pagination?.defaultPageSize ?? 10;
  });
  const mode = useResponsiveMode(containerRef, testWidth);
  const wrapperClassName = ['responsive-data-view', className].filter(Boolean).join(' ');
  const cardWithRowKey: ResponsiveCardConfig<RecordType> = card.getKey
    ? card
    : { ...card, getKey: getRowKey(rowKey) };
  const cardPagination = getCardPaginationConfig(dataSource ?? [], pagination);
  const current = cardPagination?.config.current ?? internalCurrent;
  const pageSize = cardPagination?.config.pageSize ?? internalPageSize;
  const hasAllRows = (dataSource?.length ?? 0) >= (cardPagination?.total ?? 0);
  const currentPageData = cardPagination && hasAllRows
    ? (dataSource ?? []).slice((current - 1) * pageSize, current * pageSize)
    : (dataSource ?? []);
  const table = (
    <Table<RecordType>
      {...tableProps}
      dataSource={dataSource}
      locale={locale}
      loading={loading}
      pagination={pagination}
      rowKey={rowKey}
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
            data={currentPageData}
            card={cardWithRowKey}
            rowSelection={rowSelection}
            emptyText={getEmptyText(locale)}
          />
          {cardPagination && !cardPagination.hidden && (
            <Pagination
              {...cardPagination.config}
              className="responsive-data-view-pagination"
              current={current}
              pageSize={pageSize}
              total={cardPagination.total}
              onChange={(page, nextPageSize) => {
                if (cardPagination.config.current === undefined) setInternalCurrent(page);
                if (cardPagination.config.pageSize === undefined) setInternalPageSize(nextPageSize);
                cardPagination.config.onChange?.(page, nextPageSize);
              }}
              onShowSizeChange={(page, nextPageSize) => {
                if (cardPagination.config.current === undefined) setInternalCurrent(page);
                if (cardPagination.config.pageSize === undefined) setInternalPageSize(nextPageSize);
                cardPagination.config.onShowSizeChange?.(page, nextPageSize);
              }}
            />
          )}
        </Spin>
      )}
    </div>
  );
}
