---
specialist: review-agent
issueId: PAN-905
outcome: changes-requested
timestamp: 2026-04-29T03:42:47Z
---

# Verdict: CHANGES_REQUESTED

## Summary
PAN-905 implements the Command Deck Awaiting Merge canonical merge gate: webhook ingestion for CI/PR/review events, `blocker_reasons` persistence in SQLite, smee-client relay lifecycle, and UI surfacing of GitHub-native blockers. Requirements coverage is complete (18/18 ✅). One blocker remains: `handleCheckSuite` only processes the first PR from the `pull_requests` array, silently skipping blocker updates for feature branches that appear later — this causes stale `failing_checks` blockers when a check_suite is associated with multiple PRs (e.g., a backport PR first, then the feature PR). Two high-priority items should also be addressed: the double-read mutation pattern in webhook handlers and silent error swallowing in forked webhook dispatch.

## Blockers (MUST fix before merge)

### 1. `handleCheckSuite` only processes first PR from array — `src/lib/webhook-handlers.ts:97` — `!`
**Raised by**: correctness
**Why it blocks**: GitHub's check_suite payload can include multiple PRs. The code explicitly accesses only `suite.pull_requests?.[0]` — if the first PR is a backport from `main` rather than the feature branch, the feature branch's blocker is never updated, leaving stale `failing_checks` blockers in place even after CI passes.

```typescript
// Fix: iterate all PRs, not just the first
for (const pr of suite.pull_requests ?? []) {
  const issueId = issueIdFromBranch(pr.head.ref);
  if (!issueId) continue;
  // ... existing blocker logic per issueId ...
}
```

---

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. Webhook blocker mutations do 2 reads + 1 write per event — `src/lib/webhook-handlers.ts:72` — `~`
**Raised by**: performance
**Issue**: `mutateBlockers()` reads the current status with `getReviewStatusAsync()`, then `setReviewStatusAsync()` re-reads the same row internally before upserting. Each webhook event performs ~2 SQLite reads + 1 write instead of 1 read + 1 write. Under burst traffic (check_run fan-out, review-thread churn), this is unnecessary DB work on a path intended to stay lightweight. The HTTP response path is protected via `Effect.fork`, but the background job does redundant work.

**Fix**: Add a dedicated `mutateReviewStatus(issueId, updater)` API in `review-status-db.ts` that performs a single read-modify-write cycle, passing the already-loaded status through to avoid the second read inside `setReviewStatus()`.

### 2. Forked webhook dispatch swallows errors with no retry — `src/dashboard/server/routes/webhooks.ts:153-155` — `~`
**Raised by**: correctness
**Issue**: `dispatchWebhook` errors are caught and logged to console, but the forked fiber is not tracked — errors are not propagated and there is no retry mechanism. A JSON parse error, DB failure, or any unhandled exception in a webhook handler silently drops the event after logging.

**Fix (minimum)**: Track the fork's fiber and log on exit. For production reliability, consider persisting failed events to SQLite as a dead-letter queue for retry.

---

## Nits (advisory — safe to defer)

- `src/lib/webhook-handlers.ts:229` — `?` — `handlePullRequestReviewThread` silently skips unresolved thread when `thread.id == null` (no logging, no counter). Add a `console.warn` so there's a discoverable signal when this edge case fires. (correctness, advisory)
- `src/dashboard/server/routes/webhooks.ts:128` — `?` — `PANOPTICON_DEV_WEBHOOKS=1` dev-mode bypass should stay limited to local dev; document it as not a production fallback. (security, advisory)
- `src/dashboard/frontend/src/components/inspector/ReviewPipelineSection.tsx:254` — `?` — Continue treating rendered markdown notes as untrusted content; do not add `rehype-raw` without a sanitization review. (security, advisory)
- `src/dashboard/frontend/src/components/inspector/ReviewPipelineSection.tsx:43` — `?` — PR polling continues every 30s during failed merge states; consider stopping it in `failed` state and relying on store/event updates. (performance, optimization)

---

## Cross-cutting groups

**Webhook handler path reliability** (all in `src/lib/webhook-handlers.ts`):
- [blocker-1] `handleCheckSuite` only processes first PR → multi-PR check_suites silently skip feature branch blocker updates
- [high-2] Double-read mutation pattern in `mutateBlockers` → single read-modify-write needed
- [nit-3] `handlePullRequestReviewThread` silently skips unresolved thread when `thread.id == null`
- [nit-4] `handlePullRequest` doesn't handle `review_dismissed` action (edge case — most dismissals correctly arrive via `pull_request_review`)

**Error handling and observability** (in `src/dashboard/server/routes/webhooks.ts`):
- [high-5] Forked webhook dispatch has no error propagation or retry → silent event drops
- [nit-6] Dev-mode webhook bypass footgun (advisory)

---

## What's good
- All 18 requirements implemented and verified — requirements coverage is complete
- `issueIdFromBranch` correctly matches all project prefixes (confirmed fixed from earlier rounds)
- `review_dismissed` handling confirmed working (REQ-6 evidence at `webhook-handlers.ts:214`)
- `blocker_reasons` schema migration (v29→v30) and JSON serialization properly wired
- Webhook HMAC-SHA256 verification correctly implemented with dev-mode bypass gated behind env flag
- smee-client lifecycle correctly integrated into `pan up`/`pan down`
- Awaiting Merge page correctly filters blocked vs ready issues and shows per-blocker-type icons
- 4-step pipeline stepper with merge retry count, notes, queue position, and live specialist log link all working
- Vision document and docs index properly created

---

## Review stats
- Blockers: 1   High: 2   Medium: 0   Nits: 4
- By reviewer: correctness=1 blocker + 3 warnings, security=0 blockers + 2 nits, performance=0 blockers + 1 warning, requirements=PASS (0 blockers)
- Files touched: 63+   Files with findings: 7

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

