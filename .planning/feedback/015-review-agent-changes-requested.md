---
specialist: review-agent
issueId: PAN-946
outcome: changes-requested
timestamp: 2026-05-04T02:45:13Z
---

# Verdict: CHANGES_REQUESTED

## Summary
This PR implements the PAN-946 vBRIEF lifecycle and continue-state migration, but it cannot merge yet because it misses explicit CLI requirements for `pan scope list` and `pan scope show`, and it routes workspace/server mutations through lifecycle lookups that can write archived state or block the dashboard event loop with synchronous filesystem scans. To move forward, finish the missing scope command behavior, separate workspace-scoped plan/continue writes from lifecycle lookups, and convert the server-reachable lifecycle/continue-state path to async, indexed I/O.

## Blockers (MUST fix before merge)

### 1. `pan scope list` does not satisfy the required coverage and output contract — `src/cli/commands/scope.ts:56` — `!`
**Raised by**: requirements
**Why it blocks**: Missing explicit acceptance criteria is a merge blocker by policy.

Update `listCommand(...)` so it enumerates vBRIEFs across all registered projects and lifecycle directories, includes in-flight worktree plans that have not landed on main, and renders the required table fields including issue ID, title, plan status, lifecycle dir, and created date.

### 2. `pan scope show` omits required plan and continue-state details — `src/cli/commands/scope.ts:102` — `!`
**Raised by**: requirements
**Why it blocks**: The command resolves the issue but does not deliver the required output surface, so the feature is incomplete.

Expand `showCommand(...)` to display item-level completion details, narratives, and a continue-state summary including the last session plus decisions and hazards counts when a continue file exists.

### 3. Workspace-scoped plan mutations can hit lifecycle copies, including archived plans — `src/lib/vbrief/io.ts:23` — `~`
**Raised by**: correctness
**Why it blocks**: This high-severity correctness issue can make workspace status updates mutate `vbrief/active`, `vbrief/completed`, or `vbrief/cancelled` instead of the workspace plan, corrupting the lifecycle model.

Split workspace-only plan resolution from lifecycle lookup. `readWorkspacePlan()`, `updateItemStatus()`, `updateSubItemStatus()`, and bead/readiness flows should resolve only `.planning/plan.vbrief.json`, while dashboard/read-only lifecycle lookups use a separate resolver.

### 4. Continue-state breadcrumbs are always written to `vbrief/active/` instead of the canonical lifecycle location — `src/dashboard/server/routes/agents.ts:1811` — `~`
**Raised by**: correctness
**Why it blocks**: After transition to completed or cancelled, breadcrumb writes fork session history by creating a new active continue file instead of appending beside the moved vBRIEF.

Centralize continue-state appends behind a helper that resolves the current vBRIEF first and writes beside it, and update all current hard-coded `resolveVBriefDir(projectPath, 'active')` write paths to use that helper.

### 5. Dashboard request paths now block the event loop with synchronous lifecycle and continue-state filesystem work — `src/lib/vbrief/lifecycle-io.ts:54` — `!`
**Raised by**: performance
**Why it blocks**: These synchronous scans and JSON reads are on server hot paths such as `/api/issues`, `/api/workspaces/:issueId/plan`, and planning-status routes, violating the project rule against blocking calls in dashboard server code.

Move server-reachable lifecycle and continue-state resolution to async filesystem APIs, stop rescanning lifecycle directories per request, and introduce a shared issue→vBRIEF index or cache that routes and `IssueDataService` can query in O(1).

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. Repeated lifecycle lookup work compounds across endpoints and helpers — `src/dashboard/server/routes/workspaces.ts:1280` — `~`
**Raised by**: performance
Avoid duplicate lifecycle scans by passing resolved paths through the call chain and reusing one shared lookup/index for both plan and continue-state resolution.

## Nits (advisory — safe to defer)

- `tests/lib/reopen.test.ts:91` — `?` — Reopen tests do not cover completed/cancelled continue files. Add a regression test that seeds lifecycle continue files and asserts reopen appends to the canonical file. (correctness)

## Cross-cutting groups

**Lifecycle resolution must distinguish read-only discovery from mutable workspace state** (fix these together):
- [blocker-3] Workspace-scoped plan mutations can hit lifecycle copies, including archived plans
- [blocker-4] Continue-state breadcrumbs are always written to `vbrief/active/` instead of the canonical lifecycle location
- [high-1] Repeated lifecycle lookup work compounds across endpoints and helpers

**Server lifecycle access must be async and indexed** (fix these together):
- [blocker-5] Dashboard request paths now block the event loop with synchronous lifecycle and continue-state filesystem work
- [high-1] Repeated lifecycle lookup work compounds across endpoints and helpers

**Scope CLI feature is marked complete but not delivered** (fix these together):
- [blocker-1] `pan scope list` does not satisfy the required coverage and output contract
- [blocker-2] `pan scope show` omits required plan and continue-state details

## What's good
- The lifecycle foundation itself is broadly in place: canonical filenames, lifecycle directories, continue-state files, and transition helpers are implemented.
- The security review found no confirmed new vulnerabilities in the changed surface.

## Review stats
- Blockers: 5   High: 1   Medium: 0   Nits: 1
- By reviewer: correctness=3, security=0, performance=2, requirements=2
- Files touched: 105   Files with findings: 6

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the
Synthesis Context above. Those files contain full per-reviewer detail; this
synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-946 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

