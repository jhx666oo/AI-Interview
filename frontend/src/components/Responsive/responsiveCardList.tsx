import { useMemo, useState, type ReactNode } from 'react';
import type { Key } from 'antd/es/table/interface';
import type { ResponsiveCardListProps } from './responsiveTypes';

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

export function ResponsiveCardList<RecordType>({
  data,
  card,
  rowSelection,
  className,
  emptyText = '暂无数据',
}: ResponsiveCardListProps<RecordType>) {
  const [expandedKeys, setExpandedKeys] = useState<Set<string | number>>(() => new Set());
  const selectedKeys = rowSelection?.selectedRowKeys ?? [];

  const records = useMemo(
    () => data.map((record, index) => ({ record, index, key: card.getKey?.(record, index) ?? index })),
    [card, data],
  );

  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const enabledRecords = records.filter(({ record, index }) => !rowSelection?.getCheckboxProps?.(record)?.disabled && index >= 0);
  const allSelected = enabledRecords.length > 0 && enabledRecords.every(({ key }) => selectedKeySet.has(key));

  const emitSelection = (nextKeys: Key[]) => {
    rowSelection?.onChange?.(
      nextKeys,
      records.filter(({ key }) => nextKeys.includes(key)).map(({ record }) => record),
      { type: 'multiple' },
    );
  };

  const toggleRecord = (key: string | number, checked: boolean) => {
    const nextKeys = checked
      ? Array.from(new Set([...selectedKeys, key]))
      : selectedKeys.filter((selectedKey) => selectedKey !== key);
    emitSelection(nextKeys);
  };

  const toggleAll = (checked: boolean) => {
    const enabledKeys = enabledRecords.map(({ key }) => key);
    const nextKeys = checked
      ? Array.from(new Set([...selectedKeys, ...enabledKeys]))
      : selectedKeys.filter((selectedKey) => !enabledKeys.some((key) => key === selectedKey));
    emitSelection(nextKeys);
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
          const secondaryFields = card.fields.filter((field) => field.level === 'secondary');
          const detailFields = card.fields.filter((field) => field.level === 'detail');
          const visibleSecondaryFields = secondaryFields.filter((field) => {
            const value = field.render(record, index);
            return !field.hideWhenEmpty || !isEmptyValue(value);
          });
          const visibleDetailFields = detailFields.filter((field) => {
            const value = field.render(record, index);
            return !field.hideWhenEmpty || !isEmptyValue(value);
          });

          const toggleDetails = () => {
            setExpandedKeys((previous) => {
              const next = new Set(previous);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
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

              {visibleDetailFields.length > 0 && (
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
