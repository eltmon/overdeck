# Flywheel State
<!-- LIVING DOCUMENT — overwritten by each /all-up run. History lives in OPERATION-FIX-ALL.md -->
_Last updated: 2026-05-07 (Run 15) — auto-maintained by the all-up flywheel_

---

## Active Pipeline

Each row is an issue the flywheel is tracking. **Runs Stuck** counts consecutive runs where
the issue was blocked at the same phase with the same root cause. ≥2 = cycling alert.

| Issue | Phase | Root Cause / Blocker | Auto-Requeues | Runs Stuck | Notes |
|-------|-------|----------------------|---------------|------------|-------|
| PAN-1024 | in_progress | Agent implementing — substrate fix to remove `turnDiffSummariesByAgentId` from snapshot, add eviction. | 0 | 0 | gpt-5.4, healthy |
| PAN-1025 | in_review | Work agent done; review-coordinator just spawned (PR #1026). | 0 | 0 | kimi-k2.6, awaiting review verdict |
| PAN-977 | in_progress | Agent implementing DAG-driven swarm dispatch. | 0 | 0 | claude-opus-4-7 (1M ctx), 6% ctx, $2.51 spent |
| PAN-987 | in_review | Review pipeline running — review-coordinator alive (PR #1023). | 0 | 0 | gpt-5.4, healthy |
| PAN-457 | in_review | **Stale mergeStatus=merged in DB** (PR #717 closed without merging). Agent doing review-response despite DB drift. | 0 | 1 (carried from Run 14) | gpt-5.4, ctx 36%, $2.86 — see PAN-1027 |
| PAN-945 | in_progress | **Agent freshly resumed this run** (was stopped). Working on planning artifact path mismatch (`pan plan` writes to `api/docs/prds/planned/` vs runtime reads from `<workspace>/.planning/`). | 0 | 0 | gpt-5.4, just resumed |
| PAN-934 | in_progress | **Agent freshly resumed this run** (was stopped). Working on CLIProxy auto-install on startup + macOS `/proc/meminfo` ENOENT + title generation failure. | 0 | 0 | kimi-k2.6, just resumed |
| PAN-1015 | planning | Opus drafting vBRIEF for full claudish removal in favor of CLIProxy for all providers. | — | 0 | claude-sonnet-4-6 (per config.planning-agent), planning session active |

---

## Cycling Alerts

| Issue | Phase | Runs Stuck | Why It Cycles | Candidate Fix | Status |
|-------|-------|------------|---------------|---------------|--------|
| PAN-457 | in_review | 1 (new) | mergeStatus=merged but PR was closed without merge; agent re-doing work that was previously merged. | Reset mergeStatus when GH PR state diverges (PAN-1027) | New alert — first run noticing the drift |

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
| Workspace init silently swallows bun install failure | Broken symlinks in node_modules; Docker init crashes ERR_MODULE_NOT_FOUND; work agents blocked | Run 9 | No | **FIXED Run 9** (ada4a64d) |
| Zombie agent sessions after merge (state file absent) | agent-pan-NNN session survives merge, leaks Claude+MCP processes | Run 9 | No | **FIXED Run 9** (1ffb6e60) |
| Permission prompts blocking agent launches | Agents hang on TUI permission footer because `--permission-mode bypassPermissions` was missing in most launch paths | Run 10 | No | **FIXED Run 10** (cf311e75) |
| CLI `admin specialists done` bypasses server auto-promotion | `testStatus=passed` set but `readyForMerge` stayed false; merge-agent never woke | Run 10 | No | **FIXED Run 10** (61248742) |
| `setReviewStatus` blocks `readyForMerge` on stale `verificationStatus` | Merge queue/enqueue recomputes readyForMerge=false when verification failed from earlier cycle | Run 11 | No | **FIXED Run 11** (cdc8ffde) |
| Polyrepo rebase 10-minute timeout too short | Merge fails on complex rebases; work agent not notified; cycles indefinitely | Run 11 | No | **FIXED Run 13** (507cef17) |
| Mass agent stop after system reboot with no auto-resume | All tmux sessions die on reboot; recoverOrphanedAgents stops agents but nothing resumes them | Run 13 | No | **FIXED Run 13** (7988a316) |
| Auto-resume resumes merged agents as zombies | Agents whose issues already merged or completion processed get resumed after reboot | Run 13 | No | **FIXED Run 13** (d31af9dc) |
| Merged issues with prUrl=null leave stale readyForMerge | postMergeLifecycle cleared prUrl before mergeStatus; issue persists on Awaiting Merge | Run 13 | No | **FIXED Run 13** (dc8fb30a) |
| Auto-resume skips blocked agents with completed.processed | Agents with reviewStatus=blocked and completed.processed marker never auto-resumed; stuck forever after reboot | Run 14 | No | **FIXED Run 14** (4be6f3ac) |
| Case-sensitive review status lookup misses lowercase issueIds | state.json stores `pan-457` but DB key is `PAN-457`; getReviewStatus returns null | Run 14 | No | **FIXED Run 14** (4b660d10 — getReviewStatusFromDb + getHistoryFromDb) |
| **Case-sensitive vbrief continue-file paths** | Same disease as Run 14, broader scope: `continueFilename(issueId)` did not normalize, producing duplicate `continue-PAN-NNN.vbrief.json` and `continue-pan-NNN.vbrief.json` files. Recurring dirt on `main` after every flywheel run; lookups silently miss work committed under the other case. | Run 15 | No | **FIXED Run 15** (c448ec02a — uppercase in continueFilename + writeContinueState's stored issueId) |
| **Merge-status drift: deacon auto-detect paths skip postMergeLifecycle** | Three sites in deacon.ts set mergeStatus='merged' without running label cleanup, tmux kill, or beads compaction. Inverse: when an already-detected merged PR is closed/reverted, no path resets mergeStatus. Currently 4 issues with stale `in-review`/`in-progress` labels (PAN-986, PAN-971, PAN-1014, PAN-920) and 1 issue (PAN-457) actively running an agent against a "merged" DB record. | Run 15 | **PAN-1027** | Filed Run 15 — fix scheduled for Run 16 (touches deacon repair paths) |
| Snapshot `turnDiffSummariesByAgentId` ballooned WS payload to 484 MB | Per-turn checkpoint diffs accumulated for 44 agents × ~6,000 turns × ~25 files. Browser ws library rejected with "Max payload size exceeded" → 1006 close → kanban + command deck never bootstrapped. | Run 15 | **PAN-1024** (long-term fix; immediate hotfix in `a0a8829ea` ships `{}`) | Hotfix shipped Run 15 (a0a8829ea); long-term fix in flight (PAN-1024 active agent) |
| Sync FS reads in `getSnapshot` hot path (`computePlanningState`) | 870 issues × `readFileSync` of `plan.vbrief.json` per snapshot → 50 ms first call, geometric blowup to 54 s by the third. WS bootstrap timed out before snapshot returned. | Run 15 | No | **FIXED Run 15** (a0a8829ea — mtime cache) |
| `claudish -i ... "$prompt"` ignores positional prompt | Specialists routed through claudish (kimi/minimax/glm/etc.) sit at REPL animation forever, never receive task prompt. `script -qfaec` captures redraw codes at ~10 MB/min. Today's incident: 27 GB of garbage logs across 6 orphaned `script` processes that survived `tmux kill-session`. | Run 15 | **#1015** (claudish removal) — `planning-pan-1015` now drafting vBRIEF | Cleanup performed (27 GB freed); long-term fix is the broader claudish removal already in planning |
| Snapshot localStorage cache strips `issues` at 2 MB | Page reload paints kanban with 0 issues until WS bootstrap completes. Cap was set when snapshots could be hundreds of MB; now snapshots are ~3 MB and cap unnecessarily defeats instant-render. | Run 15 | **PAN-1025** | Active agent (post-review) |
| Deacon re-dispatch gate blocked for issues with prior passed reviews | When prUrl cleared (e.g. repairClosedPRs), deacon won't re-dispatch because hasPassedReview=true | Run 8 | No | Ongoing — mitigation: tell work agent to run pan done |
| Verification gate runs on dirty workspace, not clean-committed state | Gitignored files or uncommitted changes make local build pass while CI fails | Run 7 | No | Ongoing — mitigated by check-status gate |
| Review circuit breaker can't self-reset | Manual `pan review reset` after 7 requeues | Run 4 | No | Ongoing |
| Verification bypass at 3 failures masks root causes | Bypass hides test failures | Run 5 | No | Ongoing |
| GitHub check status not synced back to Panopticon DB when server was down | panopticon/review and panopticon/test pass on GitHub but internal DB shows null; work agent doesn't know it can merge | Run 9 | No | Ongoing |
| Per-project specialist wake via API/CLI | Wake route only supports legacy global specialists | Run 11 | No | Ongoing |

---

## Pattern Ledger

| Pattern | Signature | Root Cause | Fix Applied |
|---------|-----------|------------|-------------|
| Blocking FS in request handlers | API hangs, curl timeouts | `readFileSync`/`execSync` in routes/services | Cache config at startup, async FS (Run 5: 9cf06605) |
| Review cycling with byte-identical failure notes | N runs of `review=failed` with SAME notes; no feedback files | `deacon.ts` `checkOrphanedReviewStatuses` replayed latest terminal history verbatim | Only restore `passed` terminals (Run 5: e2395dd6) |
| Cancel-flow stale prUrl | `readyForMerge=true` against CLOSED PR | `/cancel` closes PR but doesn't null `prUrl`; re-review reuses stale handle | Null `prUrl` in `closeIssuePullRequest` + pre-merge PR-state validator (Run 6: 90de55b4 + 0798a359) |
| Silent merge-agent failures | `mergeStatus=failed`, `mergeNotes=null`, no log | Catch blocks swallowed errors without logging or persisting | `console.error` + `setReviewStatus({mergeNotes})` at every catch site (Run 6: 0798a359) |
| Orphaned planning sessions | `planning-pan-NNN` alive after `complete-planning` | `complete-planning.ts` sometimes skips session kill | Deacon patrol cleanup: kill `planning-pan-X` when `agent-pan-X` exists (Run 6: cb3f67a8) |
| Local-vs-CI divergence (lockfile) | Local build passes; CI install fails with `lockfile is frozen` | Verification gate uses non-frozen `bun install`; CI uses `--frozen-lockfile` | Add `install: bun install --frozen-lockfile` as first quality gate (Run 7) |
| Local-vs-CI divergence (gitignored source) | Local build passes (dirty workspace has files); CI fails | Verification runs against dirty workspace, not committed state | check-status gate (Run 7: 40f5fe0e). Root fix pending. |
| Stale closed-PR residue surviving post-validator | `mergeStatus=failed`, `prUrl` points at CLOSED PR | Run 6 validator set readyForMerge=false but left prUrl in place | `repairClosedPRs()` startup sweep (Run 7: 6843dc27 + 9f974f43) |
| CI failure retry cycling | merge fails (CI) → 30min → deacon retries → fails again → repeats | `checkFailedMergeRetry` treated all failed merges as transient | Detect "failing required checks" in mergeNotes; saturate circuit breaker (Run 8: 0209bf1f) |
| Post-merge lifecycle incomplete | `mergeStatus=merged` but GH issue OPEN | `close-issue` step failed silently | `repairIncompletePostMergeLifecycle()` (Run 4) |
| PR merged on GH but Panopticon stuck | `gh pr view` → MERGED but `mergeStatus!=merged` | Post-merge verification failed after `gh pr merge` | `repairAlreadyMergedPRs()` (Run 4) |
| Workspace init silently creates broken environment | Docker init crashes ERR_MODULE_NOT_FOUND; work agent never starts | `bun install` 60s timeout killed on cold cache | Fatal errors, no timeout, pre-install stale node_modules wipe (Run 9: ada4a64d) |
| Zombie agent sessions after merge | `agent-pan-NNN` tmux session alive after merge | `postMergeLifecycle` only killed session when agentState file present | Kill unconditionally on `sessionExists()` (Run 9: 1ffb6e60) |
| Agent permission prompt hangs | Agent sessions alive but no tool use; TUI footer shows `⏵⏵ bypass permissions` | Only `merge-agent` launch path had `--permission-mode bypassPermissions` | Added to ALL agent launch paths (Run 10: cf311e75) |
| Test-done doesn't promote to readyForMerge | `testStatus=passed` but `readyForMerge=false` | CLI `admin specialists done` lacked the server route's side-effect | Mirror server logic in CLI; remove verification gate from readyForMerge normalization (Run 10: 61248742) |
| readyForMerge regression on stale verification | `setReviewStatus({ mergeStatus: 'queued' })` clears `readyForMerge` | `setReviewStatus` re-evaluated using `verificationSatisfied(merged)` | Remove `verificationSatisfied` from `readyForMerge` computation (Run 11: cdc8ffde) |
| Polyrepo/single-repo rebase timeout cycling | `mergeStatus=failed` "did not push within 10 minutes" | Hardcoded 10-minute timeout; agent never notified | Extend to 30 min; feedback + tmux nudge on timeout (Run 13: 507cef17) |
| Mass agent stop after system reboot | All agents `status: stopped` after reboot | Reboot kills tmux; `recoverOrphanedAgents` resets status but no resume step | `autoResumeStoppedWorkAgents()` on deacon startup (Run 13: 7988a316) |
| Zombie agent resurrection after reboot | Merged issues' agents resumed as healthy | Only checked `completed` marker, not `completed.processed` or `mergeStatus` | Guard on both (Run 13: d31af9dc) |
| Stale merged issues without prUrl | Issue on Awaiting Merge despite being merged | `postMergeLifecycle` cleared prUrl before mergeStatus | `repairClosedWontfixIssues` detects `merged` label (Run 13: dc8fb30a) |
| Blocked agents with completed.processed skipped by auto-resume | Agent stopped with `completed.processed` + `reviewStatus=blocked` never resumed | Auto-resume treated completed.processed as unconditionally finished | Resume when reviewStatus is blocked/failed or testStatus is failed (Run 14: 4be6f3ac) |
| Case-sensitive review status lookup | `getReviewStatus('pan-457')` returns null despite `PAN-457` existing | state.json stores lowercase; DB stores uppercase; exact-match lookup fails | Normalize to uppercase in getReviewStatusFromDb + getHistoryFromDb (Run 14: 4b660d10) |
| **Case-sensitive vbrief continue-file paths** | Two files for same issue: `continue-PAN-N.vbrief.json` (4336 bytes, real state) and `continue-pan-N.vbrief.json` (415 bytes, partial fork) sitting next to each other; `main` accumulates dirt every flywheel run | `continueFilename(issueId)` did not normalize case; same disease as Run 14 fix but broader scope | Uppercase in `continueFilename` + `writeContinueState` stored issueId (Run 15: c448ec02a) |
| **Snapshot bloat to 484 MB via `turnDiffSummariesByAgentId`** | WS bootstrap fails with "Max payload size exceeded" → 1006 close → kanban + command deck stuck on skeleton loaders | `state.turnDiffSummariesByAgentId` accumulates per-turn checkpoint diffs unboundedly; PAN-1012 unblocked the reconciliation that previously never finished, so the map filled and got shipped | Hotfix: send `{}` over WS, keep state in memory for `/api/agents/:id/diffs` (Run 15: a0a8829ea). Long-term in PAN-1024. |
| **Sync FS reads in getSnapshot hot path** | getSnapshot resolves in 50 ms first call, 17 s, 36 s, 54 s on subsequent — geometric blowup; WS times out | `computePlanningState` reads + parses `plan.vbrief.json` per issue × 870 issues per snapshot | mtime-cached `computePlanningState` (Run 15: a0a8829ea) |
| **Orphaned `script` processes outliving tmux** | 27 GB of ANSI-redraw garbage logs from 6 specialist tmux sessions whose `script -qfaec` processes were reparented to systemd-user/tmux server when the tmux session was force-killed; agents stuck at `claudish -i` REPL emitting ~10 MB/min of redraw codes | `claudish -i` ignores positional prompt arg; tmux session kill doesn't reach the script process tree | Cleanup performed Run 15; long-term fix tracked in #1015 (full claudish removal) |
| **Merge-status drift forward direction** | After deacon auto-detect-merged: stale `in-review` / `in-progress` labels on GitHub, leaked tmux sessions, beads not compacted | Three deacon repair paths set `mergeStatus='merged'` without invoking `postMergeLifecycle()` cleanup substeps | Filed PAN-1027; fix scheduled Run 16 |
| **Merge-status drift reverse direction** | `mergeStatus='merged'` persists after PR is reverted/closed-without-merge; deacon dispatch gates skip the issue forever | No path resets mergeStatus when GitHub PR state diverges from internal record | Filed PAN-1027 (covers both directions) |

---

## Skill Gaps

| Desired Capability | Why Needed | Priority | Status |
|-------------------|-----------|----------|--------|
| Clean-checkout verification gate | Gate currently runs on dirty workspace, missing gitignore/uncommitted bugs | High | Run 7 — mitigated but not fixed |
| Deacon re-dispatch for null-prUrl issues with passed history | Issues cleared by repairClosedPRs can't re-dispatch via deacon | Medium | Ongoing |
| Cycle-aware work-agent escalation | PAN-704 cycled 7 review rounds; system should page operator after N stuck runs | Medium | Ongoing |
| Holistic dead-code detection in review | Review finds dead code piecemeal | High | Ongoing |
| Verification gate: configurable pass criteria | 3-failure bypass masks real issues | Medium | Ongoing |
| GitHub check status → Panopticon DB sync on server startup | When server was down during CI run, internal DB never learns panopticon/review passed | Medium | Ongoing |
| Per-project specialist wake via API/CLI | Wake route only supports legacy global specialists | Medium | Discovered Run 11 |
| **Merge-status reconciliation with GitHub PR state** | Inverse drift: `mergeStatus=merged` persists after PR is closed-without-merge | High | **OPENED Run 15 — PAN-1027** |
| **Consolidated post-merge cleanup helper** | Three deacon repair paths duplicate-or-skip postMergeLifecycle steps | High | **OPENED Run 15 — PAN-1027** |
| `repairClosedPRs()` startup sweep | Clean up pre-fix stale-prUrl instances | High | **CLOSED Run 7** |
| Merge-agent error reporting | Silent failures give operators nothing to debug | — | **CLOSED Run 6** |
| `complete-planning` session cleanup | Orphaned planning sessions accumulate | — | **CLOSED Run 6** |
| System-reboot auto-resume for work agents | Machine reboots orphan all in-progress work agents | High | **CLOSED Run 13** |
| Review status lookup case normalization | Lowercase issueIds in state.json break review status lookups | Medium | **CLOSED Run 14** |
| Vbrief continue-file path case normalization | Lowercase issueIds produce duplicate continue files | Medium | **CLOSED Run 15** |

---

## Run 15 Summary

**Bugs fixed in code** (1 substrate fix this run, plus 3 from earlier today's incident response):

1. **Case-sensitive vbrief continue-file paths** (`c448ec02a`):
   - `continueFilename(issueId)` and `writeContinueState` now normalize issueId to uppercase.
   - Cleaned up 4 orphan lowercase continue files (already had uppercase canonical), renamed 2 lowercase orphans (PAN-934, PAN-945) to canonical uppercase so resumed agents' state survives.
   - This is the broader-scope sibling of Run 14's `4b660d10` (which fixed only `getReviewStatusFromDb`).

Earlier today (commit `a0a8829ea`, before this `/all-up` invocation):
2. **484 MB WS snapshot stripped** (root cause of kanban not loading): `turnDiffSummariesByAgentId` removed from snapshot; data still served via `/api/agents/:id/diffs`. Long-term fix in PAN-1024 (active agent).
3. **Geometric `getSnapshot` slowdown fixed**: `computePlanningState` mtime-cached.
4. **`[httpHandler] Unhandled error: null` log spam silenced**: skip interrupt-only causes.

**Bugs filed for next run**:
- **PAN-1027** — Merge-status drift bidirectional (forward: deacon auto-detect-merged paths skip postMergeLifecycle; reverse: no path resets mergeStatus when PR reverted). Affects 5 issues today (PAN-986, 971, 1014, 920 with stale labels; PAN-457 actively running agent against "merged" DB record).
- **PAN-1024** — Lazy-load per-turn diff summaries (long-term followup to today's hotfix).
- **PAN-1025** — Snapshot localStorage cache 2 MB cap relax.
- **PAN-1015** — Existing issue, currently in planning phase. Full claudish removal in favor of CLIProxy.

**Operational cleanup**:
- Killed 6 orphaned `script` processes from stuck specialist tmux sessions.
- Deleted 27 GB of ANSI-redraw garbage from `~/.panopticon/specialists/*/runs/*.log`.
- Resumed 2 stranded work agents (PAN-934, PAN-945).

**Active pipeline**:
- 7 PAN issues in flight, all with healthy running agents.
- 1 issue in planning (PAN-1015 / claudish removal).
- 0 PAN issues currently on Awaiting Merge (5 false-positives waiting on PAN-1027 fix).

**Main branch state**: Clean and pushed (`c448ec02a`).

**Next-run priorities**:
1. PAN-1027 — fix merge-status drift in deacon repair paths AND add reverse-direction reconciliation. Will clear the 5 stale-label issues and unblock PAN-457's DB record.
2. Monitor PAN-1024, PAN-1025 implementations through review.
3. After PAN-1015 planning completes, spawn implementation agent for full claudish removal.
4. Track PAN-457 — if its agent finishes review-response and tries to re-merge, the stale mergeStatus=merged may block deacon dispatch. Reset DB record manually if it stalls.
