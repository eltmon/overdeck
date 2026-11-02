plan-digest: fb14fabdea3acbe3069455e874f0a98486d73f3fd3574ff843195a2f84a73edb

## blocks-the-design: Negative index delays priority change

PRD D4 and FR-7 promise that a spec newly appearing in a higher-priority root replaces a fallback result on the next poll. The proposed W2b test makes `findXBriefByIssue` change its answer immediately, but the real index returns the cached negative result for five seconds: `src/lib/xbrief/xbrief-index.ts:26,129-136,158-167`. Not caching the fallback summary does not invalidate that root's negative index. If the next payload call occurs within five seconds, it still serves the fallback spec (or `planResolved: false`). Specify and test either invalidation of higher-priority negative entries when immediate pickup is required, or a bounded five-second delay instead of the next-poll guarantee.

## blocks-the-design: Malformed specs bypass the broken-spec rule

PRD D7 and W2b say a broken spec in the first root must stop the lookup, and the proposed test simulates `readXBriefDocument` rejecting a path returned by the index. In normal operation, `scanPanSpecs` drops files containing merge markers, invalid JSON, or an invalid status before indexing them (`src/lib/xbrief/xbrief-index.ts:60-84`); `findXBriefByIssue` then returns `null` (`src/lib/xbrief/xbrief-index.ts:158-167`). The proposed root loop treats that as absence and can show criteria from a lower-priority, older spec. Add a way to distinguish a matching but malformed spec from an absent spec before falling through, and test with an actual malformed file through the real index. If fallback on malformed specs is intended, revise D7 and the acceptance criterion explicitly.

## sharpens-framing: Workspace lookup exceeds the stated cost

NFR-1 claims at most two `existsSync` checks per member per poll. W2 calls `getWorkspaceInfoForIssue` for every member, and that resolver checks two candidate paths for each configured project, plus a fallback path (`src/dashboard/server/routes/workspaces.ts:390-405`), before `memberSpecRoots` performs its own existence checks. Revise NFR-1 to state the real per-project cost, or use a project-scoped path resolver if the two-check bound is required.

## sharpens-framing: Polyrepo batches may lack the plan home

PRD D1/D2 and AC-UAT assume the batch worktree contains the member's spec. Polyrepo assembly creates sub-repo worktrees only for repos named in feature contributions (`src/lib/cloister/uat-polyrepo-engine.ts:193-205,283-302,424-448`), while `resolvePlanHome` always targets the configured plan-home sub-repo (`src/lib/pan-dir/paths.ts:46-59`; `src/lib/projects.ts:882-903`). If that repo is not a contribution, the batch wrapper cannot hold its spec. The feature-workspace fallback may still work, but AC-UAT is too broad when that workspace is absent. State this condition in D2/AC-UAT and add a polyrepo test where the plan-home repo is missing from the batch.
