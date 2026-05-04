---
specialist: review-agent
issueId: PAN-936
outcome: changes-requested
timestamp: 2026-05-03T12:03:46Z
---

# Verdict: CHANGES_REQUESTED

## Summary

PAN-936 adds Rally Feature planning support end-to-end: FeatureCard action bar, click-to-select for features and child stories, InspectorPanel feature actions, the `getChildIssues` interface and Rally implementation, feature-aware planning prompt with child story section, and FEATURE-CONTEXT.md injection for story work agents. Round 1 had six blockers; the agent fixed four completely (both command injections, timer batching, Rally over-fetch, Rally re-query, plus test/fixture gaps). Two round-1 correctness findings were verified as resolved in the source code: the `readFeatureContext` sibling-workspace fallback (work-agent-prompt.ts:279-293) delivers feature context to story agents end-to-end, and the InspectorPanel Plan button status gate is present at ActionsSection.tsx:334. One blocker remains: a test regression in `ConversationPanel.test.tsx` where 3 tests fail because `vi.restoreAllMocks()` restores the DialogProvider mock factory across test boundaries. Four high-priority items should also be addressed (kanban timer proliferation, InspectorPanel polling storm, and two test coverage gaps). The PR is close to merge-ready.

## Blockers (MUST fix before merge)

### 1. ConversationPanel.test.tsx — 3 tests fail due to DialogProvider mock restoration — `~`
**Raised by**: correctness
**Why it blocks**: `vi.restoreAllMocks()` in `afterEach` restores the DialogProvider mock factory, causing 3 tests that trigger re-render or second interaction cycles to fail with "useConfirm must be used within DialogProvider". This breaks the test suite and the verification gate.

**Fix**: Replace `vi.restoreAllMocks()` with `vi.clearAllMocks()` in the test file's `afterEach` hook (Option C from the review). This preserves mock implementations across tests while resetting call history:
```typescript
afterEach(() => {
  vi.clearAllMocks();  // was: vi.restoreAllMocks()
});
```

Alternatively, wrap the `renderPanel` helper in an actual `DialogProvider` instead of relying on the module mock (Option A).

---

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. O(N) concurrent 1Hz timers on kanban hot path — `KanbanBoard.tsx:82` — `~`
**Raised by**: performance

The `LiveLastHeardBadge` batching fix (single `setDisplay` + `useMemo`-cached `baseTime`) halved re-renders and eliminated GC pressure — meaningful improvement. However, each badge still mounts an independent `setInterval(update, 1000)`. With N active agents, N timers fire per second, each triggering a child re-render. At N=10 that's 10 re-renders/sec on the primary dashboard view.

**Fix**: Replace per-badge intervals with a single shared interval at the `KanbanBoard` level. The parent computes formatted strings for all agents once per second and passes them as stable props. All badges update in one parent render pass instead of N independent child passes.

**Justification for High Priority rather than Blocker**: The performance reviewer downgraded this from `!` MUST to `~` SHOULD after the batching fix was applied. At realistic agent counts (1-5 active), the remaining impact is 1-5 child re-renders/sec — moderate, not severe. The full fix requires non-trivial architectural refactoring of the timer mechanism.

---

### 2. InspectorPanel polling storm — 5 independent polling queries — `InspectorPanel.tsx:186` — `~`
**Raised by**: performance

Five separate `useQuery` hooks poll independently (5s, 15s, 30s, 30s, 60s intervals). With 3 panels open, ~60 requests/minute hit the server. The intervals are uncoordinated, creating irregular burst patterns.

**Fix**: Consolidate workspace state, stashes, and containers into a single `/api/workspaces/:issueId/summary` endpoint, or lift all polling into one parent-level `useEffect` orchestrator that fires one batched request per cycle.

---

### 3. Test: FeatureCard renders See Plan via `hasPlan=true` — `KanbanBoard.test.tsx` — `~`
**Raised by**: requirements

