import { useMemo, useState, type ReactNode } from 'react';
import type { Key, TableRowSelection } from 'antd/es/table/interface';
import type {
  ResponsiveCardConfig,
  ResponsiveCardListProps,
  ResponsiveField,
} from './responsiveTypes';

export interface ResponsiveCardRecord<RecordType> {
  record: RecordType;
  index: number;
  key: Key;
}

export interface ResponsiveCardSelectionChange<RecordType> {
  selectedRowKeys: Key[];
  selectedRows: RecordType[];
}

function isEmptyValue(value: ReactNode) {
  return value === null || value === undefined || value === '';
}

function getText(value: ReactNode): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(getText).join('');
  if (value && typeof value === 'object' && 'props' in value) {
    return getText((value as { props?: { children?: ReactNode } }).props?.children);
  }
  return '';
}

export function getResponsiveCardRecords<RecordType>(
  data: RecordType[],
  card: ResponsiveCardConfig<RecordType>,
): ResponsiveCardRecord<RecordType>[] {
  return data.map((record, index) => ({
    record,
    index,
    key: card.getKey?.(record, index) ?? index,
  }));
}

export function getCardFieldGroups<RecordType>(
  card: ResponsiveCardConfig<RecordType>,
  record: RecordType,
  index: number,
  isExpanded: boolean,
): { secondary: ResponsiveField<RecordType>[]; detail: ResponsiveField<RecordType>[] } {
  const visibleFields = (level: ResponsiveField<RecordType>['level']) => card.fields.filter((field) => {
    if (field.level !== level) return false;
    const value = field.render(record, index);
    return !field.hideWhenEmpty || !isEmptyValue(value);
  });

  return {
    secondary: visibleFields('secondary'),
    detail: isExpanded ? visibleFields('detail') : [],
  };
}

export function toggleExpandedCardKey(currentKeys: Set<Key>, key: Key): Set<Key> {
  const nextKeys = new Set(currentKeys);
  if (nextKeys.has(key)) nextKeys.delete(key);
  else nextKeys.add(key);
  return nextKeys;
}

export function toggleRecordSelection(selectedKeys: Key[], key: Key, checked: boolean): Key[] {
  return checked
    ? Array.from(new Set([...selectedKeys, key]))
    : selectedKeys.filter((selectedKey) => selectedKey !== key);
}

export function isCardRecordSelectable<RecordType>(
  record: RecordType,
  rowSelection?: Pick<TableRowSelection<RecordType>, 'getCheckboxProps'>,
): boolean {
  return !rowSelection?.getCheckboxProps?.(record)?.disabled;
}

export function toggleAllCardSelection<RecordType>(
  selectedKeys: Key[],
  records: ResponsiveCardRecord<RecordType>[],
  isEnabled: (record: RecordType) => boolean,
  checked: boolean,
): Key[] {
  const enabledKeys = records.filter(({ record }) => isEnabled(record)).map(({ key }) => key);
  return checked
    ? Array.from(new Set([...selectedKeys, ...enabledKeys]))
    : selectedKeys.filter((selectedKey) => !enabledKeys.includes(selectedKey));
}

export function createCardSelectionChange<RecordType>(
  records: ResponsiveCardRecord<RecordType>[],
  selectedRowKeys: Key[],
): ResponsiveCardSelectionChange<RecordType> {
  return {
    selectedRowKeys,
    selectedRows: records.filter(({ key }) => selectedRowKeys.includes(key)).map(({ record }) => record),
  };
}

