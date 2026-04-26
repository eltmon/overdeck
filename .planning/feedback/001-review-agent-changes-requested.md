---
specialist: review-agent
issueId: PAN-830
outcome: changes-requested
timestamp: 2026-04-26T12:22:12Z
---

# Verdict: CHANGES_REQUESTED

## Summary

PAN-830 implements the Unified Command Deck: three-zone shell (Zone A/B/C), canonical reviewer naming with session reuse across rounds, JSONL path resolution fix, liveness building blocks (RoleBadge, StatusDot, LiveCounter, ToolFlash, ActivitySparkline), and 10-tab overview panel. Core infrastructure is solid and the command injection hardening (added to `issues.ts` and `command-deck.ts`) is correct and necessary.

However, this PR has **9 blockers** that must be addressed before merge:
- 2 command-injection vectors (correctness, MUST fix before merge)
- 1 React Rules-of-Hooks violation in `PrDiffTab` (both correctness and performance flagged this, MUST fix)
- 6 missing PRD acceptance criteria (requirements, MUST fix before merge)

Additionally, 3 high-priority performance issues and 4 nits are listed below. The work agent should address blockers first, then the high-priority performance items before signaling completion.

---

## Blockers (MUST fix before merge)

### 1. Command injection via `reason` parameter in `closeIssuePullRequest` — `src/dashboard/server/routes/issues.ts:155` — `!`

**Raised by**: correctness

**Why it blocks**: User-controlled `reason` string is interpolated directly into a shell command. A `reason` containing `"` or `$(...)` enables arbitrary command execution as the server process user. Same class of bug fixed in commit `e65a3c8c` for other locations but missed here.

**Fix**: Use `execFileAsync` with an argument array (the discussions endpoint already does this for `gh pr list`):

```typescript
await execFileAsync('gh', [
  'pr', 'close', prNumber,
  '--repo', `${githubCheck.owner}/${githubCheck.repo}`,
  '--comment', reason,
], { encoding: 'utf-8', timeout: 15000 });
```

### 2. Shell injection via `providerEnvStr` in status-review — `src/dashboard/server/routes/command-deck.ts:807` — `!`

**Raised by**: correctness

**Why it blocks**: `providerEnvStr` is built from API key values interpolated into a shell command string. If any API key contains `"` or `$()`, command injection occurs. Even without malicious intent, keys containing special characters break the `exec` call silently.

**Fix**: Use `env` option of `execAsync` instead of shell interpolation:

```typescript
const env = { ...process.env, ...envVars };
await execAsync(`${cliCmd} -p${modelFlag} --no-session-persistence`, {
  encoding: 'utf-8', timeout: 120000, maxBuffer: 1024 * 1024,
  env,
  input: await readFile(promptFile, 'utf-8'),
});
```

### 3. `useMemo` called inside JSX conditional render — `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverviewTabs/PrDiffTab.tsx:424-431` — `!`

**Raised by**: correctness, performance

**Why it blocks**: React hooks **must** be called at the top level of a component function, never inside conditionals or nested functions. The `useMemo` call inside a JSX conditional block violates Rules of Hooks and causes stale memoized values, incorrect hook ordering after conditional toggles, and unpredictable behavior during Fast Refresh or concurrent rendering. This is a correctness issue, not just a performance concern.

**Fix**: Move the memo to the component top level:

```tsx
export function PrDiffTab({ issueId }: PrDiffTabProps) {
  const { data, isLoading, isError } = usePrQuery(issueId);
  const diffRows = useMemo(() => {
    if (!data?.diff) return null;
    return data.diff.split('\n').map((line, idx) => {
      const color = diffLineColor(line);
      return <div key={idx} style={color ? { color } : undefined}>{line || '\u00A0'}</div>;
    });
  }, [data?.diff]);
  // ...
  {data.diff && diffRows && (
    <pre>{diffRows}</pre>
  )}
}
```

