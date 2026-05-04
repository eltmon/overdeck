---
specialist: review-agent
issueId: PAN-936
outcome: changes-requested
timestamp: 2026-05-03T11:05:46Z
---

# Verdict: CHANGES_REQUESTED

## Summary

PAN-936 adds Rally Feature planning support end-to-end: FeatureCard action bar, click-to-select for features and child stories, InspectorPanel feature actions, the `getChildIssues` interface and Rally implementation, feature-aware planning prompt with child story section, and FEATURE-CONTEXT.md injection for story work agents. The implementation is largely complete and well-structured — 36 of 42 acceptance criteria are fully met. However, six blockers prevent merge: a command injection RCE in the merge-failure notification path, an O(N) timer bug on the main kanban view, a broken FEATURE-CONTEXT.md delivery path (file written to the feature workspace, never copied to story workspaces where it's actually consumed), a missing InspectorPanel gate for closed-feature Plan buttons, and two missing tests promised in the vBRIEF. All six are fixable without architectural changes.

## Blockers (MUST fix before merge)

### 1. Command Injection via unsanitized `notes` field — `specialists.ts:547` — `!`
**Raised by**: security
**Why it blocks**: `notes` from the POST body flows unsanitized into an `execAsync` shell command, enabling arbitrary code execution for any caller who can POST to the dashboard API.

Replace `execAsync` with `execFileAsync` (no shell expansion) and pass arguments as an array:
```typescript
// BEFORE — dangerous
await execAsync(
  `gh api repos/${owner}/${repo}/issues/${prNumber}/comments -f body=${JSON.stringify(commentBody)}`,
  { encoding: 'utf-8' },
);

// AFTER — safe
await execFileAsync(
  'gh',
  ['api', `repos/${owner}/${repo}/issues/${prNumber}/comments`, '--field', `body=${commentBody}`],
  { encoding: 'utf-8' },
);
```
Note: use `--field` (not `-f`) with `execFileAsync` — no shell to expand `$()` or backticks.

---

### 2. O(N) concurrent 1Hz `setInterval` timers, each triggering 2 re-renders/sec — `KanbanBoard.tsx:80` — `!`
**Raised by**: performance
**Why it blocks**: Every active-agent card mounts an independent 1Hz timer with two separate `setState` calls, causing N×2 re-renders/sec on the primary dashboard view. At N=20 agents this produces 40 state updates/sec — visible frame drops on the main screen.

Batch the two state updates into a single object to halve the re-render count; also memoize the base timestamp to avoid repeated `new Date(string)` parsing on every tick:
```tsx
const baseTime = useMemo(() => new Date(lastActivity).getTime(), [lastActivity]);
const [display, setDisplay] = useState<{ label: string; style: ... }>({
  label: '', style: kbStalenessStyle(0)
});
const update = () => {
  const ms = Date.now() - baseTime;
  if (ms < 2000) { setDisplay(d => ({ ...d, label: '' })); return; }
  setDisplay({ label: kbFormatLastHeard(ms), style: kbStalenessStyle(ms) });
};
```
For a larger reduction, lift the interval to the KanbanBoard level so all badges update in one render pass (Option B from performance review).

---

### 3. FEATURE-CONTEXT.md written to feature workspace, never delivered to story workspaces — `spawn-planning-session.ts:443` — `~`
**Raised by**: correctness, requirements
**Why it blocks**: The consumer (`readFeatureContext` in `work-agent-prompt.ts:274`) reads from the story workspace's `.planning/FEATURE-CONTEXT.md`, but the producer writes the file to the feature workspace's `.planning/` directory. Story work agents will never receive feature context — the primary value of this feature is silently a no-op. AC `feature-context-injection.ac1` and `ac2` are unmet.

Fix: when spawning a work agent for a Rally story that has a `parentRef`, locate the parent feature's workspace (`workspaces/feature-<parentRef.toLowerCase()>/`) and copy `FEATURE-CONTEXT.md` from the feature workspace's `.planning/` into the story workspace's `.planning/` directory before the work agent starts. Alternatively, update `readFeatureContext` to also search the parent feature's workspace path when no local file is found.

---

### 4. Plan button shown for closed/done features in InspectorPanel — `ActionsSection.tsx:332` — `~`
**Raised by**: correctness, requirements
**Why it blocks**: `KanbanBoard.tsx:767` correctly gates the Plan button by feature status (`!== 'done' && !== 'canceled'`), but `ActionsSection.tsx:332` has no such gate — it renders the Plan button whenever `isFeature && onPlan`. A Done/Closed Rally Feature will show Plan in InspectorPanel. AC `derivedstatus-plan-gate.ac3` is unmet.

Fix: in `ActionsSection.tsx`, add a status gate matching the FeatureCard logic. Pass `issueStatus` (or an `isClosedFeature` bool) from `InspectorPanel.tsx` (which already has `issue?.status`) down to `ActionsSection`:
```tsx
{isFeature && onPlan && !isClosedFeature && (
  <button data-testid="inspector-plan-feature" ...>
```

---

### 5. Missing test: `GitHubTracker.getChildIssues()` returns empty array — `tests/lib/tracker/github.test.ts` — `!`
**Raised by**: requirements
**Why it blocks**: vBRIEF item `test-get-child-issues.ac3` promises this test; none exists. The GitHub implementation at `github.ts:241` returns `[]` but is untested — a future refactor could silently break the interface contract.

Add a test (in `tests/lib/tracker/github.test.ts` or alongside the Rally tests) calling `githubTracker.getChildIssues('some-id')` and asserting the result is `[]`.

---

### 6. Missing test: FEATURE-CONTEXT.md is written with correct content — `spawn-planning-session.ts:443` — `!`
**Raised by**: requirements
**Why it blocks**: vBRIEF item `test-feature-planning-pipeline.ac2` promises a test for the file-writing path. The existing `spawn-planning-session.test.ts` only tests `buildPlanningPrompt`, not the file-write in `spawnPlanningSession`. Lines 443-461 have zero test coverage; a regression in path, format, or condition guard would go undetected.

Add a test that calls `spawnPlanningSession` (or an integration wrapper) with a mocked `artifactType` containing `'PortfolioItem'` and asserts that `.planning/FEATURE-CONTEXT.md` is created with the expected parent feature title and vBRIEF narrative content.

---

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. Command injection via URL-param `issueIdentifier` in `execAsync` — `issues.ts:840` — `~`
**Raised by**: security

`issueIdentifier` is derived from the `id` URL path param (user-controlled) and interpolated into an `execAsync` shell string. If Effect's router doesn't strip shell metacharacters from percent-encoded path segments, this is equivalent to finding #1. Replace with `execFileAsync`:
```typescript
await execFileAsync('pan', ['workspace', 'destroy', issueIdentifier!.toLowerCase(), '--force'], {
  cwd: projectPath, encoding: 'utf-8', timeout: 120000,
});
```

---

### 2. Polling storm — 5 independent polling queries when InspectorPanel is open — `InspectorPanel.tsx:186` — `~`
**Raised by**: performance

With 3 panels open simultaneously, up to 15 requests/sec hit 5 separate endpoints at uncoordinated intervals (5s, 15s, 30s, 30s, 60s). Consolidate workspace + containers + stash into a single polling endpoint, or lift all polling into one `useEffect` orchestrator that fires one batched request per cycle.

---

### 3. `updateIssue` makes 3 Rally API calls (fetch → update → re-fetch) — `rally.ts:269` — `~`
**Raised by**: performance

The re-fetch after update is unnecessary. `updateRally` returns `OperationResult.Object` with the updated artifact. Reconstruct the normalized issue from the known pre-update artifact merged with the update payload:
```typescript
const updatedArtifact = { ...artifact, ...updatePayload };
return this.normalizeIssue(updatedArtifact);
```
Eliminates ~300ms per Rally state transition.

---

### 4. `listIssues` over-fetches up to 4× the requested limit — `rally.ts:163` — `~`
**Raised by**: performance

With `limit=50` and 4 artifact types, up to 200 items are fetched and then sliced to 50. Use a proportional per-type limit with a safety buffer:
```typescript
const perTypeLimit = Math.ceil(limit / QUERYABLE_TYPES.length) * 2;
```
Reduces Rally API payload transfer by ~60–75% at the default limit.

---

### 5. `hasBeads: boolean` required prop missing from test `defaultProps` — `ActionsSection.test.tsx:120` — `~`
**Raised by**: correctness

`ActionsSectionProps` declares `hasBeads: boolean` as required (line 31), but `defaultProps` in the test file passes `beadsCount: 0` (deprecated) without `hasBeads`. Every spread of `{...defaultProps}` sends `undefined` for a required boolean. Add `hasBeads: false` to `defaultProps` (and remove the deprecated `beadsCount` if appropriate). This is likely the source of some of the 9 verification-gate failures.

---

### 6. `parentRef` not asserted in `rally-getChildIssues` test — `src/lib/tracker/__tests__/rally-getChildIssues.test.ts:57` — `~`
**Raised by**: correctness

AC `get-child-issues-rally.ac2` states "Returned issues are normalized with `parentRef` set to the feature ID," but the test at line 105-112 checks only `ref`, `title`, and `state`. The mock data also lacks a `PortfolioItem` field, so `normalizeIssue` would set `parentRef = undefined`, causing any added assertion to fail. Fix: add `PortfolioItem: { FormattedID: 'F123' }` to mock story objects, and add `expect(result[0].parentRef).toBe('F123')`.

---

## Nits (advisory — safe to defer)

- `spawn-planning-session.ts:236` — `?` — Over-escaped backticks: `\\\`blocks\\\`` renders as `\`blocks\`` with visible backslashes; use `` \`blocks\` `` or `` `blocks` `` (single-escape or no-escape). (correctness)
- `tests/fixtures/synced-skills.txt` — `?` — Fixture may still be missing `pan-resources`; verify it's in alphabetical position between `pan-quickstart` and `pan-restart`. Commit `6863a8733` may already address this — confirm tests pass. (correctness)
- `vbrief/beads.ts:241` — `?` — Bead creation is serial; items at the same topo-depth could be parallelized (planning-time only, not hot path). (performance)
- `beads-query.ts:19` — `?` — `readBeadsFromJsonl` does a full linear scan; irrelevant at current JSONL sizes but worth noting. (performance)
- `done-preflight.ts:114` — `?` — `readdirSync` in CLI-only code; consider `await readdir()` defensively in case this is ever imported into a server route. (performance)
- `rally-client.ts:178` — `?` — Cache key includes `apiKey.slice(-4)`; use a truncated hash instead of a key substring to avoid partial secret leakage in logs. (security)
- `KanbanBoard.test.tsx` — `?` — No test explicitly passes `hasPlan: true` for the See Plan label; only tested via the label side-door (`labels: ['planned']`). Add a `createMockFeature({ hasPlan: true })` test. (requirements)
- `ActionsSection.test.tsx` — `?` — No explicit `isFeature={false}` regression test for Start Agent visibility; currently covered incidentally. Add a named test for clarity. (requirements)

---

## Cross-cutting groups

**Command injection pair** (fix together — same root cause, same fix pattern):
- [blocker-1] Command injection in `specialists.ts:547` via `notes` field
- [high-1] Command injection in `issues.ts:840` via `issueIdentifier` URL param
Both: replace `execAsync(template-string)` with `execFileAsync(cmd, args[])`.

**FEATURE-CONTEXT.md delivery pipeline** (fix together — the broken write path and the missing test for that path share the same code block):
- [blocker-3] File written to wrong workspace (feature not story)
- [blocker-6] No test for the file-writing path in `spawnPlanningSession`
Fix blocker-3 first, then write the test covering the corrected behavior.

**Missing test trio** (add together in one test-writing pass):
- [blocker-5] GitHubTracker.getChildIssues returns empty array
- [blocker-6] FEATURE-CONTEXT.md write path
- [high-6] parentRef assertion in rally-getChildIssues.test.ts

---

## What's good

- Rally `getChildIssues` implementation is thorough: queries both `hierarchicalrequirement` and `defect` types, validates IDs, handles errors gracefully, and normalizes correctly.
- FeatureCard click-to-select split (title vs chevron) is clean — stopPropagation on the chevron prevents cross-contamination, and the tests verify both paths explicitly.
- The effect hierarchy (spawn-planning-session detecting `PortfolioItem` → child stories fetch → planning prompt injection) is a solid design with good separation of concerns.
- No new blocking sync I/O was introduced in dashboard server routes — CLAUDE.md constraints respected.
- 36 of 42 ACs fully implemented and verified — a high completion rate for a complex cross-cutting feature.
- InspectorPanel's `isFeature` gating for Start/Stop/Resume agent buttons is correct and fully tested.

---

## Review stats
- Blockers: 6   High: 6   Medium: 0   Nits: 8
- By reviewer: correctness=4, security=3, performance=7, requirements=6
- Files touched: 54   Files with findings: 12

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

