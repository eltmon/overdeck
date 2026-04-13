# Flywheel State
<!-- LIVING DOCUMENT — overwritten by each /all-up run. History lives in OPERATION-FIX-ALL.md -->
_Last updated: 2026-04-13 (Run 8) — auto-maintained by the all-up flywheel_

---

## Active Pipeline

Each row is an issue the flywheel is tracking. **Runs Stuck** counts consecutive runs where
the issue was blocked at the same phase with the same root cause. ≥2 = cycling alert.

| Issue | Phase | Root Cause / Blocker | Auto-Requeues | Runs Stuck | Notes |
|-------|-------|----------------------|---------------|------------|-------|
| PAN-544 | merge blocked by CI | `bun install --frozen-lockfile` fails on CI: local bun 1.3.11 vs CI bun 1.3.12 lockfile mismatch. Feedback written (005-merge-agent-ci-failure.md) + tmux tell sent. New deacon fix will intercept next merge failure and route to work agent instead of retrying. | 0 | 2 | Work agent needs to upgrade bun to 1.3.12 + regenerate bun.lock |
| PAN-611 | feedback sent — awaiting agent fix | `.gitignore:42` (`src/lib/**/*.js`) excludes caveman JS source files. CI's `cp` step fails on clean checkout. Feedback written (014-merge-agent-ci-failure-details.md) + tmux tell sent. Merge retry cycle broken by Run 8 fix. | 0 | 0 | Work agent must add `!src/lib/caveman/*.js` negation to .gitignore |
| PAN-509 | pending review — awaiting dispatch | prUrl cleared by repairClosedPRs (Run 7). reviewStatus=pending but deacon re-dispatch gate blocks because `hasPassedReview=true`. Work agent told to run `pan work done PAN-509`. | 0 | 1 | Work agent needs to call pan work done to create fresh PR |
| PAN-457 | in progress | Just started — work agent launched 2026-04-13 | 0 | 0 | Planning complete, work agent started |
| PAN-540 | planning | Active planning session (planning-pan-540 attached) | 0 | 0 | Planning still in progress |
| PAN-653 | in progress | Just started — work agent launched 2026-04-13 | 0 | 0 | Planning complete, work agent started |

---

## Cycling Alerts

### [RESOLVED Run 8] PAN-611 — CI cycling merge retry loop
- **Pattern Run 5-7**: merge cycling due to check-status gate + deacon retry loop
- **Root cause confirmed Run 8**: `checkFailedMergeRetry()` in deacon.ts was retrying ALL failed merges (up to 3×, 30min apart) including CI check failures. Cycle: gate sets mergeStatus=failed → 30min cooldown → deacon resets to pending → merge re-queued → gate blocks again.
- **Fix (0209bf1f)**: `checkFailedMergeRetry` now detects `mergeNotes` containing "failing required checks", writes feedback file, saturates mergeRetryCount instead of retrying. `review-status.ts` adds `mergeStatus !== 'failed'` to rfm auto-computation as defense-in-depth.
- **Runs Stuck**: 0 (cycle broken). Work agent must still fix the gitignore issue.

### PAN-544 — Bun lockfile mismatch CI failure (2 runs — work agent has feedback)
- **Pattern Run 7**: `bun install --frozen-lockfile` gate added but passes locally (bun 1.3.11 → "no changes"). CI uses bun 1.3.12 which considers the lockfile stale.
- **Pattern Run 8**: same blocker. Merge will fail again → new deacon code will catch it and route to work agent. Feedback already written.
- **Substrate status**: **Contained.** New `checkFailedMergeRetry` CI detection will prevent further merge cycling after the next failure. Work agent must fix.
- **Runs Stuck**: 2

### PAN-509 — Post-repair review re-dispatch blocked (1 run — agent has feedback)
- **Pattern**: `repairClosedPRs` cleared prUrl and set reviewStatus=pending. But deacon re-dispatch gate checks `!hasPassedReview` which is false (history has passed entries) AND `status.prUrl` which is null. Re-dispatch blocked.
- **Workaround**: work agent told to run `pan work done` to create fresh PR. This bypasses the deacon re-dispatch gate.
- **Potential substrate fix**: deacon re-dispatch should handle the case where prUrl is null AND the issue has passed reviews before — it should be eligible for re-dispatch.
- **Runs Stuck**: 1

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
| `checkFailedMergeRetry` retries CI failures indefinitely | CI check failures cycle until circuit breaker trips (3×30min=90min wasted) | Run 8 | No | **FIXED Run 8** (0209bf1f — detect "failing required checks" in mergeNotes, write feedback, saturate circuit breaker) |
| Deacon re-dispatch gate blocked for issues with prior passed reviews | When prUrl cleared (e.g. repairClosedPRs), deacon won't re-dispatch because hasPassedReview=true | Run 8 | No | **NEW** — mitigation: tell work agent to run pan work done. Proper fix: deacon should re-dispatch when prUrl is null regardless of history. |
| Verification gate runs on dirty workspace, not clean-committed state | Gitignored files or uncommitted changes make local build pass while CI fails | Run 7 | No | Ongoing — mitigated by check-status gate |
| Review circuit breaker can't self-reset | Manual `pan work reset-review` after 7 requeues | Run 4 | No | Ongoing |
| Verification bypass at 3 failures masks root causes | Bypass hides test failures | Run 5 | No | Ongoing |

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

