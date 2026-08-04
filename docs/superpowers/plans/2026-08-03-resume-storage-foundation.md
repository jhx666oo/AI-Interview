# Resume Storage Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the typed D1 artifact catalog, private R2 object-store boundary, feature flags, and current Wrangler configuration needed by every later resume-storage task without changing production behavior.

**Architecture:** `resume_artifacts` records object identity and lifecycle state in D1 while `ResumeArtifactStore` owns binary/text objects in R2. The first release only adds infrastructure and repositories; every new path remains disabled by default. Wrangler configs move to JSONC because the later AI Search namespace binding requires modern Wrangler configuration.

**Tech Stack:** TypeScript, D1, R2 Workers API, Hono, Vitest, Wrangler >=4.68.1, `@cloudflare/workers-types` >=4.20260304.0.

## Global Constraints

- Follow the master plan and architecture design before editing.
- This plan must not create a production bucket, apply a production D1 migration, set production secrets, or deploy.
- Use the exact binding name `RESUME_ARTIFACTS` and bucket name `ai-interview-resume-artifacts`.
- Keep all R2 and new behavior disabled by default.
- Do not modify or delete legacy `resume_files`, `raw_text`, `ocr_markdown`, `resume_markdown`, `ai_review`, or `ai_evaluation` data.
- Object keys are server-generated and contain no candidate name, email, phone, or other PII.
- Artifact writes are versioned; never overwrite an existing object version.
- Store ISO 8601 timestamps in D1 and use prepared statements for every value.

---

## File Structure

- `worker/migrations/0011_resume_artifacts.sql` — additive artifact catalog migration.
- `worker/schema.sql` — local/bootstrap schema parity.
- `worker/src/resume-storage/types.ts` — artifact contracts and enums.
- `worker/src/resume-storage/object-key.ts` — deterministic, PII-free object keys.
- `worker/src/resume-storage/artifact-repository.ts` — D1 lifecycle operations.
- `worker/src/resume-storage/r2-artifact-store.ts` — R2 Workers binding adapter.
- `worker/src/resume-config/flags.ts` — one feature-flag parser shared by API and consumer.
- `worker/tests/resume-artifacts.test.ts` — schema, key, repository, and R2 adapter tests.
- `worker/tests/resume-feature-flags.test.ts` — disabled-by-default flag tests.
- `frontend/wrangler.jsonc` — Pages bindings and vars.
- `worker/wrangler.jsonc` — local/API Worker bindings and vars.
- `worker/wrangler.resume-consumer.jsonc` — Queue consumer bindings and vars.
- `frontend/wrangler.toml`, `worker/wrangler.toml`, `worker/wrangler.resume-consumer.toml` — remove only after JSONC parity verification.
- `README.md`, `docs/agent-handoff-2026-08-03.md` — update config filenames and commands.

## Task 1: Upgrade Wrangler support and convert configs without semantic changes

**Files:**
- Modify: `worker/package.json`
- Modify: `worker/package-lock.json`
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Create: `worker/wrangler.jsonc`
- Create: `worker/wrangler.resume-consumer.jsonc`
- Create: `frontend/wrangler.jsonc`
- Delete after parity check: `worker/wrangler.toml`
- Delete after parity check: `worker/wrangler.resume-consumer.toml`
- Delete after parity check: `frontend/wrangler.toml`
- Modify: `README.md`
- Modify: `docs/agent-handoff-2026-08-03.md`

**Interfaces:**
- Consumes: existing D1 ID `3f82993e-210d-4b0b-9d83-4ed4be69724f`, Queue `resume-processing`, Pages project `ai-interview`.
- Produces: JSONC configs that later plans extend with R2 and AI Search bindings.

- [ ] **Step 1: Capture current Wrangler config output**

```bash
cd worker
npx wrangler@latest --version
npx wrangler@latest deploy --config wrangler.resume-consumer.toml --dry-run
cd ../frontend
npx wrangler@latest pages functions build --project-directory .
```

Expected: record the current binding names and any pre-existing warnings. No deployment occurs.

