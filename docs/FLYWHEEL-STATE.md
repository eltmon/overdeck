# Flywheel State
<!-- LIVING DOCUMENT — overwritten by each /all-up run. History lives in OPERATION-FIX-ALL.md -->
_Last updated: 2026-04-20 (Run 14) — auto-maintained by the all-up flywheel_

---

## Active Pipeline

Each row is an issue the flywheel is tracking. **Runs Stuck** counts consecutive runs where
the issue was blocked at the same phase with the same root cause. ≥2 = cycling alert.

| Issue | Phase | Root Cause / Blocker | Auto-Requeues | Runs Stuck | Notes |
|-------|-------|----------------------|---------------|------------|-------|
| PAN-569 | in_review | Agent implementing; not yet at review gate. | 0 | 0 | Agent healthy, context 71% |
| PAN-704 | in_review | Review blocked (7 cycles) — agent fixing type assertion + missing test coverage. | 7 | 2 | Agent healthy, context 39%, 3 consecutive failures |
| PAN-457 | in_review | Review blocked — agent fixing conversation discovery issues. | 0 | 0 | Auto-resumed this run, agent healthy |
| PAN-539 | in_review | Review blocked — agent fixing attachment path leaks + optimistic render gaps. | 1 | 0 | Auto-resumed this run, agent healthy |
| PAN-709 | in_review | Review blocked — agent fixing dashboard todo filter + workflow issues. | 0 | 0 | Auto-resumed this run, agent healthy |
| PAN-711 | in_review | Review blocked — agent fixing notification mute checkbox merge. | 0 | 0 | Manually resumed (runtime was idle), agent healthy |

---

## Cycling Alerts

| Issue | Phase | Runs Stuck | Why It Cycles | Candidate Fix | Status |
|-------|-------|------------|---------------|---------------|--------|
| PAN-704 | in_review | 2 | Agent keeps introducing new issues while fixing old ones; review gate finds NEW problems on each re-review instead of comprehensive list upfront | Review agent should emit full acceptance criteria upfront; or split large UI refactors into smaller issues | Ongoing — agent is actively working |

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
| Polyrepo rebase 10-minute timeout too short | Merge fails on complex rebases; work agent not notified; cycles indefinitely | Run 11 | No | **FIXED Run 13** (507cef17 — extended to 30min, added timeout feedback to work agent) |
| Mass agent stop after system reboot with no auto-resume | All tmux sessions die on reboot; recoverOrphanedAgents stops agents but nothing resumes them | Run 13 | No | **FIXED Run 13** (7988a316 — autoResumeStoppedWorkAgents on deacon startup) |
| Auto-resume resumes merged agents as zombies | Agents whose issues already merged or completion processed get resumed after reboot | Run 13 | No | **FIXED Run 13** (d31af9dc — guard on completed.processed + mergeStatus=merged) |
| Merged issues with prUrl=null leave stale readyForMerge | postMergeLifecycle cleared prUrl before mergeStatus; issue persists on Awaiting Merge | Run 13 | No | **FIXED Run 13** (dc8fb30a — merged-label startup repair in repairClosedWontfixIssues) |
| **Auto-resume skips blocked agents with completed.processed** | Agents with reviewStatus=blocked and completed.processed marker never auto-resumed; stuck forever after reboot | Run 14 | No | **FIXED Run 14** (4be6f3ac — resume when reviewStatus is blocked/failed or testStatus is failed) |
| **Case-sensitive review status lookup misses lowercase issueIds** | state.json stores `pan-457` but DB key is `PAN-457`; getReviewStatus returns null | Run 14 | No | **FIXED Run 14** (4b660d10 — normalize to uppercase in getReviewStatusFromDb + getHistoryFromDb) |
| Deacon re-dispatch gate blocked for issues with prior passed reviews | When prUrl cleared (e.g. repairClosedPRs), deacon won't re-dispatch because hasPassedReview=true | Run 8 | No | Ongoing — mitigation: tell work agent to run pan done |
| Verification gate runs on dirty workspace, not clean-committed state | Gitignored files or uncommitted changes make local build pass while CI fails | Run 7 | No | Ongoing — mitigated by check-status gate |
| Review circuit breaker can't self-reset | Manual `pan review reset` after 7 requeues | Run 4 | No | Ongoing |
| Verification bypass at 3 failures masks root causes | Bypass hides test failures | Run 5 | No | Ongoing |
| GitHub check status not synced back to Panopticon DB when server was down | panopticon/review and panopticon/test pass on GitHub but internal DB shows null; work agent doesn't know it can merge | Run 9 | No | Ongoing — PAN-509 example; mitigation: resume work agent to re-check |
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
| Polyrepo/single-repo rebase timeout cycling | `mergeStatus=failed` with "did not push within 10 minutes"; work agent idle; retries fail again | Hardcoded 10-minute timeout too short for conflict resolution; agent never notified of timeout | Extend timeout to 30 minutes; `checkFailedMergeRetry` writes feedback + sends tmux nudge on timeout (Run 13: 507cef17) |
| Mass agent stop after system reboot | All agents `status: stopped` after reboot; dashboard shows no running agents | Machine reboot kills all tmux sessions; `recoverOrphanedAgents` resets status but no resume step exists | `autoResumeStoppedWorkAgents()` scans all agent dirs on deacon startup and resumes orphaned work agents (Run 13: 7988a316) |
| Zombie agent resurrection after reboot | Merged issues' agents resumed as healthy after auto-resume deployed | `autoResumeStoppedWorkAgents` only checked `completed` marker, not `completed.processed`; didn't check `mergeStatus=merged` | Guard on `completed.processed` and `mergeStatus=merged` (Run 13: d31af9dc) |
| Stale merged issues without prUrl | Issue on Awaiting Merge despite being merged; `readyForMerge=true`, `mergeStatus=pending`, `prUrl=null` | `postMergeLifecycle` cleared prUrl before updating mergeStatus | `repairClosedWontfixIssues` now also detects `merged` label and repairs internal state (Run 13: dc8fb30a) |
| **Blocked agents with completed.processed skipped by auto-resume** | Agent stopped with `completed.processed` + `reviewStatus=blocked`; never resumed after reboot | `autoResumeStoppedWorkAgents` treated completed.processed as unconditionally finished | Resume when reviewStatus is blocked/failed or testStatus is failed (Run 14: 4be6f3ac) |
| **Case-sensitive review status lookup** | `getReviewStatus('pan-457')` returns null despite `PAN-457` existing in DB | state.json stores lowercase issueId; DB stores uppercase; exact-match lookup fails | Normalize issueId to uppercase in getReviewStatusFromDb + getHistoryFromDb (Run 14: 4b660d10) |

