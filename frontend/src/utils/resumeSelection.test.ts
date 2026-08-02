import { describe, expect, it } from 'vitest';
import { getCurrentPageSelectionState, toggleCurrentPageSelection } from './resumeSelection';

describe('resume current-page selection', () => {
  it('adds every current-page id while retaining an earlier-page selection', () => {
    expect(toggleCurrentPageSelection(['other-page'], ['page-1', 'page-2'], true))
      .toEqual(['other-page', 'page-1', 'page-2']);
  });

  it('clears only current-page ids', () => {
    expect(toggleCurrentPageSelection(['other-page', 'page-1', 'page-2'], ['page-1', 'page-2'], false))
      .toEqual(['other-page']);
  });

  it('marks a partial current page as indeterminate', () => {
    expect(getCurrentPageSelectionState(['page-1'], ['page-1', 'page-2']))
      .toEqual({ checked: false, indeterminate: true });
  });
});
