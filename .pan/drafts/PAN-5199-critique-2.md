plan-digest: e0822ec41c1008ba6297b1d340e61c2ac4c98fa3b48e3047f5669b2efff991e2

## blocks-the-design: Tracked sync paths still pass the start gate

FR-6 and WI-6 say every tracked or staged sync-path change is refused. WI-1 defines `.pan/review/`, `.pan/test/`, `.pan/prompts/`, and `.pan/events/` as sync paths, but the proposed predicate accepts `isOverdeckWorkspaceRuntimePath(path)` before checking status. In `src/lib/state-plane.ts:86-90`, that predicate accepts every `.pan/` path regardless of status. Thus ` M .pan/review/x.md` and `A  .pan/test/x.md` still pass with `{ polyrepoWrapper: true }`. The current start gate in `src/dashboard/server/routes/agents/spawn-issue.ts:104-106` has the same blanket runtime behavior, which the plan preserves. Make the polyrepo sync-path status check take precedence over the runtime allowance, or explicitly narrow FR-6 to exclude those overlapping `.pan/` paths and add tests for the chosen boundary.

## blocks-the-design: Existing exact-command test will fail

WI-4 changes `commitPolyrepoWorkspaceGitignoreAsync` to run `git diff --cached --quiet -- .gitignore` and `git commit -m "chore(workspace): add polyrepo scaffold .gitignore" -- .gitignore`. The existing `src/lib/workspace-manager/__tests__/create-polyrepo-gitignore.test.ts:163-165` asserts that the mock received the old, unscoped commands with `toContain`, which compares strings exactly. WI-4 scopes only the new heal test file and never updates these assertions, while the PRD requires touched tests to pass. Update the two exact command expectations in the existing test during WI-4 and include that file in the item's files and verification.
