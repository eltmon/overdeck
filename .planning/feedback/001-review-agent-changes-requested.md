---
specialist: review-agent
issueId: PAN-830
outcome: changes-requested
timestamp: 2026-04-26T13:42:40Z
---

# Verdict: CHANGES_REQUESTED

## Summary
PAN-830 delivers a major three-zone Command Deck surface with reviewer canonical naming, JSONL resolution, liveness primitives, and a fully-wired tabbed overview. The core architecture is sound and 19 of 28 requirements are implemented correctly. However, 4 blockers prevent merge: (1) the review-orchestrator node is missing from the session tree (PRD specifies 6 nodes, 5 are emitted), (2) the composer addressing line and spawn-and-send exceptions are not implemented, (3) task files are redundantly re-read from disk on every 5-second activity poll (hot path), and (4) `fetchIssuePullRequest` still uses shell interpolation via `execAsync` instead of `execFileAsync`. Additionally, 10 high-priority items cover Zone A/B enrichment gaps, missing color coding on ActivitySparkline, O(P×I) nested loops in the project tree endpoint, and syncCache called on every poll. Security is clean. All issues must be addressed before this PR can merge.

## Blockers (MUST fix before merge)

### 1. Review-orchestrator node missing from session tree — `command-deck.ts` + `reviewer-tree.ts` — `!`
**Raised by**: requirements
**Why it blocks**: The PRD requires exactly 6 reviewer nodes (1 orchestrator + 5 roles) per issue. Only 5 role nodes are emitted; the orchestrator node (`getTmuxSessionName('review', projectKey, issueId)`) is never created. Users cannot see or interact with the review orchestrator session in the Command Deck tree.

The comment at `reviewer-tree.ts:11` explicitly states "The orchestrator (parent `review` node) is emitted by the caller" — but the caller (`command-deck.ts`) does not emit it either. This is not a partial implementation; it is absent.

**Fix**: In `command-deck.ts` before the `buildReviewerNodes` loop (around line 435), emit a parent orchestrator node with type `'review'` and the canonical session name. Alternatively, add orchestrator emission inside `buildReviewerNodes` with a flag to skip role children when emitting the parent.

---

### 2. Composer addressing line and spawn-and-send exceptions not implemented — `ZoneCConversation.tsx` / `ComposerFooter` — `!`
**Raised by**: requirements
**Why it blocks**: REQ-28 is a hard requirement: the composer must show an addressing line (`addressing: specialist-panopticon-540-review-correctness`) in agent-selected mode, and in issue-selected mode it should be disabled with a contextual hint OR show "Spawn & Send" when zero sessions exist. None of this is implemented. The `ComposerPlaceholder` in `IssueWorkbench.tsx` does not handle any of these cases.

**Fix**: In `ZoneCConversation.tsx`, add an addressing line when a session is selected (agent-selected mode). In `ComposerPlaceholder` (or a new wrapper), implement: (1) disabled composer with hint in issue-selected mode, (2) "Spawn & Send" exception when sessions.length === 0, (3) "Spawn Work & Send" when all sessions have ended.

---

### 3. Task files double-read on 5-second activity poll hot path — `command-deck.ts:407` — `!`
**Raised by**: performance
**Why it blocks**: `fetchActivityDataWithContext` reads all task files into `taskFileContents` Map at lines 333–343, then at line 407 re-reads each file from disk via `readOptional(join(tasksDir, taskFiles[taskIdx]!))` instead of looking up the already-cached content. The activity endpoint (`/api/command-deck/activity/:id`) is polled every 5 seconds from `useActivityQuery`. With 3–10 task files per issue, this multiplies filesystem I/O by 3–10× on the hottest server path introduced by this PR.

