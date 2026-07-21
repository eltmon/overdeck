# Fix red main — repoint `review-agent.test.ts` source-introspection tests after #2124

**Branch:** `codebase-health/fix-review-agent-test` (off `main`) · **Executor:** GPT-5.5 (handoff), supervised by conv #182
**Mode:** orchestrated handoff — **do NOT run `pan done`, do NOT open a PR.** Commit on this branch; the orchestrator reviews + merges.

---

## Root cause (verified)
`main` is RED. PR #2124 decomposed `src/dashboard/server/routes/workspaces.ts` and **extracted the review routes into submodules**, but `tests/lib/cloister/review-agent.test.ts` still `readFileSync`s `workspaces.ts` and regex-matches for route code that has MOVED. 9 tests now get `null` matches → `expect(...).not.toBeNull()` fails.

**Symbol → new location on `main` (verified with grep):**
| Symbol | Now lives in |
|---|---|
| `postWorkspaceRequestReviewRoute` | `src/dashboard/server/routes/workspaces/review-pipeline.ts` |
| `shouldTreatAsRerun(existingStatus)` | `…/workspaces/review-pipeline.ts` |
| `getDirtyWorkspaceErrorForReviewRequest` | `…/workspaces/review-pipeline.ts` |
| `runVerificationForIssue` usage (request-review) | `…/workspaces/review-pipeline.ts` |
| gated-dispatch deferral (`reviewResult.gated`, `Review deferred for`) | `…/workspaces/review-pipeline.ts` |
| `postWorkspaceResetReviewRoute` (old END delimiter) | `…/workspaces/review-control.ts` |
| `postWorkspaceApproveRoute` / `POST /api/issues/:issueId/approve` | still `workspaces.ts` |

## The 9 failing tests (all in `tests/lib/cloister/review-agent.test.ts`)
1. `reviewStatus type-safety regression` → `does not write reviewStatus=dispatch_failed` (~L404)
2. `request-review fresh convoy regression` → `forces review respawn…` (~L435)
3. `passed-state rerun regression` → `rejects dirty workspaces before rerun dispatch` (~L507)
4. `passed-state rerun regression` → `uses spawnReviewRoleForIssue in the rerun path` (~L525)
5. `dispatch failure reviewStatus regression` → `blocks dirty worktrees before verification` (~L749)
6. `dispatch failure reviewStatus regression` → `yields the verification Effect directly` (~L773)
7. `dispatch failure reviewStatus regression` → `review request routes treat gated dispatches as deferrals` (~L812)
8. `dispatch failure reviewStatus regression` → `approve route treats gated dispatches as deferrals` (~L833)
9. `dispatch failure reviewStatus regression` → `dispatch failure paths set reviewStatus=pending not failed` (~L857)

(Note: a 10th test in the same block, `specialists review restart route returns 409…` at ~L792, reads `specialists.ts` and is NOT failing — leave it alone.)

## Fix approach (behavior-preserving, NO weakening of assertions)
For each failing test, repoint the `readFileSync(...)` at the module that now contains the code, and fix the block-extraction:

- **Tests 1, 2, 5, 6, 7, 9** (request-review block): read `…/workspaces/review-pipeline.ts`. The old extraction `routeSrc.match(/postWorkspaceRequestReviewRoute[\s\S]*?postWorkspaceResetReviewRoute/)` can no longer span two files. Since `review-pipeline.ts` IS the request-review module, set `requestReviewBlock = <the full review-pipeline.ts source>` (drop the cross-file regex), then keep the existing inner assertions unchanged. If an inner assertion needs a narrower scope, pick an in-module delimiter that actually exists in `review-pipeline.ts`.
- **Tests 3, 4** (rerun block): read `…/workspaces/review-pipeline.ts`; the `/shouldTreatAsRerun\(existingStatus\)[\s\S]*?rerun:\s*true/` regex still works there — only the file path changes.
- **Test 8** (approve route): approve stayed in `workspaces.ts`. Keep reading `workspaces.ts`, but VERIFY the `/POST \/api\/issues\/:issueId\/approve[\s\S]*?Fallback \(PAN-1531\): direct server-side rebase/` delimiters still both exist there; if the end-delimiter moved, pick one that exists in the current approve route.

**Do NOT delete or weaken any inner `toContain`/`toMatch`/`toBeNull` assertion.** The route CODE moved verbatim; the asserted strings must still be present in the new module. If any assertion genuinely cannot be satisfied against the new module, STOP and report — that would mean #2124 changed behavior, not just location.

Consider extracting a small top-level helper `readRouteSrc(relPath)` to DRY the repeated `readFileSync(resolve(import.meta.dirname, relPath), 'utf-8')`, but that is optional — minimal repointing is fine.

## Verification (MUST run, in this worktree which has the post-#2124 code)
```
npx vitest run tests/lib/cloister/review-agent.test.ts --configLoader runner   # all green, 0 failed
npm run typecheck && npm run lint
```
The first command is the real gate — these tests run against the actual new module layout in this worktree, so green here means the fix is correct.

## Acceptance criteria
- All 9 tests pass; the non-failing tests in the file still pass; no assertion weakened/removed.
- `npx vitest run tests/lib/cloister/review-agent.test.ts` exit 0; typecheck + lint exit 0.
- Diff touches ONLY `tests/lib/cloister/review-agent.test.ts` (+ this PRD).

## Intersecting rules
No bandaids (repoint to real new locations, don't weaken tests); surgical; worktree discipline (branch = `codebase-health/fix-review-agent-test`); conventional commit lowercase subject (e.g. `test(review): repoint review-agent introspection tests to extracted review modules`), never `--no-verify`; **do NOT run `pan done` or open a PR** — report to the orchestrator when green.
