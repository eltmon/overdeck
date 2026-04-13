# Flywheel State
<!-- LIVING DOCUMENT — overwritten by each /all-up run. History lives in OPERATION-FIX-ALL.md -->
_Last updated: 2026-04-13 (Run 7) — auto-maintained by the all-up flywheel_

---

## Active Pipeline

Each row is an issue the flywheel is tracking. **Runs Stuck** counts consecutive runs where
the issue was blocked at the same phase with the same root cause. ≥2 = cycling alert.

| Issue | Phase | Root Cause / Blocker | Auto-Requeues | Runs Stuck | Notes |
|-------|-------|----------------------|---------------|------------|-------|
| PAN-611 | merge blocked by check-status gate | `GitHub PR #684 has failing required checks on HEAD …` — new Run 7 check-status gate (40f5fe0e) trips before rebase. Real failure: build:cli `cp src/lib/caveman/*.js` fails because `.gitignore:42` excludes `src/lib/**/*.js` so feature branch never commits its new source files. | 0 | 3 | **Feature-branch bug, not substrate** — work-agent must fix its own .gitignore/file layout. Gate is doing its job. |
| PAN-544 | merge blocked by check-status gate | `GitHub PR #545 has failing required checks on HEAD …` — CI `bun install --frozen-lockfile` rejects stale bun.lock; local verification gate didn't run with `--frozen-lockfile` so drift was invisible. | 0 | 1 | Config fix applied: panopticon-cli quality_gates now includes `install` gate with `--frozen-lockfile`. Future workspaces will fail verification on lockfile drift. |
| PAN-509 | repaired — re-entering pipeline | — (sweep cleaned stale prUrl) | 0 | 0 | **Run 7 substrate fix (9f974f43): `repairClosedPRs()` startup sweep ran and cleared prUrl + reset reviewStatus=pending.** 4-run cycle broken. |
| PAN-544 | also in planning/impl | — | 0 | 0 | agent-pan-544 running, task_complete awaiting specialist dispatch |
| PAN-457 | planning | — (in progress) | 0 | 0 | Planning agent active |
| PAN-540 | planning-complete | — (awaiting implementation) | 0 | 0 | Plan ready for work agent |
| PAN-653 | planning | — (in progress) | 0 | 0 | Planning agent active |
| PAN-596 | merged | — | — | — | Shipped Run 6 ✓ |
| PAN-645 | merged | — | — | — | Shipped Run 4 ✓ |

---

## Cycling Alerts

### PAN-611 — GitHub CI failure masked by verification gate (3 runs — now diagnostic-blocked)
- **Pattern Run 5–6**: silent merge failure; Run 6 fix (0798a359) surfaced the real error: `GitHub PR #684 has failing required checks`.
- **Pattern Run 7**: same blocker persists. Work agent has not fixed the CI failure. Root cause on feature branch: `src/lib/caveman/*.js` files exist in the workspace but are excluded by `.gitignore:42` (`src/lib/**/*.js`), so they are never pushed; CI's `cp` step fails.
- **Substrate status**: **Contained.** Run 7 check-status gate (40f5fe0e) now refuses to even attempt the rebase when CI is red, so we stop churning the queue. Work agent must fix its branch.
- **Runs Stuck at 3** but the substrate can no longer mask it — the issue is now clearly the agent's responsibility.

### PAN-544 — Lockfile drift divergence (1 run — now blocked by gate)
- **Pattern Run 7**: work agent modified a workspace dependency without updating `bun.lock`; local verification `bun install` silently updated it (non-frozen) so build passed locally; CI `bun install --frozen-lockfile` rejected, causing all jobs to fail at the install step.
- **Substrate fix Run 7**: added `install: bun install --frozen-lockfile` as the first gate in `panopticon-cli` project `quality_gates` (`~/.panopticon/projects.yaml`). Future agent-done events will fail verification immediately on lockfile drift and feedback will be sent to the agent to run `bun install` and commit the updated lockfile.
- **PAN-544 itself**: check-status gate now refuses merge; work agent must fix its own `bun.lock`.

---

## Infrastructure Gaps

