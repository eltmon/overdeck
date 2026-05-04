---
specialist: review-agent
issueId: PAN-936
outcome: changes-requested
timestamp: 2026-05-03T08:27:11Z
---

# Verdict: CHANGES_REQUESTED

## Summary

PAN-936 implements Rally Feature planning end-to-end: FeatureCard action bar, InspectorPanel feature detection, `getChildIssues` on the `IssueTracker` interface, Rally backend implementation, child-story injection into the planning prompt, and FEATURE-CONTEXT.md generation. The bulk of the feature is well-implemented and tested. However, five blockers prevent merge: (1) a guaranteed `TypeError` crash when any Rally Feature triggers `getChildIssues` via `RallyClientOptionalLive`; (2) the core FEATURE-CONTEXT.md injection into work agents is entirely absent from `work-agent-prompt.ts` — the file is written but never read; (3–4) two explicitly-required vBRIEF regression tests are missing; and (5) three `readFileSync` calls in server-reachable code violate the project-wide prohibition on blocking event-loop I/O. Eight high-priority items (missing tests, query injection, double fetches, broken cache, sync FS in background context) should also be addressed before merge but are documented as high rather than blockers where warranted.

---

## Blockers (MUST fix before merge)

### 1. `RallyClientOptionalLive` missing `getChildIssues` — guaranteed TypeError — `src/dashboard/server/services/rally-client.ts:275` — `!`
**Raised by**: correctness
**Why it blocks**: Every attempt to start planning for a Rally Feature calls `rally.getChildIssues(id)` via `issues.ts:600`; the production layer `RallyClientOptionalLive` (used by `server.ts:235`) omits this method. `Effect.catch` does not catch a synchronous `TypeError` thrown before the Effect is constructed, so the route handler crashes unconditionally.

Add the missing delegation to `RallyClientOptionalLive`:
```typescript
export const RallyClientOptionalLive = Layer.effect(
  RallyClient,
  Effect.succeed({
    getIssue: (...args) => getRallyClient().getIssue(...args),
    getChildIssues: (...args) => getRallyClient().getChildIssues(...args),  // ADD THIS
    updateState: (...args) => getRallyClient().updateState(...args),
    addComment: (...args) => getRallyClient().addComment(...args),
  } as RallyClientShape),
);
```

---

### 2. `readPlanningContext()` does not read FEATURE-CONTEXT.md — feature context is written but never consumed — `src/lib/cloister/work-agent-prompt.ts:255` — `!`
**Raised by**: requirements (as `!` MUST), correctness (as `~`); highest severity wins
**Why it blocks**: `feature-context-injection.ac2` is an explicitly-listed AC: "work-agent-prompt.ts readPlanningContext() reads FEATURE-CONTEXT.md and injects it into the work agent prompt." There is zero reference to `FEATURE-CONTEXT`, `FEATURE_CONTEXT`, or `featureContext` anywhere in `work-agent-prompt.ts`. Story work agents receive no feature-level context even when the file exists.

In `readPlanningContext` (lines 255–261), after reading `STATE.md`, also read `.planning/FEATURE-CONTEXT.md` if it exists and return or separately surface it. Pass it as a template variable (e.g. `FEATURE_CONTEXT`) to `renderPrompt`, and add `{{FEATURE_CONTEXT}}` as an optional variable in the `work.md` template.

---

### 3. Missing test: FeatureCard does NOT render Start Agent button — `src/dashboard/frontend/src/components/KanbanBoard.test.tsx` — `!`
**Raised by**: requirements (`test-featurecard-actions.ac3`)
**Why it blocks**: Explicitly listed AC; without this regression test a future refactor could silently restore the Start Agent button to FeatureCards, violating the feature's core UX contract.

Add to the FeatureCard describe block (lines 749–946):
```typescript
it('does NOT render Start Agent button', () => {
  // render FeatureCard
  expect(screen.queryByText(/Start Agent/i)).toBeNull();
});
```

---

### 4. Missing test: Feature with `derivedStatus='in_progress'` and `status='todo'` shows Plan button — `src/dashboard/frontend/src/components/KanbanBoard.test.tsx` — `!`
**Raised by**: requirements (`test-featurecard-actions.ac4`)
**Why it blocks**: The derivedStatus-gating fix (using `feature.status` not `derivedStatus`) is the highest-priority correctness change in Phase 1. Without this specific regression test, the fix can silently regress.

Add to the FeatureCard describe block:
```typescript
it('shows Plan button when derivedStatus is in_progress but status is Todo', () => {
  const feature = { ...baseFeature, status: 'Todo', derivedStatus: 'in_progress' };
  // render FeatureCard with this feature
  expect(screen.getByTestId('action-plan-<id>')).toBeInTheDocument();
});
```

