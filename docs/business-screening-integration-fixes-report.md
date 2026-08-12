# Business screening integration fixes report

Implemented three scoped integration fixes:

1. Link contract
- Worker-generated push/resend links now use the SPA path `/business-screening/:token` on the same origin.
- Public API routes remain unchanged under `/api/public/business-screening/:token`.

2. Resume list business-screening filter contract
- Both `/api/resumes` and the optimized SQL list now expose `hr_disposition` and `business_screening_status`.
- Both list paths now honor `business_screening_status=pending|passed|rejected` with `not_ready` as the default fallback when no business push state exists.
- Existing `status` and `screening_result` filters remain intact.

3. Public page conflict messaging
- The public business-screening page now maps known backend conflict reasons to Chinese user-facing messages for completed, stale, and HR-rejected cases.

Verification run:

- Worker focused tests: passed
- Worker full tests: `312` passed
- Frontend focused tests: passed
- Frontend full tests: `147` passed
- Frontend production build: passed