| Gap | Impact | First Seen | Filed? | Status |
|-----|--------|-----------|--------|---|
| Blocking FS calls in request handlers | Dashboard API hangs under load | Run 4 | No | **FIXED Run 5** (9cf06605) |
| Deacon replays stale review notes for orphaned `reviewing` | PAN-596 cycled 3 runs with byte-identical notes | Run 5 | No | **FIXED Run 5** (e2395dd6) |
| Cancel-flow leaves stale `prUrl` pointing to CLOSED PR | `readyForMerge=true` against closed PR | Run 5 | No | **FIXED Run 6** (90de55b4 + 0798a359) |
| Merge-agent silent failures (no `mergeNotes`, no log) | `mergeStatus=failed` with zero diagnostics | Run 5 | No | **FIXED Run 6** (0798a359) |
| Orphaned planning sessions | `planning-pan-NNN` alive hours after plan complete | Run 3 | PAN-682 | **FIXED Run 6** (cb3f67a8) |
| `repairClosedPRs()` startup sweep | Pre-fix PAN-509 instance still needs cleanup | Run 6 | No | **FIXED Run 7** (6843dc27 + 9f974f43 — broadened filter, live-verified PAN-509 cleared on restart) |
| Verification gate lacks `bun install --frozen-lockfile` | Lockfile drift invisible until GitHub CI catches it; merge queue churns against red PRs | Run 7 | No | **FIXED Run 7** (config update to panopticon-cli quality_gates; `install` gate now runs first) |
| No GitHub check-status gate in `triggerMerge()` | Merge pipeline attempts rebase+merge against PRs with failing required checks; branch protection rejects silently, operator sees generic error | Run 7 | No | **FIXED Run 7** (40f5fe0e — pre-rebase check of `prState.checksFailed` with clear `mergeNotes`) |
| Verification gate runs on dirty workspace, not clean-committed state | Gitignored files or uncommitted changes make local build pass while CI fails on a fresh clone | Run 7 | No | **NEW** — structural gap. Mitigated by check-status gate, but root fix would be `git stash + clean checkout` for verification. |
| Review circuit breaker can't self-reset | Manual `pan work reset-review` after 7 requeues | Run 4 | No | Ongoing |
| Verification bypass at 3 failures masks root causes | Bypass hides test failures | Run 5 | No | Ongoing |
| Startup repair `repairMergedLabels` full-table scan | Noisy logs every restart | Run 4 | No | Ongoing |

---

## Pattern Ledger

| Pattern | Signature | Root Cause | Fix Applied |
|---------|-----------|------------|-------------|
| Blocking FS in request handlers | API hangs, curl timeouts | `readFileSync`/`execSync` in routes/services | Cache config at startup, async FS (Run 5: 9cf06605) |
| Review cycling with byte-identical failure notes | N runs of `review=failed` with SAME notes; no feedback files | `deacon.ts` `checkOrphanedReviewStatuses` replayed latest terminal history verbatim | Only restore `passed` terminals (Run 5: e2395dd6) |
| Cancel-flow stale prUrl | `readyForMerge=true` against CLOSED PR | `/cancel` closes PR but doesn't null `prUrl`; re-review reuses stale handle | Null `prUrl` in `closeIssuePullRequest` + pre-merge PR-state validator (Run 6: 90de55b4 + 0798a359) |
| Silent merge-agent failures | `mergeStatus=failed`, `mergeNotes=null`, no log | Catch blocks swallowed errors without logging or persisting | `console.error` + `setReviewStatus({mergeNotes})` at every catch site (Run 6: 0798a359) |
| Orphaned planning sessions | `planning-pan-NNN` alive after `complete-planning` | `complete-planning.ts` sometimes skips session kill | Deacon patrol cleanup: kill `planning-pan-X` when `agent-pan-X` exists (Run 6: cb3f67a8) |
| Local-vs-CI divergence (lockfile) | Local build passes; CI install fails with `lockfile is frozen` | Verification gate uses non-frozen `bun install`; CI uses `--frozen-lockfile` | Add `install: bun install --frozen-lockfile` as first quality gate (Run 7: projects.yaml config) |
| Local-vs-CI divergence (gitignored source) | Local build passes (dirty workspace has files); CI fails (files not committed, excluded by .gitignore) | Verification runs against dirty workspace, not committed state | Defense-in-depth: check-status gate in `triggerMerge` blocks merges when PR's HEAD has failing required checks (Run 7: 40f5fe0e). Root fix (clean-checkout verification) still pending. |
| Stale closed-PR residue surviving post-validator | `mergeStatus=failed`, `prUrl` points at CLOSED PR, `readyForMerge=false` | Run 6 validator set readyForMerge=false but left prUrl in place | `repairClosedPRs()` startup sweep clears prUrl and resets reviewStatus (Run 7: 6843dc27 + 9f974f43) |
| Post-merge lifecycle incomplete | `mergeStatus=merged` but GH issue OPEN | `close-issue` step failed silently | `repairIncompletePostMergeLifecycle()` (Run 4) |
| PR merged on GH but Panopticon stuck | `gh pr view` → MERGED but `mergeStatus!=merged` | Post-merge verification failed after `gh pr merge` | `repairAlreadyMergedPRs()` (Run 4) |

---

## Skill Gaps