---

### 5. `readFileSync` in server-reachable route code — three locations — `⊗`
**Raised by**: performance (three separate `⊗` MUST NOT findings)
**Why it blocks**: CLAUDE.md prohibits all sync FS reads in any code reachable from dashboard server routes. All three violate this rule and block the Node.js event loop on every triggering request.

- **`src/lib/beads-query.ts:22`** — `readBeadsFromJsonl` called from `workspaces.ts:buildRichPRBody`. Convert to `await readFile(jsonlPath, 'utf-8')` from `node:fs/promises`.
- **`src/lib/vbrief/beads.ts:311`** — `readBeadTitleFromJsonl` called by `syncBeadStatusToVBrief`, imported by route code. Make `readBeadTitleFromJsonl` async; cascade async up through `syncBeadStatusToVBrief` and its callers.
- **`src/dashboard/server/routes/workspaces.ts:634`** — local duplicate of the above. Convert to async `readFile` or delete the duplicate and use the fixed version from `beads-query.ts`.

---

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. FEATURE-CONTEXT.md written to feature workspace instead of story workspace — `src/lib/planning/spawn-planning-session.ts:439` — `~`
**Raised by**: correctness, requirements (REQ-A)
`feature-context-injection.ac1` specifies writing to the **story workspace**. The current code writes to the feature's own `.planning/` directory. Story agents cannot discover this file from their workspace without additional cross-workspace lookup logic. If Blocker #2 is fixed (readPlanningContext reads the file), this placement error means the injection fires only when a feature plans itself — not when story agents run.

Add logic (in workspaces route or spawn flow for story issues) to detect `parentRef`/`artifactType`, locate `workspaces/feature-<featureId>/.planning/plan.vbrief.json`, and write `FEATURE-CONTEXT.md` into the story's `.planning/` directory at agent spawn time.

### 2. Missing test: FEATURE-CONTEXT.md write during `spawnPlanningSession` — `src/lib/planning/__tests__/spawn-planning-session.test.ts` — `~`
**Raised by**: correctness, requirements (REQ-B)
`test-feature-planning-pipeline.ac2` is marked completed but no test calls `spawnPlanningSession()` and asserts `FEATURE-CONTEXT.md` was written with correct content. Add an integration-style test or extract the write logic into a testable unit.

### 3. Rally WSAPI query injection — unsanitized `id` and `parentId` in query strings — `src/lib/tracker/rally.ts:230,451` — `~`
**Raised by**: security
`id` arrives from an HTTP path parameter and is interpolated verbatim into `(FormattedID = "${id}")`. An attacker with dashboard access can widen the WSAPI query to return all artifacts. Risk is limited to information disclosure within the already-accessible Rally workspace (no privilege escalation), but the injection surface is unnecessary.

Validate Rally IDs against `/^[A-Za-z]+\d+$/` before building query strings. For filter values in `buildQueryStringForType`, escape double-quotes: `s.replace(/"/g, '\\"')`.

### 4. Double WSAPI fetch in `updateIssue` — `src/lib/tracker/rally.ts:250` — `~`
**Raised by**: performance
`updateIssue` makes two sequential Rally WSAPI round-trips: the first `getIssue` call already fetches `ObjectID`, yet a second query re-fetches the same field. At 200–500ms per round-trip over WAN, this doubles latency on every state transition. Restructure to a single query that retrieves both display fields and `_ref`.

### 5. Double WSAPI fetch in `getComments` — `src/lib/tracker/rally.ts:333` — `~`
**Raised by**: performance
Same pattern as finding #4: `getIssue` is called but its result is unused; a second query immediately follows for the same artifact. Remove the `getIssue` call and rely solely on the targeted `ObjectID/_ref/Discussion` query.

### 6. `_rallyClientImpl` cache variable is declared but never populated — `src/dashboard/server/services/rally-client.ts:164` — `~`
**Raised by**: performance
`getRallyClient()` allocates a new `RallyTracker` instance on every call despite declaring `_rallyClientImpl` as a cache slot. The cache is cleared on config change (line 182) but never set. Under dashboard polling with multiple Rally issues this amplifies GC pressure. Populate `_rallyClientImpl` after first construction and return the cached instance on subsequent calls with the same config key.

