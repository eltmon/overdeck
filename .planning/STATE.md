# PAN-711 Planning STATE

## Issue
**PAN-711** — PAN-705 follow-up: remove transitional route aliases after merge
https://github.com/eltmon/panopticon-cli/issues/711

## Discovery summary

PAN-711 was scoped on the assumption that PAN-705 had landed with backward-compat
alias routes still in place that needed to be deleted in a follow-up. **That
assumption is now false.** During PAN-705 review (feedback round #007), the
review agent flagged the alias routes as a "no bandaids" violation. They were
deleted in commit `d18c74cc` ("fix: remove alias bandaid, fix root-cause callers
of old API routes"), which was squashed into the merged PR `#708` (commit
`0f1fcfa0`). Main is already free of all 9 alias routes and the `forwardAlias`
helper.

Verified by grep against `src/` on the current branch (forked from main):
- Zero references to `/api/workspaces/:id/{review-status,approve,merge,review-trigger,review-reset,review-request,review,request-review}` or the `:issueId` variants in any `.ts` source under `src/`.
- The five renamed handlers exist at their new homes in `src/dashboard/server/routes/workspaces.ts`:
  - `/api/review/:issueId/status` (GET + POST), `/api/review/:issueId/trigger`, `/api/review/:issueId/reset`, `/api/review/:issueId/request`
  - `/api/issues/:issueId/approve`, `/api/issues/:issueId/merge`, `/api/issues/:issueId/sync-main`
- Specialist prompts under `src/lib/cloister/prompts/` contain zero references to the old paths.
- The d18c74cc commit also fixed the three remaining internal callers (`service.ts:654`, `verification-runner.ts:136`, `verification-runner.ts:294`).

## What remains for PAN-711

Two narrow follow-ups, neither of which are code-path bugs:

1. **Regression guard.** Add a unit test that fails if any of the deleted alias path strings reappear under `src/`. This locks in the cleanup so the aliases can't be reintroduced by reflex during a future "make it work" fix. Without this, nothing in CI prevents the same bandaid from sliding back in.
2. **Stale doc references.** Four living docs still mention the renamed paths as if they were current. They are not historical incident records — they are reference docs that other contributors and agents will read and treat as authoritative. The historical PRD archives under `docs/prds/completed/` should NOT be touched (per user direction); they are time-locked snapshots.

## Doc references to update

| File | Line | Old path | New path |
|---|---|---|---|
| `docs/TESTING.md` | 132 | `POST /api/workspaces/:id/review-status` | `POST /api/review/:id/status` |
| `docs/PRD-CLOISTER.md` | 178 | `GET /api/workspaces/:issueId/review-status` | `GET /api/review/:issueId/status` |
| `docs/PRD-CLOISTER.md` | 179 | `POST /api/workspaces/:issueId/review-status` | `POST /api/review/:issueId/status` |
| `docs/FIX-ALL-PRD.md` | 124 | `POSTs to /api/workspaces/:id/merge` | `POSTs to /api/issues/:id/merge` |
| `docs/prds/active/pan-509/STATE.md` | 17 | `/api/workspaces/:issueId/review-status` | `/api/review/:issueId/status` |

**Explicitly out of scope:**
- `docs/OPERATION-FIX-ALL.md:183` — this is a Run-N incident note describing what the path was at the time of the fix (commit `7396ba18`). It's a historical log entry and rewriting it would falsify the record. Leave alone.
- `docs/research/t3code-drift-plan.md` — references different `/api/workspaces/:id/...` endpoints (`start-agent`) that were not renamed and remain valid.
- `docs/prds/completed/{PAN-262,pan-35}-plan.md` — completed PRD archives, time-locked.
- `docs/prds/planned/pan-453-vbrief-full-spec-support.md` and others mentioning `/api/workspaces/:issueId/plan` — that endpoint still exists at that path; only the specialist-feedback routes were renamed.
- A live pipeline test cycle (per user direction — PAN-711's own merge run will exercise the new routes end-to-end).

## Approach

Two beads, both `simple`/`trivial`. No phases.

1. **Regression guard test.** Add `tests/unit/dashboard/no-alias-routes.test.ts` (or extend an existing routes test) that walks `src/` and asserts none of the eight deleted alias path literals appear. Use a hardcoded list of path strings — the test itself documents which paths are forbidden. Should run inside the existing `npm test` Vitest invocation.
2. **Doc reference sweep.** Update the five lines listed above. Pure string replacement — no re-architecture, no surrounding rewrite.

Order: independent. Either can land first. No `blocks` edges.

## Out of scope (explicit)

- Renaming any other route. The only renames that happened in PAN-705 are the eight specialist-feedback paths. Don't touch `/api/workspaces/:issueId/plan`, `/api/workspaces/:issueId/tldr`, `/api/workspaces/:issueId/refresh-db`, etc.
- Adding alias deprecation warnings or compat shims (the whole point is no shims).
- Editing completed PRD archives or historical incident logs.
- Refactoring `workspaces.ts`. It's still 4000+ lines; that's a separate problem.

## Risks

- **Test brittleness:** if a future legitimate route happens to contain a substring like "review-status", the regression test could false-positive. Mitigation: assert on the full path literal (`'/api/workspaces/:issueId/review-status'`), not a fragment.
- **Quoting variants:** alias paths could be reintroduced as template strings or with the `:id` form instead of `:issueId`. The guard test should check both `:id` and `:issueId` variants and both quote styles.

## Verification gates

Standard: `npm run typecheck`, `npm run lint`, `npm test`. The new test will exercise itself.
