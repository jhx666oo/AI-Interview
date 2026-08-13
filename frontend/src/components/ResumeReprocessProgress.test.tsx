// @vitest-environment jsdom
import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import ResumeReprocessProgress from './ResumeReprocessProgress';
import { type ReprocessBatchView } from '../utils/resumeReprocess';

afterEach(() => {
  cleanup();
});

const makeBatch = (overrides: Partial<ReprocessBatchView> = {}): ReprocessBatchView => ({
  batch_id: 'b1',
  scope: 'all',
  status: 'running',
  total: 10,
  completed: 4,
  processing: 1,
  queued: 3,
  pending: 2,
  failed: 1,
  skipped: 0,
  percent: 40,
  current: { resume_id: 'r1', candidate_name: '张三', step: 'screening' },
  failed_items: [{ resume_id: 'r5', candidate_name: '李四', error_code: 'ERR', error_message: '文本不可用' }],
  error_message: null,
  created_at: '2026-08-12T00:00:00Z',
  updated_at: '2026-08-12T00:05:00Z',
  completed_at: null,
  ...overrides,
});

describe('ResumeReprocessProgress', () => {
  it('renders nothing when batch is null', () => {
    const { container } = render(<ResumeReprocessProgress batch={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows batch title and progress', () => {
    render(<ResumeReprocessProgress batch={makeBatch()} />);
    expect(screen.getByText('全部重评')).toBeTruthy();
    expect(screen.getByText('评估中')).toBeTruthy();
  });

  it('shows stop button only while the batch is active', () => {
    render(<ResumeReprocessProgress batch={makeBatch()} onCancel={() => undefined} />);
    expect(screen.getByRole('button', { name: '停止处理' })).toBeTruthy();

    cleanup();
    render(<ResumeReprocessProgress batch={makeBatch({ status: 'cancelled' })} onCancel={() => undefined} />);
    expect(screen.queryByRole('button', { name: '停止处理' })).toBeNull();
  });

  it('displays completed/total counts', () => {
    render(<ResumeReprocessProgress batch={makeBatch()} />);
    const texts = screen.getAllByText(/已完成.*10/);
    expect(texts.length).toBeGreaterThan(0);
  });

  it('shows queued count', () => {
    render(<ResumeReprocessProgress batch={makeBatch()} />);
    const texts = screen.getAllByText(/排队中/);
    expect(texts.length).toBeGreaterThan(0);
  });

  it('shows processing count', () => {
    render(<ResumeReprocessProgress batch={makeBatch()} />);
    const texts = screen.getAllByText(/评估中/);
    expect(texts.length).toBeGreaterThan(0);
  });

  it('shows failed count as button', () => {
    render(<ResumeReprocessProgress batch={makeBatch()} />);
    const texts = screen.getAllByText(/失败/);
    expect(texts.length).toBeGreaterThan(0);
  });

  it('shows current candidate', () => {
    render(<ResumeReprocessProgress batch={makeBatch()} />);
    expect(document.body.textContent).toContain('张三');
  });

  it('hides when no current task', () => {
    render(<ResumeReprocessProgress batch={makeBatch({ current: null })} />);
    expect(document.body.textContent).not.toContain('张三');
  });
});
