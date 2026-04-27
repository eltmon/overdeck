---
specialist: review-agent
issueId: PAN-879
outcome: changes-requested
timestamp: 2026-04-27T13:39:19Z
---

# Verdict: CHANGES_REQUESTED

## Summary
PAN-879 implements a canonical stash taxonomy with named prefixes, a janitor in the Deacon for stale stash cleanup, lifecycle management for pre-merge/pre-spawn/review-temp/salvageable stashes, and a dashboard inspector UI for recovering or dismissing salvageable stashes. The implementation is structurally sound with good test coverage. However, two critical issues block merge: (1) the new stash recovery and deletion endpoints are unauthenticated, expanding the dashboard's mutation surface without any authorization guard; and (2) the merge success path violates its own explicit acceptance criterion — it restores (`popStash`) the pre-merge safety stash instead of dropping it, contradicting CLAUDE.md stash hygiene rules.

## Blockers (MUST fix before merge)

### 1. Unauthenticated stash recovery and deletion endpoints — `src/dashboard/server/routes/workspaces.ts:1166,1196` — `!`
**Raised by**: security
**Why it blocks**: `POST /api/workspaces/:issueId/stashes/:stashRef/recover` and `DELETE /api/workspaces/:issueId/stashes/:stashRef` perform destructive Git operations (branch creation, stash deletion) with no authentication, authorization, or CSRF validation. An attacker who can reach the dashboard server can enumerate stash refs via `GET /api/workspaces/:issueId/stashes`, then create recovery branches from or permanently delete salvageable user work.

**Fix instruction**: Add the same trust-boundary checks used by other privileged dashboard actions before performing the Git operation. At minimum, wire in the workspace mutation permission check (the same pattern used by other destructive endpoints in the same route module). If localhost-only access is the intended guard, enforce it explicitly at the server boundary rather than relying on convention.

### 2. Merge success path does not drop the `pre-merge:` stash — `src/lib/cloister/merge-agent.ts:1161` — `!`
**Raised by**: requirements
**Why it blocks**: The issue's explicit acceptance criterion states "`merge-agent.ts` drops `pre-merge:` stash on success AND on rollback." The current success path at line 1161 calls `popStash(projectPath, preMergeStashRef)` which restores the stash instead of dropping it. The corresponding test at `src/lib/cloister/__tests__/merge-agent-stash.test.ts:88` also codifies the wrong behavior (asserts `dropStash` was NOT called). This is a missing requirement (REQ-13) and violates the CLAUDE.md stash hygiene rule that "`pre-merge:*` — drop once the merge succeeds."

**Fix instruction**: Change the merge success path to call `dropStash(projectPath, preMergeStashRef)` instead of `popStash(...)`. Update the test to assert that `dropStash` IS called on successful merge completion. The rollback path already correctly drops the stash — only the success path needs to be fixed.

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. TOCTOU race on pre-spawn stash baseline check — `src/lib/cloister/deacon.ts:cleanupSpawnAndOrphanedStashes` — `~`
**Raised by**: correctness
**Fix instruction**: Consider adding a minimum agent-runtime threshold (e.g., 5 minutes) before the janitor drops a pre-spawn stash, to avoid dropping a stash where `hasCommitsAhead` is true purely due to a rebased baseline rather than actual new commits.

### 2. Multi-project workspace path resolution bypasses existing pattern — `src/dashboard/server/routes/workspaces.ts:resolveWorkspacePath` — `~`
**Raised by**: correctness
**Fix instruction**: `resolveWorkspacePath` derives the path from issue prefix alone. For multi-project setups where two projects share a prefix, this could resolve to the wrong workspace. Reuse the workspace resolution pattern from the existing workspace detail endpoints (which use workspace metadata file) instead of deriving from prefix.

### 3. Sequence counter incremented even when no stash is created — `src/lib/cloister/review-agent.ts:108-125` — `~`
**Raised by**: correctness
**Fix instruction**: Call `getNextReviewTempSequence` only after confirming the stash was actually created, to avoid cosmetic gaps in sequence numbering. Alternatively, accept the gap as currently documented — the behavior is functionally correct.

### 4. Stale merge reconciliation sets `mergeStatus: 'merged'` for cancelled issues — `src/lib/cloister/deacon.ts:reconcileAndCheckIfMerged` — `~`
**Raised by**: correctness
**Fix instruction**: Treat tracker "closed" state as a secondary heuristic only when a PR URL exists. Use the GitHub App PR state check (`prState.merged`) as the primary signal, which correctly distinguishes merged from cancelled/duplicate/wontfix.

## Nits (advisory — safe to defer)

- `src/lib/stashes.ts:130-131` — `?` — Decorated message extraction may misparse branch names with colons. Consider a more robust extraction for the `On <branch>: <message>` format. (correctness)
- `src/lib/stashes.ts:190-205` — `?` — `resolveStashOperationRef` calls `listStashes` on every invocation. Consider caching results within a batch operation for minor performance improvement. (correctness)
- `src/lib/cloister/review-agent.ts:1040-1047` — `?` — The `finally` block cleanup may mask the original review error if cleanup itself fails. Consider surfacing the original error prominently in error logs. (correctness)
- `src/dashboard/frontend/src/components/InspectorPanel.tsx:186` — `?` — Salvageable stash query polls every 60s; could be event-driven eventually. Current cadence is fine for current scale. (performance)

## Cross-cutting groups

**Stash endpoint authorization** (same root cause — no auth layer on new mutation endpoints):
- [blocker-1] Unauthenticated stash recovery and deletion endpoints

**Merge success path** (same root cause — wrong stash operation on success):
- [blocker-2] Merge success path does not drop `pre-merge:` stash
- The test `src/lib/cloister/__tests__/merge-agent-stash.test.ts:88` codifies the same incorrect behavior and must be updated alongside the fix

**Workspace path resolution** (related findings on path derivation):
- [high-2] Multi-project workspace path resolution bypasses existing pattern
- [blocker-1] The unauthenticated endpoints also use `resolveWorkspacePath`, amplifying the multi-project risk

## What's good
- Canonical stash taxonomy (`stashes.ts`) is well-designed with clear type definitions and consistent naming conventions.
- Test coverage for the janitor logic, merge stash lifecycle, and review-temp cleanup is thorough and uses realistic scenarios.
- The salvageable stash inspector UI and confirmation dialog represent a solid user-facing improvement.
- Startup legacy-stash scan safely logs non-canonical stashes without deleting them — appropriate first step.

## Review stats
- Blockers: 2   High: 4   Medium: 0   Nits: 4
- By reviewer: correctness=7, security=2, performance=2, requirements=1
- Files touched: 19   Files with findings: 9

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the Synthesis Context above. Those files contain full per-reviewer detail; this synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-879 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