export function ResponsiveCardList<RecordType>({
  data,
  card,
  rowSelection,
  className,
  emptyText = '暂无数据',
}: ResponsiveCardListProps<RecordType>) {
  const [expandedKeys, setExpandedKeys] = useState<Set<Key>>(() => new Set());
  const selectedKeys = rowSelection?.selectedRowKeys ?? [];

  const records = useMemo(() => getResponsiveCardRecords(data, card), [card, data]);

  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const isRecordEnabled = (record: RecordType) => isCardRecordSelectable(record, rowSelection);
  const enabledRecords = records.filter(({ record }) => isRecordEnabled(record));
  const allSelected = enabledRecords.length > 0 && enabledRecords.every(({ key }) => selectedKeySet.has(key));

  const emitSelection = (nextKeys: Key[]) => {
    const selection = createCardSelectionChange(records, nextKeys);
    rowSelection?.onChange?.(
      selection.selectedRowKeys,
      selection.selectedRows,
      { type: 'multiple' },
    );
  };

  const toggleRecord = (key: Key, checked: boolean) => {
    emitSelection(toggleRecordSelection(selectedKeys, key, checked));
  };

  const toggleAll = (checked: boolean) => {
    emitSelection(toggleAllCardSelection(selectedKeys, records, isRecordEnabled, checked));
  };

  if (!records.length) {
    return <div className="responsive-card-list-empty">{emptyText}</div>;
  }

  return (
    <section className={['responsive-card-list', className].filter(Boolean).join(' ')}>
      {rowSelection && (
        <label className="responsive-card-list-select-all">
          <input
            type="checkbox"
            checked={allSelected}
            aria-checked={allSelected}
            onChange={(event) => toggleAll(event.currentTarget.checked)}
          />
          全选当前页
        </label>
      )}
      <div role="list" className="responsive-card-list-items">
        {records.map(({ record, index, key }) => {
          const title = card.title(record, index);
          const titleText = getText(title) || '记录';
          const isExpanded = expandedKeys.has(key);
          const checkboxProps = rowSelection?.getCheckboxProps?.(record);
          const fieldGroups = getCardFieldGroups(card, record, index, isExpanded);
          const visibleSecondaryFields = fieldGroups.secondary;
          const visibleDetailFields = fieldGroups.detail;
          const hasVisibleDetailFields = getCardFieldGroups(card, record, index, true).detail.length > 0;

          const toggleDetails = () => {
            setExpandedKeys((previous) => {
              return toggleExpandedCardKey(previous, key);
            });
          };

          return (
            <article key={key} role="listitem" className="responsive-data-card">
              <div className="responsive-data-card-main">
                {rowSelection && (
                  <input
                    type="checkbox"
                    className="responsive-data-card-checkbox"
                    checked={selectedKeySet.has(key)}
                    aria-checked={selectedKeySet.has(key)}
                    aria-label={`选择${titleText}`}
                    disabled={checkboxProps?.disabled}
                    onChange={(event) => toggleRecord(key, event.currentTarget.checked)}
                  />
                )}
                <div className="responsive-data-card-heading">
                  <strong className="responsive-data-card-title">{title}</strong>
                  {card.subtitle && <span className="responsive-data-card-subtitle">{card.subtitle(record, index)}</span>}
                </div>
                {card.status && <div className="responsive-data-card-status">{card.status(record, index)}</div>}
                {card.actions && <div className="responsive-data-card-actions">{card.actions(record, index)}</div>}
              </div>

              {visibleSecondaryFields.length > 0 && (
                <dl className="responsive-data-card-fields responsive-data-card-secondary-fields">
                  {visibleSecondaryFields.map((field) => (
                    <div key={field.key} className="responsive-data-card-field">
                      <dt>{field.label}</dt>
                      <dd>{field.render(record, index)}</dd>
                    </div>
                  ))}
                </dl>
              )}

              {hasVisibleDetailFields && (
                <>
                  <button
                    type="button"
                    className="responsive-data-card-details-toggle"
                    aria-expanded={isExpanded}
                    aria-label={`${isExpanded ? '收起' : '展开'}${titleText}详情`}
                    onClick={toggleDetails}
                  >
                    {isExpanded ? '收起详情' : '展开详情'}
                  </button>
                  {isExpanded && (
                    <dl className="responsive-data-card-fields responsive-data-card-detail-fields">
                      {visibleDetailFields.map((field) => (
                        <div key={field.key} className="responsive-data-card-field">
                          <dt>{field.label}</dt>
                          <dd>{field.render(record, index)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
