---
specialist: review-agent
issueId: PAN-905
outcome: changes-requested
timestamp: 2026-04-28T22:33:03Z
---

# Verdict: CHANGES_REQUESTED

## Summary
PAN-905 implements GitHub webhook ingestion for merge-blocking / merge-unblocking events, adds blocker-reason storage to the review status DB, and expands the merge pipeline UI. The review found 3 blockers: (1) the webhook route accepts unsigned payloads when the secret is missing or empty, enabling forgery of merge state; (2) the same route uses `readFileSync` on the dashboard event loop, violating the project's dashboard-node22-only rule; (3) the `status` webhook event declared in the vBRIEF is not implemented at all. Five high-priority findings and three nits are also present. The work agent must fix all three blockers before this can merge.

## Blockers (MUST fix before merge)

### 1. Unsigned webhook payloads accepted when the webhook secret is missing — `src/dashboard/server/routes/webhooks.ts:66` — `!`
**Raised by**: security
**Why it blocks**: When `~/.panopticon/github-app/webhook-secret` is absent or empty, the route logs a warning but still processes and dispatches the event. Any actor who can reach the webhook endpoint can forge `pull_request_review`, `check_run`, or `check_suite` events to clear `changes_requested` blockers, add fake blockers, or otherwise manipulate the dashboard's merge-readiness decisions without authenticating through GitHub.

Fail closed: require a non-empty webhook secret before the route accepts any event.

### 2. `readFileSync` in dashboard server route handler — `src/dashboard/server/routes/webhooks.ts:34` — `⊗`
**Raised by**: performance, security
**Why it blocks**: `getWebhookSecret()` calls `readFileSync` on every first webhook request after boot. This blocks the Node.js event loop, stalling all concurrent HTTP and WebSocket traffic on the dashboard server. CLAUDE.md explicitly bans `readFileSync` in dashboard-reachable code (PAN-70, PAN-446).

Load the secret asynchronously during server startup or via a module-level async init. Request handlers must read only an in-memory value.

### 3. `status` webhook event is not implemented — `src/dashboard/server/routes/webhooks.ts:103-105`, `src/lib/webhook-handlers.ts` — `!`
**Raised by**: requirements
**Why it blocks**: The vBRIEF plan at `.planning/plan.vbrief.json:241-252` explicitly requires a `handleStatus` function for commit status updates. The route accepts `status` events but intentionally skips them with a comment ("handled by check_suite/check_run for now"). The unit tests only cover `check_suite`/`check_run` paths, not `status`. A feature that does not implement its stated requirements cannot merge.

Implement `handleStatus` or remove the requirement from the plan. If the handler is intentionally deferred, the vBRIEF plan must be updated before merge.

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. `handleCheckRun` success prematurely removes the `failing_checks` blocker — `src/lib/webhook-handlers.ts:89-92` — `~`
**Raised by**: correctness, performance
When a single `check_run` completes with `success`, the entire `failing_checks` blocker is removed — even if other check runs in the same suite are still failing. This causes a brief flicker on the Awaiting Merge page. Track individual check run conclusions and only clear the blocker when all runs in the suite have passed, or only act on `check_suite` events for blocker management.

### 2. Duplicate merge-conflict detection in `handlePullRequest` — `src/lib/webhook-handlers.ts:105-114,141-149` — `~`
**Raised by**: correctness, performance
The handler contains two blocks that detect merge conflicts. Block 2 is a superset of Block 1 (it also handles `mergeable_state === 'clean'`), making Block 1 dead code that produces 2 extra SQLite writes per PR webhook event. Remove lines 105-114; Block 2 handles all cases correctly.

### 3. `selectBlockedFromMerge` shows issues that were never close to ready — `src/dashboard/frontend/src/lib/store.ts:148-157` — `~`
**Raised by**: correctness
The selector shows ALL issues with `blockerReasons`, including draft PRs that haven't passed review or test. The Awaiting Merge page describes these as "issues that were ready to merge but GitHub is blocking them" — misleading for issues in early states. Add a filter: only surface issues where `reviewStatus === 'passed'` and (`testStatus === 'passed'` or `testStatus === 'skipped'`).

### 4. Redundant DB read/write cycles per blocker mutation — `src/lib/webhook-handlers.ts:40` — `~`
**Raised by**: performance
`addBlocker` calls `getReviewStatus()` (hits SQLite) then `setReviewStatus()` (reads again before upserting). Each webhook state change is at least two DB reads plus one write. Under bursty event delivery this compounds. Collapse blocker updates into a single per-event mutation, or add a dedicated DB path for blocker reasons that skips the extra pre-read.

### 5. Awaiting Merge blocker display lacks distinct per-blocker icons and expandable detail — `src/dashboard/frontend/src/components/AwaitingMergePage.tsx:371-380` — `~`
**Raised by**: requirements
The requirement specifies type-specific icons and expandable detail. The implementation uses a single generic `AlertTriangle` icon for all blocker types and exposes additional context only via the badge `title` attribute. Add distinct icon mappings per blocker type and an expandable details UI.

## Nits (advisory — safe to defer)

- `src/dashboard/frontend/src/components/inspector/ReviewPipelineSection.tsx:123-131` — `?` — Merge retry count shows `retry N/3` instead of `Attempt N/3` as specified in the acceptance criterion. (requirements)
- `src/dashboard/frontend/src/components/inspector/types.ts:10-41` — `?` — `ReviewStatus` interface used by `ReviewPipelineSection` doesn't include `blockerReasons`, creating an asymmetry with `ReviewStatusData` in `queries.ts`. (correctness)
- `scripts/create-github-app.mjs:119` — `?` — Setup silently succeeds without a webhook secret, leaving authentication disabled. Refuse to persist setup as successful if `data.webhook_secret` is absent or empty. (security)

## Cross-cutting groups

**Webhook route (`webhooks.ts`)** — all three blockers plus nit-3 share the same file and the same fix root:
- [blocker-1] Unsigned webhooks when secret missing
- [blocker-2] `readFileSync` on dashboard event loop
- [nit-3] Silent setup without secret

**Webhook handler efficiency (`webhook-handlers.ts`)** — issues 1, 2, 4, 5 share the same handler file:
- [blocker-3] Missing `status` handler
- [high-1] `handleCheckRun` premature blocker removal
- [high-2] Duplicate merge-conflict detection dead code
- [high-4] Redundant DB reads per blocker mutation

## What's good
- Blocker-reason schema, storage, and API enrichment are complete and traceable to the vBRIEF.
- The smee client lifecycle, `pan up`/`pan down`/`pan doctor`, and GitHub App setup scripts are all present.
- Merge pipeline stepper (4th step, CI sub-statuses, queue position, live log link) is substantially implemented with test coverage.
- All 17 vBRIEF items are marked completed; acceptance criteria coverage table in the correctness review shows full traceable coverage except the `status` handler.

## Review stats
- Blockers: 3   High: 5   Medium: 0   Nits: 3
- By reviewer: correctness=4 warnings + 3 suggestions, security=1 blocker + 1 nit, performance=1 blocker + 1 warning + 1 optimization, requirements=1 missing + 2 partial
- Files touched: 38+ across all reviewers   Files with findings: ~12

## Appendix: individual reviews
See individual reviewer output files listed in `## Reviewer Output Files` in the Synthesis Context above. Those files contain full per-reviewer detail; this synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-905 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