- [ ] **Step 2: Install the minimum supported toolchain**

```bash
cd worker
npm install --save-dev wrangler@^4.68.1 @cloudflare/workers-types@^4.20260304.0
cd ../frontend
npm install --save-dev wrangler@^4.68.1
```

Expected: both lockfiles update; `cd worker && npx wrangler --version` reports 4.68.1 or newer.

- [ ] **Step 3: Create JSONC configs with disabled flags**

Create `frontend/wrangler.jsonc`:

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "ai-interview",
  "compatibility_date": "2026-08-03",
  "pages_build_output_dir": "dist",
  "vars": {
    "AI_BASE_URL": "https://api.deepseek.com",
    "R2_ARTIFACT_WRITE": "false",
    "R2_ARTIFACT_READ": "false",
    "DIRECT_R2_UPLOAD": "false",
    "RESUME_SQL_LIST": "false",
    "RESUME_HYBRID_SEARCH": "false",
    "RECRUITMENT_EVENTS": "false",
    "RECRUITMENT_EVENT_METRICS": "false"
  },
  "d1_databases": [{
    "binding": "DB",
    "database_name": "ai-interview-db",
    "database_id": "3f82993e-210d-4b0b-9d83-4ed4be69724f",
    "migrations_dir": "../worker/migrations"
  }],
  "ai": { "binding": "AI" },
  "queues": {
    "producers": [{
      "binding": "RESUME_PROCESSING_QUEUE",
      "queue": "resume-processing"
    }]
  }
}
```

Create `worker/wrangler.resume-consumer.jsonc`:

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "ai-interview-resume-consumer",
  "main": "src/resume-consumer.ts",
  "compatibility_date": "2026-08-03",
  "vars": {
    "R2_ARTIFACT_WRITE": "false",
    "R2_ARTIFACT_READ": "false",
    "DIRECT_R2_UPLOAD": "false",
    "RESUME_SQL_LIST": "false",
    "RESUME_HYBRID_SEARCH": "false",
    "RECRUITMENT_EVENTS": "false",
    "RECRUITMENT_EVENT_METRICS": "false"
  },
  "d1_databases": [{
    "binding": "DB",
    "database_name": "ai-interview-db",
    "database_id": "3f82993e-210d-4b0b-9d83-4ed4be69724f",
    "migrations_dir": "migrations"
  }],
  "queues": {
    "consumers": [{
      "queue": "resume-processing",
      "max_batch_size": 1,
      "max_batch_timeout": 5,
      "max_concurrency": 3,
      "dead_letter_queue": "resume-processing-dlq",
      "max_retries": 8,
      "retry_delay": 30
    }]
  }
}
```

Create `worker/wrangler.jsonc` by preserving the current main entry, D1 binding, Queue producer, AI binding if present, and cron list exactly; add the seven disabled vars shown above. Add `"typecheck": "tsc --noEmit"` to `worker/package.json` so later plan commands are stable.

- [ ] **Step 4: Verify JSONC parity before deleting TOML**

```bash
cd worker
npx wrangler deploy --config wrangler.jsonc --dry-run
npx wrangler deploy --config wrangler.resume-consumer.jsonc --dry-run
cd ../frontend
npm run build
npx wrangler pages functions build --project-directory .
```

Expected: all commands succeed. Compare dry-run binding output with Step 1; D1, Queue, AI, and cron semantics are unchanged.

- [ ] **Step 5: Remove superseded TOML and update documentation**

Use `apply_patch` to remove the three tracked TOML files and replace documented commands with:

```bash
npx wrangler deploy --config worker/wrangler.resume-consumer.jsonc --dry-run
npx wrangler deploy --config worker/wrangler.resume-consumer.jsonc
```

Do not modify the untracked `frontend/.wrangler.local.toml`.

- [ ] **Step 6: Commit**

