---
specialist: review-agent
issueId: PAN-905
outcome: changes-requested
timestamp: 2026-04-29T00:37:30Z
---

# Verdict: CHANGES_REQUESTED

## Summary

PAN-905 adds GitHub webhook reception for merge blocker detection — `BlockerReason` tracking, `readyForMerge` override, and webhook dispatch via smee-client. The feature is substantially complete (17/18 requirements implemented, solid blocker logic). However, two findings rise to blocker severity: (1) the webhook handler uses synchronous `better-sqlite3` calls on the Node event loop despite `Effect.fork`, directly contradicting the "No Blocking Calls" dashboard rule (PAN-70/PAN-446); and (2) the `pan health` smee-client status requirement was not implemented — only `pan doctor` was added, leaving the acceptance criterion unmet. Both must be addressed before merge.

## Blockers (MUST fix before merge)

### 1. Webhook handler performs synchronous database I/O on the event loop — `src/dashboard/server/routes/webhooks.ts:153` — `⊗`

**Raised by**: performance

**Why it blocks**: `Effect.fork` does not unblock the Node event loop — the forked handler immediately calls `getReviewStatus()` + `setReviewStatus()` which invoke synchronous `better-sqlite3` operations (`dbUpsert`). This blocks all HTTP and WebSocket traffic on the dashboard server. The CLAUDE.md "No Blocking Calls" rule (PAN-70: 15 commits, PAN-446: 139 sync FS calls) exists precisely to prevent this. The route comment at line 151 explicitly claims it "doesn't block ... the Node event loop," which is incorrect.

The fix requires making the SQLite write path non-blocking for dashboard-reachable code. Options: (a) use `db.upsertAsync` (async variant of better-sqlite3), (b) queue webhook mutations to a worker/process, or (c) use an async write pipeline. The `setReviewStatus` / `getReviewStatusFromDb` / `dbUpsert` chain is the entry point — whichever async approach is chosen, it must propagate through `mutateBlockers` (`webhook-handlers.ts:72`) up to the webhook handler.

### 2. `pan health` smee-client status is not implemented — `src/cli/index.ts` / `src/cli/commands/doctor.ts` — `!`

**Raised by**: requirements

**Why it blocks**: The vBRIEF item `pan-up-smee-lifecycle` states "pan health shows smee-client status (running/stopped/not configured)" as an acceptance criterion. This PR adds smee status to `pan doctor` (doctor.ts:176) but does not add any `pan health` command or health output path. The requirement is only half-delivered.

The fix: implement the `pan health` command output to surface smee relay state (running/stopped/not configured), or confirm that `pan doctor` output is the intended health surface and update the vBRIEF acceptance criterion accordingly.

## High Priority (SHOULD fix; synthesis may still approve if justified)

_none_

## Nits (advisory — safe to defer)

- `src/lib/webhook-handlers.ts:76` — `?` — Silent failure in `mutateBlockers`: `setReviewStatus` errors are caught and swallowed; GitHub receives 200 even if DB write fails. This is pre-existing fire-and-forget pattern. Accept as design given GitHub's delivery guarantees, or add read-back verification. (correctness)
- `src/lib/webhook-handlers.ts:171,180,193` — `?` — Dead `return blockers` in `mutateBlockers` callback. The `fn` return value is computed but discarded; only `updated = fn(blockers)` is used. Remove the dead `return blockers` statements to reduce maintenance confusion. (correctness)
- `src/dashboard/server/routes/agents.ts:1023` — `?` — Pre-existing unauthenticated heartbeat ingestion endpoint (`POST /api/agents/:id/heartbeat`). Not PR-introduced. Consider requiring `X-Panopticon-Internal-Token` to align with other internal endpoints. (security)
- `src/lib/webhook-handlers.ts:272-286` — `?` — `handleStatus` only acts on first feature branch via `break`. Likely intentional given GitHub's per-commit status semantics, but worth confirming. (correctness)

## Cross-cutting groups

**Synchronous DB I/O in webhook path** (root cause: `better-sqlite3` sync calls on Node event loop):
- [blocker-1] Webhook handler sync I/O — `webhooks.ts:153`, `webhook-handlers.ts:72`, `review-status.ts:133`
- [nit-1] Silent failure when DB write fails — `webhook-handlers.ts:76`

Both stem from the same root cause: webhook-induced state changes go through synchronous SQLite path. Fix the sync I/O (blocker-1) and the silent failure becomes moot since the async pipeline propagates errors correctly.

## What's good

- Blocker schema and `BlockerReason` interface are well-designed with 6 distinct types
- `readyForMerge` override when blockers exist is defensively correct — explicit override is always overridden back to false
- Webhook HMAC verification + repository allowlisting is properly implemented
- Bulk history load replaces prior N+1 pattern in `getAllReviewStatusesFromDb()` — good regression prevention
- Diff virtualization in `PrDiffTab` prevents proportional DOM growth
- `pan up` / `pan down` smee lifecycle is correctly wired

## Review stats

- Blockers: 2   High: 0   Medium: 0   Nits: 4
- By reviewer: correctness=5, security=1, performance=1, requirements=1
- Files touched: 50+   Files with findings: 5

## Appendix: individual reviews

See individual reviewer output files:
- `correctness.md` — 2 warnings, 3 suggestions
- `security.md` — 1 pre-existing best practice observation, 0 PR-introduced issues
- `performance.md` — 1 critical (MUST NOT), 0 warnings, 2 optimization notes
- `requirements.md` — 1 missing requirement (!, blocker), 17 implemented, 0 partial

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-905 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

