---
specialist: review-agent
issueId: PAN-815
outcome: changes-requested
timestamp: 2026-04-27T01:36:42Z
---

# Verdict: CHANGES_REQUESTED

## Summary
PAN-815 refactors the Command Deck from a single-select tab interface to independent conversation/project filter toggles with a unified sidebar list. Requirements are fully satisfied (6/6), security is clean, and the core implementation is sound. However, 4 high-severity issues must be addressed: a correctness bug where the auto-select-first-conversation effect fires even when the conversations filter is disabled (leaving the user unable to understand or switch the shown conversation), and three performance issues on hot paths (N+1 HTTP waterfall on mount, unmemoized agent lookup per render, and WebSocket subscription churn every 10 seconds).

## Blockers (MUST fix before merge)

### 1. Auto-select conversation bypasses `showConversations` filter — `src/dashboard/frontend/src/components/CommandDeck/index.tsx:331` — `~`
**Raised by**: correctness
**Why it blocks**: The invariant "content area matches sidebar filter state" is violated — when `showConversations=false` on page reload, the effect auto-selects a conversation and shows it in the content area while the conversation list is hidden in the sidebar, leaving the user unable to identify or switch the shown conversation.

Add `showConversations` to the guard:
```typescript
useEffect(() => {
  if (hasAutoSelected.current) return;
  if (!showConversations) return;  // <-- add this
  if (conversations.length === 0 || convId || selectedConversation !== null || selectedFeature !== null) return;
  setSelectedConversation(conversations[0].name);
  hasAutoSelected.current = true;
}, [conversations, convId, selectedConversation, selectedFeature, showConversations]);
```

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. N+1 HTTP pattern for per-project session tree loading — `src/dashboard/frontend/src/components/CommandDeck/index.tsx:205-211` — `~`
**Raised by**: performance
**Why it matters**: With 20 projects, this creates 20 parallel HTTP requests on mount; browser connection limits queue the remainder, creating a waterfall. Scales linearly with project count.

**Fix:** Replace with a single bulk endpoint (e.g., `GET /api/session-trees?projects=key1,key2,...`) that returns all trees in one request. The server already has the data — bundling avoids HTTP overhead and head-of-line blocking. Until a bulk endpoint exists, the parallel fetch is acceptable but should be tracked as a follow-on optimization.

### 2. Unmemoized agent lookup on every render — `src/dashboard/frontend/src/components/CommandDeck/index.tsx:768-769` — `~`
**Raised by**: performance
**Why it matters**: `agents.find()` runs twice on every CommandDeck re-render; with 100 agents and store updates every few seconds (heartbeats), this is continuous wasted work.

**Fix:** Wrap in `useMemo`:
```typescript
const selectedAgent = useMemo(() => {
  if (!selectedFeature) return undefined;
  const key = selectedFeature.toLowerCase();
  return agents.find(a => a.issueId?.toLowerCase() === key && a.id.startsWith('agent-'))
    ?? agents.find(a => a.issueId?.toLowerCase() === key);
}, [agents, selectedFeature]);
```

### 3. WebSocket subscription churn on every projects refetch — `src/dashboard/frontend/src/components/CommandDeck/index.tsx:231-262` — `~`
**Raised by**: performance
**Why it matters**: `projects` array dependency (new reference every 10s from `refetchInterval`) tears down and recreates all WebSocket subscriptions, creating a brief window where live session tree deltas are dropped.

**Fix:** Depend on a stable project name key instead of the full array:
```typescript
const projectNamesKey = useMemo(() => projects.map(p => p.name).join(','), [projects]);
useEffect(() => {
  if (!showProjects) return;
  const transport = getTransport();
  const unsubscribes: Array<() => void> = [];
  for (const project of projects) {
    const unsubscribe = transport.subscribe(/* ... */);
    unsubscribes.push(unsubscribe);
  }
  return () => { /* teardown all */ };
}, [showProjects, projectNamesKey, queryClient]);
```

## Nits (advisory — safe to defer)

- `src/dashboard/frontend/src/components/CommandDeck/index.tsx:59` — `?` — `pickBestSession` sorts O(n log n) instead of scanning O(n). Negligible with typical session counts; algorithmic anti-pattern. (performance)
- `src/dashboard/frontend/src/components/CommandDeck/index.tsx:357-487` — `?` — Three handlers each perform O(P×F) nested scans for session lookup. User-click path (not render), low absolute cost, but pattern could be consolidated into a memoized lookup map. (performance)
- `src/dashboard/frontend/src/components/CommandDeck/index.tsx:679-721` — `?` — Empty sidebar when both filters are off. Filter chips remain visible for recovery; consistent with user intent. No change needed. (correctness/suggestion)

## Cross-cutting groups

**Feature lookup consolidation** (same root cause: repeated linear scans over projects/features):
- [high-2] `selectedAgent` lookup at line 768 — unmemoized double-find
- [nit-2] Three handlers (`handleSelectFeature`, `handleViewTerminal`, `handleViewJsonl`) each scan nested project/feature arrays — consolidate into memoized `Map<issueId, feature>` and `Map<sessionId, feature>`

## What's good
- All 6 requirements satisfied — unified list, independent filter chips, multi-select default both-visible, counts on chips, selection persistence across filter toggles, localStorage persistence
- No security vulnerabilities introduced — `encodeURIComponent` on project keys, no `dangerouslySetInnerHTML`, no new secrets or auth changes
- Filter toggle implementation is clean — independent boolean state, `aria-pressed` semantics, localStorage persistence with correct read/write flow
- Removed dead `DetailPanelLayout` fallback branch — good cleanup
- Test coverage updated to reflect new default-both-visible behavior

## Review stats
- Blockers: 0   High: 4   Medium: 0   Nits: 3
- By reviewer: correctness=1, security=0, performance=3, requirements=0
- Files touched: 4   Files with findings: 1 (`index.tsx`)

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the
Synthesis Context above. Those files contain full per-reviewer detail; this
synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-815 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