```bash
git add worker/package.json worker/package-lock.json frontend/package.json frontend/package-lock.json worker/wrangler.jsonc worker/wrangler.resume-consumer.jsonc frontend/wrangler.jsonc worker/wrangler.toml worker/wrangler.resume-consumer.toml frontend/wrangler.toml README.md docs/agent-handoff-2026-08-03.md
git commit -m "chore: modernize Cloudflare worker configuration"
```

## Task 2: Add the artifact catalog migration

**Files:**
- Create: `worker/migrations/0011_resume_artifacts.sql`
- Modify: `worker/schema.sql`
- Create: `worker/tests/resume-artifacts.test.ts`

**Interfaces:**
- Consumes: `resumes(id)`.
- Produces: `resume_artifacts` table and indexes used by every storage/search plan.

- [ ] **Step 1: Write the failing schema parity test**

```ts
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('resume artifact schema', () => {
  it('keeps migration and bootstrap schema in parity', async () => {
    const files = await Promise.all([
      readFile(resolve(process.cwd(), 'migrations/0011_resume_artifacts.sql'), 'utf8'),
      readFile(resolve(process.cwd(), 'schema.sql'), 'utf8'),
    ]);
    for (const sql of files) {
      expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS resume_artifacts/);
      expect(sql).toMatch(/UNIQUE\s*\(resume_id, artifact_type, version\)/);
      expect(sql).toMatch(/idx_resume_artifacts_current/);
      expect(sql).toMatch(/idx_resume_artifacts_expiry/);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `cd worker && npm test -- resume-artifacts.test.ts`

Expected: FAIL because the migration does not exist.

- [ ] **Step 3: Add the exact additive migration**

```sql
CREATE TABLE IF NOT EXISTS resume_artifacts (
  id TEXT PRIMARY KEY,
  resume_id TEXT NOT NULL,
  artifact_type TEXT NOT NULL CHECK (artifact_type IN ('pdf','ocr','ai_analysis','interview_report','search_document')),
  version INTEGER NOT NULL CHECK (version > 0),
  object_key TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
  sha256 TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','available','expired','deleted','failed')),
  expires_at TEXT,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (resume_id, artifact_type, version),
  FOREIGN KEY (resume_id) REFERENCES resumes(id)
);
CREATE INDEX IF NOT EXISTS idx_resume_artifacts_current
  ON resume_artifacts(resume_id, artifact_type, status, version DESC);
CREATE INDEX IF NOT EXISTS idx_resume_artifacts_expiry
  ON resume_artifacts(status, expires_at)
  WHERE expires_at IS NOT NULL;
```

Copy the same definition into `worker/schema.sql` after `resumes` and before tables that reference artifacts.

- [ ] **Step 4: Apply and reapply locally**

```bash
cd worker
npx wrangler d1 migrations apply ai-interview-db --local --config wrangler.jsonc
npx wrangler d1 migrations apply ai-interview-db --local --config wrangler.jsonc
npm test -- resume-artifacts.test.ts
```

Expected: migration applies once, second command reports no pending migration, test PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/migrations/0011_resume_artifacts.sql worker/schema.sql worker/tests/resume-artifacts.test.ts
git commit -m "feat: add resume artifact catalog"
```

## Task 3: Define artifact types and PII-free object keys

**Files:**
- Create: `worker/src/resume-storage/types.ts`
- Create: `worker/src/resume-storage/object-key.ts`
- Modify: `worker/tests/resume-artifacts.test.ts`

**Interfaces:**
- Consumes: stable `tenantId`, `resumeId`, `createdAt`, artifact type, version.
- Produces: `ResumeArtifact`, `ResumeArtifactStore`, `buildResumeArtifactKey`.

- [ ] **Step 1: Write failing key tests**

