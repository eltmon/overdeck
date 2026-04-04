# PAN-448: Start Agent confirmation timeout too short

## Decision

Increase the inline confirmation timeout on the "Start Agent" / "Resume Agent" button from 6s to 7s.

## Context

- Commit `ca74462` already bumped from 3s → 6s, but user wants 7s.
- Single line change in `src/dashboard/frontend/src/components/KanbanBoard.tsx` line 1852.
- The `setTimeout` value changes from `6000` to `7000`.

## Scope

- **In scope:** Change timeout constant from 6000 → 7000
- **Out of scope:** Changing the confirmation UX pattern (stays as auto-reset timeout)

## Difficulty: trivial

## Specialist Feedback

- **[2026-04-04T22:35Z] verification-gate → FAILED** — `.planning/feedback/001-verification-gate-failed.md`
