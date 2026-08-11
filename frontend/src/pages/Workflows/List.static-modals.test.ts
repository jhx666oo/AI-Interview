import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./List.tsx', import.meta.url), 'utf8');
const staticModalWidth = 'min(600px, calc(100vw - 32px))';

const sourceSection = (start: string, end: string) =>
  source.slice(source.indexOf(start), source.indexOf(end));

describe('workflow static modals', () => {
  it('caps execution and batch-action modal widths to the narrow viewport', () => {
    expect(source).toContain(
      `const staticModalWidth = '${staticModalWidth}';`,
    );

    const executionResultModal = sourceSection('const handleExecute', 'const handleDuplicate');
    expect(executionResultModal).toContain('Modal.info({');
    expect(executionResultModal).toContain('width: staticModalWidth');

    const batchDeleteModal = sourceSection('const handleBatchDelete', 'const handleBatchPublish');
    expect(batchDeleteModal).toContain('Modal.confirm({');
    expect(batchDeleteModal).toContain('width: staticModalWidth');

    const batchPublishModal = sourceSection('const handleBatchPublish', 'const columns');
    expect(batchPublishModal).toContain('Modal.confirm({');
    expect(batchPublishModal).toContain('width: staticModalWidth');
  });
});
