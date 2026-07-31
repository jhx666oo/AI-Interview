# Resume AI Display Fix Design

## Goal

Keep AI evaluation scores visible on resume list cards for every supported stored shape, and prevent AI evaluation text from expanding beyond the resume detail panel.

## Data contract

The UI will use one pure normalizer with this source precedence: `ai_evaluation`, then `ai_review`. It accepts modern `dimensions` arrays, legacy maps of dimension names to numeric scores, maps whose values contain `{ score, reason }`, and JSON-encoded legacy strings. It returns a normalized `{ name, score, reason }[]` with scores clamped to the five-point display scale.

## Rendering

The list card receives the normalized dimensions and continues to render its existing tags. When no dimension can be recovered, it shows the available overall score rather than incorrectly reporting that no AI evaluation exists. The detail page uses the same normalized view for a compact score section and renders all AI prose in a bounded, wrap-safe container.

## Safety and verification

This is a presentation-only change: no AI jobs, D1 rows, or evaluation values are rewritten. Unit tests cover both array and legacy object shapes plus source fallback; the production frontend build confirms the detail layout compiles.
