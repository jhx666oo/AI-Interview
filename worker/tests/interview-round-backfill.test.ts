import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

// Python helpers are the source of truth for the offline migration tool. Keep a
// small contract fixture here as documentation for the equivalent CLI output.
describe('legacy interview round backfill contract', () => {
  it('uses a deterministic id and preserves round one fields', () => {
    const legacy = { id: 'iv-1', resume_id: 'resume-1', round: 1, result: 'passed', result2: 'passed', evaluation2: '二面通过', status2: 'completed' };
    const output = execFileSync('python3', [resolve(process.cwd(), '../scripts/backfill_interview_rounds.py')], {
      input: JSON.stringify([legacy]), encoding: 'utf8',
    });
    expect(JSON.parse(output)).toMatchObject({
      id: 'iv-1-round-2', resume_id: 'resume-1', round: 2,
      result: 'passed', evaluation: '二面通过', previous_interview_id: 'iv-1',
    });
  });

  it('skips legacy rows without any second-round data and emits idempotent SQL', () => {
    const script = resolve(process.cwd(), '../scripts/backfill_interview_rounds.py');
    const skipped = execFileSync('python3', [script], {
      input: JSON.stringify([{ id: 'iv-1', resume_id: 'resume-1', result2: 'pending', status2: 'pending' }]), encoding: 'utf8',
    });
    expect(skipped).toBe('');
    const sql = execFileSync('python3', [script, '--emit-sql'], {
      input: JSON.stringify({ id: 'iv-1', resume_id: 'resume-1', result2: 'passed', evaluation2: 'ok', status2: 'completed' }), encoding: 'utf8',
    });
    expect(sql).toContain('ON CONFLICT(id) DO NOTHING');
    expect(sql).toContain("next_interview_id = 'iv-1-round-2'");
  });
});