The test at `KanbanBoard.test.tsx:788-800` exercises the "See Plan" label via `labels: ['planned']`, not via `hasPlan: true`. The `hasPlan` branch of `planLabelExists` is never directly tested. Add:
```typescript
test('renders See Plan when hasPlan is true', () => {
  renderFeatureCard(createMockFeature({ hasPlan: true }));
  expect(screen.getByText('See Plan')).toBeInTheDocument();
});
```

---

### 4. Test: Closed feature hides Plan button in InspectorPanel — `ActionsSection.test.tsx` — `~`
**Raised by**: requirements

The code fix is present (`ActionsSection.tsx:334` gates on `STATUS_LABELS[issueStatus ?? ''] !== 'done' && !== 'canceled'`), but no test verifies the closed-feature case in InspectorPanel. Add:
```typescript
test('does not show Plan button for closed feature', () => {
  render(<ActionsSection {...defaultProps} isFeature={true} issueStatus="Done" onPlan={vi.fn()} />);
  expect(screen.queryByTestId('inspector-plan-feature')).not.toBeInTheDocument();
});
```

---

## Nits (advisory — safe to defer)

- `spawn-planning-session.ts:236` — `?` — Over-escaped backticks: `\\\`blocks\\\`` renders with literal backslashes in the prompt. Use `` \`blocks\` `` or `` `blocks` ``. (correctness)
- `rally-client.ts:178` — `?` — Cache key includes `apiKey.slice(-4)`; use a truncated hash instead of a key substring to avoid partial secret leakage in logs. (security)
- `vbrief/beads.ts:241` — `?` — Bead creation is serial; items at the same topo-depth could be parallelized (planning-time only, not hot path). (performance)
- `beads-query.ts:19` — `?` — `readBeadsFromJsonl` does a full linear scan; irrelevant at current JSONL sizes. (performance)
- `done-preflight.ts:114` — `?` — `readdirSync` in CLI-only code; defensive replacement with `await readdir()` would future-proof against server import. (performance)

---

## Cross-cutting groups

**Test coverage gaps** (add together in one pass):
- [high-3] FeatureCard See Plan via `hasPlan=true`
- [high-4] Closed feature hides Plan button in InspectorPanel

**Dashboard performance** (both affect request/render load on the main view; design together):
- [high-1] O(N) concurrent timers on kanban
- [high-2] InspectorPanel polling storm

---

## What's good

- Both round-1 command injection vulnerabilities were fixed with `execFileAsync` — verified by security reviewer.
- `LiveLastHeardBadge` state batching and `baseTime` caching were applied, halving re-renders and eliminating GC pressure — verified by performance reviewer.
- Rally `listIssues` per-type limit and `updateIssue` local reconstruction were both fixed — verified by performance reviewer.
- `readFeatureContext` sibling-workspace fallback (work-agent-prompt.ts:279-293) correctly delivers feature context to story agents end-to-end. The correctness reviewer's claim that this is "silently a no-op" is contradicted by the source code.
- InspectorPanel Plan button status gate is present at `ActionsSection.tsx:334` with `issueStatus` prop wired from `InspectorPanel.tsx:1089`. The correctness reviewer's claim that this is "STILL OPEN" is contradicted by the source code.
- 39 of 42 acceptance criteria are fully implemented. All functional requirements are met.
- `getChildIssues` is well-tested across Rally (with `parentRef` assertion), GitHub (empty array), and interface compliance (all four trackers implement it).
- `writeFeatureContext` has dedicated test coverage verifying file creation, content, and no-op for non-PortfolioItem issues.

---

## Review stats
- Blockers: 1   High: 4   Medium: 0   Nits: 5
- By reviewer: correctness=2, security=1, performance=5, requirements=2
- Files touched: 58   Files with findings: 8

---

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the Synthesis Context above. Those files contain full per-reviewer detail; this synthesis is the policy layer.

---

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-936 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

