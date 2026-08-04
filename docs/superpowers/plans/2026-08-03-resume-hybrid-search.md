# Resume Hybrid Search Implementation Plan

> Execution order: run after R2 processing/read paths are complete. Use Cloudflare AI Search's current `ai_search`/`ai_search_namespaces` bindings; do not use the legacy `env.AI.autorag()` API.

**Goal:** Add exact field filters plus semantic full-text retrieval without leaking another HR user's resumes.

**Architecture:** Each active resume gets one sanitized Markdown search document under `search/{tenant}/{resumeId}.md` in R2. AI Search indexes only `/search/**`. Search retrieves candidates, then D1 is always the final authorization/filter source. The public endpoint is not enabled.

**Version floor:** Wrangler `>=4.68.1`; `@cloudflare/workers-types >=4.20260304.0`.

## Task 1: Add search state and stable ownership

**Files:**
- Create: `worker/migrations/0015_resume_search_state.sql`
- Create: `worker/migrations/0016_position_responsible_user.sql`
- Modify: `worker/schema.sql`
- Create: `worker/tests/resume-search-schema.test.ts`

- [ ] Add `resume_search_state(resume_id PRIMARY KEY, document_version, document_sha256, object_key, indexed_source_updated_at, status, error_code, attempt_count, updated_at)`.
- [ ] Add `positions.responsible_user_id` and index it. Backfill only when `users.full_name` maps uniquely to the existing responsible-person value; leave ambiguous rows null and report them.
- [ ] Make new position writes persist both display name and stable user ID.
- [ ] Add tests proving ambiguous names are never automatically assigned and non-admin scope uses user ID/position IDs.
- [ ] Apply locally and run `cd worker && npm test -- resume-search-schema.test.ts`.
- [ ] Commit: `feat: add resume search state and stable ownership`.

## Task 2: Generate sanitized, deterministic search documents

**Files:**
- Create: `worker/src/resume-search/document.ts`
- Create: `worker/src/resume-search/types.ts`
- Create: `worker/tests/resume-search-document.test.ts`

**Document format:** YAML-like metadata header followed by normalized sections for education, experience, skills, certificates, OCR text, and AI evidence. Exclude phone, email, ID number, address, R2 keys, internal error text, and raw prompt traces.

- [ ] Test deterministic output, PII removal, truncation at 200,000 UTF-8 bytes, and metadata normalization.
- [ ] Use at most five custom metadata fields: `tenant_id`, `position_id`, `owner_user_id`, `created_at_epoch`, `is_active`.
- [ ] Use document hash as `document_version`; unchanged inputs must not rewrite R2.
- [ ] Store with `Content-Type: text/markdown; charset=utf-8` and matching R2 custom metadata.
- [ ] Run `cd worker && npm test -- resume-search-document.test.ts`.
- [ ] Commit: `feat: generate sanitized resume search documents`.

## Task 3: Wire search-document refresh into processing and deletion

**Files:**
- Create: `worker/src/resume-search/indexer.ts`
- Modify: `worker/src/resume-consumer.ts`
- Modify: `worker/src/resume-storage/deletion.ts`
- Create: `worker/tests/resume-search-indexer.test.ts`

- [ ] Test document creation after successful AI projection, no-op on same hash, update after edited fields, and deletion of the search object after soft delete.
- [ ] Write the R2 object first, then update `resume_search_state`; on failure preserve the prior good object/state and throw for queue retry.
- [ ] Use the existing resume processing queue for normal refreshes with an explicit `message_type: 'refresh_search_document'`; do not make browser requests perform indexing.
- [ ] Mark deleted resumes inactive immediately in D1 and delete their `/search/**` object asynchronously.
- [ ] Run `cd worker && npm test -- resume-search-indexer.test.ts`.
- [ ] Commit: `feat: refresh resume search documents asynchronously`.

## Task 4: Configure the AI Search source and binding

**Files:**
- Create: `infra/ai-search/resume-search-v1.json`
- Modify: `worker/wrangler.resume-consumer.jsonc`
- Modify: `worker/wrangler.jsonc`
- Modify: `README.md`

**Instance settings to record in `infra/ai-search/resume-search-v1.json`:**

```json
{
  "id": "resume-search-v1",
  "type": "r2",
  "source": "ai-interview-resume-artifacts",
  "source_params": { "include_items": ["/search/**"] },
  "index_method": { "vector": true, "keyword": true },
  "fusion_method": "rrf",
  "indexing_options": { "keyword_tokenizer": "trigram" },
  "retrieval_options": { "keyword_match_mode": "or" },
  "sync_interval": 900,
  "rewrite_query": false,
  "reranking": false
}
```

- [ ] Create a staging instance using these exact settings and verify its source preview contains only `search/` objects.
- [ ] Do not enable a public search/chat endpoint.
- [ ] Add an instance binding named `RESUME_SEARCH` using `ai_search`; if account policy requires a namespace, use `ai_search_namespaces` and resolve `resume-search-v1` with `env.RESUME_SEARCH.get('resume-search-v1')`.
- [ ] Run `cd worker && npx wrangler types --env staging && npm run typecheck`.
- [ ] Record the resulting binding type and instance identifier; do not commit account IDs or secrets.
- [ ] Commit: `chore: configure private resume AI Search`.

