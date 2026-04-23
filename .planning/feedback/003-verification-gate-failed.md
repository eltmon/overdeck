---
specialist: verification-gate
issueId: PAN-805
outcome: failed
timestamp: 2026-04-23T13:55:42Z
---

VERIFICATION FAILED for PAN-805 (attempt 2/10):

Failed check: vbrief-ac

Acceptance criteria check FAILED — 74/74 AC incomplete:

### Add issue_state and label_sync_audit tables to schema.ts (4/4 incomplete)
  - [ ] issue_state table exists with columns issue_id (PK), canonical_state, last_synced_at, pending_mutation, updated_at
  - [ ] label_sync_audit table exists with id (PK AUTOINCREMENT), issue_id, attempted_at, target_label, action (CHECK add|remove), outcome (CHECK success|failure|rate_limited|skipped), reason, retry_count DEFAULT 0, http_status
  - [ ] SCHEMA_VERSION bumped to 28 and schema init is idempotent (running initSchema twice does not error)
  - [ ] issue-state-db.ts exports getIssueState(id), upsertIssueState(row), writeAuditRow(entry) with strict TypeScript types

### Create reconciler module scaffold with loop, mutex, and config (4/4 incomplete)
  - [ ] startReconciler() begins ticking at the configured interval; stopReconciler() clears the timer cleanly
  - [ ] Calling startReconciler() twice without stopping is a no-op (mutex prevents double-start) and logs a WARN
  - [ ] PANOPTICON_RECONCILER_INTERVAL_MS env var overrides the default 30000; invalid values fall back to default with a WARN log
  - [ ] A thrown error inside the tick fn is caught and logged; the next tick still runs

### Reconciler GitHub client with .ok check and 429/5xx retry (4/4 incomplete)
  - [ ] Every fetch call checks response.ok; non-ok responses throw or trigger retry
  - [ ] On 429 or 5xx: exponential backoff 1s → 2s → 4s → ... capped at 60s, max 5 attempts
  - [ ] Retry-After header (seconds or HTTP-date) overrides the backoff schedule when present
  - [ ] Errors include issueId, operation, status, and a body snippet in the log; after max retries, the error is thrown (not swallowed)

### Audit writer records every attempt to label_sync_audit (3/3 incomplete)
  - [ ] Every push attempt (success, failure, rate_limited, skipped) writes exactly one audit row per intent
  - [ ] retry_count reflects the number of retries attempted before the terminal outcome
  - [ ] http_status is populated for success/failure/rate_limited rows; NULL for skipped (no API call made)

### Pure function mapping canonical_state → desired label set (2/2 incomplete)
  - [ ] desiredLabelsFor returns the exact current Panopticon label convention for each canonical state
  - [ ] Unit tests cover all 5 canonical states

### Reconciler push step: diff issue_state vs remote, write deltas (4/4 incomplete)
  - [ ] Only deltas are written — if desired == last-synced, no API call is made
  - [ ] On successful write, pending_mutation is cleared and last_synced_at is advanced
  - [ ] On final failure after max retries, pending_mutation is retained so the next tick retries
  - [ ] Every terminal outcome writes exactly one audit row

### Reconciler pull step: list-issues, detect remote-ahead, update local (4/4 incomplete)
  - [ ] Pull uses list-issues with pagination per tick (scope narrowed from spec: active/non-terminal issues only, per planning decision recorded in STATE.md), NOT one fetch per issue
  - [ ] Remote-ahead detection updates local canonical_state and last_synced_at; writes audit row with reason=remote_ahead_pulled
  - [ ] If a pending_mutation exists and remote state conflicts, WARN log is emitted with both states and the pending local write is preserved (not overwritten)
  - [ ] Issues in terminal canonical states locally are excluded from pull-sync to bound API usage

### External merge sweep: detect closed-on-GitHub issues missing the merged label (3/3 incomplete)
  - [ ] Issues closed on GitHub without a merged label are detected each tick
  - [ ] Detection flips local canonical_state to merged and enqueues the merged label via pending_mutation
  - [ ] Audit row for the resulting label write carries reason=external_merge_detected

### Boot-time backfill of issue_state from local + GitHub (3/3 incomplete)
  - [ ] On boot, any locally-known issue missing from issue_state gets a row whose canonical_state matches current GitHub labels
  - [ ] Backfill is idempotent — running it twice produces no duplicate rows and no extra API calls
  - [ ] Backfill runs before the first reconciler tick to avoid spurious pull-sync updates racing the backfill

### Wire reconciler startup into dashboard boot (2/2 incomplete)
  - [ ] Dashboard boot runs backfill then starts the reconciler loop
  - [ ] Clean shutdown stops the reconciler loop (no dangling timers)

### Delete all 5 repair* functions and their tests (4/4 incomplete)
  - [ ] All 5 repair* functions deleted from label-cleanup.ts (not commented out)
  - [ ] Associated test files deleted; npm test passes without them
  - [ ] npm run build and npm run typecheck pass without any of the repair* symbols referenced anywhere
  - [ ] grep confirms no remaining references to repairMergedLabels, repairAlreadyMergedPRs, repairIncompletePostMergeLifecycle, repairClosedWontfixIssues, or repairClosedPRs anywhere in src/ or tests/ (imports, callers, comments, or doc references)

