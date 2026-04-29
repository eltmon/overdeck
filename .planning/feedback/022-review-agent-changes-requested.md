---
specialist: review-agent
issueId: PAN-905
outcome: changes-requested
timestamp: 2026-04-29T02:32:01Z
---

# Verdict: CHANGES_REQUESTED

## Summary
PAN-905 implements the Command Deck Awaiting Merge canonical merge gate: webhook ingestion for CI/PR/review events, `blocker_reasons` persistence in SQLite, smee-client relay lifecycle, and UI surfacing of GitHub-native blockers. Requirements coverage is complete (18/18 ✅). One blocker remains: `issueIdFromBranch` only matches PAN-prefixed branches, silently dropping webhook events for all other project prefixes (MIN, KRUX, AUR, MYN). One high-priority performance issue (double-read per webhook mutation) should be addressed. The `review_dismissed` bug from the first synthesis round was confirmed fixed by the requirements reviewer (REQ-6, line 75 — "removes `changes_requested` on approval or dismissal").

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

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. Webhook blocker mutations do 2 reads + 1 write per event — `src/lib/webhook-handlers.ts:72` — `~`
**Raised by**: performance
**Issue**: `mutateBlockers()` reads the current status with `getReviewStatusAsync()`, then `setReviewStatusAsync()` re-reads the same row internally before upserting. Each webhook event performs ~2 SQLite reads + 1 write instead of 1 read + 1 write. Under burst traffic (check_run fan-out, review-thread churn), this is unnecessary DB work on a path intended to stay lightweight and non-blocking. The route correctly returns 200 immediately via `Effect.fork`, so HTTP latency is protected, but the background job does redundant work.

**Fix**: Add a dedicated `mutateReviewStatus(issueId, updater)` API in `review-status-db.ts` that performs a single read-modify-write cycle, passing the already-loaded status through to avoid the second read inside `setReviewStatus()`.

---

## Nits (advisory — safe to defer)

- `src/dashboard/server/routes/webhooks.ts:128` — `?` — `PANOPTICON_DEV_WEBHOOKS=1` dev-mode bypass should stay limited to local dev; document it as not a production fallback. (security, advisory)
- `src/dashboard/frontend/src/components/inspector/ReviewPipelineSection.tsx:254` — `?` — Continue treating rendered markdown notes as untrusted content; do not add `rehype-raw` without a sanitization review. (security, advisory)
- `src/dashboard/frontend/src/components/inspector/ReviewPipelineSection.tsx:43` — `?` — PR polling continues every 30s during failed merge states; consider stopping it in `failed` state and relying on store/event updates. (performance, optimization opportunity)

---

## Cross-cutting groups

**Webhook handler path reliability** (all in `src/lib/webhook-handlers.ts` — fix together):
- [blocker-1] `issueIdFromBranch` only matches PAN prefixes → all non-PAN project webhooks silently ignored
- [warning-2] `handlePullRequest` ignores `review_dismissed` action (edge case — most dismissals correctly arrive via `pull_request_review`)
- [warning-3] `handleCheckSuite` only processes first PR from array — uncommon but possible with multi-PR branches
- [warning-4] `handlePullRequestReviewThread` silently skips unresolved thread when `thread.id == null`
- [high-5] Double-read mutation pattern in `mutateBlockers` → single read-modify-write needed

---

## What's good
- All 18 requirements implemented and verified — requirements coverage is complete
- `review_dismissed` handling confirmed fixed by requirements reviewer (REQ-6 evidence at `webhook-handlers.ts:214`)
- `blocker_reasons` schema migration (v29→v30) and JSON serialization properly wired
- Webhook HMAC-SHA256 verification correctly implemented with dev-mode bypass gated behind env flag
- smee-client lifecycle correctly integrated into `pan up`/`pan down`
- Awaiting Merge page correctly filters blocked vs ready issues and shows per-blocker-type icons
- 4-step pipeline stepper with merge retry count, notes, queue position, and live specialist log link all working
- Vision document and docs index properly created
- Forked webhook dispatch correctly protects HTTP response latency (errors are logged but not propagated)

---

## Review stats
- Blockers: 1   High: 1   Medium: 0   Nits: 3
- By reviewer: correctness=1 blocker + 4 warnings, security=0 blockers + 2 nits, performance=0 blockers + 1 warning, requirements=PASS (0 blockers — confirms `review_dismissed` fix already in code)
- Files touched: 60+   Files with findings: 7

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

