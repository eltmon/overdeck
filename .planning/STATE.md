# PAN-805 — Epic A: Labels as display, internal state as source of truth

## Status: In Progress

## Current Phase
Implementing beads one at a time — building reconciler sub-modules (GitHub client, desired labels, audit writer).

## Completed Work
- [x] pan-569-ggj: Remove repair* wiring from dashboard boot path (commit: 2c341ebe)
- [x] pan-569-fq5: Add issue_state and label_sync_audit tables to schema.ts (commit: 4cb4a15a)
- [x] pan-569-1dj: Create reconciler module scaffold with loop, mutex, and config (commit: 1077d15e)
- [x] pan-569-cqw: Reconciler GitHub client with .ok check and 429/5xx retry (commit: 355f54b7)
- [x] pan-569-okh: Pure function mapping canonical_state → desired label set (commit: e5271e3b)
- [x] pan-569-0kn: Audit writer records every attempt to label_sync_audit (commit: caad710d)
- [x] pan-569-4o1: Reconciler push step: diff issue_state vs remote, write deltas (commit: ce37184b)
- [x] pan-569-yly: Reconciler pull step: list-issues, detect remote-ahead, update local (commit: fe51ce1d)
- [x] pan-569-3nn: External merge sweep: detect closed-on-GitHub issues missing the merged label (commit: 11eec268)
- [x] pan-569-ya1: Wire reconciler startup into dashboard boot (commit: ddbf71b1)
- [x] pan-569-vyg: Boot-time backfill of issue_state from local + GitHub (commit: ff46c65e)
- [x] pan-569-agg: Migrate transitionIssueToInProgress to reconciler with idempotency + lazy insert (commit: c8f77015)
- [x] pan-569-4cc: Migrate updateGitHubToInReview to reconciler queue (commit: 6831d8f7)

## Remaining Work
- [ ] pan-569-arx: Migrate bulk-close endpoint (PAN-569) to reconciler queue
- [ ] pan-569-e41: postMergeLifecycle explicitly closes issue via API and enqueues merged label
- [ ] pan-569-egy: Remove Closes #NNN from PR body template/generator
- [ ] pan-569-1r1: Delete all 5 repair* functions and their tests
- [ ] pan-569-dzx: Grep-based CI check prevents label-write regressions outside reconciler
- [ ] pan-569-lv7: Test: respawn flood — 1000x transitionIssueToInProgress yields 0 API calls
- [ ] pan-569-1kp: Test: rate-limit recovery — 429 Retry-After handling and audit trail
- [ ] pan-569-fyf: Test: external merge sweep labels issues merged via GitHub web UI
- [ ] pan-569-6kq: Test: multi-developer pull-sync detects remote-ahead state
- [ ] pan-569-hwc: Test: CI enforcement fails when a stray gh issue edit is added
- [ ] pan-569-sed: Test: PR body generator emits no Closes #NNN / Fixes # / Resolves # directives
- [ ] pan-569-yly: Reconciler pull step: list-issues, detect remote-ahead, update local
- [ ] pan-569-3nn: External merge sweep: detect closed-on-GitHub issues missing the merged label
- [ ] pan-569-ya1: Wire reconciler startup into dashboard boot
- [ ] pan-569-vyg: Boot-time backfill of issue_state from local + GitHub
- [ ] pan-569-agg: Migrate transitionIssueToInProgress to reconciler with idempotency + lazy insert
- [ ] pan-569-4cc: Migrate updateGitHubToInReview to reconciler queue
- [ ] pan-569-arx: Migrate bulk-close endpoint (PAN-569) to reconciler queue
- [ ] pan-569-e41: postMergeLifecycle explicitly closes issue via API and enqueues merged label
- [ ] pan-569-egy: Remove Closes #NNN from PR body template/generator
- [ ] pan-569-1r1: Delete all 5 repair* functions and their tests
- [ ] pan-569-dzx: Grep-based CI check prevents label-write regressions outside reconciler
- [ ] pan-569-lv7: Test: respawn flood — 1000x transitionIssueToInProgress yields 0 API calls
- [ ] pan-569-1kp: Test: rate-limit recovery — 429 Retry-After handling and audit trail
- [ ] pan-569-fyf: Test: external merge sweep labels issues merged via GitHub web UI
- [ ] pan-569-6kq: Test: multi-developer pull-sync detects remote-ahead state
- [ ] pan-569-hwc: Test: CI enforcement fails when a stray gh issue edit is added
- [ ] pan-569-sed: Test: PR body generator emits no Closes #NNN / Fixes # / Resolves # directives

## Key Decisions
- Schema bump: SCHEMA_VERSION 27 → 28, inline CREATE TABLE IF NOT EXISTS in schema.ts (existing pattern).
- CI enforcement: grep-based script, not ESLint rule.
- Pull-sync scope: only open/active issues, paginated list-issues per tick.
- Backfill: seed from local workspaces + agent state on boot; lazy-insert for any missed issues.
- PAN-676: remove Closes #NNN, Panopticon owns explicit API close + reconciler enqueue.

## Specialist Feedback
- None yet
- **[2026-04-23T12:55Z] verification-gate → FAILED** — `.planning/feedback/001-verification-gate-failed.md`
- **[2026-04-23T13:28Z] verification-gate → FAILED** — `.planning/feedback/002-verification-gate-failed.md`
- **[2026-04-23T13:55Z] verification-gate → FAILED** — `.planning/feedback/003-verification-gate-failed.md`
