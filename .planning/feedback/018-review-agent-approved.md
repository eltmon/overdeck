---
specialist: review-agent
issueId: PAN-936
outcome: approved
timestamp: 2026-05-03T12:30:17Z
---

# Verdict: APPROVED

## Summary

PAN-936 adds Rally Feature planning support end-to-end: FeatureCard action bar with Plan/See Plan/vBRIEF/Tasks chips, click-to-select split for features and child stories, InspectorPanel feature actions (gated Plan button, hidden execution controls), the `getChildIssues` interface with Rally implementation, feature-aware planning prompt with Child Stories section and cross-story dependency edges, and FEATURE-CONTEXT.md injection for story work agents. Round 1 had six blockers; round 2 had one blocker and four high-priority items. The agent fixed all of them: both command injections switched to `execFileAsync`, `LiveLastHeardBadge` refactored to a shared `KanbanTickContext` (eliminating N independent timers), Rally `listIssues` and `updateIssue` optimized, InspectorPanel stash query merged into workspace query (5→4 polling streams), all test coverage gaps filled, and the DialogProvider mock restoration regression fixed. All 47 acceptance criteria across 15 vBRIEF items are complete. 166 tests pass with zero failures. Two high-priority follow-up items remain (sibling-scan precision in multi-feature scenarios, further InspectorPanel polling consolidation) and five nits. The PR is ready for merge.

## Blockers (MUST fix before merge)

_none_

---

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. `readFeatureContext` sibling fallback may inject wrong feature context — `work-agent-prompt.ts:284` — `~`
**Raised by**: correctness

The sibling-workspace fallback iterates `workspacesDir` in filesystem order and returns the **first** `FEATURE-CONTEXT.md` found in any `feature-*` workspace. If a project has two or more Rally Features being planned simultaneously (e.g. `feature-f1234` and `feature-f5678`), a story workspace for a child of `F1234` could receive `F5678`'s context if `feature-f5678` sorts alphabetically first.

**Fix**: When creating a story workspace that has a `parentRef`, copy the parent feature's `FEATURE-CONTEXT.md` into the story workspace's `.planning/` directory. This makes the file local and eliminates ambiguity. Alternatively, extract the story's `parentRef` and match against the workspace directory name (e.g. `feature-${parentRef.toLowerCase()}`) instead of scanning all feature workspaces.

**Why this is High Priority rather than Blocker**: This issue only manifests in the edge case of multiple simultaneous Rally Feature workspaces, which is not explicitly covered by the acceptance criteria. The requirements reviewer (AC authority) considers `feature-context-injection.ac1` fully implemented. The common case (single feature workspace) works correctly.

---

### 2. InspectorPanel still has 4 uncoordinated polling queries — `InspectorPanel.tsx:186` — `~`
**Raised by**: performance

Four separate `useQuery` hooks poll independently: workspace (with inline stashes) at 5s/30s, review-status at 15s, costData at 30s, and planningState at 30s. With 3 panels open, ~60 requests/minute hit the server. The stash query was merged into the workspace query (improvement from 5→4 streams), but the remaining queries are still uncoordinated.

**Fix**: Consolidate workspace state, review status, and containers into a single `/api/workspaces/:issueId/summary` endpoint, or lift all polling into one parent-level `useEffect` orchestrator that fires one batched request per cycle.

**Why this is High Priority rather than Blocker**: The InspectorPanel is opened on demand, not continuously rendered on the main dashboard view. It is not a hot path in the same sense as the kanban board. The agent already reduced polling from 5 to 4 streams by merging stash data inline.

---

## Nits (advisory — safe to defer)

- `spawn-planning-session.ts:236` — `?` — Over-escaped backticks: `\\\`blocks\\\`` in the template literal. The rendered markdown output is actually correct (backslash-escaped backticks render as inline code), but the source uses triple escaping where single escaping would suffice. (correctness)
- `rally-client.ts:178` — `?` — Cache key includes `apiKey.slice(-4)`; use a truncated hash instead of a key substring to avoid partial secret leakage in logs. (security)
- `vbrief/beads.ts:241` — `?` — Bead creation is serial; items at the same topo-depth could be parallelized (planning-time only, not hot path). (performance)
- `beads-query.ts:19` — `?` — `readBeadsFromJsonl` does a full linear scan; irrelevant at current JSONL sizes. (performance)
- `done-preflight.ts:114` — `?` — `readdirSync` in CLI-only code; defensive replacement with `await readdir()` would future-proof against server import. (performance)

---

## Cross-cutting groups

**Dashboard performance** (both affect request/render load; design together):
- [high-2] InspectorPanel polling consolidation

**Follow-up correctness** (related to workspace file handling):
- [high-1] `readFeatureContext` sibling-scan precision
- [nit-1] Over-escaped backticks in planning prompt

---

## What's good

- All round-1 blockers resolved: both command injections fixed with `execFileAsync`, timer batching applied, Rally over-fetch and re-query eliminated.
- All round-2 blockers and high-priority items resolved: ConversationPanel test regression fixed, shared `KanbanTickContext` eliminates N independent timers, stash query merged into workspace query, both test coverage gaps filled.
- `readFeatureContext` sibling-workspace fallback correctly delivers feature context to story agents in the common single-feature case.
- InspectorPanel Plan button status gate is present at `ActionsSection.tsx:334` with `issueStatus` prop wired from `InspectorPanel.tsx:1089`.
- 47 of 47 acceptance criteria are fully implemented — complete requirements coverage.
- 166 tests pass with zero failures: 129 frontend tests + 37 backend tests.
- `getChildIssues` is well-tested across Rally (with `parentRef` assertion), GitHub (empty array), and interface compliance.
- `writeFeatureContext` has dedicated test coverage verifying file creation, content, and no-op for non-PortfolioItem issues.
- Security posture is clean: no blockers, no warnings, only one advisory-level best-practice note.

---

## Review stats
- Blockers: 0   High: 2   Medium: 0   Nits: 5
- By reviewer: correctness=2, security=1, performance=4, requirements=0
- Files touched: 59   Files with findings: 7

---

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the Synthesis Context above. Those files contain full per-reviewer detail; this synthesis is the policy layer.

---

## ✅ CODE APPROVED — YOUR WORK IS COMPLETE

**Do NOT make any more changes.**
**Do NOT run `pan done` again.**
**Do NOT run `pan review request`.**

The specialist pipeline will now run tests. If tests pass, the issue enters the merge queue for human approval.

