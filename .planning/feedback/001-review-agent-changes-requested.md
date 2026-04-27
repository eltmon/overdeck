---
specialist: review-agent
issueId: PAN-879
outcome: changes-requested
timestamp: 2026-04-27T10:18:55Z
---

# Verdict: CHANGES_REQUESTED

## Summary

PAN-879 implements a canonical stash lifecycle management system across merge-agent, spawn-agent, review-agent, and the deacon janitor. 11 of 12 requirements are fully implemented with 96 passing tests across 5 test files. The PR introduces a new `stashes.ts` canonical module, salvageable stash UI in InspectorPanel, and workspace stash endpoints. However, REQ-12 (janitor cadence must be externally configurable) is only partially implemented — the hard-coded default exists but no config surface, env mapping, or persistence path is present to allow operators to override it. This must be addressed before merge.

## Blockers (MUST fix before merge)

### 1. REQ-12: Janitor cadence is not externally configurable — `src/lib/cloister/deacon.ts:63` — `~`

**Raised by**: requirements

**Why it blocks**: The issue requires the janitor patrol cycle to be "configurable, default once per hour." The hard-coded default `stashJanitorEveryCycles: 60` exists and is used correctly, but there is no evidence of any config loading, env mapping, or persistence mechanism that would allow an operator to change this value. A hard-coded constant is not a configurable knob.

<fix instruction>: Wire `stashJanitorEveryCycles` into the existing Cloister config loading path used by the deacon at `src/lib/cloister/deacon.ts:3256`. The deacon already reads `config.stashJanitorEveryCycles` — add the corresponding entry to the config schema, env var mapping (e.g. `PAN_STASH_JANITOR_CYCLES`), or `projects.yaml` override path so operators can actually change the cadence without a code change.

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. [deacon.ts:cleanupSpawnAndOrphanedStashes] Single try-catch conflates error sources from git rev-list and dropStash — `src/lib/cloister/deacon.ts` — `~`

**Raised by**: correctness

<fix instruction>: Separate the try-catch blocks so that a `git rev-list` failure (e.g., no `origin/main` remote, detached HEAD) does not fall into the `dropStash`-specific "not found" filter. First try-catch handles the git check and sets `hasCommitsAhead`, then a second try-catch handles `dropStash`. This prevents a coincidental "not found" in a future git error message from prematurely clearing `agentState.preSpawnStashRef`.

### 2. [deacon.ts:isIssueAlreadyMergedForJanitor] Predicate-named function mutates review status as hidden side effect — `src/lib/cloister/deacon.ts` — `~`

**Raised by**: correctness

<fix instruction>: Rename to `reconcileAndCheckIfMerged` or split into a read-only `checkIfMerged` + explicit `reconcileMergeStatus` call so the mutation is not a hidden side effect of a predicate-named function.

### 3. [deacon.ts:cleanupSpawnAndOrphanedStashes] Repeated O(k) GitHub/tracker reconciliation per workspace — `src/lib/cloister/deacon.ts:2507` — `~`

**Raised by**: performance

<fix instruction>: Hoist `isIssueAlreadyMergedForJanitor(issueId)` out of the inner stash loop so it is called once per issue per workspace instead of once per matching pre-merge stash. First filter the matching stashes, then call the reconciliation once, then push all matches if merged.

## Nits (advisory — safe to defer)

- `src/lib/stashes.ts:147` — `?` — Substring match (`includes`) for stash ref lookup could use exact match (`===`) or prefix match (`startsWith`) for more precision. Low risk with canonical stash names but eliminates an edge case on rapid consecutive stashes. (correctness)

- `src/dashboard/server/main.ts:202` — `?` — Startup stash audit (`logNonCanonicalStashesOnStartup`) scales linearly with workspace count. If cold-start latency becomes noticeable at scale, defer the audit to a background task after the server begins accepting requests. (performance)

- `src/lib/cloister/deacon.ts` — `?` — The `isOlderThanDays(stash, 28, now)` hard-codes 28 days as the "4 weeks" threshold. Consider extracting to a named constant at the top of the file for discoverability and easy adjustment. (correctness)

## Cross-cutting groups

**Error handling in `cleanupSpawnAndOrphanedStashes`** (related findings that share a root cause — fix together):
- [high-1] try-catch conflates git rev-list and dropStash error sources
- [high-3] repeated GitHub/tracker reconciliation inside stash loop
- [nit-3] hard-coded 28-day threshold not extracted to constant

All three live in `deacon.ts` in or near `cleanupSpawnAndOrphanedStashes`. Fixing the try-catch structure will naturally surface the other two.

## What's good

- Canonical stash naming (`pre-merge:`, `pre-spawn:`, `review-temp:`, `salvageable:`) implemented consistently across all four lifecycle flows with centralized `buildStashMessage` and `createNamedStash` helpers.
- 96 tests passing across 5 test files with good coverage of success, rollback, and cleanup paths.
- `salvageable:*` stashes are correctly protected from janitor auto-cleanup (REQ-7) and surfaced in the InspectorPanel with Recover/Dismiss actions.
- Security review found no injection, auth bypass, path traversal, XSS, or secrets exposure issues in the new endpoints.
- `postMergeLifecycle` Docker cleanup preserved (not touched by this PR, correctly).

## Review stats

- Blockers: 1   High: 3   Medium: 0   Nits: 3
- By reviewer: correctness=3, security=0, performance=2, requirements=1
- Files touched: 17   Files with findings: 6

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the Synthesis Context above. Those files contain full per-reviewer detail; this synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-879 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