```ts
import { buildResumeArtifactKey } from '../src/resume-storage/object-key';

it('builds versioned keys without candidate PII', () => {
  expect(buildResumeArtifactKey({
    tenantId: 'default', resumeId: 'r-123', type: 'pdf', version: 1,
    createdAt: new Date('2026-08-03T01:00:00.000Z'),
  })).toBe('pdf/default/2026/08/r-123/source-v1.pdf');
});

it('rejects path traversal input', () => {
  expect(() => buildResumeArtifactKey({
    tenantId: '../private', resumeId: 'r-123', type: 'ocr', version: 1,
    createdAt: new Date('2026-08-03T01:00:00.000Z'),
  })).toThrow('INVALID_ARTIFACT_KEY_PART');
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `cd worker && npm test -- resume-artifacts.test.ts`

Expected: FAIL because `buildResumeArtifactKey` is absent.

- [ ] **Step 3: Add the contracts and builder**

```ts
export type ResumeArtifactType = 'pdf' | 'ocr' | 'ai_analysis' | 'interview_report' | 'search_document';
export type ResumeArtifactStatus = 'pending' | 'available' | 'expired' | 'deleted' | 'failed';

export interface PutArtifactInput {
  objectKey: string;
  body: ReadableStream | ArrayBuffer | Uint8Array | string;
  contentType: string;
  customMetadata: Record<string, string>;
}

export interface StoredArtifactObject {
  objectKey: string;
  size: number;
  etag: string;
}

export interface ResumeArtifactStore {
  put(input: PutArtifactInput): Promise<StoredArtifactObject>;
  get(objectKey: string): Promise<R2ObjectBody | null>;
  head(objectKey: string): Promise<R2Object | null>;
  delete(objectKey: string): Promise<void>;
}
```

```ts
const SAFE_PART = /^[A-Za-z0-9_-]+$/;
const suffix = {
  pdf: ['source', 'pdf'], ocr: ['ocr', 'md'], ai_analysis: ['screening', 'json'],
  interview_report: ['report', 'json'], search_document: ['document', 'md'],
} as const;

