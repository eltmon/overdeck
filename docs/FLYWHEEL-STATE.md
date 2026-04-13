# Flywheel State
<!-- LIVING DOCUMENT — overwritten by each /all-up run. History lives in OPERATION-FIX-ALL.md -->
_Last updated: 2026-04-13 (Run 4) — auto-maintained by the all-up flywheel_

---

## Active Pipeline

Each row is an issue the flywheel is tracking. **Runs Stuck** counts consecutive runs where
the issue was blocked at the same phase with the same root cause. ≥2 = cycling alert.

| Issue | Phase | Root Cause / Blocker | Auto-Requeues | Runs Stuck | Notes |
|-------|-------|----------------------|---------------|------------|-------|
| PAN-544 | awaiting-merge | — (ready) | 0 | 0 | readyForMerge=true; user UAT pending |
| PAN-509 | review-blocked | Dead code in TerminalTabs/usePipelinePhase (7-cycle series — different items each time) | 7→reset | 2 | Circuit breaker tripped; manually reset. Agent fixes items one pass at a time instead of auditing holistically. |
| PAN-596 | review-failed | Missing tests + double-commit race on Enter + useCallback churn | 0 | 2 | Same 3 issues flagged across 3 review cycles. Work agent actively fixing (Run 4). |
| PAN-611 | merge-conflicts | Conflicts in schema.ts, record-cost-event.js, index.css with main | 0 | 1 | Scope creep (unrelated skill files, ModelOverride rewrite) was root cause of earlier rejects; now just conflicts. |
| PAN-457 | planning | — (in progress) | 0 | 0 | Planning agent active (ctx 42%) |
| PAN-540 | planning-complete | — (awaiting Done click) | 0 | 0 | Plan materialized; needs work agent to start |
| PAN-653 | planning | — (in progress) | 0 | 0 | Planning agent active (ctx 91%) |

---

## Cycling Alerts

Issues where the flywheel has seen the same symptom across ≥2 consecutive runs without
a substrate fix landing. These are the highest-priority diagnosis targets.

### PAN-509 — Dead Code Review Loop (2 runs)
- **Pattern**: Each review cycle finds dead code in the new components (TerminalTabs, usePipelinePhase, etc.), work agent fixes the specific items mentioned, but the next cycle finds more dead code.
- **Why it cycles**: Agent fixes exactly what's named in the review feedback — no holistic audit.
- **Candidate fix**: Review-agent prompt should require the agent to run a dead-code pass on the ENTIRE changeset (not just named files) before resubmitting. Or add a lint rule that catches unused exports.
- **Status**: Manually reset circuit breaker in Run 4. Next review will show if the pattern continues.

### PAN-596 — Same Review Feedback (2 runs)
- **Pattern**: Reviewer blocks on "missing tests, double-commit race on Enter, useCallback churn" across 3+ review cycles.
- **Why it cycles**: Work agent either doesn't fully understand the race condition or keeps reintroducing it.
- **Candidate fix**: `pan work tell` feedback template should include a concrete test case for the race condition, not just a description.
- **Status**: Work agent actively implementing in Run 4. If Run 5 shows same 3 issues, escalate.

---

## Infrastructure Gaps

Functionality or automation missing from Panopticon that the flywheel keeps working around.
These should become PAN issues (or be filed as enhancements to existing ones).

| Gap | Impact | First Seen | Filed? |
|-----|--------|-----------|--------|
| Review circuit breaker can't self-reset when agent genuinely fixed all issues | Work agent needs human intervention after 7 requeues even if code is correct | Run 4 | No |
| Orphaned planning sessions — plan completes but tmux session stays alive forever | Ghost sessions consume resources; misleading in tmux list | Run 3 | PAN-682 (partial) |
| Bare-numeric agent IDs (`agent-473`) survive across restarts as warnings | Can't transition tracker state; Panopticon warns but doesn't auto-remove | Run 4 | No |
| Startup repair `repairMergedLabels` runs for ALL merged issues every restart (not just new ones) | Noisy log: 20+ "Repaired labels" on every startup even when nothing to repair | Run 4 | No |
| No per-issue dead-code audit in review-agent prompt | Review finds dead code piecemeal across many cycles instead of one full pass | Run 4 | No |

---

## Pattern Ledger

Recurring failure signatures the flywheel should diagnose immediately when seen.

| Pattern | Signature | Root Cause | Fix Applied |
|---------|-----------|------------|-------------|
| Post-merge lifecycle incomplete | `mergeStatus=merged` but GitHub issue still OPEN | `close-issue` step failed silently | `repairIncompletePostMergeLifecycle()` — startup repair (Run 4) |
| PR merged on GitHub but Panopticon state stuck | `mergeStatus!=merged` but `gh pr view` → MERGED | Post-merge verification failed AFTER `gh pr merge` | `repairAlreadyMergedPRs()` — startup repair (Run 4) |
| `repairClosedWontfixIssues` too aggressive | Any closed GitHub issue with `readyForMerge=true` gets cleared | state_reason="completed" is ambiguous | Fixed: only act on issues with explicit `wontfix`/`won't fix`/`not planned` label (Run 4) |
| Feedback-writer mismatch | PAN-A's review feedback written into PAN-B's workspace | `workspace/issueId` divergence in feedback-writer | Path guard + canonical fallback (Run 3, commit e958e9cf) |
| CLI build wipes dashboard dist | `npm run build` after any CLI change breaks the running server | tsdown config had no `copy` exclusion | `scripts/build-cli.mjs` preserves `dist/dashboard/` (Run 3, commit c472c3b2) |
| Planning agents restart for In-Review issues | Rate-limit recovery triggers re-planning for issues already past planning | No guard on planning agent start | Filed PAN-682; partial guard added |
| `mergeStatus=failed` never retried | Deacon skips all `failed` entries permanently | No retry logic in deacon merge patrol | `checkFailedMergeRetry()`: 30-min cooldown, 3 retries (Run 2, commit 605ffaaa) |
| Wrong tracker for issue (MIN vs PAN) | Planning agent starts on a MIN issue using Panopticon | Conceptual: issue filed in wrong tracker | Manual cancel + create correct PAN issue (Run 4) |
| Main branch dirty from workspace leakage | Modified files in main worktree from feature-branch edits | Not a code bug; processes run in wrong cwd | Detect with `git status`, restore with `git restore` |

---

## Skill Gaps

Panopticon workflows that the flywheel repeatedly wishes existed as a skill or automated step.

| Desired Capability | Why Needed | Priority |
|-------------------|-----------|----------|
| `pan work reset-review <id>` CLI command | Currently requires raw curl to reset circuit breaker | Medium |
| Auto-detect cycling in review: same blocker notes across N cycles → escalate | Reviewer should flag "this is the same issue as last time" | High |
| Holistic dead-code audit baked into `pan work done` gate | Catch all unused exports/imports at done-time, not review-time | Medium |
| `pan plan done` auto-kills the planning tmux session | Currently sessions stay alive after planning completes | Low |
| Startup repair idempotency: skip already-repaired labels | `repairMergedLabels` runs for every merged issue every restart | Low |
