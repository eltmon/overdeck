# PAN-905: Command Deck — Make Awaiting Merge the Canonical Final Merge Gate

## Problem

After a PR reaches the end of the automated pipeline, the dashboard gives fragmented visibility into whether it's truly ready for the final human merge click. The user bounces between the pipeline stepper, PR/Diff tab, Awaiting Merge page, and GitHub itself. `readyForMerge` only checks Panopticon-internal states (review passed, test passed) and completely ignores GitHub-native blockers (failing CI checks, merge conflicts, unresolved review conversations). This means issues can appear on Awaiting Merge when they're actually blocked at the GitHub level.

## Product Goal

Make **Awaiting Merge** the canonical final human merge gate:
- All automated gates (planning, implementation, review, CI, post-rebase verification) happen automatically
- Issues appear on Awaiting Merge **only** when they have truly reached the final human decision point
- If a PR is still blocked, the dashboard shows the exact reason
- The human should never need to open GitHub to understand why merge is blocked

## Architecture Decisions

### 1. GitHub Webhook Infrastructure via smee.io

**Decision**: Add real-time GitHub webhook event reception using smee.io as a local relay.

**Rationale**: Panopticon runs locally on developer machines (Electron-wrapped app). Localhost can't receive webhooks directly, so smee.io acts as a relay proxy. Each developer has their own GitHub App (created by `scripts/create-github-app.mjs`), so smee-per-developer is correct.

**Implementation**:
- `smee-client` npm dependency relays GitHub webhooks to localhost
- Dashboard server adds `POST /api/webhooks/github` route with HMAC-SHA256 signature verification
- `pan up` starts the smee-client process alongside the dashboard server; `pan down` stops it
- Smee URL stored in `~/.panopticon/github-app/smee-url`
- Existing installs get a migration script to update their GitHub App's webhook config

**Events subscribed** (broad set covering all merge-readiness blockers):
- `check_suite`, `check_run` — CI status changes
- `pull_request` — merge conflicts, state changes, draft status
- `pull_request_review` — review decisions (approved/changes requested)
- `pull_request_review_thread` — unresolved conversations
- `status` — commit status updates

### 2. Blocker Storage: `blockerReasons[]` in ReviewStatus

**Decision**: Add a typed `blockerReasons` JSON array column to the `review_status` SQLite table.

**Format**:
```typescript
interface BlockerReason {
  type: 'failing_checks' | 'merge_conflict' | 'unresolved_conversations' | 'changes_requested' | 'draft_pr' | 'not_mergeable';
  summary: string;       // Human-readable, e.g., "2/5 checks failed"
  details?: string;      // Optional expanded detail
  detectedAt: string;    // ISO timestamp
}
```

**Lifecycle**: Populated by webhook event handlers. Cleared when the blocker resolves (e.g., all checks pass → remove `failing_checks` entry). `readyForMerge` enriched to return `false` when `blockerReasons.length > 0`.

### 3. Pipeline Stepper: 4th Merge Step

**Decision**: Always show 4 steps in the pipeline stepper: Build Gate → Review → Tests → Merge.

The Merge step shows as pending/grey until the merge phase begins. When active, it displays:
- Individual CI check sub-statuses (reusing PR query data already fetched for PrDiffTab)
- Queue position from existing `/api/review/:issueId/status` response
- Retry count as "Attempt N/3"
- `mergeNotes` as expandable detail on failure
- Live specialist log link during active merge work

### 4. Awaiting Merge Page Rewrite

**Decision**: Awaiting Merge means **all automated gates satisfied, only the human merge decision remains**.

- Filter out issues with non-empty `blockerReasons[]`
- Show blocker badges inline for issues that are close-but-blocked (separate section or visual treatment)
- Surface the exact GitHub-native blocker so the user never needs to open GitHub

### 5. Future Auto-Merge Compatibility

**Decision**: Design the state model so a future optional auto-merge toggle can be added cleanly once an issue reaches Awaiting Merge. Do NOT implement auto-merge in this issue.

The `mergeStatus` state machine already supports this: a future auto-merge feature would watch for `readyForMerge === true && blockerReasons.length === 0` and automatically trigger the merge flow. No schema changes needed for this future capability.

### 6. Smee-Client Process Lifecycle

**Decision**: `pan up` starts smee-client as a managed process (similar to dashboard server). `pan down` stops it.

- Smee-client runs as a spawned child process managed by the `pan up` orchestrator
- If smee URL is not configured, `pan up` logs a warning but doesn't fail (webhook reception is an enhancement, not a requirement)
- Health check: smee process restart on unexpected exit

## Scope

### In Scope
- Webhook infrastructure (smee-client, POST route, HMAC verification, event handlers)
- `blockerReasons[]` schema migration and storage
- `readyForMerge` enrichment to incorporate GitHub-native blockers
- Pipeline stepper 4th Merge step with sub-statuses
- Awaiting Merge page rewrite to reflect true final gate
- GitHub App webhook configuration update (script + migration path)
- Live merge-specialist log link
- Panopticon vision documentation

### Out of Scope
- Auto-merge implementation (design-compatible only)
- Multi-tenant webhook routing
- Slack/email notifications on merge events
- Webhook delivery engine for outbound webhooks

## Key Files

### Backend (new/modified)
- `src/lib/database/schema.ts` — add `blocker_reasons` column
- `src/lib/database/migrations/` — migration for new column
- `src/lib/review-status.ts` — enrich `readyForMerge`, add blocker types
- `src/dashboard/server/routes/webhooks.ts` — NEW: webhook POST handler
- `src/lib/webhook-handlers.ts` — NEW: per-event-type handlers
- `src/lib/smee.ts` — NEW: smee-client process management
- `scripts/create-github-app.mjs` — update webhook config in manifest
- `scripts/update-github-app-webhooks.mjs` — NEW: migration script for existing apps

### Frontend (modified)
- `src/dashboard/frontend/src/components/inspector/ReviewPipelineSection.tsx` — 4th step
- `src/dashboard/frontend/src/components/AwaitingMergePage.tsx` — blocker-aware filtering
- `src/dashboard/frontend/src/components/MergeButton.tsx` — blocker display
- `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverviewTabs/queries.ts` — extend types

### Infrastructure
- `src/lib/cloister/up.ts` or equivalent — smee-client lifecycle in `pan up`

## References
- PAN-869 — prior symptom: Awaiting Merge lane missed merge-ready PRs
- PAN-850 — adjacent merge-flow hardening
- PAN-805 — intended CI feedback bridge for failed PR checks