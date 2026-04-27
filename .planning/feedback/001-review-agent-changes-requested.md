---
specialist: review-agent
issueId: PAN-865
outcome: changes-requested
timestamp: 2026-04-27T12:34:55Z
---

# Verdict: CHANGES_REQUESTED

## Summary
PAN-865 implements the Zone C tab strip skeleton and Overview tab for the Command Deck. Seven of nine requirements are met: default Overview tab, 10-tab strip with placeholders, keyboard navigation, billboard/tile-grid/summaries rendering, sourcing from existing endpoints, no agent-selected regressions, and Playwright visual verification. However, two explicit acceptance criteria from the issue AC are not implemented, both flagged as `!` MUST by the requirements reviewer. Three additional SHOULD findings (one correctness cache-shape latent risk, two performance polling/data-fetch concerns) should be addressed but do not individually block merge. The PR cannot be approved until the two missing requirements are resolved.

## Blockers (MUST fix before merge)

### 1. Clicking an issue row auto-enters agent-selected mode instead of Overview — `src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.tsx:505-514` — `!`
**Raised by**: requirements
**Why it blocks**: The issue AC explicitly requires that clicking an issue node (not agent) in the tree swaps Zone C to IssueOverviewTabs. Currently, `FeatureItem` calls `onSelect()` and then immediately calls `onSelectSession(feature.issueId, bestSessionId)` when a `bestSessionId` exists, causing `IssueWorkbench` to render the agent-selected path instead of the required issue-selected Overview mode.

**Fix instruction**: In `FeatureItem.tsx:505-514`, when handling the row click (not the explicit session-launch button), only call `onSelect(feature.issueId)` — do NOT auto-call `onSelectSession` on that same click. The session-launch button (or double-click) should remain the entry point for agent-selected mode. Verify that `handleSelectFeature` in `index.tsx:359-371` correctly clears session focus without immediately re-setting it.

### 2. URL tab routing is not wired through the real CommandDeck → IssueWorkbench → ZoneCOverview flow — `src/dashboard/frontend/src/components/CommandDeck/IssueWorkbench.tsx:69` — `!`
**Raised by**: requirements
**Why it blocks**: The issue AC explicitly requires URL routing for tab state (e.g., `?tab=overview`). `IssueWorkbench` creates a fully controlled `activeTab` state initialized to `'overview'` and never reads from or writes to the URL. `ZoneCOverview` only reads `?tab=` when `activeTab` is not supplied (i.e., in isolation), and only pushes to URL when `!activeTab`. The integrated flow bypasses all URL interaction entirely.

**Fix instruction**: In `IssueWorkbench`, replace `useState<OverviewTab>('overview')` with a `useSearchParams` / URL-driven approach: initialize `activeTab` from `?tab=` (defaulting to `'overview'`), and call `setSearchParams` (or equivalent) on tab changes so the URL reflects the active tab. Pass both the value and a setter to `ZoneCOverview` so the controlled parent drives URL state. Alternatively, if URL routing is out of scope for this PR, the AC must be updated to reflect that decision — it cannot remain unimplemented.

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. `sweepExpired` called with mismatched cache shape — `src/dashboard/server/routes/command-deck.ts:716` — `~`
**Raised by**: correctness
**Why it blocks**: Latent fragility. `sweepExpired<T>` expects `Map<string, { timestamp: number; data: T }>` but `stashCountCache` provides `{ timestamp: number; count: number }`. No runtime crash today, but if `sweepExpired` is later extended to read `.data`, it will silently read `undefined`.

**Fix instruction**: Widen `sweepExpired` to only require `{ timestamp: number }`:
```typescript
function sweepExpired<T extends { timestamp: number }>(cache: Map<string, T>, ttlMs: number): void {
  const cutoff = Date.now() - ttlMs;
  for (const [key, entry] of cache) {
    if (entry.timestamp < cutoff) cache.delete(key);
  }
}
```

### 2. Overview mode starts six independent polling loops for one selected issue — `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverviewTabs/OverviewTab.tsx:215` — `~`
**Raised by**: performance
**Why it blocks**: At steady state one Overview panel generates ~30 req/min before retries or multiple tabs. This is on the admin dashboard hot path.

**Fix instruction**: Collapse cost/review/workspace data behind a single issue-overview endpoint, or reduce polling intervals so only truly live sections (e.g., activity surface) refresh at short intervals. Leave `5s` polling only on the activity query; push other tiles to `30s` or on-demand.

### 3. Session-tree fetch still does full activity reconstruction per feature — `src/dashboard/server/routes/projects.ts:222` — `~`
**Raised by**: performance
**Why it blocks**: `fetchProjectSessionTree()` calls `fetchActivityDataWithContext()` (a heavy helper) once per feature candidate just to derive session nodes. The batched tree endpoint avoids HTTP N+1 but still pays an O(feature count × full activity assembly) internal cost.

**Fix instruction**: Split out a tree-specific lightweight collector that only gathers the fields needed for `SessionNode[]` — session metadata only, not full activity reconstruction.

## Nits (advisory — safe to defer)

- `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverview.tsx:120` — `?` — Tab reset effect note. Currently works correctly because `visibleTabs` is a stable `readonly` constant. No action needed; the design intent is documented. (correctness)
- `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverviewTabs/OverviewTab.tsx:258` — `?` — `recentEvents` slice assumes server returns chronologically sorted sections. Add a defensive sort or a comment documenting the contract. (correctness)
- `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverviewTabs/OverviewTab.tsx:94-105` — `?` — `lastActivityLabel` re-parses timestamps every render via `Date.parse` in a loop. Could be memoized, but `sections` is typically bounded (< 50). Minor. (correctness)

## Cross-cutting groups

**URL + session-selection interaction** (both blockers share a root cause — the click flow through `CommandDeck` → `FeatureItem` → `IssueWorkbench`):
- [blocker-1] Clicking issue row auto-enters agent-selected mode
- [blocker-2] URL tab routing is not wired through the integrated flow

Fix both together: the session-auto-selection and the URL-state initialization are the two seams that must both be corrected in the `CommandDeck` / `FeatureItem` / `IssueWorkbench` integration.

**Polling consolidation** (performance warning 1 and correctness warning 1 are both about the Overview tab's data pipeline):
- [high-2] Six polling loops
- [high-3] Per-feature full activity reconstruction for tree nodes

These are separate concerns but both surface from the same Overview tab work.

## What's good
- Seven of nine requirements correctly implemented, including keyboard nav and Playwright visual verification
- Tab strip skeleton, default-Overview behavior, and 10-tab placeholder rendering are all sound
- Security review is clean — no vulnerabilities introduced
- Server-side changes (summary mode, stash-count caching, shared context hoisting) are architecturally sound
- `FeatureItem.tsx` adds an explicit confirmation gate before invoking the deep-wipe handler (security best practice confirmed)

## Review stats
- Blockers: 2   High: 3   Medium: 0   Nits: 3
- By reviewer: correctness=4, security=0, performance=2, requirements=2
- Files touched: 17   Files with findings: 8

## Appendix: individual reviews

See individual reviewer output files:
- `correctness.md`
- `security.md`
- `performance.md`
- `requirements.md`

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-865 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

