---
specialist: review-agent
issueId: PAN-847
outcome: changes-requested
timestamp: 2026-04-26T17:18:18Z
---

# Verdict: CHANGES_REQUESTED

## Summary
PAN-847 round 2 resolves all 5 blockers from round 1 (wrong issueId derivation, canResume on dead sessions, missing tree menus, unbounded cache growth, serial gh fetch). The codebase is now correct on its core invariants and all 11 acceptance criteria have corresponding code. However, 1 functional gap remains: "Export JSONL" exports a 2-field JSON metadata stub, not actual JSONL content — users who click the button expecting their session transcript get useless data. Additionally, `handleReplay` is a no-op that only closes the menu, and the `restartMutation` still derives issueId instead of using the authoritative prop despite it being available. These must be addressed before merge.

## Blockers (MUST fix before merge)

### 1. "Export JSONL" exports a metadata stub, not actual JSONL — `src/dashboard/frontend/src/components/CommandDeck/ZoneBActionStrip.tsx:172-184` — `~`
**Raised by**: correctness
**Why it blocks**: The feature is advertised as exporting JSONL but delivers a 2-field JSON object (`{ sessionId, exportedAt }`) with a `.jsonl` extension. Users expecting their conversation transcript receive a useless metadata stub. This is worse than a missing feature — it silently delivers wrong output.

```typescript
// Fix: either wire to the actual endpoint, or rename + disable until wired
// Option A: rename to "Export Session Metadata" with .json extension
// Option B: add // TODO with a note that this requires a server endpoint
// Option C: fetch actual JSONL from the session data endpoint and export that
```

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. `restartMutation` still derives issueId instead of using the available `issueId` prop — `src/dashboard/frontend/src/components/CommandDeck/ZoneBActionStrip.tsx:92` — `~`
**Raised by**: correctness
**Why it matters**: The `issueId` prop was added in the fix commit specifically to be used by these mutations, but `restartMutation` still uses `session.sessionId.replace(/^agent-/, '').toUpperCase()` instead. The `session.type !== 'work'` guard prevents specialist sessions from hitting this path, but the code is fragile and inconsistent — if work session naming ever changes, derivation breaks while the authoritative prop would still work. Use the prop.

```typescript
// Fix: use the issueId prop
body: JSON.stringify({ issueId }),  // not derivedIssueId
```

### 2. `handleReplay` is a no-op — `src/dashboard/frontend/src/components/CommandDeck/ZoneBActionStrip.tsx:200-204` — `~`
**Raised by**: correctness
**Why it matters**: The "Replay" button closes the overflow menu and does nothing else. The comment says "navigates to the JSONL transcript" but there is no navigation, no state update, no event dispatch. User clicks "Replay" → menu closes → nothing happens. Wire to actual navigation (e.g., switch to conversation view) or disable the button with a "coming soon" indicator.

### 3. Serial `gh issue list` loop across repos — `src/dashboard/server/routes/command-deck.ts:1244-1262` — `~`
**Raised by**: performance, correctness
**Why it matters**: The PR uses `Promise.all` consistently for `fetchIssueDiscussions`, `archiveReviewerRound`, and workspace scans, but the closed-issues multi-repo loop still uses `for...of` + `await`. With 3+ repos this adds 200–800ms serially. The fix is mechanical and consistent with the rest of the parallelization theme.

```typescript
await Promise.all(repos.map(async (repo) => {
  const cached = closedIssuesCache.get(repo);
  if (cached && ...) { closedIssues.push(...cached.data); return; }
  // ... fetch and cache
}));
```

## Nits (advisory — safe to defer)

- `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverviewTabs/PrDiffTab.tsx:102` — `?` — `fileMax` memo depends on whole `data` object. Replace dep with `[data?.pr?.files]` for tighter recomputation.
- `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverviewTabs/PrDiffTab.tsx:434` — `?` — Non-virtualized fallback renders all lines if virtualizer never attaches. Cap fallback to `diffLines.slice(0, 1000)` with a "diff truncated" notice.
- `src/dashboard/server/routes/command-deck.ts:535` — `?` — `syncCache()` called on every cost-cache miss. Confirm it is cheap/self-debounced; if so, informational only.
- `src/dashboard/frontend/src/components/CommandDeck/SessionView/IssueHeader.tsx:418` — `?` — `alert()` with concatenated discussion content is a UX smell for large strings; pre-existing pattern, not a regression.
- `src/dashboard/frontend/src/components/CommandDeck/ZoneB.tsx:49` — `?` — `suspended` presence maps to `idle` StatusDot, visually identical. Consider a distinct visual treatment (e.g., amber/yellow) so users can see their explicit pause action took effect.
- `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverviewTabs/__tests__/PrDiffTab.test.tsx:192-209` — `?` — Smoke test asserts `elapsed < 500` in jsdom but notes real-world target is 100ms. CI jsdom is often 5-10x slower than local; consider verifying only a subset of DOM nodes exist (virtualizer active) rather than relying on timing.

## Cross-cutting Groups

**ZoneBActionStrip overflow menu actions** (same component, fix together):
- [blocker-1] Export JSONL stub (non-functional feature)
- [high-1] `restartMutation` ignores issueId prop
- [high-2] `handleReplay` is a no-op

**Parallelization consistency** (same file, same fix pattern):
- [high-3] Serial gh issue list loop (should be `Promise.all` like everywhere else in this PR)

## What's good
- All 5 blockers from round 1 are resolved: issueId derivation guarded, canResume correctly scoped to `suspended`, context menus added to all tree node types, cache eviction added, gh commands switched to `execFileAsync`
- Multi-repo cache keying correctly fixes the cache poisoning bugs from the issue-selected cache
- `deriveRoundMarkers` as a pure function with 6 test cases is a model extraction
- Security review found no new attack surface; all GitHub lookups use `execFileAsync` with explicit argv arrays
- Requirements coverage is 10/11 fully implemented; the single partial (AC-6) is minor — all node types have menus and all actions are reachable on SessionNode
- `suspended` presence added to `SessionNodePresence` enum with proper store, zone, and StatusDot wiring

## Review stats
- Blockers: 1   High: 3   Medium: 0   Nits: 6
- By reviewer: correctness=1~, 3? | security=0 | performance=1~, 6? | requirements=1~ (partial AC-6)
- Files touched: 29   Files with findings: 9

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the Synthesis Context above. Those files contain full per-reviewer detail; this synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-847 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

