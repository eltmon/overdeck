---
specialist: review-agent
issueId: PAN-905
outcome: changes-requested
timestamp: 2026-04-29T02:11:04Z
---

# Verdict: CHANGES_REQUESTED

## Summary
PAN-905 implements the Command Deck Awaiting Merge canonical merge gate: webhook ingestion for CI/PR/review events, `blocker_reasons` persistence in SQLite, smee-client relay lifecycle, and UI surfacing of GitHub-native blockers. Requirements coverage is complete (18/18 ✅). However, two critical logic bugs in `webhook-handlers.ts` must be fixed before merge: (1) `issueIdFromBranch` only matches PAN-prefixed branches, silently dropping blocker updates for all other project prefixes (MIN, KRUX, AUR, MYN, etc.); (2) missing `review_dismissed` handling leaves `changes_requested` blockers permanently stuck after a reviewer dismisses their review. One high-priority performance issue (double-read per webhook mutation) should also be addressed.

## Blockers (MUST fix before merge)

### 1. `issueIdFromBranch` only matches PAN-prefixed branches — all non-PAN projects silently broken — `src/lib/webhook-handlers.ts:40-43` — `!`
**Raised by**: correctness
**Why it blocks**: The regex `/feature\/(pan-\d+)/i` only matches `feature/pan-*` branches. Branches for MIN, KRUX, AUR, MYN and any other project prefix are completely unmatched — webhook events for those issues never add or remove blockers, leaving their Awaiting Merge status perpetually stale or wrong.

```typescript
// Fix: change the regex to match any project prefix
function issueIdFromBranch(ref: string): string | null {
  const match = ref.match(/feature\/([a-z]+-\d+)/i);
  return match ? match[1].toUpperCase() : null;
}
```

---

### 2. Missing `review_dismissed` handling — `changes_requested` blockers never clear after reviewer dismisses — `src/lib/webhook-handlers.ts:199-216` — `!`
**Raised by**: correctness
**Why it blocks**: When a reviewer dismisses their `changes_requested` review, GitHub sends `review.state === 'dismissed'`. The current code only handles `changes_requested` (add blocker) and `approved` (remove blocker) — the `dismissed` state falls through with no action, permanently leaving the `changes_requested` blocker in place. The issue falsely appears blocked on the Awaiting Merge page.

```typescript
// Fix: handle dismissed the same as approved — reviewer explicitly withdrew their concerns
if (review.state === 'changes_requested') {
  await addBlocker(issueId, { type: 'changes_requested', ... });
} else if (review.state === 'approved' || review.state === 'dismissed') {
  await removeBlocker(issueId, 'changes_requested');
}
```

---

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. Webhook blocker mutations do 2 reads + 1 write per event — `src/lib/webhook-handlers.ts:72` — `~`
**Raised by**: performance
**Issue**: `mutateBlockers()` reads the current status with `getReviewStatusAsync()`, then `setReviewStatusAsync()` re-reads the same row internally before upserting. Each webhook event thus performs ~2 SQLite reads + 1 write. Under burst traffic (check_run fan-out, review-thread churn), this is unnecessary DB work on a path intended to stay lightweight.

**Fix**: Push the blocker mutation down to a single read-modify-write cycle — add a dedicated `mutateReviewStatus(issueId, updater)` API in `review-status-db.ts` that takes the already-loaded status, or pass the `existing` object through the update path to avoid the second read inside `setReviewStatus()`.

---

## Nits (advisory — safe to defer)

- `src/dashboard/server/routes/webhooks.ts:128` — `?` — `PANOPTICON_DEV_WEBHOOKS=1` dev-mode bypass should stay limited to local dev; document it as not a production fallback. (security, advisory)
- `src/dashboard/frontend/src/components/inspector/ReviewPipelineSection.tsx:254` — `?` — Continue treating rendered markdown notes as untrusted content; do not add `rehype-raw` without a sanitization review. (security, advisory)
- `src/dashboard/frontend/src/components/inspector/ReviewPipelineSection.tsx:43` — `?` — PR polling continues every 30s during failed merge states; consider stopping it in `failed` state and relying on store/event updates. (performance, optimization opportunity)

---

## Cross-cutting groups

**Webhook handler path reliability** (all in `src/lib/webhook-handlers.ts` — fix together):
- [blocker-1] `issueIdFromBranch` only matches PAN prefixes → all non-PAN project webhooks silently ignored
- [blocker-2] Missing `review_dismissed` in `handlePullRequestReview` → `changes_requested` blockers persist after dismissal
- [warning-3] `handlePullRequest` ignores `review_dismissed` action (edge case, most dismissals come via `pull_request_review`)
- [warning-4] `handleCheckSuite` only processes first PR from array — uncommon but possible with multi-PR branches
- [warning-5] `handlePullRequestReviewThread` silently skips unresolved thread when `thread.id == null`
- [high-6] Double-read mutation pattern in `mutateBlockers` → single read-modify-write needed

---

## What's good
- All 18 requirements implemented and verified — requirements coverage is complete
- `blocker_reasons` schema migration (v29→v30) and JSON serialization properly wired
- Webhook HMAC-SHA256 verification correctly implemented with dev-mode bypass gated behind env flag
- smee-client lifecycle correctly integrated into `pan up`/`pan down`
- Awaiting Merge page correctly filters blocked vs ready issues and shows per-blocker-type icons
- 4-step pipeline stepper with merge retry count, notes, queue position, and live specialist log link all working
- Vision document and docs index properly created
- Forked webhook dispatch correctly protects HTTP response latency (errors are logged but not propagated)

---

## Review stats
- Blockers: 2   High: 1   Medium: 0   Nits: 3
- By reviewer: correctness=2 blockers + 4 warnings, security=0 blockers + 2 nits, performance=0 blockers + 1 warning, requirements=PASS (0 blockers)
- Files touched: 56   Files with findings: 7

---

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the Synthesis Context above. Those files contain full per-reviewer detail; this synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-905 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

