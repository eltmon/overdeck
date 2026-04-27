---
specialist: review-agent
issueId: PAN-879
outcome: changes-requested
timestamp: 2026-04-27T13:20:06Z
---

# Verdict: CHANGES_REQUESTED

## Summary
PAN-879 introduces a canonical stash taxonomy (`pre-merge`, `pre-spawn`, `review-temp`, `salvageable`), a periodic stash janitor in the Deacon patrol, and a dashboard UI for managing salvageable stashes. All 12 requirements are implemented. However, two critical correctness issues must be resolved before merge: (1) `cleanupSpawnAndOrphanedStashes` uses the `delete` operator on agent state properties instead of explicit `undefined` assignment, creating fragile type contracts and logical TOCTOU; (2) the merge agent drops (instead of pops) the pre-merge stash after successful merge, silently discarding any uncommitted workspace state that existed before the merge — a data-loss regression from prior behavior. Both are blockers per RFC 2119 policy.

## Blockers (MUST fix before merge)

### 1. Pre-merge stash is dropped instead of popped — dirty workspace state silently discarded — `src/lib/cloister/merge-agent.ts:~1159–1175` — `!`
**Raised by**: correctness
**Why it blocks**: After a successful merge, any uncommitted changes that existed in the workspace before the merge are silently lost. The old code used `git stash pop` to restore those changes; the new code drops the stash instead. This is a data-loss regression for any user who had local work in the workspace.

<fix instruction>: Before changing the drop behavior, check whether the workspace was dirty before the merge. If it was, either (a) use `git stash pop` to restore the stashed changes after a successful merge (matching prior behavior), or (b) add a guard that refuses to merge if the workspace is dirty, with a clear error message. The stash hygiene spec says "drop once the merge succeeds" — validate whether this was intentional (workspaces should be clean before merge) vs. an accidental behavioral change. Document the decision explicitly. If the prior `pop` behavior was correct for user experience, restore it.

### 2. `delete` operator on agent state properties corrupts typed state contract — `src/lib/cloister/deacon.ts:cleanupSpawnAndOrphanedStashes` — `!`
**Raised by**: correctness
**Why it blocks**: Using `delete agentState.preSpawnStashRef` removes the key entirely from the object, causing future `in agentState` checks to differ from `!== undefined` checks. This fragile contract will silently break any future code that relies on `'preSpawnStashRef' in agentState` vs. `agentState.preSpawnStashRef !== undefined`.

<fix instruction>: Replace all `delete` calls in `cleanupSpawnAndOrphanedStashes` with explicit `undefined` assignment:
```typescript
agentState.preSpawnStashRef = undefined;
agentState.preSpawnStashMessage = undefined;
agentState.preSpawnBaselineHead = undefined;
saveAgentState(agentState);
```

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. `resolveStashOperationRef` has TOCTOU window between resolution and operation — `src/lib/stashes.ts:176–200` — `~`
**Raised by**: correctness
<fix instruction>: This is acceptable for the current single-threaded architecture. Add a comment documenting the assumption that only one Deacon patrol runs at a time and no concurrent stash operations occur. If concurrent operations ever become possible, wrap the resolve+operate sequence in a lock.

### 2. `reconcileAndCheckIfMerged` burns rate limits when GitHub App check fails — `src/lib/cloister/deacon.ts` — `~`
**Raised by**: correctness
<fix instruction>: Cache the reconciliation result per issue ID for the duration of a janitor cycle. Alternatively, skip the tracker fallback when the GitHub App check returns a definitive "not merged" vs. an error, to avoid burning rate limits on consistently misconfigured tokens.

### 3. `cleanupSpawnAndOrphanedStashes` silently skips agents when baseline HEAD is missing — `src/lib/cloister/deacon.ts` — `~`
**Raised by**: correctness
<fix instruction>: In the `git rev-list` catch block, if the error indicates the baseline ref no longer exists, proceed to drop the stash anyway (the agent clearly has commits since it is still running). Only skip the cleanup if the error is ambiguous.

### 4. `getWorkspaceStashesRoute` returns 200 with empty array for non-existent workspaces — `src/dashboard/server/routes/workspaces.ts` — `~`
**Raised by**: correctness
<fix instruction>: Add `existsSync(workspacePath)` check and return 404 if the workspace does not exist, consistent with the recover and dismiss routes.

### 5. `stashesToDrop` deduplication filter rationale is subtle and undocumented — `src/lib/cloister/deacon.ts` — `~`
**Raised by**: correctness
<fix instruction>: Add a comment explaining that drops must execute in descending stack order and the deduplication intentionally prefers the "merged" label over "stale" when a stash appears in both categories.

## Nits (advisory — safe to defer)

- `src/lib/stashes.ts:85,96,107` — `?` — `parseCanonicalStashMessage` issue ID regex `(\w+-\d+)` is too restrictive for multi-hyphen issue IDs (e.g., `KRUX-SUB-3`). Consider `([A-Z]+(?:-[A-Z]+)*-\d+)` or reusing existing issue ID parsing utilities. (correctness)
- `src/lib/stashes.ts:151` — `?` — `listStashes` uses raw format string. No change needed, but consider `execFileAsync` with an argument array for defense-in-depth. (correctness)
- `src/lib/__tests__/stashes.test.ts` — `?` — Missing edge case tests for `parseStashListLine`: empty messages, all-zeros SHA, invalid ISO date strings, legacy path where `ref` falls back to `stackRef`. (correctness)
- `src/dashboard/server/routes/workspaces.ts` — `?` — `workspacePath` is computed independently in each stash route. Extract a shared `resolveWorkspacePath(issueId)` helper if one doesn't exist. (correctness)
- `src/lib/cloister/review-agent.ts:ensureReviewTempStash` — `?` — Swallows the case where `git status --porcelain` reports changes but `git stash push` returns "No local changes". Acceptable risk given the microsecond window. Document the assumption. (correctness)
- `src/lib/cloister/deacon.ts:cleanupOrphanedReviewSessions` — `?` — Coordinator exclusion uses `.includes('coordinator')` substring check. More specific to check for `-coordinator-` as a segment. (correctness)
- `src/dashboard/server/routes/workspaces.ts:1141` — `?` — `GET /api/workspaces/:issueId/stashes` shells out `git stash list` on every inspector poll (60s). Small optimization opportunity; not necessary for this PR. (performance)

## Cross-cutting groups

**Stash state management** (fix together to ensure consistent state tracking):
- [blocker-1] Pre-merge stash drop vs. pop decision in merge-agent.ts
- [blocker-2] `delete` vs. `undefined` assignment in deacon.ts
- [high-3] Baseline HEAD missing silently skips cleanup in deacon.ts

**Deacon janitor correctness** (related janitor logic, fix together):
- [high-2] Rate limit burning in `reconcileAndCheckIfMerged`
- [high-5] Deduplication filter undocumented in `stashesToDrop`

## What's good
- All 12 requirements are implemented and verified; requirements reviewer found zero missing or partial items.
- Security reviewer found no vulnerabilities in the new server routes or stash helpers.
- Stash taxonomy design (stable SHA refs with re-resolution before operations) is sound.
- Dashboard UI correctly scopes salvageable stash actions to the requesting issue ID.

## Review stats
- Blockers: 2   High: 5   Medium: 0   Nits: 7
- By reviewer: correctness=2, security=0, performance=0, requirements=0
- Files touched: 19   Files with findings: 13

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the
Synthesis Context above. Those files contain full per-reviewer detail; this
synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-879 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

