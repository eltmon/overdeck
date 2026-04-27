---
specialist: review-agent
issueId: PAN-866
outcome: changes-requested
timestamp: 2026-04-27T09:17:59Z
---

# Verdict: CHANGES_REQUESTED

## Summary
PAN-866 ("Zone C-2: markdown / activity / costs / PR-diff / discussions tabs") is incompletely implemented. The PR delivers Activity tab (with a critical cross-issue data exposure), Costs tab, and two workspace markdown endpoints (state-md, inference-md), but the requirements explicitly call for all 9 tabs. Beads, PR/Diff (file-tree + hunks), and Discussions (Linear + GitHub merge) are entirely absent from the diff. The Activity tab additionally introduces a blocker-level access control regression: it renders the global God View feed instead of the issue-scoped feed, exposing cross-issue messages to any user with issue-tab access. All 4 missing requirements must be implemented before this PR can merge.

## Blockers (MUST fix before merge)

### 1. Cross-issue activity data exposure — `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverviewTabs/ActivityTab.tsx:12` — `!`
**Raised by**: security, performance
**Why it blocks**: The Activity tab renders `<ActivityFeed />` which reads the unfiltered global `recentActivity` store via `selectGodViewActivityFeed`. Any user who opens an issue Activity tab can see activity events from unrelated issues/workspaces — commit summaries, prompts, branch names, internal URLs, and secrets appearing in activity messages cross into the wrong issue context. This is a broken access control regression from the previous issue-scoped `ActivityView`.

<fix instruction — what to change, concrete and scoped>
Restore issue scoping: replace `<ActivityFeed />` with the issue-scoped `<ActivityView issueId={issueId} issues={issues ? [...issues] : undefined} featureData={featureData} />` that this PR replaced, OR introduce a new selector/API that filters `recentActivity` by `issueId` before rendering. Do not surface the global feed in an issue-scoped tab.

### 2. All 9 tabs not evidenced in the diff — PR file list — `!`
**Raised by**: requirements
**Why it blocks**: The acceptance criterion explicitly states "All 9 tabs render their respective content." The issue #866 scope lists: Activity, Costs, PRD, STATE.md, INFERENCE.md, vBRIEF, Beads, PR/Diff, and Discussions. The diff only contains Activity, Costs, PRD (empty state only), and the markdown endpoints. Four tabs (vBRIEF, Beads, PR/Diff, Discussions) have no implementation changes in the PR at all.

<fix instruction — what to change, concrete and scoped>
Implement all remaining tabs (vBRIEF, Beads, PR/Diff with file-tree + hunk rendering, Discussions with chronological Linear + GitHub merge) before signaling completion. Partial delivery of a feature provides zero value per CLAUDE.md § "Deliver Complete Features."

### 3. Beads tab endpoint usage not implemented — PR file list — `!`
**Raised by**: requirements
**Why it blocks**: REQ-9 explicitly requires "Beads tab uses existing `/api/issues/:id/beads` (no duplicate endpoint)." No BeadsTab implementation or endpoint-usage change appears in the PR diff. This is a MUST requirement for the issue.

<fix instruction — what to change, concrete and scoped>
Implement the Beads tab consuming the existing `/api/issues/:id/beads` endpoint. Show the tab rendering task beads and wiring to the endpoint.

### 4. PR/Diff file-tree + hunk rendering not implemented — PR file list — `!`
**Raised by**: requirements
**Why it blocks**: REQ-10 explicitly requires "PR / Diff tab renders file-tree + hunks; handles 'no PR yet' state." The changed test only covers the empty state path. No `PrDiffTab` implementation for file-tree or hunk rendering exists in the diff.

<fix instruction — what to change, concrete and scoped>
Implement the PR/Diff tab with file-tree + diff hunk rendering wired to the existing GitHub API. Include the "no PR yet" empty state. Full rendering per the acceptance criterion, not just the empty-state placeholder.

### 5. Discussions chronological merge not implemented — PR file list — `!`
**Raised by**: requirements
**Why it blocks**: REQ-11 explicitly requires "Discussions merges Linear + GitHub comments chronologically." No `DiscussionsTab` or discussions backend implementation changes appear in the PR diff.

<fix instruction — what to change, concrete and scoped>
Implement the Discussions tab merging Linear and GitHub comments into a single chronological timeline. Include both data sources and the chronological ordering.

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. Dead type-narrowing branch in custom `execAsync` — `src/lib/cloister/specialist-context.ts:27-35` — `~`
**Raised by**: correctness
<fix instruction>
Remove the dead `typeof stdoutOrResult === 'object'` branch. With `encoding: 'utf-8'` (always passed at call site), `exec` callback provides strings only — the object branch is unreachable. Simplify to string-typed resolution or restore `promisify(exec)`.

### 2. Per-tab live polling adds duplicate `/api/costs/stream` traffic — `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverviewTabs/CostsTab.tsx:153` — `~`
**Raised by**: performance
<fix instruction>
Each mounted Costs tab starts its own 5s poller to `/api/costs/stream`. Use a single stable query key (move `lastFetchTime` out of the key) or hoist the live stream to a shared provider/store so one poller serves all tabs, avoiding multiplied request traffic when multiple issue workbenches are open.

### 3. Issue tab re-renders on all global activity events — `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverviewTabs/ActivityTab.tsx:12` — `~`
**Raised by**: performance
<fix instruction>
Same root cause as blocker #1. Filter the feed by `issueId` before rendering, or restore an issue-scoped selector/view. If a global feed is intentional, memoize and cap the rendered subset so unrelated system events do not fan out through every mounted issue panel.

## Nits (advisory — safe to defer)

- `src/dashboard/server/routes/workspaces.ts:105` — `?` — `readWorkspacePlanningMarkdown` silently returns 404 on empty `issueId`. Consider an early 400 validation for empty `issueId` to avoid unnecessary filesystem access and return a more accurate status code. (correctness)
- `src/lib/cloister/specialist-handoff-logger.ts:158` — `?` — `getSpecialistHandoffStats(options?.agentsDir)` accepts but never uses the `agentsDir` parameter. Remove the unused parameter to avoid misleading future callers. (correctness)
- `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverviewTabs/CostsTab.tsx:217` — `?` — Totals recomputed from already-aggregated rows on every render. Data already includes `cost.totalCost` and grouped maps are aggregate values — minor cleanup, safe to defer. (performance)
- `src/dashboard/frontend/src/components/GodView/ActivityFeed.tsx:29` — `?` — Best practice: treat God View components as global-by-default and require an explicit scoping adapter before embedding in issue/workspace views. Prevents future regressions. (security)

## Cross-cutting groups

**Activity tab root cause** (single change causes blocker + high findings — fix together):
- [blocker-1] Cross-issue activity data exposure (security — `!`)
- [high-3] Issue tab re-renders on all global activity events (performance — `~`)

## What's good
- Workspace markdown endpoints (`state-md`, `inference-md`) use async `fs/promises` correctly with proper 404 handling — no blocking calls introduced.
- Specialist handoff logger's JSONL corruption handling fix (`flatMap` with try/catch replacing unsafe `map`+`JSON.parse`) is solid correctness work.
- Costs tab correctly uses `useIssueCostStream` + `useIssueCostsQuery` composition.
- Specialist context test mocking improved by replacing `promisify(exec)` with explicit callback handling.

## Review stats
- Blockers: 5   High: 3   Medium: 0   Nits: 4
- By reviewer: correctness=3, security=2, performance=4, requirements=5
- Files touched: 13   Files with findings: 11

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the Synthesis Context above. Those files contain full per-reviewer detail; this synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-866 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

