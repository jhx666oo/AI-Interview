# Task 8 Operations Responsive Migration

## Scope

- `frontend/src/pages/Positions/List.tsx`
- `frontend/src/pages/Positions/Form.tsx`
- `frontend/src/pages/Interviews/List.tsx`
- `frontend/src/pages/Interviews/Result.tsx`
- `frontend/src/pages/Interviews/Score.tsx`
- `frontend/src/pages/Onboarding/List.tsx`
- `frontend/src/pages/Probation/List.tsx`
- `frontend/src/pages/TalentPool/List.tsx`

## Changes

- Wrapped operational tables in `TableViewport` without changing columns, row keys, selection, pagination, sorting, or action callbacks.
- Applied `ResponsiveModal` to operational dialogs and responsive grid breakpoints to score and operational form content.
- Moved selected toolbar controls into responsive primitives and added responsive headers where appropriate.
- Preserved request, form, dialog, and action behavior.

## Verification

- `git diff --check` passed.
- `npm run build` passed in `frontend/`.