**Fix**: Replace the disk re-read at line 407 with a Map lookup:
```typescript
const taskContent = taskFileContents.get(taskFiles[taskIdx]!);
if (taskContent) {
  const meaningfulLines = taskContent.split('\n').filter(l =>
    !l.startsWith('```') && !l.startsWith('# EXECUTE') && !l.startsWith('⚠️')
  );
  transcriptParts.push(`\n--- Task ---\n${meaningfulLines.slice(0, 5).join('\n')}`);
}
```

---

### 4. `fetchIssuePullRequest` uses `execAsync` (shell interpolation) instead of `execFileAsync` — `issues.ts:2530–2532` — `!`
**Raised by**: correctness
**Why it blocks**: `fetchIssuePullRequest` constructs shell commands via string interpolation through `execAsync`, while `fetchIssueDiscussions` (lines 2733–2744) correctly uses `execFileAsync` with argument arrays for the same `gh pr list` operation. `execAsync` passes commands to `/bin/sh -c`, where `$`, backticks, and `"` are interpreted. `repoArg` and `branchName` are currently safe, but the inconsistency means one path is hardened and the other is not — and if `isGitHubIssue` validation is ever relaxed or this function is called from another context, shell injection becomes possible. This is a reachable code path in production.

**Fix**: Replace the three `execAsync` calls in `fetchIssuePullRequest` with `execFileAsync` + argument arrays, matching the pattern in `fetchIssueDiscussions`:
```typescript
const { stdout } = await execFileAsync(
  'gh',
  ['pr', 'list', '--repo', repoArg, '--head', branchName, '--state', 'all',
   '--json', 'number', '--limit', '1', '--jq', '.[0].number'],
  { encoding: 'utf-8', timeout: 15000 },
);
```

---

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. Zone B has no detailed elements (phase+tool, round history, cost rate, output buffer, idle warning) — `ZoneB.tsx` — `~`
**Raised by**: requirements
**Why it blocks**: The PRD specifies five detailed Zone B elements: "Phase + tool inline (live)", "Round history mini-cards", "Per-session cost rate", "Output buffer counter", "Idle warning ribbon". None of the five are implemented. The component is a stripped-down status strip.

**Fix**: Expand `ZoneB.tsx` using the already-built `ToolFlash`, `RoundCard`, and `LiveCounter` components. Add: phase+tool line from `session.currentTool`, round history from `session.roundHistory`, cost rate from `session.costPerMinute`, output buffer counter, and idle warning ribbon.

---

### 2. Zone A has no detailed elements (stage dots, quality gates, sparkline, stuck ribbon, stash warning) — `ZoneA.tsx` — `~`
**Raised by**: requirements
**Why it blocks**: The PRD specifies five detailed Zone A enrichments: "Six circles connected by a thin line" (stage dots planning·work·verify·review·test·merge), "Quality gates rollup pills", "Activity sparkline", "Stuck warning ribbon", "Salvageable stash warning". None are implemented. The current `IssueHeader` is significantly simpler.

**Fix**: Add sub-components (or expand `ZoneA.tsx`/`IssueHeader.tsx`) for: 6 stage dots with done/current/pending states, quality gates rollup, activity sparkline in header, stuck warning ribbon, salvageable stash warning.

---

### 3. ActivitySparkline has no event-type color coding — `ActivitySparkline.tsx` — `~`
**Raised by**: requirements
**Why it blocks**: The PRD requires color-coded bars (green=success, blue=info, purple=review, orange=warning, red=failure). All bars currently use `var(--primary)`. The `SparklineEvent` interface lacks a `type` or `category` field, so color-coding is impossible with the current API.

**Fix**: Extend `SparklineEvent` with a `category` field and add color mapping in `ActivitySparkline.tsx` using the PRD's color scheme.

---

### 4. `syncCache()` called on every 5-second activity poll — `command-deck.ts:502` — `~`
**Raised by**: performance
**Why it blocks**: `syncCache()` is invoked unconditionally on every `fetchActivityData` call. If it re-scans the cost tracking directory, this is redundant filesystem scanning at human timescales (agent completions), not every 5 seconds. With multiple concurrent users, this amplifies server load unnecessarily.