---

## Skill Gaps

| Desired Capability | Why Needed | Priority | Status |
|-------------------|-----------|----------|--------|
| Clean-checkout verification gate | Gate currently runs on dirty workspace, missing gitignore/uncommitted bugs | High | Run 7 — mitigated but not fixed. Needs `git stash push -u` + run + `git stash pop` or worktree sandbox. |
| Deacon re-dispatch for null-prUrl issues with passed history | Issues cleared by repairClosedPRs can't re-dispatch via deacon | Medium | **NEW Run 8** — workaround: tell agent to run pan work done |
| Cycle-aware work-agent escalation | PAN-611 cycled 3 runs; system should page operator after N stuck runs | Medium | Ongoing |
| PR-state validator in `/review` and `/request-review` | Additional defense layer at review submission time | Medium | Partially addressed |
| Holistic dead-code detection in review | Review finds dead code piecemeal | High | Ongoing |
| Verification gate: configurable pass criteria | 3-failure bypass masks real issues | Medium | Ongoing |
| `repairClosedPRs()` startup sweep | Clean up pre-fix stale-prUrl instances | High | **CLOSED Run 7** |
| Merge-agent error reporting | Silent failures give operators nothing to debug | — | **CLOSED Run 6** |
| `complete-planning` session cleanup | Orphaned planning sessions accumulate | — | **CLOSED Run 6** |

---

## Run 8 Summary

**Bugs fixed in code** (1 substrate fix, pushed to `origin/main`):

1. **Break CI-failure cycling merge retry loop** (`0209bf1f`):
   - `checkFailedMergeRetry()` was retrying ALL failed merges (up to 3×, 30min apart) including CI check failures.
   - Cycle confirmed: merge failure at 07:43, reset to pending at 08:13 — exact 30min `FAILED_MERGE_RETRY_COOLDOWN_MS` match.
   - Fix: detect `mergeNotes` containing "failing required checks"; write feedback file to workspace + tmux nudge; saturate `mergeRetryCount` to suppress future re-entry.
   - `checkPostReviewCommits` now resets `mergeRetryCount=0` when HEAD advances, so the counter clears after work agent pushes a fix.
   - Secondary: orphaned-review restore won't reset CI-failed `mergeStatus='failed'→'pending'`.
   - Defense-in-depth: `review-status.ts` rfm auto-computation now blocks on `mergeStatus !== 'failed'`.
   - **Live-observed**: on startup, deacon immediately caught PAN-611 CI failure and wrote `013-merge-agent-ci-failure.md` feedback file.

**Issues moved**:
- **PAN-457** → Planning complete → work agent started (2026-04-13)
- **PAN-653** → Planning complete → work agent started (2026-04-13)
- **PAN-611** → Cycling loop broken. Feedback written explaining gitignore fix needed. Work agent notified.
- **PAN-544** → Feedback written (bun 1.3.12 lockfile fix). Work agent notified. Merge cycling will stop after next failed attempt.
- **PAN-509** → Work agent told to run `pan work done` to create fresh PR (deacon re-dispatch blocked by hasPassedReview gate).

**Awaiting Merge (PAN scope)**: None currently ready (PAN-544 rfm=True but will fail CI; PAN-369-TEST is test artifact).

**Main branch state**: Clean, up-to-date with `origin/main`. 1 substrate fix commit pushed this run (0209bf1f).

**Next-run priorities**:
1. Verify PAN-611/PAN-544 work agents pushed CI fixes → watch merge pipeline complete.
2. Verify PAN-509 work agent ran `pan work done` and is in review pipeline.
3. PAN-457/PAN-653 work agents progressing through implementation.
4. Consider fixing deacon re-dispatch gate for null-prUrl issues with passed history (medium priority).
5. Design clean-checkout verification gate (structural fix for local-vs-CI divergence).