### 4. Tree status filter `[All] [Alive] [Failed]` not implemented — `!`

**Raised by**: requirements

**Why it blocks**: Explicitly stated in PRD tree behavior section as a required feature. Users cannot filter the session tree to focus on active or failed sessions.

**Fix**: Add filter UI in `ProjectNode` or tree header with filter logic applied to `features.sessions` before rendering.

### 5. Right-click context menu on session nodes not implemented — `!`

**Raised by**: requirements

**Why it blocks**: Explicitly stated in PRD tree behavior section. Users cannot access session actions directly from the tree; they must select the session first and use Zone B.

**Fix**: Add `onContextMenu` handler on session rows in `FeatureItem` or tree rendering, mirroring Zone B contextual actions.

### 6. Done-state collapse / in-flight expand defaults not implemented — `!`

**Raised by**: requirements

**Why it blocks**: Explicitly stated in PRD tree behavior section. Currently all project nodes default to the same expand state regardless of issue status, violating the PRD's density principle.

**Fix**: `ProjectNode` or `FeatureItem` should read issue status and set `expanded` accordingly — done-state issues default to collapsed; in-flight issues default to expanded.

### 7. Issue-row StatusDot dominant aggregation not implemented — `!`

**Raised by**: requirements

**Why it blocks**: Explicitly stated in PRD tree behavior section. The issue/feature row in the tree should show a `StatusDot` reflecting the dominant state of its child sessions.

**Fix**: `FeatureItem` should compute dominant session state and render `StatusDot` on the issue row.

### 8. Event-driven motion catalog not wired to domain events — `!`

**Raised by**: requirements

**Why it blocks**: The PRD acceptance criterion explicitly requires: "Every domain event in the catalog triggers its prescribed motion within 200ms." The liveness components (LiveCounter, ToolFlash, StatusDot, ActivitySparkline) exist and can animate, but they are not connected to domain events. Data updates only via `useQuery` polling — the core "north-star principle: liveness" is not realized.

**Fix**: Add `subscribeDomainEvents` event listeners/hooks in `IssueWorkbench`, `ZoneA`, `ZoneB`, `ZoneCOverview` that subscribe to domain events and trigger matching animations within 200ms.

### 9. `getZoneAActions` missing explicit branches for many pipeline states — `~` (High, blocking per requirements policy)

**Raised by**: requirements

**Why it blocks**: The PRD specifies a 16+ state-to-actions table. The current implementation uses a simpler 5-branch heuristic (merge, reviewTest, recover, stopAgent/startAgent/resumeSession, artifacts). Several explicit pipeline states from the PRD table are missing: `Planning` (active), `Planning Done · Awaiting Work`, `In Progress · work idle`, `Verification failing`, `In Review · reviewers running`, `In Review · CHANGES_REQUESTED`, `In Review · APPROVED`, `Testing · running`, `Testing · failures`, `Ready to Merge`, `Merging`, `Merged`, `Done`.

**Fix**: Add explicit conditional branches in `getZoneAActions` matching the full PRD state-to-actions table.

---

## High Priority (SHOULD fix; may still approve if justified)

### 1. Sequential file reads in `readReviewerRounds` — `src/dashboard/server/routes/reviewer-tree.ts:132-161` — `⊗`

**Raised by**: performance

`readReviewerRounds` calls `readFile` sequentially in a `for…of` loop. With 5 roles and 10+ rounds per role, this means 50+ sequential disk reads on every activity poll (every 10 s). Fix by parallelizing with `Promise.all`.

### 2. Unvirtualized discussion list in `DiscussionsTab` — `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverviewTabs/DiscussionsTab.tsx:317-319` — `~`

**Raised by**: performance

Discussion feed renders all items without virtualization. On a busy PR with 200+ comments/reviews/threads, this creates a large React tree and heavy markdown parsing upfront, causing scroll jank and slow initial render.