**Fix**: Either (1) make `syncCache` a no-op when its mtime hasn't changed, (2) cache the cost lookup with a short TTL (e.g., 30s), or (3) move sync to a background job.

---

### 5. O(P × I) nested loops in `fetchProjectTree` — `command-deck.ts:1289–1307, 1325–1347` — `~`
**Raised by**: performance
**Why it blocks**: `fetchProjectTree` iterates over all issues twice inside the per-project loop. With 10 projects and 500 issues, that's 10,000 iterations per call. The endpoint is polled every 10 seconds. Pre-grouping issues by source/project prefix reduces this to O(P + I).

**Fix**: Pre-group `allIssues` into `rallyIssuesByProject` and `trackerIssuesByPrefix` Maps before the project loop. Then use direct Map lookups inside the loop instead of scanning all issues twice per project.

---

### 6. Date object allocation in sort comparator — `command-deck.ts:492–496` — `~`
**Raised by**: performance
**Why it blocks**: The `sections.sort()` comparator allocates `new Date()` objects on every comparison. With 20+ sections (planning + work + 5 reviewers + test + merge), that's ~200 Date allocations per request on a 5-second poll.

**Fix**: Use lexical string comparison since ISO 8601 strings sort lexicographically:
```typescript
return a.startedAt.localeCompare(b.startedAt);
```

---

### 7. Reviewer JSONL resolution uses wrong project directory — `reviewer-tree.ts:189–192` — `~`
**Raised by**: correctness
**Why it blocks**: `buildReviewerNodes` passes `opts.workspacePath` to `resolveJsonlPath`, but reviewer sessions are spawned from `packageRoot`. Claude Code stores JSONL transcripts relative to the cwd at launch time, so the encoded paths differ and `hasJsonl` is always `false`. Reviewer conversations never render in Zone C.

**Fix**: Pass the reviewer's actual cwd (`packageRoot`) to `resolveJsonlPath` for reviewer sessions, or add a `cwdOverride` parameter to `BuildReviewerNodesOptions`.

---

### 8. Round divider wiring from `roundMetadata` to timeline not implemented — `ZoneCConversation.tsx` — `~`
**Raised by**: requirements
**Why it blocks**: `RoundMarker` interface exists in `MessagesTimeline.tsx` and `ZoneCConversation` accepts `roundMarkers` prop, but no code derives `roundMarkers` from session `roundMetadata`. The derivation is explicitly marked as deferred in a comment.

**Fix**: Derive `RoundMarker[]` from `session.roundMetadata` in `IssueWorkbench` or `ZoneCConversation` and pass them through to `ConversationPanel`.

---

### 9. Parity smoke test does not walk existing surfaces — `commandDeckActions.test.ts` — `~`
**Raised by**: requirements
**Why it blocks**: The test verifies that Command Deck action keys are reachable from pipeline states, but does not walk the actual existing surfaces (KanbanBoard, InspectorPanel, BadgeBar, StatusFlowControl, WorkspacePane) to assert their labeled actions are present in `getZoneAActions`/`getZoneBActions`. It only tests the inverse, which doesn't catch drift.

**Fix**: Extend the smoke test to read action labels from the existing surface files and assert presence in the Command Deck action output.

---

## Nits (advisory — safe to defer)

- `CommandDeck/index.tsx:61` — `≉` — `pickBestSession` sorts instead of scanning. Use a single linear scan instead of copying and sorting the entire sessions array. (performance)
- `MessagesTimeline.tsx:189` — `≉` — Defensive deduping of virtual items is unnecessary; `useVirtualizer.getVirtualItems()` does not produce duplicates. Remove `dedupedVirtualItems`. (performance)
- `ZoneCOverviewTabs/OverviewTab.tsx:301–309` — `?` — PR summary placeholder text is stale; the PR/Diff tab was fully implemented. Update the placeholder or wire in `usePrQuery` data. (requirements)
- `ZoneCOverviewTabs/OverviewTab.tsx:291–299` — `?` — Test summary is a documented placeholder (D9: deferred). No action required, flagged for completeness. (requirements)
- `src/dashboard/frontend/src/components/CommandDeck/index.tsx:211–242` — `?` — WebSocket subscription re-runs every 10s because `projects` is a new array identity on every `useQuery` refetch. Consider using a stable project-key list. (performance)