export function buildResumeArtifactKey(input: {
  tenantId: string; resumeId: string; type: keyof typeof suffix; version: number; createdAt: Date;
}): string {
  if (!SAFE_PART.test(input.tenantId) || !SAFE_PART.test(input.resumeId) || !Number.isInteger(input.version) || input.version < 1) {
    throw new Error('INVALID_ARTIFACT_KEY_PART');
  }
  const year = String(input.createdAt.getUTCFullYear());
  const month = String(input.createdAt.getUTCMonth() + 1).padStart(2, '0');
  const [name, extension] = suffix[input.type];
  return `${input.type === 'ai_analysis' ? 'ai' : input.type === 'interview_report' ? 'interview' : input.type === 'search_document' ? 'search' : input.type}/${input.tenantId}/${year}/${month}/${input.resumeId}/${name}-v${input.version}.${extension}`;
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `cd worker && npm test -- resume-artifacts.test.ts && npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/resume-storage/types.ts worker/src/resume-storage/object-key.ts worker/tests/resume-artifacts.test.ts
git commit -m "feat: define resume artifact contracts"
```

## Task 4: Implement the D1 artifact repository

**Files:**
- Create: `worker/src/resume-storage/artifact-repository.ts`
- Modify: `worker/tests/resume-artifacts.test.ts`

**Interfaces:**
- Consumes: D1 `resume_artifacts` schema.
- Produces: `createPendingArtifact`, `markArtifactAvailable`, `findCurrentArtifact`, `markArtifactFailed`, `markArtifactDeleted`.

- [ ] **Step 1: Write failing repository behavior tests**

```ts
it('selects only the newest available artifact', async () => {
  const db = createArtifactDb([
    { id: 'a1', version: 1, status: 'available' },
    { id: 'a2', version: 2, status: 'failed' },
    { id: 'a3', version: 3, status: 'available' },
  ]);
  await expect(findCurrentArtifact(db as never, 'r1', 'ocr')).resolves.toMatchObject({ id: 'a3', version: 3 });
});

it('marks an artifact available only from pending', async () => {
  const db = createArtifactTransitionDb('pending');
  await expect(markArtifactAvailable(db as never, 'a1', { sizeBytes: 42, sha256: 'a'.repeat(64) })).resolves.toBe(true);
  await expect(markArtifactAvailable(db as never, 'a1', { sizeBytes: 42, sha256: 'a'.repeat(64) })).resolves.toBe(false);
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `cd worker && npm test -- resume-artifacts.test.ts`

Expected: FAIL because repository functions do not exist.

- [ ] **Step 3: Implement conditional lifecycle writes**

Use these exact SQL constraints:

```ts
export async function findCurrentArtifact(db: D1Database, resumeId: string, type: ResumeArtifactType) {
  return db.prepare(
    `SELECT * FROM resume_artifacts
     WHERE resume_id=? AND artifact_type=? AND status='available'
     ORDER BY version DESC LIMIT 1`,
  ).bind(resumeId, type).first<ResumeArtifact>();
}

export async function markArtifactAvailable(
  db: D1Database,
  id: string,
  input: { sizeBytes: number; sha256: string | null },
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE resume_artifacts SET status='available', size_bytes=?, sha256=?
     WHERE id=? AND status='pending'`,
  ).bind(input.sizeBytes, input.sha256, id).run();
  return Number(result.meta.changes || 0) === 1;
}
```

All other transitions must include both `id=?` and the allowed previous status. A duplicate create caused by Queue retry returns the row with the existing `(resume_id, artifact_type, version)` key.

- [ ] **Step 4: Run focused and full Worker tests**

```bash
cd worker
npm test -- resume-artifacts.test.ts
npm test
```

Expected: focused and full suites PASS.

- [ ] **Step 5: Commit**

```bash
git add worker/src/resume-storage/artifact-repository.ts worker/tests/resume-artifacts.test.ts
git commit -m "feat: add resume artifact repository"
```

## Task 5: Implement the private R2 adapter and bindings

**Files:**
- Create: `worker/src/resume-storage/r2-artifact-store.ts`
- Modify: `worker/tests/resume-artifacts.test.ts`
- Modify: `frontend/wrangler.jsonc`
- Modify: `worker/wrangler.jsonc`
- Modify: `worker/wrangler.resume-consumer.jsonc`

**Interfaces:**
- Consumes: `env.RESUME_ARTIFACTS: R2Bucket`.
- Produces: `createR2ArtifactStore(bucket): ResumeArtifactStore`.

- [ ] **Step 1: Write the failing adapter test**

```ts
it('writes content type and non-PII metadata to R2', async () => {
  const bucket = createFakeR2Bucket();
  const store = createR2ArtifactStore(bucket as never);
  await store.put({
    objectKey: 'ocr/default/2026/08/r1/ocr-v1.md',
    body: '# resume',
    contentType: 'text/markdown; charset=utf-8',
    customMetadata: { resume_id: 'r1', tenant_id: 'default', artifact_type: 'ocr', version: '1' },
  });
  expect(bucket.putCalls[0].options).toMatchObject({
    httpMetadata: { contentType: 'text/markdown; charset=utf-8' },
    customMetadata: { resume_id: 'r1', tenant_id: 'default', artifact_type: 'ocr', version: '1' },
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `cd worker && npm test -- resume-artifacts.test.ts`

Expected: FAIL because the adapter is absent.

- [ ] **Step 3: Implement the adapter**

```ts
export function createR2ArtifactStore(bucket: R2Bucket): ResumeArtifactStore {
  return {
    async put(input) {
      const stored = await bucket.put(input.objectKey, input.body, {
        httpMetadata: { contentType: input.contentType },
        customMetadata: input.customMetadata,
      });
      if (!stored) throw new Error('R2_PUT_FAILED');
      return { objectKey: input.objectKey, size: stored.size, etag: stored.etag };
    },
    get: (key) => bucket.get(key),
    head: (key) => bucket.head(key),
    delete: (key) => bucket.delete(key),
  };
}
```

Add this binding to all three JSONC configs:

```jsonc
"r2_buckets": [{
  "binding": "RESUME_ARTIFACTS",
  "bucket_name": "ai-interview-resume-artifacts"
}]
```

- [ ] **Step 4: Validate locally and with dry runs**

```bash
cd worker
npm test -- resume-artifacts.test.ts
npx tsc --noEmit
npx wrangler deploy --config wrangler.jsonc --dry-run
npx wrangler deploy --config wrangler.resume-consumer.jsonc --dry-run
cd ../frontend
npm run build
```

Expected: PASS. If dry run requires an existing remote bucket, create a separate staging bucket only after receiving infrastructure approval; do not create production resources in this task.

- [ ] **Step 5: Commit**

```bash
git add worker/src/resume-storage/r2-artifact-store.ts worker/tests/resume-artifacts.test.ts frontend/wrangler.jsonc worker/wrangler.jsonc worker/wrangler.resume-consumer.jsonc
git commit -m "feat: add private R2 artifact store"
```

## Task 6: Add disabled-by-default feature flags

**Files:**
- Create: `worker/src/resume-config/flags.ts`
- Create: `worker/tests/resume-feature-flags.test.ts`

**Interfaces:**
- Consumes: string Worker vars.
- Produces: `readResumeFeatureFlags(env): ResumeFeatureFlags`.

- [ ] **Step 1: Write failing flag tests**

```ts
import { describe, expect, it } from 'vitest';
import { readResumeFeatureFlags } from '../src/resume-config/flags';

describe('resume feature flags', () => {
  it('disables every new path when variables are absent', () => {
    expect(readResumeFeatureFlags({})).toEqual({
      r2ArtifactWrite: false,
      r2ArtifactRead: false,
      directR2Upload: false,
      sqlResumeList: false,
      hybridSearch: false,
      recruitmentEvents: false,
      recruitmentEventMetrics: false,
    });
  });

  it('only accepts the literal true ignoring case', () => {
    expect(readResumeFeatureFlags({ R2_ARTIFACT_WRITE: 'TRUE', DIRECT_R2_UPLOAD: '1' })).toMatchObject({
      r2ArtifactWrite: true,
      directR2Upload: false,
    });
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `cd worker && npm test -- resume-feature-flags.test.ts`

Expected: FAIL because the flag module is absent.

- [ ] **Step 3: Implement the exact parser from the master plan**

```ts
export interface ResumeFeatureFlags {
  r2ArtifactWrite: boolean;
  r2ArtifactRead: boolean;
  directR2Upload: boolean;
  sqlResumeList: boolean;
  hybridSearch: boolean;
  recruitmentEvents: boolean;
  recruitmentEventMetrics: boolean;
}

export function readResumeFeatureFlags(env: Record<string, unknown>): ResumeFeatureFlags {
  const enabled = (key: string) => String(env[key] ?? '').toLowerCase() === 'true';
  return {
    r2ArtifactWrite: enabled('R2_ARTIFACT_WRITE'),
    r2ArtifactRead: enabled('R2_ARTIFACT_READ'),
    directR2Upload: enabled('DIRECT_R2_UPLOAD'),
    sqlResumeList: enabled('RESUME_SQL_LIST'),
    hybridSearch: enabled('RESUME_HYBRID_SEARCH'),
    recruitmentEvents: enabled('RECRUITMENT_EVENTS'),
    recruitmentEventMetrics: enabled('RECRUITMENT_EVENT_METRICS'),
  };
}
```

- [ ] **Step 4: Run all foundation verification**

```bash
cd worker
npm test -- resume-feature-flags.test.ts resume-artifacts.test.ts
npm test
npx tsc --noEmit
cd ../frontend
npm run build
node ../scripts/pre-deploy-check.mjs
```

Expected: all commands PASS; no feature flag is enabled.

- [ ] **Step 5: Commit**

```bash
git add worker/src/resume-config/flags.ts worker/tests/resume-feature-flags.test.ts
git commit -m "feat: add resume architecture feature flags"
```

## Plan Completion Gate

- [ ] Review `git diff` and confirm only foundation/config files changed.
- [ ] Confirm no production resource or secret was changed.
- [ ] Confirm old upload, processing, list, detail, and delete behavior is unchanged with all flags false.
- [ ] Record test counts and dry-run outputs in the handoff template.
- [ ] Stop for review before starting direct upload.