### 3. `existsSync` inside async server path in `getProjectPath` — `src/dashboard/server/routes/command-deck.ts:106` — `~`

**Raised by**: performance

`getProjectPath` uses dynamic `require('node:fs').existsSync` inside an async function. The dynamic `require` may break when bundled by `tsdown` for production. Replace `require('node:fs')` with a static import of `existsSync` at the top of the file.

### 4. Sequential `gh` CLI calls in `fetchIssuePullRequest` — `src/dashboard/server/routes/issues.ts:2517-2551` — `~`

**Raised by**: performance

Three sequential `gh pr list` → `gh pr view` → `gh pr diff` calls. Steps 2 and 3 depend only on the PR number and can run in parallel. On slow GitHub API conditions, this exceeds 2 s latency.

---

## Nits (advisory — safe to defer)

- `src/dashboard/server/routes/reviewer-tree.ts:101` — `≉` — Legacy reviewer-role parser uses `dashIdx <= 0` instead of `dashIdx < 0`, accidentally rejecting position-0 dashes. Minor edge case, safe to defer.
- `src/dashboard/server/routes/command-deck.ts:781-808` — `?` — status-review uses `cat | cliCmd` pipe; consider using `execAsync`'s `input` option instead.
- `src/dashboard/frontend/src/components/chat/MessagesTimeline.tsx:189-196` — `?` — `dedupedVirtualItems` IIFE runs every render; should be `useMemo`'d.
- `src/dashboard/server/routes/issues.ts:2710-2712` — `?` — `fetchIssueDiscussions` throws on invalid issue ID; consider returning an error response object instead of throwing a rejected promise.

---

## Cross-cutting groups

**Command injection (fix together):**
- [blocker-1] `issues.ts:155` — `reason` parameter interpolated into shell command
- [blocker-2] `command-deck.ts:807` — `providerEnvStr` interpolated into shell command

**React hooks violations (fix together):**
- [blocker-3] `PrDiffTab.tsx:424-431` — `useMemo` called inside JSX conditional render

**Tree behavior requirements (fix together — all relate to tree rendering):**
- [blocker-4] Tree status filter `[All] [Alive] [Failed]` toggle missing
- [blocker-5] Right-click session-action menu missing
- [blocker-6] Done-state collapse / in-flight expand defaults missing
- [blocker-7] Issue-row StatusDot dominant aggregation missing

**Domain event wiring (all relate to connecting liveness components to event stream):**
- [blocker-8] Event-driven motion catalog not wired
- [high-4] `existsSync` dynamic require in dashboard route (can be part of the same cleanup pass)

---

## What's good

- Command injection hardening was correctly applied to both identified vectors (`issues.ts` and `command-deck.ts`) — same class of bug, same fix pattern.
- Canonical reviewer naming + session reuse across rounds is correctly implemented with proper `sessionExistsAsync` check and `remain-on-exit on`.
- JSONL path resolution fix (`jsonl-resolver.ts`) correctly handles all three fallback levels.
- Three-zone shell structure (Zone A/B/C) is clean and properly gated on `isAgentSelected` vs issue-selected mode.
- All 10 tabs are wired and render their respective data without leaving Command Deck.
- TanStack Query polling cadence is appropriate (10 s for projects/costs/conversations, 30 s for discussions/PR/diff).
- `applySessionTreeDelta` is O(F+S) as documented — correct and efficient.
- Round dividers rendering in `MessagesTimeline` is correctly wired (even if the data derivation is deferred).
- No refresh buttons in Command Deck UI — data updates via polling and domain events as specified.

---

## Review stats

- Blockers: 9   High: 4   Medium: 0   Nits: 4
- By reviewer: correctness=5 (2 critical, 3 warnings), security=0, performance=8 (1 critical, 1 should-fix, 4 consider-fix, 2 noted), requirements=14 (6 missing, 8 partial)
- Files touched: ~60   Files with findings: ~14

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

