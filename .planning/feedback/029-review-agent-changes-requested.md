---
specialist: review-agent
issueId: PAN-905
outcome: changes-requested
timestamp: 2026-04-29T15:09:39Z
---

# Verdict: CHANGES_REQUESTED

## Summary
PAN-905 adds persisted merge blockers, GitHub webhook ingestion, smee relay support, and dashboard merge-pipeline UI, but the new webhook correlation and failing-check aggregation logic are not safe to merge yet. The branch-name-only correlation lets an unrelated PR in an allowlisted repository mutate another issue's blocker state, and the current `failing_checks` handling can both clear blockers while other checks are still failing and miss non-`failure` terminal conclusions entirely. Fix those blocker-state bugs first, then address the snapshot hot-path reload and stale `mergeable_state: unknown` behavior before merge.

## Blockers (MUST fix before merge)

### 1. Branch-name-only webhook correlation mutates the wrong issue — `src/lib/webhook-handlers.ts:40` — `~`
**Raised by**: security
**Why it blocks**: This is a high-severity access-control flaw in the merge gate because any PR in an allowlisted repo with a colliding `feature/<issue-id>` branch name can add or clear blockers for the tracked issue.

Bind every webhook mutation to the exact tracked PR identity before updating review state. Use the branch name only to discover a candidate issue, then compare the incoming repository plus immutable PR identity (PR number, node ID, PR URL, or matched head SHA for status events) against the PR already stored for that issue, and ignore non-matching events.

### 2. Any one success event clears all failing-check blockers — `src/lib/webhook-handlers.ts:80` — `!`
**Raised by**: correctness
**Why it blocks**: A single green `status`, `check_suite`, or `check_run` event can remove `failing_checks` while other checks are still red, making `readyForMerge` true for a PR GitHub still considers blocked.

Replace the single `failing_checks` flag with per-check or per-source tracking, or recompute blocker state from the full GitHub status rollup before clearing it. Removal must happen only when all relevant checks for the tracked PR are passing.

### 3. Non-`failure` terminal GitHub conclusions never block merge — `src/lib/webhook-handlers.ts:103` — `!`
**Raised by**: correctness
**Why it blocks**: Timed-out, cancelled, stale, startup-failure, or action-required checks remain non-mergeable in GitHub, but the current handlers ignore them and can leave `readyForMerge` true.

Treat every completed non-success check conclusion as blocking, not just `failure`. Update the check handlers so any terminal conclusion other than `success` adds or updates the failing-check blocker, and only clear the blocker when the aggregate tracked-PR check state is fully green.

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. Full review-status reload runs on every dashboard snapshot — `src/dashboard/server/read-model.ts:161` — `~`
**Raised by**: performance

Keep `getSnapshot()` cheap and return the in-memory projection instead of reloading all review statuses from SQLite and tmux on every bootstrap/reconnect. Move drift repair to incremental mutation handling or a slower background refresh path so snapshot latency does not scale with total issue count.

### 2. `mergeable_state: "unknown"` can preserve stale merge blockers indefinitely — `src/lib/webhook-handlers.ts:170` — `~`
**Raised by**: correctness

Do not leave blocker state unchanged indefinitely when GitHub reports `mergeable_state: 'unknown'`. Refresh mergeability from GitHub or schedule a follow-up reconciliation so stale `merge_conflict` / `not_mergeable` blockers cannot survive after the PR becomes mergeable.

### 3. Missing-secret webhook behavior is narrower than the acceptance text — `src/dashboard/server/routes/webhooks.ts:140` — `~`
**Raised by**: requirements

Align the route behavior with the plan wording or tighten the plan to match the intentional behavior. If the explicit dev-only bypass is the intended design, update the acceptance text; otherwise broaden the graceful missing-secret handling so the implementation and requirement say the same thing.

## Nits (advisory — safe to defer)

- `src/dashboard/frontend/src/components/inspector/ReviewPipelineSection.tsx:43` — `?` — Avoid polling PR status checks while merge is merely failed. Stop the 30s `/api/issues/:id/pr` polling loop once merge has failed and no active merge attempt is in progress. (performance)
- `src/lib/webhook-handlers.ts:40` — `?` — Treat branch names as routing hints, not authorization keys. Keep `issueIdFromBranch()` only as a lookup helper after exact PR identity validation is in place. (security)

## Cross-cutting groups

**Webhook truth and authorization** (related findings that share a root cause — fix together):
- [blocker-1] Branch-name-only webhook correlation mutates the wrong issue
- [blocker-2] Any one success event clears all failing-check blockers
- [blocker-3] Non-`failure` terminal GitHub conclusions never block merge
- [high-2] `mergeable_state: "unknown"` can preserve stale merge blockers indefinitely
- [high-3] Missing-secret webhook behavior is narrower than the acceptance text
- [nit-2] Treat branch names as routing hints, not authorization keys

**Snapshot hot path** (related findings that share a root cause — fix together):
- [high-1] Full review-status reload runs on every dashboard snapshot
- [nit-1] Avoid polling PR status checks while merge is merely failed

## What's good
- The PR carries blocker metadata through storage, contracts, normalization, and dashboard rendering instead of leaving merge readiness implicit.
- The webhook route verifies HMAC signatures for configured secrets and correctly rejects untracked repositories before processing events.

## Review stats
- Blockers: 3   High: 3   Medium: 0   Nits: 2
- By reviewer: correctness=3, security=1, performance=2, requirements=1
- Files touched: 52   Files with findings: 4

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the Synthesis Context above. Those files contain full per-reviewer detail; this synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-905 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

