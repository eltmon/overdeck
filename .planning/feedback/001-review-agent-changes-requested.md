---
specialist: review-agent
issueId: PAN-879
outcome: changes-requested
timestamp: 2026-04-27T14:22:54Z
---

# Verdict: CHANGES_REQUESTED

## Summary

PAN-879 introduces a canonical stash taxonomy (`pre-merge`, `pre-spawn`, `review-temp`, `salvageable`), a new `stashes.ts` module with parsing/creation/drop operations, stash lifecycle management in merge-agent and review-agent, a deacon stash-janitor sweep, and dashboard/frontend endpoints for viewing and recovering salvageable stashes. The feature is fully implemented (12/12 requirements met). However, a command-injection vulnerability in `createRecoveryBranchFromStash` is a MUST-severity blocker that must be fixed before merge. Two HIGH-severity warnings (stash resolution race, janitor stackRef filter) should also be addressed.

## Blockers (MUST fix before merge)

### 1. Command injection in `createRecoveryBranchFromStash` — `src/lib/stashes.ts:234-235` — `!`
**Raised by**: correctness
**Why it blocks**: `issueId.toUpperCase()` is interpolated directly into a shell command via `execAsync` backtick expansion. While the codebase uses `ISSUE_ID_PATTERN` validation elsewhere, `buildStashMessage` does not validate its `issueId` argument, and the recovery branch path (`git branch ${branchName} ${operationRef}`) is not protected by the same quoting as the stash message path.

```typescript
// stashes.ts:234-235
const branchName = `recovery/${issueId.toUpperCase()}-${sanitizeShortDescription(shortDescription)}`;
await execAsync(`git branch ${JSON.stringify(branchName)} ${JSON.stringify(operationRef)}`, ...);
```

`sanitizeShortDescription` strips non-alphanumeric chars, but `issueId.toUpperCase()` is raw. If any caller passes a malformed `issueId` (or a future code path bypasses validation), shell execution is possible.

**Fix:** Add `validateIssueId` at the top of `buildStashMessage` to enforce the `([A-Z]+(?:-[A-Z]+)*-\d+)` pattern before any interpolation:

```typescript
function validateIssueId(issueId: string): void {
  if (!/^[A-Z]+(?:-[A-Z]+)*-\d+$/.test(issueId)) {
    throw new Error(`Invalid issue ID format: ${issueId}`);
  }
}
```

Call `validateIssueId(issueId)` at the top of `buildStashMessage` (line ~49). This provides a hard invariant boundary — any malformed `issueId` throws before it reaches any shell command.

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. Race condition in `resolveStashOperationRef` stack resolution — `src/lib/stashes.ts:177-209` — `~`
**Raised by**: correctness
**Why it blocks (high, not blocker):** The function resolves a stable SHA to a `stash@{N}` slot, then the caller uses that slot in a `git stash drop/pop`. Between resolution and execution, another process could shift indices. The existing re-validation at lines 188 and 204 catches most drift. The risk is real but limited to concurrent stash operations in the same repo.

**Fix:** Add a comment at the top of `resolveStashOperationRef` documenting the serialized-invocation requirement (per-workspace stash operations must not run concurrently), and assert the invariant in debug mode. No structural change needed.

### 2. Janitor silently drops stashes without `stackRef` — `src/lib/cloister/deacon.ts:2570-2582` — `~`
**Raised by**: correctness
**Why it blocks (high, not blocker):** Stashes without a `stackRef` (e.g., from legacy parse paths where `ref === stackRef`) are silently filtered out by `Number.isFinite(entry.stashIndex)` in the janitor's drop pipeline. A stash with a valid SHA ref but no `stackRef` will never be cleaned up.

**Fix:** For entries without `stackRef`, fall back to a SHA-based resolution path instead of silently dropping them. The simplest fix: pass the SHA `ref` directly to `dropStash` when `stackRef` is absent — `dropStash` already handles SHA-only refs via the full list scan path (lines 191-213).

## Nits (advisory — safe to defer)

- `src/lib/stashes.ts:152-159` — `?` — Empty stash list handling is correct. No action needed. (correctness)
- `src/lib/cloister/review-agent.ts:127-145` — `?` — `cleanupReviewTempStash` error handling is already safe (call site wraps it at line 1042-1044). No action needed. (correctness)

## Cross-cutting groups

**Stash index resolution fragility** (related findings that share a root cause — fix together):
- [high-1] `resolveStashOperationRef` race condition — same index-shift risk as the janitor's stackRef filter
- [high-2] Janitor silently drops stash entries without `stackRef`

## What's good
- All 12 requirements implemented with no missing coverage
- `stashes.ts` centralizes canonical message construction and correctly uses `JSON.stringify` for the stash `-m` argument (mitigates the injection surface on the main stash push path)
- Security review found no OWASP-class vulnerabilities
- `sanitizeShortDescription` correctly strips non-alphanumeric chars from recovery branch names
- Janitor explicitly preserves `salvageable` stashes from auto-cleanup
- `stash_janitor_every_cycles` env-var override creates a new config object (no mutation)

## Review stats
- Blockers: 1   High: 2   Medium: 0   Nits: 2
- By reviewer: correctness=1 blocker + 3 warnings + 2 suggestions, security=clean, performance=clean, requirements=PASS
- Files touched: 22   Files with findings: 3 (stashes.ts, deacon.ts, review-agent.ts)

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

