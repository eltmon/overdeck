---
specialist: review-agent
issueId: PAN-847
outcome: changes-requested
timestamp: 2026-04-26T16:53:25Z
---

# Verdict: CHANGES_REQUESTED

## Summary
PAN-847 adds Zone A/B enrichment (sparklines, ribbons, cost ticker), a motion catalog, parallelized network fan-out, PrDiffTab virtualization, and proper multi-repo cache keying — all worthwhile improvements. However, 2 critical logic bugs in `ZoneBActionStrip` will cause wrong-agent spawns and guaranteed runtime errors on Resume clicks, and 3 acceptance criteria from the issue body are only partially implemented (AC-6, AC-7, AC-9). The PR cannot merge until these are resolved: the code does not yet do what was asked.

## Blockers (MUST fix before merge)

### 1. Wrong issueId derivation in `restartMutation` — `src/dashboard/frontend/src/components/CommandDeck/ZoneBActionStrip.tsx:87` — `!`
**Raised by**: correctness
**Why it blocks**: The `sessionId.replace(/^agent-/, '').toUpperCase()` pattern only works for work sessions following `agent-pan-XXX`. Reviewer/specialist sessions named `specialist-panopticon-PAN-847-review-correctness` produce invalid garbage issueIds, causing the POST to `/api/agents` to fail or spawn the wrong agent.

```typescript
// Fix: gate Restart to work sessions only, or derive issueId from the parent feature
if (session.type !== 'work') throw new Error('Cannot restart non-work sessions');
```
Alternatively, pass `issueId` down from `ZoneB` which has access to the session's parent feature.

### 2. `canResume` triggers for ended/crashed sessions — `src/dashboard/frontend/src/components/CommandDeck/ZoneBActionStrip.tsx:145` — `!`
**Raised by**: correctness
**Why it blocks**: `session.presence !== 'active'` is true for `ended`, `crashed`, `idle`, and `error` states as well as `paused`/`suspended`. Clicking Resume on a dead session sends a request to `/api/agents/:id/resume` that will fail, producing a guaranteed error toast.

```typescript
// Fix: only allow Resume for genuinely paused/suspended sessions
const canResume = session.presence === 'paused' || session.presence === 'suspended';
```
If `suspended` is not yet represented in the presence enum, that enum must be extended first.

### 3. AC-7 — Zone B overflow actions severely incomplete — `src/dashboard/frontend/src/components/CommandDeck/ZoneBActionStrip.tsx` — `~ (bordering on !)`
**Raised by**: requirements
**Why it blocks**: The overflow menu is the primary action surface for session management. Only "Open State Dir" is present; the other 6 required actions (Restart, View JSONL, Deep Wipe, Replay, Export JSONL, Export round history JSON) are entirely absent. This is the most significant functional gap — the feature as specified is not delivered.

Fix: Add all 6 missing actions to the overflow menu in `ZoneBActionStrip.tsx`. Deep Wipe must include a confirmation dialog (consistent with `SessionNode.tsx`).

### 4. AC-6 — Tree right-click menus limited to SessionNode only — `src/dashboard/frontend/src/components/CommandDeck/ProjectTree/ProjectNode.tsx`, `src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.tsx` — `~`
**Raised by**: requirements
**Why it blocks**: The acceptance criterion specifies "all tree nodes" but `ProjectNode` and `FeatureItem` have no `onContextMenu` handler at all. Users right-clicking those nodes get the browser default menu, not Panopticon actions.

Fix: Add context menu handlers to `ProjectNode` and `FeatureItem` with at minimum the project-level applicable actions (e.g., Open State Dir). If session-centric actions are genuinely not applicable to non-session nodes, update the AC text to reflect the intended scope — but that is a separate conversation, not a unilateral code change.

### 5. AC-9 — Missing 5k-line diff smoke test — `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverviewTabs/PrDiffTab.tsx` — `~`
**Raised by**: requirements
**Why it blocks**: The acceptance criterion explicitly calls for a smoke test verifying 5k-line diff renders under 100ms. The virtualization is correctly implemented, but without the test a regression in overscan configuration or row measurement would go undetected.

Fix: Add a performance smoke test in `PrDiffTab.test.tsx` that renders 5000 lines and asserts the `performance.now()` delta is under 100ms.

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. Serial `gh issue list` loop across repos — `src/dashboard/server/routes/command-deck.ts:1244-1262` — `~`
**Raised by**: performance, correctness
**Why it matters**: The PR uses `Promise.all` consistently for `fetchIssueDiscussions`, `archiveReviewerRound`, and workspace scans — but the closed-issues multi-repo loop still uses sequential `for...of` + `await`. With 3+ repos this adds 200–800ms per repo serially. The fix is mechanical and consistent with the rest of the PR.

