// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PositionSummaryTable } from './PositionSummaryTable';
import type { BoardTotals, DivisionBoard } from '../types';

const totals: BoardTotals = {
  active_positions: 1,
  total_headcount: 3,
  total_resumes: 12,
  ai_screened: 10,
  first_interview: 4,
  first_pass: 3,
  second_pass: 2,
  third_pass: 1,
  offers: 1,
  hired: 1,
  interview_pass_rate: 25,
};

const divisions: DivisionBoard[] = [{
  ...totals,
  division: '智能硬件事业部',
  hrbps: ['张三'],
  positions: [{
    position_id: 'position-1',
    division: '智能硬件事业部',
    hrbp: '张三',
    position: '产品经理',
    priority: 'P0',
    headcount: 3,
    total_resumes: 12,
    ai_screened: 10,
    first_interview: 4,
    first_pass: 3,
    second_pass: 2,
    third_pass: 1,
    offers: 1,
    hired: 1,
    notes: '本周重点跟进',
    status: '招聘中',
  }],
}];

describe('PositionSummaryTable narrow mode', () => {
  beforeAll(() => {
    class ResizeObserverMock {
      observe() {}
      disconnect() {}
      unobserve() {}
    }

    globalThis.ResizeObserver = ResizeObserverMock as typeof ResizeObserver;
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: () => ({
        matches: false,
        media: '',
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        addListener: () => undefined,
        removeListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
  });

  afterEach(() => cleanup());

  it('keeps the division expand control and aria state', async () => {
    const user = userEvent.setup();
    render(<PositionSummaryTable divisions={divisions} totals={totals} testWidth={700} />);

    const toggle = screen.getByRole('button', { name: '收起智能硬件事业部' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    await user.click(toggle);

    expect(screen.getByRole('button', { name: '展开智能硬件事业部' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('renders total metrics in the narrow summary card', () => {
    render(<PositionSummaryTable divisions={divisions} totals={totals} testWidth={700} />);

    expect(screen.getByText('合计')).toBeDefined();
    expect(screen.getAllByText(String(totals.total_resumes)).length).toBeGreaterThan(0);
    expect(screen.queryByRole('table')).toBeNull();
  });
});