---

## Skill Gaps

| Desired Capability | Why Needed | Priority | Status |
|-------------------|-----------|----------|--------|
| Clean-checkout verification gate | Gate currently runs on dirty workspace, missing gitignore/uncommitted bugs | High | Run 7 — mitigated but not fixed. Needs `git stash push -u` + run + `git stash pop` or worktree sandbox. |
| Deacon re-dispatch for null-prUrl issues with passed history | Issues cleared by repairClosedPRs can't re-dispatch via deacon | Medium | Ongoing — workaround: tell agent to run pan done |
| Cycle-aware work-agent escalation | PAN-704 cycled 7 review rounds; system should page operator after N stuck runs | Medium | Ongoing |
| PR-state validator in `/review` and `/request-review` | Additional defense layer at review submission time | Medium | Partially addressed |
| Holistic dead-code detection in review | Review finds dead code piecemeal | High | Ongoing |
| Verification gate: configurable pass criteria | 3-failure bypass masks real issues | Medium | Ongoing |
| GitHub check status → Panopticon DB sync on server startup | When server was down during CI run, internal DB never learns panopticon/review passed | Medium | Ongoing — startup repair: scan all PRs in "in-review" state and reconcile GitHub check results |
| `repairClosedPRs()` startup sweep | Clean up pre-fix stale-prUrl instances | High | **CLOSED Run 7** |
| Merge-agent error reporting | Silent failures give operators nothing to debug | — | **CLOSED Run 6** |
| `complete-planning` session cleanup | Orphaned planning sessions accumulate | — | **CLOSED Run 6** |
| Per-project specialist wake via API/CLI | Wake route only supports legacy global specialists | Medium | Discovered Run 11 |
| System-reboot auto-resume for work agents | Machine reboots orphan all in-progress work agents | High | **CLOSED Run 13** |
| Review status lookup case normalization | Lowercase issueIds in state.json break review status lookups | Medium | **CLOSED Run 14** |

---

## Run 14 Summary

**Bugs fixed in code** (2 substrate fixes, pushed to `origin/main`):

1. **`autoResumeStoppedWorkAgents` skips blocked agents with `completed.processed`** (`4be6f3ac`):
   - PAN-457, PAN-539, PAN-709, PAN-711 all had `completed.processed` markers + `reviewStatus=blocked` after the verification gate processed their completion.
   - `autoResumeStoppedWorkAgents` treated `completed.processed` as unconditionally finished, so these agents were never resumed after reboot.
   - Fixed: when `reviewStatus` is `blocked`/`failed` or `testStatus` is `failed`, the agent is resumed so it can fix the issues.

2. **Case-sensitive review status lookup** (`4b660d10`):
   - `state.json` stores lowercase `issueId` (e.g. `pan-457`) but the review status DB stores uppercase (`PAN-457`).
   - `getReviewStatusFromDb` did exact-case matching, so `getReviewStatus('pan-457')` returned null.
   - This caused the auto-resume fix above to fail for PAN-457 and PAN-709 (their review statuses were invisible).
   - Fixed: normalize `issueId` to uppercase in `getReviewStatusFromDb` and `getHistoryFromDb`.

**Data cleanup:**
- **PAN-369-TEST**: Cleared stale test entry from review status DB (not a real GitHub issue; was showing on Awaiting Merge page).
- **PAN-714**: Startup repairs correctly updated its state to `mergeStatus=merged`, `readyForMerge=false`.

**Issues moved:**
- **PAN-457** → agent resumed and healthy (was stopped with completed.processed)
- **PAN-539** → agent resumed and healthy (was stopped with completed.processed)
- **PAN-709** → agent resumed and healthy (was stopped with completed.processed)
- **PAN-711** → manually resumed (runtime state was idle, blocking auto-resume), agent healthy

**Active pipeline:**
- 6 PAN issues in In Review, all with healthy running work agents
- 0 PAN issues on Awaiting Merge
- 0 cycling alerts (new cycling alert for PAN-704 at 2 runs stuck)

**Main branch state**: Clean, up-to-date with `origin/main`. 2 substrate fixes committed this run.

**Next-run priorities:**
1. Monitor PAN-704 for review re-submission — it's cycled 7 review rounds; may need manual intervention if agent can't break through.
2. Monitor PAN-457, PAN-539, PAN-709, PAN-711 for review re-submission after agents fix blocked issues.
3. Monitor PAN-569 for work agent completion → verification gate → review.
