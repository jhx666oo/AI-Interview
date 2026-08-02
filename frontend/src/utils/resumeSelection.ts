import type { Key } from 'react';

export function toggleCurrentPageSelection(selectedIds: Key[], currentPageIds: Key[], checked: boolean): Key[] {
  const currentPageSet = new Set(currentPageIds);
  if (!checked) return selectedIds.filter((id) => !currentPageSet.has(id));
  return [...new Set([...selectedIds, ...currentPageIds])];
}

export function getCurrentPageSelectionState(selectedIds: Key[], currentPageIds: Key[]) {
  const selectedOnPage = currentPageIds.filter((id) => selectedIds.includes(id)).length;
  return {
    checked: currentPageIds.length > 0 && selectedOnPage === currentPageIds.length,
    indeterminate: selectedOnPage > 0 && selectedOnPage < currentPageIds.length,
  };
}