### 7. Sync FS calls in `spawnPlanningSession` — `src/lib/planning/spawn-planning-session.ts:308` — `~`
**Raised by**: performance
`spawnPlanningSession` is async/background but runs in the dashboard server process. It uses `readFileSync`, `readdirSync`, `mkdirSync`, and `writeFileSync` throughout (lines 37, 308–309, 355, 374–376, 392, 421, 436, 467–468, 511). CLAUDE.md prohibits sync FS in any server code — "CLI commands only." Convert to `await readFile`, `await readdir`, `await mkdir`, `await writeFile` from `node:fs/promises`.

### 8. Missing test: CompactChildCard identifier link click does NOT fire `onSelect` — `src/dashboard/frontend/src/components/KanbanBoard.test.tsx` — `~`
**Raised by**: requirements (REQ-C / `test-click-to-select.ac2`)
Only the positive half of AC2 is tested (clicking the card fires `onSelect`). No test asserts that clicking the `<a>` identifier link does NOT call `onSelect`. Add the negative assertion to the existing CompactChildCard click test.

---

## Nits (advisory — safe to defer)

- `src/dashboard/frontend/src/components/KanbanBoard.tsx:722` — `?` — Action bar gap area propagates click to `onSelect`. Add `onClick={(e) => e.stopPropagation()}` to the action bar container div. (correctness)
- `src/lib/tracker/rally.ts:451` — `?` — `buildQueryStringForType` filter values (`assignee`, label, `query`) also lack escaping (same injection surface as blocker #3's `id`; low risk for filter fields since they come from UI inputs, but should escape for consistency). (security)
- `src/dashboard/server/routes/workspaces.ts:2226` — `?` — `projectName` interpolated into shell command string; use `execFileAsync` with array args to remove the injection surface. (security)
- `src/dashboard/server/routes/workspaces.ts:2109` — `?` — Container action route constructs workspace path from `issueId` without `parseIssueId` validation; inconsistent with peer routes that have path-traversal checks. (security)
- `src/dashboard/server/routes/workspaces.ts:352` — `?` — `requireTrustedMutationOrigin` applied to stash routes but not to `clean`, `containerize`, `refresh-db`; apply consistently or document intentional exemptions. (security)
- `src/lib/vbrief/beads.ts:240` — `?` — Serial `bd create` subprocess loop; independent items could be partially parallelized. Planning-time only, so low user impact. Validate Dolt supports concurrent writes before changing. (performance)
- `src/dashboard/frontend/src/components/vbrief/` — `?` — VBriefViewer edge rendering for cross-story edges not verified in this PR; likely works given existing edge type support, but no PR-level evidence. (requirements REQ-G)

---

## Cross-cutting groups

**FEATURE-CONTEXT.md pipeline** (root cause: the file is generated but the injection chain is incomplete):
- [blocker-2] `work-agent-prompt.ts` does not read FEATURE-CONTEXT.md
- [high-1] FEATURE-CONTEXT.md written to feature workspace, not story workspace
- [high-2] Missing test: FEATURE-CONTEXT.md write in `spawnPlanningSession`

**readFileSync in server code** (root cause: three sync FS reads in the route call graph violate project rule):
- [blocker-5a] `beads-query.ts:22`
- [blocker-5b] `vbrief/beads.ts:311`
- [blocker-5c] `workspaces.ts:634`
- [high-7] `spawn-planning-session.ts` — related sync FS violations in same background context

**Rally double-fetch** (root cause: `getIssue` result not reused by callers that immediately re-query):
- [high-4] `updateIssue` double fetch
- [high-5] `getComments` double fetch

**Missing vBRIEF regression tests** (root cause: ACs marked completed but test artifacts absent):
- [blocker-3] Start Agent button NOT rendered on FeatureCard
- [blocker-4] derivedStatus vs status Plan button visibility

---

## What's good

- FeatureCard action bar (Plan/See Plan/Tasks/vBRIEF chips), click-to-select separation, and CompactChildCard selection are cleanly implemented and well-tested.
- `IssueTracker.getChildIssues()` interface + Rally implementation + no-op stubs for GitHub/Linear/GitLab are correct and fully tested.
- `RallyClientLive` and `getRallyClient()` both implement `getChildIssues` correctly — only `RallyClientOptionalLive` (the production layer) was missed.
- `rehype-sanitize` is used correctly on all markdown rendering paths (XSS prevention).
- `execFileAsync` with array arguments is used throughout `beads.ts` — no shell injection surfaces there.
- Path traversal check in `getWorkspacePathForIssue` is correctly implemented and consistently applied in peer routes.
- `derivedStatus` gating fix (using `feature.status` not `derivedStatus`) is correctly implemented — just missing its required regression test.

---

## Review stats

- Blockers: 5   High: 8   Medium: 0   Nits: 7
- By reviewer: correctness=5, requirements=10, performance=8, security=4
- Files touched: 38   Files with findings: 12

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

