import { describe, expect, it } from 'vitest';
import { ensureResumeListSchema, exposeStructuredEvaluation, RESUME_LIST_COMPATIBILITY_MIGRATIONS } from '../src/resume-schema';

describe('resume list schema compatibility', () => {
  it('repairs every legacy resume column required by the list endpoint', () => {
    const requiredColumns = [
      'ai_evaluation',
      'ocr_markdown',
      'ocr_status',
      'mineru_task_id',
      'mineru_status',
      'gender',
      'birthday',
      'education',
      'work_experience',
      'certifications',
      'self_evaluation',
      'updated_at',
    ];

    const migrationSql = RESUME_LIST_COMPATIBILITY_MIGRATIONS.join('\n');
    for (const column of requiredColumns) {
      expect(migrationSql).toContain(`ALTER TABLE resumes ADD COLUMN ${column}`);
    }
  });
});

describe('ensureResumeListSchema', () => {
  it('attempts every resume compatibility migration and ignores existing columns', async () => {
    const attempted: string[] = [];
    const db = {
      prepare(sql: string) {
        attempted.push(sql);
        return {
          async run() {
            if (sql.includes('ai_evaluation')) throw new Error('duplicate column name');
          },
        };
      },
    };

    await expect(ensureResumeListSchema(db as never)).resolves.toBeUndefined();
    expect(attempted).toEqual([...RESUME_LIST_COMPATIBILITY_MIGRATIONS]);
  });
});

describe('structured screening compatibility', () => {
  it('keeps a null weighted score when a hard gate fails', () => {
    const item: Record<string, unknown> = {
      match_score: 62,
      ai_evaluation: JSON.stringify({
        weighted_score: null,
        gate_results: { red_flag: { score: 4, passed: false } },
        screening_reason: '避坑雷区未达到 5 分',
      }),
    };

    exposeStructuredEvaluation(item);

    expect(item.match_score).toBeNull();
    expect(item.weighted_score).toBeNull();
    expect(item.gate_results).toEqual({ red_flag: { score: 4, passed: false } });
    expect(item.screening_reason).toBe('避坑雷区未达到 5 分');
  });
});