## Task 5: Build a permission-safe hybrid search service

**Files:**
- Create: `worker/src/resume-search/access-scope.ts`
- Create: `worker/src/resume-search/service.ts`
- Create: `worker/tests/resume-search-service.test.ts`

**Interface:**

```ts
searchResumes(input: {
  query: string;
  userId: string;
  role: string;
  filters: ResumeSearchFilters;
  page: number;
  pageSize: number;
}): Promise<{ items: ResumeListItem[]; totalCandidates: number; mode: 'hybrid' | 'exact_fallback' }>;
```

- [ ] Test admin and HR scopes, guessed resume IDs, stale search hits, deleted rows, exact-only query, semantic query, AI Search timeout, and empty query.
- [ ] For semantic queries call `env.RESUME_SEARCH.search({ messages: [{ role: 'user', content: normalizedQuery }] })` (or namespace instance equivalent). Limit retrieval to 100 candidates.
- [ ] Extract only resume IDs from results, then query D1 with `id IN (...)`, `deleted_at IS NULL`, requested structured filters, and authorized position IDs.
- [ ] Never trust AI Search metadata as authorization. Preserve AI Search relevance order with a parameterized `CASE id WHEN ...` expression.
- [ ] On binding error/timeout, return deterministic exact D1 results with `mode: 'exact_fallback'`; never return unfiltered search hits.
- [ ] Run `cd worker && npm test -- resume-search-service.test.ts`.
- [ ] Commit: `feat: add permission-safe hybrid resume search`.

## Task 6: Expose the search API with abuse controls

**Files:**
- Create: `worker/src/resume-search/routes.ts`
- Modify: `worker/src/index.ts`
- Create: `worker/tests/resume-search-routes.test.ts`

**Route:** `POST /api/resumes/search` with `{ query, filters, page, page_size }`.

- [ ] Validate query length 1–200, page size 1–50, allowed filter keys, age/score ranges, and enum values.
- [ ] Require authenticated roles already allowed to list resumes; apply the same scope resolver.
- [ ] Add a per-user rate limit of 30 searches/minute using the project's existing rate-limit mechanism; if none exists, add a Cloudflare rate-limit binding rather than process memory.
- [ ] Return list-card projections and optional `matched_sections`; never return raw OCR text in search response.
- [ ] Add structured timing fields (`search_ms`, `d1_ms`, `mode`) without query text or PII.
- [ ] Run `cd worker && npm test -- resume-search-routes.test.ts`.
- [ ] Commit: `feat: expose hybrid resume search API`.

## Task 7: Add the frontend search experience

**Files:**
- Create: `frontend/src/components/ResumeSearchBar/index.tsx`
- Create: `frontend/src/components/ResumeSearchStatus/index.tsx`
- Modify: `frontend/src/services/resume.ts`
- Modify: `frontend/src/pages/Resumes/List.tsx`
- Create: `frontend/src/pages/Resumes/resumeSearchState.ts`
- Create: `frontend/src/pages/Resumes/resumeSearchState.test.ts`
- Modify: `frontend/package.json`

- [ ] Test URL-state parsing, clearing search, preserving structured filters, request cancellation, and fallback badge state.
- [ ] Debounce input by 350ms, cancel stale requests, and put `q` plus filters in the URL so refresh/back navigation are stable.
- [ ] Empty query continues to use SQL list API. Non-empty query uses search API and displays `语义+关键词` or `精确筛选（搜索服务暂不可用）`.
- [ ] Reuse existing cards and pagination; show no snippets containing phone/email.
- [ ] Run `cd frontend && npm test -- resumeSearchState.test.ts && npm run build`.
- [ ] Commit: `feat: add hybrid search to resume management`.

## Task 8: Stage rollout and relevance acceptance

**Files:**
- Create: `docs/runbooks/resume-search-acceptance.md`
- Modify: `worker/src/config/feature-flags.ts`
- Modify: `README.md`

- [ ] Build a 30-query redacted acceptance set: exact name/skill/certificate, Chinese synonym, typo, multi-condition, and forbidden-scope cases.
- [ ] Acceptance: 100% forbidden-scope exclusion; >=90% exact-query top-5 recall; >=80% semantic-query top-10 recall; p95 API latency <2s with warm index.
- [ ] Enable `RESUME_HYBRID_SEARCH` for admins in staging, then one HR user, then all users after 24 hours without leakage/errors.
- [ ] Verify object-to-index delay at the configured 15-minute sync interval and show `索引更新中` for newer documents.
- [ ] Record file count. At 400,000 indexed files, prepare a second instance; hard limit is 500,000 files per instance and cross-instance search is limited to 10.
- [ ] Run worker/frontend full suites and record results.
- [ ] Commit: `docs: add resume search acceptance and rollout runbook`.

## Done criteria

- Search supports both deterministic structured filtering and semantic text retrieval.
- D1 performs final authorization for every returned resume.
- Search documents omit direct-contact PII and internal system data.
- Search failures degrade to exact D1 filtering.
- No public AI Search endpoint exists.
