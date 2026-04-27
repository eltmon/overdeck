---
specialist: review-agent
issueId: PAN-879
outcome: changes-requested
timestamp: 2026-04-27T14:01:58Z
---

# Verdict: CHANGES_REQUESTED

## Summary
PAN-879 implements a canonical stash taxonomy (pre-merge, pre-spawn, review-temp, salvageable) with a janitor that drops stale stashes and a dashboard inspector for salvageable stash recovery. All 12 requirements are implemented and requirements coverage is complete. However, 1 blocker was found: `reconcileAndCheckIfMerged` in deacon.ts conflates tracker "closed" state with "merged" for Linear/GitLab/Rally, which can cause data loss by dropping pre-merge stashes for issues closed as "won't fix", "duplicate", or "cancelled". Two additional should-fix issues (env var zero handling, review-temp regex inconsistency) and 1 performance warning (O(N) subprocess rescans in janitor drop path) also require attention before this can merge.

## Blockers (MUST fix before merge)

### 1. `reconcileAndCheckIfMerged` treats tracker "closed" as "merged" for non-GitHub trackers — `src/lib/cloister/deacon.ts:~2410` — `⊗`
**Raised by**: correctness
**Why it blocks**: For Linear/GitLab/Rally, any closed issue (including "won't fix", "duplicate", "cancelled") is treated as merged, causing the janitor to drop pre-merge safety stashes for issues that were never actually merged — irreversible data loss of uncommitted work.

The function checks `tracker.getIssue(issueId).state === 'closed'` which is only sufficient for GitHub (where `prState.merged` is checked first). For other trackers, closed = merged is wrong.

**Fix**: Check for a merged PR or branch existence before treating non-GitHub tracker issues as merged. Expose a merge-specific field from the tracker abstraction (e.g., `issue.merged` or `issue.closedReason`), or gate the close-as-merged logic on tracker type (GitHub-only).

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. `PAN_STASH_JANITOR_CYCLES` env var silently ignores `0` — `src/lib/cloister/config.ts:~391` — `!`
**Raised by**: correctness
**Why it blocks**: The YAML config correctly accepts `stash_janitor_every_cycles: 0` to disable the janitor (sets interval to Infinity), but the env var override uses `parsed > 0`, silently ignoring `PAN_STASH_JANITOR_CYCLES=0`. This inconsistency means a user cannot disable the janitor via env var.

**Fix**: Change `parsed > 0` to `parsed >= 0` in config.ts line ~391 to match config file behavior.

### 2. `review-temp` regex uses `\w+-\d+` instead of `ISSUE_ID_PATTERN` — `src/lib/stashes.ts:97` — `!`
**Raised by**: correctness
**Why it blocks**: The `review-temp` parser accepts lowercase issue IDs (e.g., `pan-879`) while all other stash kinds use the stricter uppercase-only `ISSUE_ID_PATTERN`. This latent inconsistency means messages constructed outside `buildStashMessage` would parse differently across stash types.

**Fix**: Use `ISSUE_ID_PATTERN` in the review-temp regex:
```typescript
const reviewTempMatch = new RegExp(`^review-temp:${ISSUE_ID_PATTERN}:(\\d+)$`).exec(message);
```

### 3. Janitor does O(N) repeated `listStashes` rescans while dropping N stashes — `src/lib/cloister/deacon.ts:2569` — `~`
**Raised by**: performance
**Why it blocks**: `dropStash()` calls `resolveStashOperationRef()`, which re-invokes `listStashes()` to map SHA→stackRef for every stash being dropped. Dropping N stashes costs 1 initial scan + N rescans + N drops = O(N) extra subprocess calls.

**Fix**: Use the already-known `stackRef` when available, or add a batch drop path that operates on precomputed ordered stash entries directly. The `listStashes` result already contains `stackRef` for each entry — pass it through instead of re-resolving by SHA.

## Nits (advisory — safe to defer)

- `src/lib/stashes.ts:177–205` — `~` — TOCTOU in `resolveStashOperationRef`. Race window between resolve and operation is acknowledged in code comments. Acceptable since deacon is the only automated stash operator per workspace. (correctness)
- `src/lib/cloister/review-agent.ts:~1041` — `~` — `cleanupReviewTempStash` in finally block silently swallows errors. Orphaned stash persists until janitor age-based sweep (28 days). Acceptable as safety net. (correctness)
- `src/lib/cloister/deacon.ts:~2470` — `~` — `cleanupSpawnAndOrphanedStashes` mutates `getAgentState()` result in place before `saveAgentState`. If save fails, in-memory state is already mutated. Established pattern, not a regression. (correctness)
- `src/lib/stashes.ts:~1230` — `?` — Recover/delete endpoints rescan stash list twice per action (performance optimization). Minor at small stash counts. (performance)
- `src/lib/cloister/deacon.ts:~2495` — `?` — `listStashes` called per-workspace in a loop. Bounded by janitor cycle cadence (~hourly). Not a correctness issue. (correctness)

## Cross-cutting groups

**Janitor stash lifecycle** (related by shared drop/list machinery):
- [blocker-1] C1: `reconcileAndCheckIfMerged` false positive for non-GitHub trackers causes premature stash drops
- [high-3] Performance warning: O(N) rescans in janitor drop path (same `resolveStashOperationRef` call chain)

**Configuration consistency** (shared root cause: env var vs YAML config file handling):
- [high-1] C2: `PAN_STASH_JANITOR_CYCLES=0` silently ignored
- [high-2] C3: `review-temp` regex inconsistency vs other stash kinds

## What's good
- All 12 requirements from PAN-879 are implemented; requirements coverage is complete with zero missing or partial items.
- Canonical stash taxonomy design (canonical prefix format, stable SHA refs, kind-based lifecycle rules) is well-structured and consistent across all four stash types.
- Test coverage is thorough across canonical format parsing, janitor age cutoff, salvageable preservation, and all drop-on-completion paths.
- Security review found zero issues — no injection, authz, data exposure, or unsafe command execution risks introduced.

## Review stats
- Blockers: 1   High: 3   Medium: 0   Nits: 5
- By reviewer: correctness=10, security=0, performance=2, requirements=0
- Files touched: 20   Files with findings: 7

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the Synthesis Context above. Those files contain full per-reviewer detail; this synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-879 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

