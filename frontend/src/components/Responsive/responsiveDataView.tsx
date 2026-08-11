import { Pagination, Spin, Table, type TableProps } from 'antd';
import { useRef } from 'react';
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

function getCardPagination<RecordType>(
  data: readonly RecordType[],
  pagination: TableProps<RecordType>['pagination'],
) {
  if (pagination === false) return null;

  const config: TablePaginationConfig = pagination ?? {};
  const pageSize = config.pageSize ?? config.defaultPageSize ?? 10;
  const current = config.current ?? config.defaultCurrent ?? 1;
  const total = config.total ?? data.length;
  const hasAllRows = data.length >= total;
  const currentPageData = hasAllRows
    ? data.slice((current - 1) * pageSize, current * pageSize)
    : data;
  const hidden = config.position?.every((position) => position === 'none') ?? false;

  return {
    config,
    current,
    currentPageData,
    hidden,
    pageSize,
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
  const mode = useResponsiveMode(containerRef, testWidth);
  const wrapperClassName = ['responsive-data-view', className].filter(Boolean).join(' ');
  const cardWithRowKey: ResponsiveCardConfig<RecordType> = card.getKey
    ? card
    : { ...card, getKey: getRowKey(rowKey) };
  const cardPagination = getCardPagination(dataSource ?? [], pagination);
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
            data={cardPagination?.currentPageData ?? (dataSource ?? [])}
            card={cardWithRowKey}
            rowSelection={rowSelection}
            emptyText={getEmptyText(locale)}
          />
          {cardPagination && !cardPagination.hidden && (
            <Pagination
              {...cardPagination.config}
              className="responsive-data-view-pagination"
              current={cardPagination.current}
              pageSize={cardPagination.pageSize}
              total={cardPagination.total}
              onChange={(page, nextPageSize) => {
                cardPagination.config.onChange?.(page, nextPageSize);
              }}
              onShowSizeChange={(page, nextPageSize) => {
                cardPagination.config.onShowSizeChange?.(page, nextPageSize);
              }}
            />
          )}
        </Spin>
      )}
    </div>
  );
}
