---
specialist: review-agent
issueId: PAN-879
outcome: approved
timestamp: 2026-04-27T15:36:40Z
---

# Verdict: APPROVED

## Summary
PAN-879 implements a canonical stash taxonomy (pre-merge, pre-spawn, review-temp, salvageable) and an automated orphan janitor in the Deacon patrol cycle. All 12 requirements are implemented and verified by the requirements reviewer. The security reviewer found no vulnerabilities. The implementation is well-structured with 926+ new test lines across 5 test files. One high-priority correctness finding (GitHub tracker fallback false-positive for closed issues) and two performance optimizations are advisory — the primary merge-detection path is correct and the janitor's mitigations are proportional to the race-condition risk. The PR is safe to merge.

## Blockers (MUST fix before merge)

_none_

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. GitHub tracker fallback treats "closed" issue as "merged" — `src/lib/cloister/deacon.ts:~2480` — `~`
**Raised by**: correctness
**Why it blocks**: The `reconcileAndCheckIfMerged` fallback for GitHub projects checks `issue.state === 'closed'` to set `mergeStatus: 'merged'`, but GitHub issues can be closed without being merged (e.g., "closed as not planned", duplicate, manual close). This false positive would cause the janitor to prematurely drop a pre-merge stash for a closed-but-not-merged GitHub issue.

The primary detection path (review status `mergeStatus === 'merged'` + GitHub App PR check) is correct — this is only a last-resort fallback when both the review status and PR URL are absent. Blast radius is low: dropped stashes survive 90 days in git reflog. However, the correctness defect is real and SHOULD be fixed before this fallback ever fires.

**Fix:** Skip the GitHub tracker fallback entirely (lines 2426–2429), relying only on the GitHub App PR path above it. Alternatively, check the issue's `closed_at_reason` via the GitHub API to distinguish "merged" closes from other closes.

## Nits (advisory — safe to defer)

- `src/lib/cloister/deacon.ts:~2420` — `~` — No lock between stash list and drop operations in `cleanupSpawnAndOrphanedStashes`. Mitigated by descending stack-index drop order, SHA re-verification before each drop, and per-workspace serialization documented in CLAUDE.md. Risk is low; proportional to the maintenance cadences already in place. (correctness)
- `src/dashboard/frontend/src/components/InspectorPanel.tsx:186` + `src/dashboard/server/routes/workspaces.ts:1196` — `~` — Polling `/api/workspaces/:issueId/stashes` every 60 seconds spawns a new `git stash list` process per open inspector tab. Cost is O(total stashes in repo), not O(salvageable stashes for the issue). Admin-only UI; low blast radius. Consider event-driven invalidation or a brief in-process cache. (performance)
- `src/dashboard/server/routes/workspaces.ts:1230,1264` + `src/lib/stashes.ts:186` — `≉` — recover and delete paths call `listStashes()` then pass only `stash.ref` to `createRecoveryBranchFromStash()` / `dropStash()`, which re-scans via `resolveStashOperationRef`. Thread `stash.stackRef` through from the route handler so the action operates directly on the already-resolved slot (2 scans → 1 per request). (performance)
- `src/lib/cloister/review-agent.ts:115` — `?` — `ensureReviewTempStash` scans all stashes to compute the next sequence. Minor optimization: persist last used sequence in review status and increment instead of rescanning. (performance)
- `src/lib/cloister/review-agent.ts:~110` — `?` — `cleanupReviewTempStash` re-throws non-"not found" errors, leaving stash metadata in review status for future retries. Consider logging and swallowing all errors since stash metadata is cleared on success and the stash itself is low-value. (correctness)
- `src/dashboard/server/routes/workspaces.ts:~315` — `?` — `requireTrustedMutationOrigin` returns 403 without Origin/Referer headers, blocking API-only clients. Consistent with dashboard-only deployment but worth documenting for future API consumers. (correctness)
- `src/lib/agents.ts:~965` — `?` — `spawnAgent` reads `existingState` for pre-spawn field carry-forward; adding more persistent fields requires updating this pattern. Consider a `mergeExistingState` helper to make the contract explicit. (correctness)

## Cross-cutting groups

**Stash double-scan on mutation paths** (fix together):
- [nit-3] recover/delete double-scan in workspaces.ts:1230,1264
- [nit-4] review-temp sequence double-scan in review-agent.ts:115

Root cause: `resolveStashOperationRef` always re-scans to recover `stackRef` when given a SHA-backed ref. Threading `stash.stackRef` from the route through to the stash action functions would eliminate both redundant scans in a single pass.

**GitHub closed-check false positive** (single fix):
- [high-1] deacon.ts GitHub tracker fallback (lines 2426–2429)

Root cause: using `issue.state === 'closed'` as a merge proxy for GitHub issues, without distinguishing merged closes from other close reasons. Fix by removing this fallback or checking `closed_at_reason`.

## What's good
- All 12 PAN-879 requirements implemented and verified by requirements reviewer
- 926+ new test lines across 5 test files covering format compliance, age cutoff, salvageable preservation, and drop-on-completion paths
- `resolveStashOperationRef` in `stashes.ts` correctly re-validates SHA before every destructive operation, preventing wrong-stash drops
- `validateIssueId` prevents injection in stash messages (rejects `PAN-879; rm -rf /`)
- Security reviewer found no vulnerabilities; CSRF protection preserved on all stash mutation endpoints
- Canonical stash naming enforced through a single `buildStashMessage` helper — `src/lib/stashes.ts:173` is the only `git stash push` implementation path
- Merge-agent behavioral change: pre-merge stashes are now **dropped** (not popped) on completion, aligning with CLAUDE.md stash hygiene rules

## Review stats
- Blockers: 0   High: 1   Medium: 0   Nits: 6
- By reviewer: correctness=5, security=0, performance=3, requirements=0 (0 blockers in requirements)
- Files touched: 21   Files with findings: 7

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the Synthesis Context above. Those files contain full per-reviewer detail; this synthesis is the policy layer.

## ✅ CODE APPROVED — YOUR WORK IS COMPLETE

**Do NOT make any more changes.**
**Do NOT run `pan done` again.**
**Do NOT run `pan review request`.**

The specialist pipeline will now run tests. If tests pass, the issue enters the merge queue for human approval.

