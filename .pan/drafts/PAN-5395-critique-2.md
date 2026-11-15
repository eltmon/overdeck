plan-digest: 0a8c224e67b0c83aa7d30bc3799bceae074463716dd94c0d51aaf19dd5142015

## blocks-the-design: Workspace creation still dirties the primary checkout

The PRD's FR-5 (`.pan/drafts/PAN-5395.md`, line 69) requires the primary checkout's `git status` to stay unchanged, and WI-4 (line 285) says the primary checkout is untouched. But `createWorkspace` still calls `ensurePanGitignore(projectConfig.path)` at `src/lib/workspace-manager/create.ts:344-350`, after the proposed insertion point. `ensurePanGitignore` writes `<project>/.gitignore` whenever any of its five entries are absent (`src/lib/workspace-manager/migration.ts:205-224`). In a single-repo project with a tracked `.gitignore` lacking those entries, creating the worktree will still modify the primary checkout, even though the new worktree exclude itself is private. The smallest resolution is to reconcile the existing `ensurePanGitignore` call with FR-5: keep it from editing the primary checkout on this path, or explicitly narrow FR-5 and the user docs to the new helper's effects if primary-checkout edits remain intended.

## sharpens-framing: The skills pattern hides project-created files

WI-1 calls the seven patterns “exact files” and says a project's own `.claude/` files stay visible (`.pan/drafts/PAN-5395.md:103-119`). One pattern is `/.claude/skills/`, which hides every new file below that directory, including a project-created `.claude/skills/my-skill/SKILL.md`. `mergeSkillsIntoWorkspace` also populates that directory (`src/lib/skills-merge.ts:82-115`), so the broad pattern may be intentional. State this directory-wide behavior in the accepted trade-off and user docs, and mention `git add -f` for project-created skills there; otherwise an implementer or user may assume only Overdeck's copied skills are hidden.

## sharpens-framing: The route test does not verify start-time wiring

The proposed `agents-spawn-sync-exclude.test.ts` calls `ensureWorkspaceSyncExclude` directly and then calls the exported predicate (`.pan/drafts/PAN-5395.md:192-201`). That proves the helper's effect on porcelain but never exercises the planned call in `spawnIssueAgentForRoute` (`src/dashboard/server/routes/agents/spawn-issue.ts:684-709`). WI-3 has no test that would fail if the helper were omitted or moved after `git status`; its acceptance check relies on reviewing the source. Add a focused test for the route's helper-before-status ordering, or make that ordering an explicit mechanical verification step rather than describing the predicate test as route-level coverage.
