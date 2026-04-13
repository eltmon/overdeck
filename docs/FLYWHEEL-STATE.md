# Flywheel State
<!-- LIVING DOCUMENT — overwritten by each /all-up run. History lives in OPERATION-FIX-ALL.md -->
_Last updated: 2026-04-13 (Run 5 — extended session) — auto-maintained by the all-up flywheel_

---

## Active Pipeline

Each row is an issue the flywheel is tracking. **Runs Stuck** counts consecutive runs where
the issue was blocked at the same phase with the same root cause. ≥2 = cycling alert.

| Issue | Phase | Root Cause / Blocker | Auto-Requeues | Runs Stuck | Notes |
|-------|-------|----------------------|---------------|------------|-------|
| PAN-596 | review passed, test failed | Real test regressions: unresolved merge-conflict markers in `ConversationList.tsx`; unimplemented v16→v17 schema migration (favorites table) | 0 | 0 | **Cycling RESOLVED** — deacon replay fix (e2395dd6) let a real review run. Review PASSED. Test agent then found genuine regressions — back to work-agent. PR #664 OPEN. |
| PAN-611 | merge failed (silent) | `merge-agent` logged `Merging github review artifact for PAN-611...` and then `Dequeuing next merge` with no error output. Post-rebase verify passed, commit statuses reported, then artifact step threw silently. | 0 | 1 | PR #684 OPEN, mergeStatus=failed. Silent-failure path in `mergeGithubReviewArtifact` swallows the error. **Substrate bug**: merge-agent error reporting. |
| PAN-509 | merge queued against CLOSED PR | Cancel-flow state divergence — PR #527 was closed on GitHub but Panopticon state has `readyForMerge=true`, `mergeStatus=merging`, `prUrl=#527`. Merge-agent will fail when it tries to merge a closed PR. | 2 | 3 | Runs Stuck=3. **Substrate bug**: no `prUrl` open-PR validator in `/review`/`/request-review`; no `repairClosedPRs()` startup repair. |
| PAN-457 | planning | — (in progress) | 0 | 0 | Planning agent active |
| PAN-540 | planning-complete | — (awaiting implementation start) | 0 | 0 | Plan ready for work agent |
| PAN-653 | planning | — (in progress) | 0 | 0 | Planning agent active |
| PAN-544 | merged | — (done) | — | — | Shipped Run 5 ✓ |
| PAN-645 | merged | — (done) | — | — | Shipped Run 4 ✓ |

---

## Cycling Alerts

### PAN-509 — Cancel-flow state divergence (3 runs, escalating)
- **Pattern**: Issue shipped review→test→verification all green, queued for merge, BUT `prUrl` points to a PR closed on GitHub (cancel-flow was invoked at some point). Merge-agent will attempt `gh pr merge` against a closed PR and fail.
- **Root cause**: `POST /api/issues/:id/cancel` (`issues.ts:1174`) calls `closeIssuePullRequest()` which runs `gh pr close ${prNumber} --comment "Canceled via Panopticon"`, then calls `clearReviewStatus()`. If the agent is subsequently re-started on the same issue and re-goes through review/test without a NEW PR being created, the stale `prUrl` persists into `readyForMerge=true`. Neither `/review` nor `/request-review` validates that `prUrl` still points to an OPEN PR.
- **Candidate fix**:
  1. In `/review` and `/request-review` endpoints: check `gh pr view ${prUrl} --json state` before accepting submission. If state≠OPEN, create a fresh PR via the normal artifact flow.
  2. Add `repairClosedPRs()` startup repair in `label-cleanup.ts`: for every workspace with `readyForMerge=true`, verify the `prUrl` is OPEN; if CLOSED/MERGED-but-issue-still-open, reset review state and re-dispatch.
  3. In `closeIssuePullRequest()`, also null out `prUrl` in workspace state so downstream flows don't reuse a dead handle.
- **Status**: Fix deferred to Run 6 — waiting for the merge-agent attempt to surface the exact error path so the validator can catch the real failure signature, not a speculative one.

### PAN-611 — Silent merge failure (1 run, new)
- **Pattern**: Log shows `[merge] Merging github review artifact for PAN-611...` immediately followed by `[merge] Dequeuing next merge: PAN-509` with NO error line in between. `mergeStatus` flipped to `failed` with `mergeNotes=null`.
- **Root cause** (candidate): The GitHub review-artifact merge path throws a thrown Error that's caught at a high level and converted to `mergeStatus=failed` without logging the error message or writing it to `mergeNotes`.
- **Candidate fix**: In `merge-agent.ts` `mergeGithubReviewArtifact()` and its catch block in `processMergeQueue()`, log the full error (name + message + stack) and set `mergeNotes` to the error message so the user can see WHY merge failed on the Awaiting Merge page.
- **Status**: Fix deferred to Run 6.

---

## Infrastructure Gaps

