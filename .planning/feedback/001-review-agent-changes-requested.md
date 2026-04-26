---
specialist: review-agent
issueId: PAN-830
outcome: changes-requested
timestamp: 2026-04-26T07:30:06Z
---

# Verdict: CHANGES_REQUESTED

## Summary
PAN-830 implements the Unified Command Deck — a three-zone dashboard surface replacing the old kanban + inspector split with canonical reviewer naming, session selection state, liveness primitives, PR/Diff tab, Discussions tab, and round divider plumbing. Core infrastructure (naming, JSONL resolution, tree nodes, liveness components, tab shell) is solid. However, the requirements reviewer found **6 missing acceptance criteria** (all `!` blockers) and **7 partial implementations** — the PRD specifies this as a single-ship issue with no phased delivery exception. Additionally, a correctness/type-mismatch finding causes round metadata (cost, duration, findings) to always render as null. The work agent must address all 6 requirements blockers plus the type-mismatch before this can merge.

## Blockers (MUST fix before merge)

### 1. `claudeSessionId` not written to reviewer `state.json` on first spawn — `src/lib/cloister/review-agent.ts` — `!`
**Raised by**: requirements
**Why it blocks**: Reviewer JSONL resolution (`resolveJsonlPath`) has no `session.id` / `sessions.json` / runtime state to look up, so `hasJsonl` is always `false` for reviewers and transcripts never load in the conversation view.

Fix: `spawnReviewer` in `review-agent.ts` must create `~/.panopticon/agents/<sessionName>/state.json` with `claudeSessionId` after the reviewer starts, or capture it from Claude's own session file at spawn time.

### 2. Action parity entirely missing — `src/dashboard/frontend/src/components/CommandDeck/ZoneA.tsx`, `ZoneB.tsx`, `command-deck.ts` — `!`
**Raised by**: requirements
**Why it blocks**: The PRD's core goal is "single, complete surface" — every action reachable elsewhere (IssueCard, InspectorPanel, BadgeBar, StatusFlowControl, WorkspacePane) must also be reachable from the three Command Deck zones. No `getZoneAActions`, no `getZoneBActions`, no contextual buttons, no overflow menus, and no parity smoke test exist.

Fix: Implement `getZoneAActions(state, status)` and `getZoneBActions(state)` pure functions mapping pipeline state to buttons. Wire existing backend RPCs. Add overflow `…` menus. Add parity smoke test.

### 3. `prefers-reduced-motion` not honored — `src/dashboard/frontend/src/index.css` — `!`
**Raised by**: requirements
**Why it blocks**: Accessibility failure — users with motion sensitivity cannot disable the constant pulsing/shimmer animations (`.anim-alive-dot-*`, `.anim-stuck-shake`, `.anim-round-active`). The acceptance criterion explicitly requires this.

Fix: Add `@media (prefers-reduced-motion: reduce)` block in `index.css` setting `animation: none` on all ambient keyframe classes. React components that gate on `useReducedMotion` may also be needed.

### 4. Composer in issue-selected mode not disabled with hint — `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverview.tsx`, `IssueWorkbench.tsx` — `!`
**Raised by**: requirements
**Why it blocks**: When no session is selected (issue-selected mode), the composer is entirely absent from the UI. The PRD explicitly requires either a disabled composer with a hint ("select a session to chat") or a contextual-spawn composer ("Spawn & Send" when zero sessions exist).

Fix: Add a disabled composer or contextual-spawn composer to `ZoneCOverview` / `IssueWorkbench` when `selectedSessionId` is null.

### 5. Fresh-load default selection not implemented — `src/dashboard/frontend/src/components/CommandDeck/index.tsx`, `src/dashboard/frontend/src/lib/commandDeckSelection.ts` — `!`
**Raised by**: requirements
**Why it blocks**: On initial load and first feature selection, the UI lands in issue-selected mode. Users must click twice (once to select the feature, once to pick a session) instead of auto-selecting the best alive session per the acceptance criterion.

Fix: `CommandDeck/index.tsx` or `FeatureItem` should call `selectSession(issueId, bestSessionId)` on mount when a feature is first selected, using `pickBestSession` or equivalent to prefer an alive session.

### 6. Density rules cannot be applied — `src/dashboard/frontend/src/components/CommandDeck/ZoneA.tsx` — `!`
**Raised by**: requirements
**Why it blocks**: The acceptance criterion requires hiding default-state badges and non-contextual action buttons. Zone A currently has neither the badge surfaces nor the action buttons these rules would triage. This is blocked by REQ-P1 (Zone A enrichment) and REQ-M5 (action parity).

Fix: Implement Zone A enrichment (REQ-P1) and action parity (REQ-M5) first; density triage logic can then be layered on top.

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. Round metadata (cost, duration, findings) always null — `src/dashboard/server/routes/reviewer-tree.ts:122-141` + `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverviewTabs/queries.ts:28-36` — `~`
**Raised by**: correctness
**Why it blocks**: The server writes and returns `{ round, status, reviewResult, success, archivedAt }` but the frontend `ReviewerRoundSummary` type expects `{ round, startedAt, endedAt, durationSec, cost, findings }`. The fields the UI claims to display are never present.

