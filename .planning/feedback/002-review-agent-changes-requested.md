---
specialist: review-agent
issueId: PAN-862
outcome: changes-requested
timestamp: 2026-04-27T15:19:21Z
---

# Verdict: CHANGES_REQUESTED

## Summary
The PR implements the resource-allocated tree endpoint and per-row resource icons for PAN-862, but three findings block merge: (1) a guaranteed crash in `projects.ts` where removing the `yield* HttpServerRequest` yield leaves `request` undefined causing a `ReferenceError` on every session-trees request, (2) a critical access-control gap where the new cleanup endpoint performs destructive deletions without server-side verification that the issue is actually orphaned/closed, and (3) the PR state requirement is partially implemented — the backend returns `state` and `isDraft` but the UI does not display them. The PR must fix all three before merge.

## Blockers (MUST fix before merge)

### 1. Removed `yield* HttpServerRequest` causes guaranteed ReferenceError on GET /api/session-trees — `src/dashboard/server/routes/projects.ts:269` — `!`
**Raised by**: correctness

**Why it blocks**: The diff removes the only assignment to `request` but the very next line accesses `request.url`, guaranteeing a `ReferenceError: request is not defined` on every invocation of `GET /api/session-trees`. The endpoint is entirely non-functional.

**Fix**: Restore the yield at the top of the Effect handler:
```typescript
const request = yield* HttpServerRequest.HttpServerRequest;
const url = new URL(request.url, 'http://localhost');
```
Also remove the now-unused `HttpServerRequest` import on line 14 if the yield is restored.

---

### 2. Cleanup endpoint trusts client-side state with no server-side eligibility check — `src/dashboard/server/routes/issues.ts:1741` — `!`
**Raised by**: security

**Why it blocks**: `POST /api/issues/:id/cleanup-workspace` performs destructive deletion (removes workspace directory, deletes local feature branch, removes agent state) for any syntactically valid issue ID. The only gate is the frontend showing the button only for "orphaned" rows — a caller can bypass that UI and invoke the endpoint directly for an active in-progress issue, destroying work.

**Fix**: Enforce cleanup eligibility on the server before performing any deletion:
```typescript
const issue = await getIssueForCleanup(id);
if (!issue || !isOrphanedIssue(issue)) {
  return jsonResponse({ error: 'Cleanup is only allowed for closed/orphaned issues' }, { status: 409 });
}
```

---

### 3. PR resources do not display required state in UI — `src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.tsx:67-68, 176-178` — `!`
**Raised by**: requirements

**Why it blocks**: Issue acceptance criterion requires "🔀 PR (number + state)" to be visible. The backend returns `state` and `isDraft` for each PR, but the UI only shows `PR: <n> open` in the icon strip and `PR: #<number> <title>` in the popover — no state or draft status is displayed. This is a partial implementation of the stated requirement.

**Fix**: Include PR state/draft status in the icon tooltip and/or popover row, e.g.:
- Icon tooltip: `PR: #42 (open, draft)` or similar
- Popover row: render state badge or draft indicator alongside the title

---

## High Priority (SHOULD fix)

### 1. Duration NaN propagation when timestamps are present but invalid — `src/dashboard/server/routes/command-deck.ts:430-434` — `~`
**Raised by**: correctness

The `duration` calculation guards only with truthiness (`ss.startedAt && ss.endedAt`). If either value is an invalid date string, `getTime()` returns `NaN`, which flows into `Math.floor(NaN / 1000)`. The same pattern at line 487 correctly uses a `Number.isFinite(ms)` guard.

**Fix**:
```typescript
const ms = new Date(ss.endedAt).getTime() - new Date(ss.startedAt).getTime();
return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
```

### 2. Resource-details endpoint discloses concrete local infrastructure identifiers — `src/dashboard/server/routes/issues.ts:3040` — `~`
**Raised by**: security

`GET /api/issues/:id/resource-details` returns unsanitized workspace paths, local/remote branch names, tmux session names, docker container names, and PR metadata. This bypasses the sanitization done for the resource-allocated listing endpoint. Any dashboard consumer can enumerate local filesystem layout and runtime identifiers.

**Fix**: Only return concrete identifiers to explicitly privileged/debug contexts, or gate the endpoint behind additional authorization. If the UI only needs human-readable summaries, prefer sanitized counts.

### 3. Cleanup action fires POST without user confirmation visible to the system — `src/dashboard/frontend/src/components/CommandDeck/index.tsx:431` — `?`
**Raised by**: security (best practice)

The new orphaned-resource Cleanup action posts immediately with no confirmation dialog. The existing deep-wipe flow uses `window.confirm` at the call site. Add a confirmation step in the UI even after server-side validation is fixed.

---

## Nits (advisory — safe to defer)

- `src/dashboard/server/routes/projects.ts:265-290` — `~` — `HttpServerRequest` imported but unused after yield removal (blocking fix will resolve this)
- `tests/unit/dashboard/server/services/resource-discovery.test.ts:28-40` — `~` — Test data includes fields not in the public `ResourceDetails` interface. Remove identifier fields to match public shape, or cast through `as any` with a comment.
- `src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.tsx:435` — `?` — `sorted[0]!.sessionId` non-null assertion is safe but redundant after empty check.
- `src/dashboard/server/services/resource-discovery.ts:193` — `?` — PR arrays re-sorted in response shaping after already being sorted in `loadOpenPullRequests()`. Negligible impact at current scale.
- `src/dashboard/server/services/resource-discovery.ts:565` — `?` — `new Set([...issue.resourceSources].sort())` is redundant since `sort()` already returns a deterministic array.

---

## Cross-cutting groups

**Missing yield** (root cause: single mechanical diff error):
- [blocker-1] `projects.ts:269` — Removed `yield* HttpServerRequest` causes ReferenceError crash

**Cleanup authorization gap** (root cause: endpoint added without server-side guard):
- [blocker-2] `issues.ts:1741` — Cleanup endpoint trusts client-side state
- [high-3] `command-deck.ts:431` — Cleanup action fires without user confirmation in UI

**PR state display gap** (root cause: frontend rendering incomplete):
- [blocker-3] `FeatureItem.tsx:67-68,176-178` — PR state not displayed in UI

---

## What's good
- `GET /api/issues/resource-allocated` aggregates all 7+ resource types in a single discovery pass with caching — clean architecture
- `<1s benchmark assertion wired into CI for discovery performance
- Playwright spec covers both the icon strip and hover popover detail rendering
- No N+1 query patterns — `gh pr list` batched per repo, `git for-each-ref` bounded per project
- Closed issues with leftover resources correctly appear in the tree

---

## Review stats
- Blockers: 3   High: 2   Medium: 0   Nits: 5
- By reviewer: correctness=1, security=1, requirements=1, performance=0
- Files touched: 15   Files with findings: 8

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the
Synthesis Context above. Those files contain full per-reviewer detail; this
synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-862 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