---

## Cross-cutting groups

**command-deck.ts:jsonl-and-task-file-lookups** (related: both involve path resolution and file content retrieval):
- [blocker-3] Task files double-read on activity poll (command-deck.ts:407) — fix by using cached Map
- [high-7] Reviewer JSONL resolution uses wrong project directory (reviewer-tree.ts:189) — fix by passing packageRoot instead of workspacePath
- [high-4] syncCache called on every 5-second poll (command-deck.ts:502) — fix by adding TTL or mtime-based guard

**command-deck.ts:performance-on-poll-endpoints** (activity and project tree polled frequently):
- [blocker-3] Task files double-read (command-deck.ts:407)
- [high-4] syncCache on every poll (command-deck.ts:502)
- [high-5] O(P×I) nested loops in fetchProjectTree (command-deck.ts:1289)
- [high-6] Date allocation in sort comparator (command-deck.ts:492)
- [nit-1] pickBestSession sorts instead of scanning (index.tsx:61)

**requirements-gaps-cluster** (Zone A/B and tab enrichment partially implemented):
- [high-1] Zone B missing 5 elements
- [high-2] Zone A missing 5 elements
- [high-3] ActivitySparkline color coding absent
- [high-8] Round divider wiring not implemented
- [nit-3] OverviewTab PR summary placeholder stale
- [nit-4] OverviewTab test summary placeholder (documented defer)

**session-tree-orchestrator-gap** (reviewer tree missing parent orchestrator):
- [blocker-1] Review-orchestrator node missing from session tree (command-deck.ts + reviewer-tree.ts)
- [blocker-2] Composer addressing line and spawn-and-send exceptions not implemented (ZoneCConversation.tsx)

---

## What's good
- Three-zone Command Deck architecture (Zone A/B/C dispatch, tab wiring) is correctly implemented across all components
- Reviewer canonical naming and session resumption across rounds (`runParallelReview` + `sessionExistsAsync`) works as specified
- JSONL resolver is a clean extraction with proper fallback lookup order (session.id → sessions.json → runtime state)
- Canonical reviewer round archival (`archiveReviewerRound`) correctly writes round-N.json artifacts
- All 5 liveness components (StatusDot, LiveCounter, ActivitySparkline, RoundCard, ToolFlash) are implemented with tests
- Security review is clean: shell interpolation fixed in command-deck.ts, JSONL path resolution avoids user-controlled path concatenation, frontend markdown uses the existing allowlisted renderer
- Reviewer tree emits 5 role nodes in correct `REVIEWER_ROLES` order; the architecture is correct except for the missing orchestrator parent
- PR/Discussions backend endpoints (`fetchIssuePullRequest`, `fetchIssueDiscussions`) are well-structured with proper error handling (the `execAsync` issue in `fetchIssuePullRequest` is a blocker, but the overall structure is sound)
- 19 of 28 PRD requirements are fully implemented

---

## Review stats
- Blockers: 4   High: 10   Medium: 0   Nits: 5
- By reviewer: correctness=4 findings (0 critical, 2 warnings, 2 suggestions), security=0 findings (clean), performance=6 findings (1 critical, 3 warnings, 2 optimizations), requirements=9 findings (2 blockers, 7 partial/high)
- Files touched: 93 (across all reviewers)
- Files with findings: 17 (command-deck.ts, reviewer-tree.ts, issues.ts, ZoneB.tsx, ZoneA.tsx, ActivitySparkline.tsx, ZoneCConversation.tsx, commandDeckActions.test.ts, index.tsx, MessagesTimeline.tsx, OverviewTab.tsx)

---

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the Synthesis Context above. Those files contain full per-reviewer detail; this synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-830 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