Fix: Extend `archiveReviewerRound` in `review-agent.ts` to write `cost`, `durationSec`, `findings` into the round artifact. Extend `readReviewerRounds` in `reviewer-tree.ts` to extract and return those fields.

### 2. Invalid date produces NaN (not null) duration — `src/dashboard/server/routes/reviewer-tree.ts:194` — `~`
**Raised by**: correctness
**Why it blocks**: `new Date("unknown").getTime()` returns `NaN`; `Math.floor(NaN)` is `NaN` — not `null`. This violates the `number | null` type contract.

Fix:
```typescript
duration: opts.startedAt && opts.endedAt
  ? (() => {
      const ms = new Date(opts.endedAt).getTime() - new Date(opts.startedAt).getTime();
      return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
    })()
  : null,
```

### 3. One file with massive changes squash all other bars to zero width — `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverviewTabs/PrDiffTab.tsx:95-98` — `≉`
**Raised by**: correctness, performance
**Why it blocks**: `Math.max(...files.map(f => f.additions + f.deletions))` means one 50,000-line file makes all smaller files' bars sub-pixel and invisible.

Fix: Cap `fileMax` at the 95th percentile, or use a log scale, so small changes remain visible. Consider `Math.max(addPct, total > 0 ? 4 : 0)` as a minimum bar width.

### 4. `fetchIssueDiscussions` runs three independent gh API calls sequentially — `src/dashboard/server/routes/issues.ts:2725-2816` — `~`
**Raised by**: performance
**Why it blocks**: Three independent calls (PR conversation, PR reviews, inline review comments) each take 200–800 ms and are polled every 30 s per viewer. Sequential execution compounds latency and rate-limit budget.

Fix: Fan out with `Promise.allSettled` wrapping the three call blocks, preserving per-source `try/catch` + `errors[]` semantics.

## Nits (advisory — safe to defer)

- `src/dashboard/server/routes/command-deck.ts:105` — `?` — `require('node:fs')` inside route handler. Hoist to ES module import at top of file, consistent with `issues.ts:27`. (correctness)
- `src/lib/cloister/specialists.ts:721` — `?` — regex lazy quantifiers may misparse hyphenated project keys. Latent bug for future project keys with hyphens. (correctness)
- `src/dashboard/server/routes/reviewer-tree.ts:121-141` — `?` — sequential `readFile` over round artifacts could parallelize with `Promise.all`. Wins are small but consistent with `buildReviewerNodes`'s style. (performance)
- `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverviewTabs/PrDiffTab.tsx:329-369` — `?` — files/checks lists lack `useMemo`. Bounded by file count but compounds with diff DOM overhead. (performance)
- `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverviewTabs/DiscussionsTab.tsx` — `?` — ChatMarkdown items re-render every 30 s poll. Could memoize rows or wrap in `React.memo`. (performance)

## Cross-cutting groups

**Round metadata pipeline** (fix together):
- [blocker-req] REQ-M1: `claudeSessionId` not written to reviewer `state.json` → reviewer JSONL never loads
- [high-1] ReviewerRoundSummary type mismatch → `cost`, `durationSec`, `findings` always null
- [high-2] NaN guard missing in duration calc

**Zone A/B enrichment + action parity** (fix together):
- [blocker-2] Action parity missing — no `getZoneAActions`, `getZoneBActions`
- [blocker-6] Density rules cannot apply without Zone A/B surfaces
- [high-req] REQ-P1: Zone A missing pipeline stage badge, quality gates, live cost ticker, contextual actions
- [high-req] REQ-P2: Zone B missing phase, current tool, per-session cost, round history mini-cards

**PR/Diff performance** (fix together):
- [high-3] PrDiffTab bar chart skew from one massive file
- [high-4] Sequential gh API calls in discussions

**GH API pagination** (shared root cause):
- [nit-corrections] discussions per_page=100 truncation
- [nit-performance] PR/comments per_page=100 truncation

## What's good
- Core infrastructure is solid: canonical reviewer naming (9 tests), JSONL resolution (15 tests), reviewer tree (23 tests), liveness primitives (62 tests)
- Architecture is clean: Effect RPC + raw WS terminal separation, async I/O everywhere, no `*Sync` calls introduced
- Security surface is clean: no new attack surface, no `dangerouslySetInnerHTML`, safe link attributes, path resolution is constrained
- PRD Phase 4 tabs (PR/Diff, Discussions) are fully implemented with good test coverage
- Round divider plumbing is complete end-to-end; only the data feeding is missing

## Review stats
- Blockers: 6   High: 4   Medium: 0   Nits: 5
- By reviewer: correctness=3 warnings+3 suggestions, security=0, performance=2 warnings+5 optimizations, requirements=6 blockers+7 partials
- Files touched: ~45   Files with findings: ~20

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the Synthesis Context above. Those files contain full per-reviewer detail; this synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-830 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