| Gap | Impact | First Seen | Filed? | Status (Run 5) |
|-----|--------|-----------|--------|---|
| Blocking FS calls in request handlers | Dashboard API hangs under load | Run 4 | No | **FIXED Run 5** (commit 9cf06605) |
| Deacon replays stale review notes for orphaned `reviewing` states | PAN-596 cycled 3 runs with byte-identical failure notes | Run 5 | No | **FIXED Run 5** (commit e2395dd6) — restore only `passed` terminals |
| Cancel-flow leaves stale `prUrl` pointing to CLOSED PR | PAN-509 `readyForMerge=true` against closed PR #527 | Run 5 | No | **NEW** — needs validator in `/review`/`/request-review` + startup repair |
| Merge-agent silent failures (no `mergeNotes`, no error log) | PAN-611 `mergeStatus=failed` with zero diagnostic info | Run 5 | No | **NEW** — catch blocks must log + persist error message |
| Review circuit breaker can't self-reset | Agent needs manual `pan work reset-review` after 7 requeues | Run 4 | No | Ongoing |
| Orphaned planning sessions | `planning-pan-596` session alive 5h+ after plan complete | Run 3 | PAN-682 | 3rd consecutive run — **needs code fix** in `complete-planning.ts` |
| Verification bypass at 3 failures masks root causes | Bypass escape hatch hides test failures | Run 5 | No | Ongoing — PAN-596 real failures now visible since deacon fix |
| Startup repair `repairMergedLabels` full-table scan | Noisy logs every restart | Run 4 | No | Ongoing |

---

## Pattern Ledger

| Pattern | Signature | Root Cause | Fix Applied |
|---------|-----------|------------|-------------|
| Blocking FS in request handlers | API hangs, curl timeouts | `readFileSync`/`execSync` in routes/services | Cache config at startup, async FS (Run 5: 9cf06605) |
| Review cycling with byte-identical failure notes | N runs of `review=failed` with the SAME notes across different commits; no review-agent feedback files created | `deacon.ts:1229` `checkOrphanedReviewStatuses` replayed latest terminal history entry's status+notes verbatim when restoring orphaned `reviewing` state | **Only restore `passed` terminals; fall through to `pending` re-dispatch for `failed`/`blocked`** (Run 5: e2395dd6) |
| Cancel-flow stale prUrl | `readyForMerge=true` against CLOSED PR | `/cancel` closes PR but doesn't null `prUrl`; re-review reuses stale handle | **Candidate**: `prUrl` open-PR validator + `repairClosedPRs()` startup repair |
| Silent merge-agent failures | `mergeStatus=failed`, `mergeNotes=null`, no error in log | Catch block swallows error without logging or persisting | **Candidate**: log full error + write to `mergeNotes` |
| Orphaned planning sessions | `planning-pan-NNN` tmux session alive hours after complete-planning | `complete-planning.ts` never kills its session | **Candidate**: add `tmux kill-session` in complete-planning cleanup |
| Post-merge lifecycle incomplete | `mergeStatus=merged` but GH issue stays OPEN | `close-issue` step failed silently | `repairIncompletePostMergeLifecycle()` (Run 4) |
| PR merged on GH but Panopticon stuck | `gh pr view` → MERGED but `mergeStatus!=merged` | Post-merge verification failed after `gh pr merge` | `repairAlreadyMergedPRs()` (Run 4) |

---

## Skill Gaps

| Desired Capability | Why Needed | Priority | Status |
|-------------------|-----------|----------|--------|
| PR-state validator in `/review` and `/request-review` | Catches cancel-flow state divergence before it reaches merge-agent | **High** | New (Run 5) |
| Merge-agent error reporting | Silent failures give operators nothing to debug | **High** | New (Run 5) |
| `complete-planning` session cleanup | Orphaned planning sessions accumulate across runs | High | PAN-682 — 3rd consecutive run |
| Holistic dead-code detection in review | Review finds dead code piecemeal | High | Ongoing |
| Active feedback notification for idle agents | Agents don't know feedback has arrived | High | Ongoing |
| Verification gate: configurable pass criteria | 3-failure bypass masks real issues | Medium | Ongoing |
| `pan work reset-review <id>` CLI command | — | — | **CLOSED Run 5** — command exists, used successfully to reset PAN-596 |
| Feedback delivery: batch and de-dup | Multiple feedback files should consolidate | Medium | Ongoing |
| Auto-detect cycling in review | Same issue across N cycles should escalate | Low | Partially addressed by deacon replay fix |

---

## Run 5 Summary

**Bugs fixed in code**:
1. **PAN-70 type** — blocking FS calls in tracker-config service → cache `.panopticon.env` at startup (commit 9cf06605)
2. **Review replay bug** — deacon's `checkOrphanedReviewStatuses` replayed stale terminal history notes when restoring orphaned `reviewing` state, causing PAN-596 to appear to cycle for 3 runs with byte-identical failure notes across different commits. Only restore `passed` terminals now; `failed`/`blocked` fall through to the `pending` re-dispatch path so a real review runs against current code (commit e2395dd6).

**Issues moved**:
- PAN-544 → merged (user)
- PAN-611 → merge attempted, FAILED silently (needs Run 6 substrate fix)
- PAN-509 → queued for merge against CLOSED PR (needs Run 6 substrate fix)
- PAN-596 → real review PASSED for the first time in 3 runs; test agent found genuine regressions (merge-conflict markers in ConversationList.tsx, unimplemented v16→v17 migration); back to work-agent

**New substrate bugs discovered**:
- Cancel-flow stale `prUrl` leaves workspace pointing at CLOSED PR after re-review
- Merge-agent silent failures (no `mergeNotes`, no log line)
- Orphaned `planning-pan-596` tmux session (PAN-682 pattern, 3rd consecutive run)

**Main branch state**: Clean, up-to-date with origin/main. 2 substrate fix commits pushed this run (9cf06605, e2395dd6).

**Next-run priorities** (in order):
1. Fix merge-agent silent failures (log + persist error)
2. Fix cancel-flow state divergence (prUrl validator + startup repair)
3. Fix orphaned planning session cleanup
4. Re-attempt PAN-611 and PAN-509 merges after fixes land