### Remove repair* wiring from dashboard boot path (2/2 incomplete)
  - [ ] src/dashboard/server/main.ts no longer references any repair* symbol (commented or otherwise)
  - [ ] No orphan imports left behind; npm run lint passes

### Migrate transitionIssueToInProgress to reconciler with idempotency + lazy insert (4/4 incomplete)
  - [ ] transitionIssueToInProgress reads issue_state.canonical_state before acting
  - [ ] When canonical_state is already in_progress, no API call is made and an INFO log is emitted with the expected format
  - [ ] If the issue has no issue_state row, one is lazy-inserted (covers issues missed by boot backfill)
  - [ ] Actual label writes flow through the reconciler queue, not a direct fetch from this call site

### Migrate updateGitHubToInReview to reconciler queue (3/3 incomplete)
  - [ ] updateGitHubToInReview sets canonical_state=in_review and lets the reconciler perform the label write
  - [ ] Any surviving direct fetch call has an explicit .ok check
  - [ ] Errors are thrown (not swallowed) and logs include issueId, operation, status, and a body snippet

### Migrate bulk-close endpoint (PAN-569) to reconciler queue (3/3 incomplete)
  - [ ] Bulk-close endpoint no longer performs direct GitHub label fetch calls
  - [ ] Each targeted issue has its canonical_state updated and pending_mutation set so the reconciler writes the label
  - [ ] Endpoint response is unchanged from the client's perspective (UI contract preserved)

### Remove Closes #NNN from PR body template/generator (2/2 incomplete)
  - [ ] No PR body emitter in the codebase produces Closes #, Fixes #, or Resolves # directives
  - [ ] Existing tests that assert on PR body content are updated accordingly

### postMergeLifecycle explicitly closes issue via API and enqueues merged label (3/3 incomplete)
  - [ ] After a Panopticon-driven merge, the issue is closed via explicit GitHub API call (not relying on Closes # keyword)
  - [ ] The close call goes through the github-client so .ok + retry + Retry-After semantics apply
  - [ ] canonical_state is set to merged and the merged label is enqueued via the reconciler

### Grep-based CI check prevents label-write regressions outside reconciler (3/3 incomplete)
  - [ ] A CI-invoked script fails the build if gh issue edit or direct label-write fetch appears outside src/lib/lifecycle/reconciler/**
  - [ ] Script is wired into CI (package.json + workflow) and runs on every PR
  - [ ] Script passes cleanly on the migrated codebase

### Test: respawn flood — 1000x transitionIssueToInProgress yields 0 API calls (3/3 incomplete)
  - [ ] Test calls transitionIssueToInProgress 1000 times with canonical_state already in_progress
  - [ ] Assertion: GitHub mock receives 0 label-write calls
  - [ ] Test passes in CI

### Test: rate-limit recovery — 429 Retry-After handling and audit trail (3/3 incomplete)
  - [ ] Mock returns 429 Retry-After: 2 for first 3 attempts then 200
  - [ ] Reconciler eventually succeeds on the 4th attempt
  - [ ] label_sync_audit contains a row with retry_count >= 3 and outcome=success

### Test: external merge sweep labels issues merged via GitHub web UI (3/3 incomplete)
  - [ ] Scenario: GitHub reports PR merged, issue closed, no merged label locally
  - [ ] After one tick: canonical_state=merged, merged label applied
  - [ ] label_sync_audit row has reason=external_merge_detected

### Test: PR body generator emits no Closes #NNN / Fixes # / Resolves # directives (2/2 incomplete)
  - [ ] Test calls the PR-body generator for at least one representative scenario
  - [ ] Assertion: output contains no Closes #, Fixes #, or Resolves # (case-insensitive)

### Test: CI enforcement fails when a stray gh issue edit is added (3/3 incomplete)
  - [ ] Fixture with a stray gh issue edit call outside the reconciler path causes the enforcement script to fail (non-zero exit)
  - [ ] Fixture with a stray direct /labels fetch call outside the reconciler path causes the enforcement script to fail
  - [ ] Without the fixture, the script passes cleanly on the migrated codebase

### Test: multi-developer pull-sync detects remote-ahead state (3/3 incomplete)
  - [ ] Seeded local state is in_progress; mocked remote labels imply in_review
  - [ ] After one tick, local canonical_state=in_review and last_synced_at advances
  - [ ] label_sync_audit row has outcome=skipped and reason=remote_ahead_pulled

## REQUIRED: Complete all acceptance criteria BEFORE resubmitting

1. Review the incomplete AC above
2. Implement the missing requirements and write tests
3. Update plan.vbrief.json subItem statuses to 'completed'
4. Commit and push ALL changes
5. ONLY THEN resubmit: pan review request PAN-805 -m "Completed acceptance criteria"

Do NOT resubmit until all AC are completed.