| Desired Capability | Why Needed | Priority | Status |
|-------------------|-----------|----------|--------|
| Clean-checkout verification gate | Gate currently runs on dirty workspace, missing gitignore/uncommitted bugs | High | **NEW Run 7** — mitigated but not fully fixed. Needs `git stash push -u` + run + `git stash pop`, or worktree-based sandbox. |
| Cycle-aware work-agent escalation | PAN-611 cycled 3 runs; system should page the operator after N stuck runs | Medium | Ongoing |
| PR-state validator in `/review` and `/request-review` | Additional defense layer at review submission time | Medium | Partially addressed — Run 6 + 7 validators are at merge-time |
| Holistic dead-code detection in review | Review finds dead code piecemeal | High | Ongoing |
| Active feedback notification for idle agents | Agents don't know feedback arrived | High | Ongoing |
| Verification gate: configurable pass criteria | 3-failure bypass masks real issues | Medium | Ongoing |
| Feedback delivery: batch and de-dup | Multiple feedback files should consolidate | Medium | Ongoing |
| Auto-detect cycling in review | Same issue across N cycles should escalate | Low | Partially addressed by deacon replay fix (Run 5) |
| `repairClosedPRs()` startup sweep | Clean up pre-fix stale-prUrl instances | High | **CLOSED Run 7** (6843dc27 + 9f974f43) |
| Merge-agent error reporting | Silent failures give operators nothing to debug | — | **CLOSED Run 6** (0798a359) |
| `complete-planning` session cleanup | Orphaned planning sessions accumulate | — | **CLOSED Run 6** (cb3f67a8) |

---

## Run 7 Summary

**Bugs fixed in code** (3 substrate fixes, all pushed to `origin/main`):

1. **GitHub check-status gate in `triggerMerge()`** (`40f5fe0e` — `fix(dashboard): block merge when GitHub required checks are failing`):
   - Extends the Run 6 pre-merge PR-state validator to also fail when `prState.checksFailed` is true.
   - Uses the existing `GitHubPullRequestState.checksFailed` field (already populated via GitHub REST API).
   - Writes a clear `mergeNotes` pointing to the PR page; returns HTTP 409.
   - **Live-observable impact**: PAN-611 and PAN-544 will no longer churn the merge queue — the gate refuses merge up-front and work agents must fix CI.

2. **`repairClosedPRs()` startup sweep** (`6843dc27` + `9f974f43`):
   - Adds a fifth repair function to the startup battery in `label-cleanup.ts`, wired into `main.ts`.
   - Scans review-status for any issue with a non-merged `prUrl` pointing at a CLOSED (unmerged) GitHub PR; clears `prUrl`, `readyForMerge`, `mergeStatus`, and resets `reviewStatus` to `pending` so the issue re-enters the pipeline on the next review cycle.
   - Initial filter required `readyForMerge=true`, but the Run 6 validator already flips that to false — filter broadened in `9f974f43` to catch post-validator residue.
   - **Live-verified**: on dashboard restart, PAN-509's prUrl was cleared (`updatedAt: 2026-04-13T07:58:07.525Z`, `reviewStatus: pending`, `mergeNotes: "Cleared stale closed PR #527 on startup"`). 4-run cycle officially broken.

3. **`install` quality gate for panopticon-cli** (op-level config, `~/.panopticon/projects.yaml`):
   - Adds `install: bun install --frozen-lockfile` as the first gate in panopticon-cli's `quality_gates`.
   - Future work-agent `done` events will fail verification immediately if `bun.lock` drifts from `package.json`, and feedback will be sent to the agent instead of shipping a broken branch to CI.
   - Not a code commit (config lives in `~/.panopticon/`), but persistent on this machine and reproducible for others via doc note.

**Issues moved**:
- **PAN-509** → Cleaned up via `repairClosedPRs()` sweep. Re-enters pipeline with fresh review cycle. 4-run cycle broken.
- **PAN-611** → Still blocked on feature-branch CI failure (gitignored caveman sources). Check-status gate now reports the blocker clearly; work-agent must fix `.gitignore` or file layout in its branch. Not a substrate regression.
- **PAN-544** → Same — blocked on feature-branch `bun.lock` drift. Config fix ensures future workspaces catch it at verification, but this instance already escaped.

**New substrate gap surfaced**:
- **Clean-checkout verification gate**: The dirty-workspace verification hole is the structural root cause behind both PAN-611 and PAN-544. Mitigated by check-status gate, but a proper fix would run the gate on a clean git state (stash, or worktree sandbox) so local matches CI exactly. Filed in Skill Gaps (High).

**Main branch state**: Clean, up-to-date with `origin/main`. 3 substrate fix commits pushed this run (40f5fe0e, 6843dc27, 9f974f43).

**Next-run priorities** (in order):
1. Observe PAN-509 through its fresh review cycle — does it reach readyForMerge cleanly?
2. PAN-611 / PAN-544 — escalate to work-agents with explicit fix instructions for their feature-branch bugs (gitignore + lockfile). Not substrate issues anymore.
3. Design and implement clean-checkout verification gate (structural fix for local-vs-CI divergence).
4. Drive PAN-457 / PAN-540 / PAN-653 plans into implementation.
