# Resume AI Display Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore AI score tags on all resume cards and make AI evaluation prose wrap safely in the detail view.

**Architecture:** Add a pure frontend normalization utility so the list and detail pages consume the same D1-compatible evaluation shape. Keep rendering changes local to the two resume pages.

**Tech Stack:** React, TypeScript, Ant Design, Vitest.

## Global Constraints

- Do not re-run or mutate AI evaluations.
- Use `ai_evaluation` first and `ai_review` only as a compatibility fallback.
- Convert only display scores; clamp them to `0..5`.
- Long unbroken text must wrap inside the detail panel.

### Task 1: Test and implement evaluation normalization

**Files:**
- Create: `frontend/src/utils/resumeEvaluation.ts`
- Create: `worker/tests/resume-evaluation-display.test.ts`

- [ ] Write a failing Vitest import test for `normalizeResumeEvaluation`, covering a dimensions array, a numeric object map, and fallback from empty `ai_evaluation` to `ai_review`.
- [ ] Run `cd worker && npm test -- resume-evaluation-display.test.ts` and observe module-not-found failure.
- [ ] Implement the pure normalizer and run the same command until it passes.

### Task 2: Use the contract in resume views

**Files:**
- Modify: `frontend/src/pages/Resumes/List.tsx`
- Modify: `frontend/src/pages/Resumes/Detail.tsx`

- [ ] Replace card-local parsing with the shared normalizer and show a fallback overall score when dimensions are unavailable.
- [ ] Add a compact dimensions section in detail and use `overflowWrap: 'anywhere'`, `wordBreak: 'break-word'`, and bounded Markdown table/code styles for all AI prose.
- [ ] Run `cd worker && npm test -- resume-evaluation-display.test.ts && cd ../frontend && npm run build`.
