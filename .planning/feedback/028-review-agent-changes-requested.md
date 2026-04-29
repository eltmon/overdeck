---
specialist: review-agent
issueId: PAN-905
outcome: changes-requested
timestamp: 2026-04-29T04:25:20Z
---

# Verdict: CHANGES_REQUESTED

## Summary
This PR implements the Command Deck "Awaiting Merge" canonical final merge gate (PAN-905): adding a `blockerReasons[]` schema and persistence, GitHub webhook ingestion for CI/PR/review blockers, smee relay lifecycle, and an updated Awaiting Merge UI with blocker surfacing. The implementation covers 15 of 16 requirements; one named acceptance criterion is incomplete, and four correctness/performance issues reach blocker severity. The synchronous SQLite issue in the webhook hot path explicitly contradicts the PR's stated non-blocking design. All four blockers must be fixed before merge.

## Blockers (MUST fix before merge)

### 1. Unhandled JSON.parse exception corrupts blocker mutation — `src/lib/webhook-handlers.ts:246,262` — `!`
**Raised by**: correctness
**Why it blocks**: Malformed JSON in `existing.details` throws an unhandled exception inside `mutateBlockers`, permanently breaking blocker mutation for that issue until manual DB repair.

```typescript
// Line 246:
const threadIds = new Set<string>(JSON.parse(existing?.details ?? '[]') as string[]);
// Line 262:
const threadIds = new Set<string>(JSON.parse(existing.details ?? '[]') as string[]);
```

Wrap both in try/catch:
```typescript
let threadIds: Set<string>;
try {
  threadIds = new Set<string>(JSON.parse(existing?.details ?? '[]') as string[]);
} catch {
  threadIds = new Set<string>();
}
```

### 2. Rejected reviewStatus regression silently drops pipeline notification — `src/lib/review-status.ts:155-158` — `!`
**Raised by**: correctness
**Why it blocks**: The regression guard returns early without calling `notifyPipeline`, so WebSocket subscribers never learn that the status update was rejected — dashboard state silently diverges from actual status.

Add `notifyPipeline` before the early return:
```typescript
if (update.reviewStatus === 'reviewing' && status.reviewStatus === 'passed' && update.mergeStatus === undefined) {
  console.warn(`[review-status] Rejecting reviewStatus regression from 'passed' to 'reviewing' for ${issueId}`);
  notifyPipeline({ type: 'status_changed', issueId, status: status as ReviewStatus });
  return status as ReviewStatus;
}
```

### 3. Webhook "async" path performs synchronous SQLite on the event loop — `src/lib/review-status.ts:355` — `⊗`
**Raised by**: performance
**Why it blocks**: `setReviewStatusAsync()` delegates directly to the synchronous `setReviewStatus()`, which monopolizes the Node event loop for every accepted webhook. This directly contradicts the PR's stated non-blocking design and degrades unrelated HTTP/WS/terminal traffic at webhook volume.

Use `setImmediate` to fully defer the SQLite work:
```typescript
export function setReviewStatusAsync(
  issueId: string,
  update: Partial<ReviewStatus>,
  existing?: ReviewStatus,
): Promise<ReviewStatus> {
  return new Promise((resolve, reject) => {
    setImmediate(() => {
      try {
        resolve(setReviewStatus(issueId, update, existing));
      } catch (err) {
        reject(err);
      }
    });
  });
}
```

### 4. REQ-17 (CI sub-status icons) is incomplete — `src/dashboard/frontend/src/components/inspector/ReviewPipelineSection.tsx:190-210` — `!`
**Raised by**: requirements
**Why it blocks**: The named acceptance criterion explicitly requires per-check pass/fail/running icons; the current implementation renders text/color pills but no per-check icons. This is a partial implementation of a MUST requirement.

Add pass/fail/running icons to the inline check rollup so each individual CI check conveys its state visually, not only by label color. Reuse `statusColor()` mapping already imported from PrDiffTab.

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. Full snapshot rebuild reloads all statuses and tmux sessions on every getSnapshot() — `src/dashboard/server/read-model.ts:161` — `~`
**Raised by**: performance
**Why it matters**: At scale or on reconnect storms, `O(n review statuses + n tmux sessions)` per snapshot request causes linear latency growth. The event-driven projection is already maintained; full-table reload on every snapshot is redundant.

Fix by making the event-driven projection authoritative and removing the full reload, or add targeted drift-detection instead of unconditional full-table scan.

### 2. Unreachable `dismissed` review state branch — `src/lib/webhook-handlers.ts:225` — `~`
**Raised by**: correctness
**Why it matters**: `review.state === 'dismissed'` in `handlePullRequestReview` is dead code — GitHub routes `review_dismissed` events through `pull_request` action `review_dismissed`, which `handlePullRequest` already handles at line 149-151. Misleads future maintainers.

Remove the unreachable `|| review.state === 'dismissed'` branch.

## Nits (advisory — safe to defer)

- `src/lib/webhook-handlers.ts:172-203` — `?` — `mergeable_state` classification silently ignores unknown states. Add an explicit unknown-state warning to make it observable rather than silent. (correctness)
- `src/lib/webhook-handlers.ts:152-156` — `?` — `handlePullRequest` processes unrelated PR fields even on `review_dismissed`. Use a guard clause to skip the mutation block for `review_dismissed`. (correctness)
- `src/dashboard/server/routes/webhooks.ts:124` — `?` — Dev-only HMAC bypass (`PANOPTICON_DEV_WEBHOOKS=1`) must remain clearly documented as local-dev-only. Ensure deployment guidance prevents production enablement. (security)

## Cross-cutting groups

**Webhook handler robustness** (all in `src/lib/webhook-handlers.ts` and `src/lib/review-status.ts`):
- [blocker-1] Unhandled JSON.parse exception in thread details parsing (lines 246, 262)
- [blocker-2] Missing notifyPipeline on regression rejection (review-status.ts:155-158)
- [blocker-3] Synchronous SQLite in webhook "async" path (review-status.ts:355)
- [high-1] Unreachable dismissed review state branch (line 225)

**Snapshot architecture** (separate root cause):
- [high-2] Full snapshot rebuild on every getSnapshot() (read-model.ts:161)

## What's good
- Blocker schema, normalization, and readyForMerge semantics are correctly implemented across all code paths.
- GitHub webhook HMAC verification, event dispatch routing, and per-event handlers are well-structured.
- The Awaiting Merge UI correctly separates blocked issues from ready issues and surfaces blocker types with icons and details.
- smee relay lifecycle is properly integrated into pan up / pan down with capped restart behavior.
- The 4-step pipeline stepper, retry count, queue position, and live log link all match their acceptance criteria.

## Review stats
- Blockers: 4   High: 2   Medium: 0   Nits: 3
- By reviewer: correctness=5, security=1, performance=2, requirements=1
- Files touched: 52   Files with findings: 9

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the Synthesis Context above. Those files contain full per-reviewer detail; this synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-905 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