```typescript
await Promise.all(repos.map(async (repo) => {
  const cached = closedIssuesCache.get(repo);
  if (cached && ...) { closedIssues.push(...cached.data); return; }
  // ... fetch and cache
}));
```

### 2. `closedIssuesCache` and `costCache` Maps grow without bound — `src/dashboard/server/routes/command-deck.ts:80-85` — `~`
**Raised by**: correctness
**Why it matters**: Entries are overwritten on TTL expiry but never deleted. In a long-running server, `costCache` accumulates one entry per polled issue indefinitely. Each entry holds a small JSON blob, so absolute memory impact is low — but it violates the TTL contract: stale entries should be evicted, not just overwritten.

Fix: Add eviction in the set path — before writing a new entry, delete any expired entries for the same key, or do a periodic sweep.

### 3. `gh issue list` with unescaped repo interpolation in shell command — `src/dashboard/server/routes/command-deck.ts:1253` — `~`
**Raised by**: correctness
**Why it matters**: Repo is interpolated directly into a shell command string. While config-driven (low injection risk), this is a shell injection surface if config files are ever tampered with. The existing pattern in `issues.ts:2771` uses `execFileAsync` with an explicit argument array — follow that pattern.

```typescript
// Fix: use execFileAsync (already imported) with array args
const { stdout } = await execFileAsync('gh', [
  'issue', 'list', '--repo', repo, '--state', 'closed',
  '--limit', '200', '--json', 'number,title'
], { encoding: 'utf-8', timeout: 15000 });
```

## Nits (advisory — safe to defer)

- `src/dashboard/frontend/src/lib/deriveRoundMarkers.ts:36` — `?` — Anchor fallback to last message when all messages are after round end. Consider returning an empty marker instead (skip the round). MAY, already tested and intentional.
- `src/dashboard/frontend/src/components/CommandDeck/ZoneB.tsx:127` — `?` — Cost rate division by zero guard. Consider `session.duration < 1` threshold to avoid astronomically high rates in the first second.
- `src/dashboard/frontend/src/components/CommandDeck/ZoneB.tsx:94` — `?` — `errorShakeKey` uses `session.status` not the local `status` variable. Intentional but inconsistent with `flashKey` — add a clarifying comment.
- `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverviewTabs/PrDiffTab.tsx:102` — `?` — `fileMax` memo depends on whole `data` object. Replace dep with `[data?.pr?.files]` for tighter recomputation trigger.
- `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverviewTabs/PrDiffTab.tsx:434` — `?` — Non-virtualized fallback renders all lines if virtualizer never attaches. Cap fallback to `diffLines.slice(0, 1000)` with a "diff truncated" notice.
- `src/dashboard/server/routes/command-deck.ts:535` — `?` — `syncCache()` called on every cost-cache miss. Confirm it is cheap/self-debounced; if so, informational only.
- `src/dashboard/frontend/src/components/CommandDeck/SessionView/IssueHeader.tsx:418` — `?` — `alert()` with concatenated discussion content is a UX smell for large strings; pre-existing pattern, not a regression.

## Cross-cutting Groups

**ZoneBActionStrip lifecycle bugs** (same file, same component, fix together):
- [blocker-1] Wrong issueId derivation for specialist/reviewer sessions
- [blocker-2] `canResume` triggers for ended/crashed sessions
- [blocker-3] AC-7 overflow actions severely incomplete (same component)

**Cache hygiene** (same file, same pattern):
- [high-1] Serial gh issue list loop across repos (also impacts performance)
- [high-2] Unbounded Map growth in closedIssuesCache and costCache
- [high-3] Shell injection surface with unescaped repo interpolation

**Acceptance criteria gaps** (all from requirements reviewer):
- [blocker-4] AC-6 tree menus limited to SessionNode only
- [blocker-3] AC-7 Zone B overflow actions severely incomplete
- [blocker-5] AC-9 missing 5k-line diff smoke test

## What's good
- Multi-repo cache keying by `issueId.toUpperCase()` and repo string correctly fixes the cache poisoning bugs
- Parallel fan-out via `Promise.all` for `fetchIssueDiscussions`, `archiveReviewerRound`, and workspace scans is consistently applied
- PrDiffTab virtualization with `@tanstack/react-virtual` is correctly implemented with proper overscan and test fallback
- Motion catalog wiring to Zustand store subscriptions is clean and follows the 200ms animation timing
- `deriveRoundMarkers` extraction as a pure testable unit with 6 test cases is a model implementation
- Security review found no new injection surfaces, no unsafe HTML sinks, and proper `rel="noopener noreferrer"` on external links

## Review stats
- Blockers: 5   High: 3   Medium: 0   Nits: 6
- By reviewer: correctness=2!, 3~, 3? | security=0 | performance=1~, 5? | requirements=3~ (bordering on !)
- Files touched: 26   Files with findings: 14

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the Synthesis Context above. Those files contain full per-reviewer detail; this synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-847 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

