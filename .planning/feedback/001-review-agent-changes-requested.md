---
specialist: review-agent
issueId: PAN-865
outcome: changes-requested
timestamp: 2026-04-27T10:12:20Z
---

# Verdict: CHANGES_REQUESTED

## Summary

PAN-865 adds a tile grid, URL routing, keyboard navigation, and an enhanced billboard to the Command Deck overview tab. Eight of nine acceptance criteria are implemented correctly. However, the requirements reviewer identified that the PR violates its own stated scope: the nine non-Overview tabs were required to render placeholder content ("Loading…" or "Coming soon") so that those tabs could be delivered in PAN-866, but the PR wires real tab components for all nine instead. This is a MUST-level scope violation that blocks merge. All other reviewer findings are warnings or nits.

## Blockers (MUST fix before merge)

### 1. Non-Overview tabs are fully wired instead of placeholders — `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverview.tsx:238-266` — `!`
**Raised by**: requirements
**Why it blocks**: REQ-9 explicitly requires "Other 9 tabs render placeholder ('Loading…' or 'Coming soon')" so they can be delivered in PAN-866. The PR wires real components (ActivityTab, CostsTab, MarkdownTab, VBriefTab, BeadsTab, PrDiffTab, DiscussionsTab) instead, violating the stated scope of the issue.

The fix is surgical: in `ZoneCOverview.tsx`, replace the nine non-Overview tab body renderers with a single placeholder:
```tsx
const PlaceholderBody = () => (
  <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
    Coming soon
  </div>
);
```
Then use `PlaceholderBody` for all non-Overview tabs (Activity, Costs, PRD, STATE.md, INFERENCE.md, vBRIEF, Beads, PR/Diff, Discussions) instead of their real tab components. The tab strip (showing all 10 tabs) remains; only the body changes.

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. Unsafe type assertions in `isReviewPipelineStuck` call — `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverviewTabs/OverviewTab.tsx:257-262` — `~`
**Raised by**: correctness

The four `as` casts bypass compile-time checking between `ReviewStatusData` (which has `reviewStatus: string`) and the `PipelineStateLike` union types. If the server returns a status value not in the hardcoded union (e.g., `"unknown"`), `isReviewPipelineStuck` silently won't match it, meaning a genuinely stuck pipeline wouldn't show the Recover button. The pattern is low-probability (server and client co-developed) but technically unsound.

**Fix**: Widen `PipelineStateLike` fields to `string` so the casts are unnecessary, or add a type-guard helper that accepts any string but narrows the type at the call site.

### 2. `formatRuntime` returns "0m" for recently-started agents — `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverviewTabs/OverviewTab.tsx:202-209` — `?`
**Raised by**: correctness

When an agent starts within the last 60 seconds, `mins` is 0 and the display shows "0m". A zero-valued metric is uninformative and can look like a bug.

**Fix**: Return `"<1m"` when `mins === 0`:
```typescript
if (mins === 0) return '<1m';
return `${mins}m`;
```

## Nits (advisory — safe to defer)

- `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverviewTabs/OverviewTab.tsx:451-456` — `?` — Fire-and-forget POST in Spawn Work button swallows all errors with an empty catch. Consistent with other action buttons in the file. Low priority UX enhancement; intentional for MVP.
- `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverview.tsx:116-119` — `?` — Tab validity reset effect has a subtle dependency gap (`visibleTabs` is a module constant, making the effect dead code). Remove or add a comment explaining it's a safety net for future dynamic tab filtering.
- `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverview.tsx:96-103` — `?` — `useEffect` for URL sync fires on every render when `activeTab` is set, but the early return makes it a no-op. Not a bug; flagged for awareness only.

## Cross-cutting groups

_none_

## What's good
- URL sync and keyboard navigation are correctly implemented with no Tab-trap behavior
- Tab strip shows all 10 tabs unconditionally, matching the spec
- All data sourced from existing endpoints — no new server work introduced
- No regressions in agent-selected mode (Zone C swap to SessionPanel still works)
- Performance is clean — React Query centralizes caching, no duplicate fetches on tab switches
- Security is clean — no XSS sinks, proper `rel="noopener noreferrer"` on external links, no injection surface

## Review stats
- Blockers: 1   High: 1   Medium: 0   Nits: 3
- By reviewer: correctness=5, security=0, performance=0, requirements=1
- Files touched: 11   Files with findings: 3

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the
Synthesis Context above. Those files contain full per-reviewer detail; this
synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-865 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

