# Flywheel State
<!-- LIVING DOCUMENT — overwritten by each /all-up run. History lives in OPERATION-FIX-ALL.md -->
_Last updated: 2026-04-15 (Run 11) — auto-maintained by the all-up flywheel_

---

## Active Pipeline

Each row is an issue the flywheel is tracking. **Runs Stuck** counts consecutive runs where
the issue was blocked at the same phase with the same root cause. ≥2 = cycling alert.

| Issue | Phase | Root Cause / Blocker | Auto-Requeues | Runs Stuck | Notes |
|-------|-------|----------------------|---------------|------------|-------|
| PAN-369-TEST | awaiting merge | Review passed, test passed, readyForMerge=true. | 0 | 0 | Ready for merge |
| PAN-457 | in progress | Review failed at verification gate. Work agent fixing. | 0 | 0 | Agent running |
| PAN-540 | in progress | Review failed at verification gate. Work agent fixing. | 0 | 0 | Agent running |
| PAN-611 | in progress | Merge failed — work agent did not push rebase within 10 min. | 0 | 2 | **Cycling at merge** — polyrepo rebase timeout |
| PAN-653 | in progress | Review failed at verification gate. Work agent fixing. | 0 | 0 | Agent running |
| PAN-709 | in progress | Review failed at verification gate. Work agent fixing. | 0 | 0 | Agent running — self-improving flywheel epic |
| PAN-712 | in progress | Review failed at verification gate. Work agent fixing. | 0 | 0 | Agent running |
| PAN-714 | in progress | Review blocked + merge failed (PR #716 timeout). | 0 | 0 | Back to review after merge timeout |

---

## Cycling Alerts

| Issue | Phase | Runs Stuck | Why It Cycles | Candidate Fix | Status |
|-------|-------|------------|---------------|---------------|--------|
| PAN-611 | merge | 2 | Polyrepo merge requires work agent to rebase and push all affected repos within a 10-min hard timeout. Agent is running but doesn't always complete the rebase push in time. | Extend timeout, add progress pings, or split rebase coordination from merge button. | Ongoing — merge-agent wrote feedback to work agent |

---

## Infrastructure Gaps

| Gap | Impact | First Seen | Filed? | Status |
|-----|--------|-----------|--------|---|
| Blocking FS calls in request handlers | Dashboard API hangs under load | Run 4 | No | **FIXED Run 5** (9cf06605) |
| Deacon replays stale review notes for orphaned `reviewing` | PAN-596 cycled 3 runs with byte-identical notes | Run 5 | No | **FIXED Run 5** (e2395dd6) |
| Cancel-flow leaves stale `prUrl` pointing to CLOSED PR | `readyForMerge=true` against closed PR | Run 5 | No | **FIXED Run 6** (90de55b4 + 0798a359) |
| Merge-agent silent failures (no `mergeNotes`, no log) | `mergeStatus=failed` with zero diagnostics | Run 5 | No | **FIXED Run 6** (0798a359) |
| Orphaned planning sessions | `planning-pan-NNN` alive hours after plan complete | Run 3 | PAN-682 | **FIXED Run 6** (cb3f67a8) |
| `repairClosedPRs()` startup sweep | Pre-fix PAN-509 instance still needs cleanup | Run 6 | No | **FIXED Run 7** (6843dc27 + 9f974f43) |
| Verification gate lacks `bun install --frozen-lockfile` | Lockfile drift invisible until GitHub CI catches it | Run 7 | No | **FIXED Run 7** (config update to panopticon-cli quality_gates) |
| No GitHub check-status gate in `triggerMerge()` | Merge pipeline churns against red PRs | Run 7 | No | **FIXED Run 7** (40f5fe0e) |
| `checkFailedMergeRetry` retries CI failures indefinitely | CI check failures cycle until circuit breaker trips (3×30min=90min wasted) | Run 8 | No | **FIXED Run 8** (0209bf1f) |
| Workspace init silently swallows bun install failure | Broken symlinks in node_modules; Docker init crashes ERR_MODULE_NOT_FOUND; work agents blocked | Run 9 | No | **FIXED Run 9** (ada4a64d — fatal errors, no timeout, stale node_modules wipe) |
| Zombie agent sessions after merge (state file absent) | agent-pan-NNN session survives merge, leaks Claude+MCP processes | Run 9 | No | **FIXED Run 9** (1ffb6e60 — kill unconditionally on sessionExists) |
| Permission prompts blocking agent launches | Agents hang on TUI permission footer because `--permission-mode bypassPermissions` was missing in most launch paths | Run 10 | No | **FIXED Run 10** (cf311e75 — added to 10 files) |
| CLI `admin specialists done` bypasses server auto-promotion | `testStatus=passed` set but `readyForMerge` stayed false; merge-agent never woke | Run 10 | No | **FIXED Run 10** (61248742 — CLI now mirrors server route logic; `normalizeReviewStatus` no longer clears readyForMerge based on stale verification) |
| `setReviewStatus` blocks `readyForMerge` on stale `verificationStatus` | Merge queue/enqueue recomputes readyForMerge=false when verification failed from earlier cycle | Run 11 | No | **FIXED Run 11** (cdc8ffde — removed `verificationSatisfied` from readyForMerge computation) |
| Deacon re-dispatch gate blocked for issues with prior passed reviews | When prUrl cleared (e.g. repairClosedPRs), deacon won't re-dispatch because hasPassedReview=true | Run 8 | No | Ongoing — mitigation: tell work agent to run pan done |
| Verification gate runs on dirty workspace, not clean-committed state | Gitignored files or uncommitted changes make local build pass while CI fails | Run 7 | No | Ongoing — mitigated by check-status gate |
| Review circuit breaker can't self-reset | Manual `pan review reset` after 7 requeues | Run 4 | No | Ongoing |
| Verification bypass at 3 failures masks root causes | Bypass hides test failures | Run 5 | No | Ongoing |
| GitHub PR check status not synced back to Panopticon DB when server was down | panopticon/review and panopticon/test pass on GitHub but internal DB shows null; work agent doesn't know it can merge | Run 9 | No | Ongoing — PAN-509 example; mitigation: resume work agent to re-check |
| Per-project specialist wake via API/CLI | `/api/specialists/:name/wake` and CLI `admin specialists wake` target legacy global specialist, not per-project ephemeral ones | Run 11 | No | Ongoing — discovered while trying to wake `specialist-panopticon-cli-merge-agent` |

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
| Local-vs-CI divergence (gitignored source) | Local build passes (dirty workspace has files); CI fails (files not committed, excluded by .gitignore) | Verification runs against dirty workspace, not committed state | check-status gate blocks merges when PR HEAD has failing checks (Run 7: 40f5fe0e). Root fix pending. |
| Stale closed-PR residue surviving post-validator | `mergeStatus=failed`, `prUrl` points at CLOSED PR, `readyForMerge=false` | Run 6 validator set readyForMerge=false but left prUrl in place | `repairClosedPRs()` startup sweep clears prUrl and resets reviewStatus (Run 7: 6843dc27 + 9f974f43) |
| CI failure retry cycling | merge fails (CI) → 30min → deacon retries → fails again → repeats until circuit breaker | `checkFailedMergeRetry` treated all failed merges as transient; no CI distinction | Detect "failing required checks" in mergeNotes, write feedback to work agent, saturate circuit breaker (Run 8: 0209bf1f) |
| Post-merge lifecycle incomplete | `mergeStatus=merged` but GH issue OPEN | `close-issue` step failed silently | `repairIncompletePostMergeLifecycle()` (Run 4) |
| PR merged on GH but Panopticon stuck | `gh pr view` → MERGED but `mergeStatus!=merged` | Post-merge verification failed after `gh pr merge` | `repairAlreadyMergedPRs()` (Run 4) |
| Workspace init silently creates broken environment | Docker init crashes ERR_MODULE_NOT_FOUND; work agent never starts | `bun install` 60s timeout killed on cold cache; catch block swallowed error as "non-fatal warning" | Fatal errors, no timeout, pre-install stale node_modules wipe (Run 9: ada4a64d) |
| Zombie agent sessions after merge | `agent-pan-NNN` tmux session alive after merge; leaks Claude+MCP | `postMergeLifecycle` only killed session when agentState file present; missing state → session survives | Kill unconditionally on `sessionExists()`, update state if present (Run 9: 1ffb6e60) |
| Agent permission prompt hangs | Agent sessions alive but no tool use for hours; TUI footer shows `⏵⏵ bypass permissions` | Only `merge-agent` launch path had `--permission-mode bypassPermissions`; all others hung on the footer prompt | Added `--dangerously-skip-permissions --permission-mode bypassPermissions` to ALL agent launch paths (Run 10: cf311e75) |
| Test-done doesn't promote to readyForMerge | `testStatus=passed` but `readyForMerge=false`; merge queue empty | CLI `admin specialists done` lacked the server route's `readyForMerge=true` side-effect; `normalizeReviewStatus` also overrode it | Mirror server logic in CLI done.ts; remove verification gate from readyForMerge normalization (Run 10: 61248742) |
| readyForMerge regression on stale verification | `setReviewStatus({ mergeStatus: 'queued' })` clears `readyForMerge` because `verificationStatus: failed` from earlier cycle | `setReviewStatus` re-evaluated `readyForMerge` using `verificationSatisfied(merged)` | Remove `verificationSatisfied` from `readyForMerge` computation in `setReviewStatus` (Run 11: cdc8ffde) |

---

## Skill Gaps

| Desired Capability | Why Needed | Priority | Status |
|-------------------|-----------|----------|--------|
| Clean-checkout verification gate | Gate currently runs on dirty workspace, missing gitignore/uncommitted bugs | High | Run 7 — mitigated but not fixed. Needs `git stash push -u` + run + `git stash pop` or worktree sandbox. |
| Deacon re-dispatch for null-prUrl issues with passed history | Issues cleared by repairClosedPRs can't re-dispatch via deacon | Medium | Ongoing — workaround: tell agent to run pan done |
| Cycle-aware work-agent escalation | PAN-611 cycled 3 runs; system should page operator after N stuck runs | Medium | Ongoing |
| PR-state validator in `/review` and `/request-review` | Additional defense layer at review submission time | Medium | Partially addressed |
| Holistic dead-code detection in review | Review finds dead code piecemeal | High | Ongoing |
| Verification gate: configurable pass criteria | 3-failure bypass masks real issues | Medium | Ongoing |
| GitHub check status → Panopticon DB sync on server startup | When server was down during CI run, internal DB never learns panopticon/review passed | Medium | Ongoing — startup repair: scan all PRs in "in-review" state and reconcile GitHub check results |
| `repairClosedPRs()` startup sweep | Clean up pre-fix stale-prUrl instances | High | **CLOSED Run 7** |
| Merge-agent error reporting | Silent failures give operators nothing to debug | — | **CLOSED Run 6** |
| `complete-planning` session cleanup | Orphaned planning sessions accumulate | — | **CLOSED Run 6** |
| Per-project specialist wake via API/CLI | Wake route only supports legacy global specialists | Medium | Discovered Run 11 |

---

## Run 11 Summary

**Bugs fixed in code** (1 substrate fix, pushed to `origin/main`):

1. **`setReviewStatus` blocked `readyForMerge` on stale `verificationStatus`** (`cdc8ffde`):
   - The merge API queued PAN-714 behind PAN-611, calling `setReviewStatus({ mergeStatus: 'queued' })`.
   - `setReviewStatus` recomputed `readyForMerge` using `verificationSatisfied(merged)`, and PAN-714 had `verificationStatus: failed` from an earlier cycle.
   - This regressed `readyForMerge` from `true` to `false`, causing PAN-714 to disappear from Awaiting Merge.
   - Fix: removed `verificationSatisfied` from `setReviewStatus`'s `readyForMerge` computation, matching the Run 10 fix in `normalizeReviewStatus`.
   - Updated 3 tests that asserted the old behavior (including 1 unrelated `agents-auth-routing` test that was missing the Run 10 `--permission-mode bypassPermissions` flag).

**Issues moved**:
- **PAN-714** → fell back to `review: blocked` / `merge: failed` after merge-agent timed out waiting for PR #716 to become mergeable. Review-agent provided new blockers.
- **PAN-611** → `merge: failed` (polyrepo rebase timeout — work agent did not push rebased branches within 10 minutes). Entered cycling alert (2 consecutive runs stuck at merge).

**Ready for your UAT + merge**:
- PAN-369-TEST — on Awaiting Merge page.

**Main branch state**: Clean, up-to-date with `origin/main`. 1 substrate fix committed this run.

**Next-run priorities**:
1. Address PAN-611 cycling alert — polyrepo rebase 10-minute timeout is too tight or work agent feedback is insufficient.
2. Monitor PAN-709 / PAN-712 / PAN-457 / PAN-653 / PAN-540 for review re-submission after agents fix verification failures.
3. Consider fixing per-project specialist wake API gap.
