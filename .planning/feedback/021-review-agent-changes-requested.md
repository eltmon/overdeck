---
specialist: review-agent
issueId: PAN-936
outcome: changes-requested
timestamp: 2026-05-04T04:18:57Z
---

# Verdict: CHANGES_REQUESTED

## Summary
This PR delivers most of PAN-936’s Rally feature-planning UX and pipeline work, including feature-aware planning, feature actions in the dashboard, and Rally child-issue retrieval, but it still misses one explicit requirement: child-story workspaces are not being populated from the parent feature workspace’s vBRIEF narratives and dependency context before work-agent startup. In addition, there is still a reachable CommandDeck crash when `/api/registered-projects` returns non-array JSON, plus two performance issues on repeatedly exercised paths. The missing story-workspace feature-context flow must be implemented before merge; the high-priority correctness and performance issues should be fixed in the same pass.

## Blockers (MUST fix before merge)

### 1. Story workspaces do not receive parent feature vBRIEF context — `src/lib/planning/spawn-planning-session.ts:286` — `!`
**Raised by**: requirements
**Why it blocks**: The issue’s acceptance criteria explicitly require story workspaces to write `.planning/FEATURE-CONTEXT.md` from the parent feature workspace’s `plan.vbrief.json`, including narrative decisions and cross-story dependency notes, and that end-to-end path is still missing.

Implement the story-workspace generation path, not just the feature-planning writer: detect when a spawned story belongs to a Rally Feature, load `workspaces/feature-<featureId>/.planning/plan.vbrief.json`, extract the parent feature’s narratives and dependency context, write the synthesized `.planning/FEATURE-CONTEXT.md` into the story workspace, and add an end-to-end test that exercises the story-workspace/work-agent prompt path.

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. CommandDeck still crashes on non-array registered-project payloads — `src/dashboard/frontend/src/components/CommandDeck/index.tsx:92` — `~`
**Raised by**: correctness
Validate or coerce the `/api/registered-projects` response in `fetchRegisteredProjects()` before caching it in React Query, or guard the `for (const rp of registeredProjects)` iteration with the same `Array.isArray(...)` check already used earlier in the memoized partitioning path.

### 2. InspectorPanel adds a stash-fetch waterfall on its polling path — `src/dashboard/frontend/src/components/InspectorPanel.tsx:187` — `~`
**Raised by**: performance
Stop serializing `/api/workspaces/:issueId/stashes` behind every `/api/workspaces/:issueId` poll. Either include salvageable stashes in the main workspace payload or split stashes into a separate query so the main workspace poll can resolve independently.

### 3. Work-agent startup scans sibling workspaces for feature context — `src/lib/cloister/work-agent-prompt.ts:276` — `~`
**Raised by**: performance
Replace the sibling-workspace scan with a deterministic lookup keyed by the current story’s parent feature, ideally using an explicit path or identifier created during planning so feature-context resolution stays O(1) at startup.

## Nits (advisory — safe to defer)

- `src/dashboard/server/routes/issues.ts:600` — `?` — Rally child-story status is mapped from a nonexistent field. Translate `Issue.state` or `rawState` into the exported `status` field before building planning child-story context. (correctness)
- `src/lib/beads-query.ts:19` — `?` — JSONL bead fallback still scans the full file. Keep it if this path is rare, but consider indexing or narrowing the fallback if `bd` is often unavailable. (performance)

## Cross-cutting groups

**Feature-context pipeline gaps** (related findings that share a root cause — fix together):
- [blocker-1] Story workspaces do not receive parent feature vBRIEF context
- [high-3] Work-agent startup scans sibling workspaces for feature context
- [nit-1] Rally child-story status is mapped from a nonexistent field

**Repeated query-path overhead** (network/filesystem work on frequently exercised paths):
- [high-2] InspectorPanel adds a stash-fetch waterfall on its polling path
- [nit-2] JSONL bead fallback still scans the full file

## What's good
- The Rally tracker work appears to move in the right direction overall: `getChildIssues()` is implemented, normalized, and covered by targeted tests.
- The dashboard feature UX changes are broadly in place, with the requirements reviewer confirming the feature action bar, selection behavior, and feature-specific Inspector actions.

## Review stats
- Blockers: 1   High: 3   Medium: 0   Nits: 2
- By reviewer: correctness=2, security=0, performance=2, requirements=1
- Files touched: 69   Files with findings: 6

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the Synthesis Context above. Those files contain full per-reviewer detail; this synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-936 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

