# Flywheel State
<!-- LIVING DOCUMENT — overwritten by each /all-up run. History lives in OPERATION-FIX-ALL.md -->
_Last updated: 2026-04-13 (Run 6) — auto-maintained by the all-up flywheel_

---

## Active Pipeline

Each row is an issue the flywheel is tracking. **Runs Stuck** counts consecutive runs where
the issue was blocked at the same phase with the same root cause. ≥2 = cycling alert.

| Issue | Phase | Root Cause / Blocker | Auto-Requeues | Runs Stuck | Notes |
|-------|-------|----------------------|---------------|------------|-------|
| PAN-596 | merged | — | — | — | **Shipped Run 6** ✓ (commit a8ae2b9e, PR #664). Cycling resolved. |
| PAN-611 | merge failed | `GitHub PR #684 has failing required checks` — now surfaced in `mergeNotes` thanks to Run 6 fix 0798a359. Required checks on PR #684 are red. | 0 | 2 | Was silent last run — now diagnostic. Blocker is genuine CI failure on the feature branch; needs work-agent to fix the failing checks, not a substrate bug. |
| PAN-509 | merge blocked by PR-state validator | `PR #527 is CLOSED (not OPEN). Panopticon state is out of sync — likely a cancel-flow left a stale prUrl.` — new validator (0798a359) tripped as designed, returned HTTP 409, wrote clear `mergeNotes`. | 0 | 4 | Cancel-flow root-cause also fixed (90de55b4). Issue now needs manual reset/re-open to create a fresh PR; validator is doing its job. |
| PAN-544 | merge verifying → readyForMerge | — | 0 | 0 | Re-entered merge queue this run; verification in progress. |
| PAN-457 | planning | — (in progress) | 0 | 0 | Planning agent active |
| PAN-540 | planning-complete | — (awaiting implementation) | 0 | 0 | Plan ready for work agent |
| PAN-653 | planning | — (in progress) | 0 | 0 | Planning agent active |
| PAN-645 | merged | — | — | — | Shipped Run 4 ✓ |

---

## Cycling Alerts

### PAN-509 — Cancel-flow state divergence (4 runs — now contained)
- **Pattern**: `readyForMerge=true` pointing at a PR that was closed via cancel-flow.
- **Status Run 6**: **Substrate fixed.** Two-layer defense now in place:
  1. **Root-cause fix** (`90de55b4`): `closeIssuePullRequest()` in `issues.ts` now nulls `prUrl` in review-status after `gh pr close` runs, so a subsequent re-review cycle creates a fresh PR instead of reusing the dead handle.
  2. **Defense-in-depth** (`0798a359`): `triggerMerge()` in `workspaces.ts` validates PR state via `getPullRequestState()` before rebasing/merging; if CLOSED, returns HTTP 409 with a clear `mergeNotes` message instead of silently mis-merging.
- **PAN-509 itself**: Still pointing at closed PR #527 from its pre-fix state. Validator tripped correctly. Issue needs manual reset (or a `repairClosedPRs()` startup sweep) to reflow into the pipeline — the alert is retained only because this instance still needs cleanup.
- **Runs Stuck climbed to 4** but the cycling mechanism is broken: future issues can no longer enter this state.

### PAN-611 — Silent merge failure (2 runs — now diagnostic)
- **Pattern**: `mergeStatus=failed` with `mergeNotes=null` and no error line in the dashboard log.
- **Status Run 6**: **Substrate fixed.** `triggerMerge()` catch blocks (all sites — prResult failure, remote merge failure, polyrepo prereq failures, artifact catch, top-level catch) now `console.error` the failure and persist the message to `mergeNotes`. PAN-611 now clearly reports: `github merge failed: GitHub PR #684 has failing required checks` — operators can see *why* without log-diving.
- **PAN-611 itself**: The newly-surfaced error shows the real blocker is a genuine CI failure on the feature branch, not a merge-agent bug. Work-agent needs to fix PR #684's failing checks.

---

## Infrastructure Gaps

| Gap | Impact | First Seen | Filed? | Status |
|-----|--------|-----------|--------|---|
| Blocking FS calls in request handlers | Dashboard API hangs under load | Run 4 | No | **FIXED Run 5** (9cf06605) |
| Deacon replays stale review notes for orphaned `reviewing` | PAN-596 cycled 3 runs with byte-identical notes | Run 5 | No | **FIXED Run 5** (e2395dd6) |
| Cancel-flow leaves stale `prUrl` pointing to CLOSED PR | `readyForMerge=true` against closed PR | Run 5 | No | **FIXED Run 6** (90de55b4 — null prUrl in `closeIssuePullRequest`; 0798a359 — validator in `triggerMerge`) |
| Merge-agent silent failures (no `mergeNotes`, no log) | `mergeStatus=failed` with zero diagnostics | Run 5 | No | **FIXED Run 6** (0798a359 — `console.error` + `mergeNotes` at every catch site) |
| Orphaned planning sessions | `planning-pan-NNN` alive hours after plan complete | Run 3 | PAN-682 | **FIXED Run 6** (cb3f67a8 — `cleanupOrphanedPlanningSessions()` in deacon patrol; live-verified killing `planning-pan-596`) |
| `repairClosedPRs()` startup sweep | Pre-fix PAN-509 instance still needs cleanup | Run 6 | No | **NEW** — one-shot repair: scan workspaces with `readyForMerge=true`, verify PR is OPEN, reset if not |
| Review circuit breaker can't self-reset | Manual `pan work reset-review` after 7 requeues | Run 4 | No | Ongoing |
| Verification bypass at 3 failures masks root causes | Bypass hides test failures | Run 5 | No | Ongoing |
| Startup repair `repairMergedLabels` full-table scan | Noisy logs every restart | Run 4 | No | Ongoing |

---

## Pattern Ledger

| Pattern | Signature | Root Cause | Fix Applied |
|---------|-----------|------------|-------------|
| Blocking FS in request handlers | API hangs, curl timeouts | `readFileSync`/`execSync` in routes/services | Cache config at startup, async FS (Run 5: 9cf06605) |
| Review cycling with byte-identical failure notes | N runs of `review=failed` with SAME notes across different commits; no feedback files | `deacon.ts` `checkOrphanedReviewStatuses` replayed latest terminal history entry verbatim | Only restore `passed` terminals (Run 5: e2395dd6) |
| Cancel-flow stale prUrl | `readyForMerge=true` against CLOSED PR | `/cancel` closes PR but doesn't null `prUrl`; re-review reuses stale handle | Null `prUrl` in `closeIssuePullRequest` + pre-merge PR-state validator in `triggerMerge` (Run 6: 90de55b4 + 0798a359) |
| Silent merge-agent failures | `mergeStatus=failed`, `mergeNotes=null`, no log | Catch blocks swallowed errors without logging or persisting | `console.error` + `setReviewStatus({mergeNotes})` at every catch site in `triggerMerge` (Run 6: 0798a359) |
| Orphaned planning sessions | `planning-pan-NNN` alive hours after `complete-planning` | `complete-planning.ts` sometimes skips session kill; no authoritative reaper | Deacon patrol cleanup: if `planning-pan-X` exists AND `agent-pan-X` exists, kill the planning session (Run 6: cb3f67a8) |
| Post-merge lifecycle incomplete | `mergeStatus=merged` but GH issue OPEN | `close-issue` step failed silently | `repairIncompletePostMergeLifecycle()` (Run 4) |
| PR merged on GH but Panopticon stuck | `gh pr view` → MERGED but `mergeStatus!=merged` | Post-merge verification failed after `gh pr merge` | `repairAlreadyMergedPRs()` (Run 4) |

---

## Skill Gaps

| Desired Capability | Why Needed | Priority | Status |
|-------------------|-----------|----------|--------|
| `repairClosedPRs()` startup sweep | Clean up pre-fix stale-prUrl instances like PAN-509 | High | New (Run 6) |
| PR-state validator in `/review` and `/request-review` | Additional defense layer at review submission time | Medium | Partially addressed — Run 6 validator is at merge-time, earlier layer still missing |
| Holistic dead-code detection in review | Review finds dead code piecemeal | High | Ongoing |
| Active feedback notification for idle agents | Agents don't know feedback arrived | High | Ongoing |
| Verification gate: configurable pass criteria | 3-failure bypass masks real issues | Medium | Ongoing |
| Feedback delivery: batch and de-dup | Multiple feedback files should consolidate | Medium | Ongoing |
| Auto-detect cycling in review | Same issue across N cycles should escalate | Low | Partially addressed by deacon replay fix (Run 5) |
| Merge-agent error reporting | Silent failures give operators nothing to debug | — | **CLOSED Run 6** (0798a359) |
| `complete-planning` session cleanup | Orphaned planning sessions accumulate | — | **CLOSED Run 6** (cb3f67a8) |

---

## Run 6 Summary

**Bugs fixed in code** (3 substrate fixes, all pushed to `origin/main`):

1. **Merge-agent silent failures** (`0798a359` — `fix(dashboard): persist mergeNotes + validate PR state before merge`):
   - Added `console.error` and `mergeNotes` persistence to every catch block in `triggerMerge()` (prResult, remote merge, polyrepo prereqs, artifact catch, top-level catch).
   - Added pre-merge PR-state validator using `getPullRequestState()`: if PR is CLOSED, returns HTTP 409 with clear `mergeNotes`; if already MERGED, runs post-merge lifecycle and returns success.
   - **Live-verified**: PAN-611 now reports `github merge failed: GitHub PR #684 has failing required checks`; PAN-509 now reports `PR #527 is CLOSED (not OPEN)...`.

2. **Orphaned planning sessions** (`cb3f67a8` — `fix(cloister): kill orphaned planning tmux sessions in deacon patrol`):
   - Added `cleanupOrphanedPlanningSessions()` to deacon patrol cycle. For every `planning-pan-X` tmux session, if `agent-pan-X` (work agent) also exists, kill the planning session and mark its state `stopped`.
   - **Live-verified**: Deacon log shows `[deacon] Killed orphaned planning-pan-596 (work agent agent-pan-596 is running)`.

3. **Cancel-flow stale prUrl** (`90de55b4` — `fix(dashboard): null stale prUrl in closeIssuePullRequest (cancel-flow)`):
   - `closeIssuePullRequest()` in `issues.ts` now calls `setReviewStatus({ prUrl: undefined })` after `gh pr close` so a re-review cycle creates a fresh PR instead of reusing the dead handle.
   - Closes the root cause that made PAN-509 cycle for 4 runs. The pre-merge validator (fix #1) catches any pre-existing stale-prUrl instances.

**Issues moved**:
- **PAN-596** → **MERGED** (commit `a8ae2b9e`, PR #664). 3-run cycle broken — real review ran, test regressions fixed by work agent, full pipeline completed.
- **PAN-611** → `mergeStatus=failed` with clear `mergeNotes` for the first time; real blocker (CI failing checks on PR #684) is now visible.
- **PAN-509** → Validator caught the stale closed-PR state and refused to merge with clear diagnostic; still needs manual cleanup (or a future `repairClosedPRs()` sweep) but the cycling mechanism is broken.
- **PAN-544** → Re-entered merge queue; verifying.

**New substrate work surfaced**:
- `repairClosedPRs()` one-shot repair needed to clean up the pre-fix PAN-509 instance. Not a new bug class — a cleanup tool for data that escaped into the old broken state.

**Main branch state**: Clean, up-to-date with `origin/main`. 3 substrate fix commits pushed this run plus 1 merged feature (PAN-596).

**Next-run priorities** (in order):
1. PAN-509 cleanup (either `repairClosedPRs()` or manual reset)
2. PAN-611 — hand to work-agent to fix failing CI checks on PR #684 (not a substrate issue)
3. Observe PAN-544 through verification → awaiting-merge
4. Drive PAN-457 / PAN-540 / PAN-653 plans into implementation
