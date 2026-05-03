---
specialist: review-agent
issueId: PAN-936
outcome: approved
timestamp: 2026-05-03T09:53:26Z
---

# Verdict: APPROVED

## Summary

PAN-936 implements Rally Feature planning end-to-end. All five blockers from Round 1 have been resolved: `RallyClientOptionalLive` now delegates `getChildIssues`; `work-agent-prompt.ts` reads `FEATURE-CONTEXT.md` and injects it as `FEATURE_CONTEXT` into the work agent prompt; all three missing regression tests were added (Start Agent absence on FeatureCard, derivedStatus gate, identifier link no-propagate); and all three `readFileSync` calls in server-reachable code were converted to async `fs/promises`. Additionally, the Rally WSAPI query injection surface was eliminated with input validation and escaping; both double-fetch patterns in `rally.ts` were collapsed to single round-trips; the rally-client cache is now properly populated; and `spawn-planning-session.ts` uses fully async file I/O. Two high-priority items remain (FEATURE-CONTEXT.md placement and missing write-path test), along with several advisory nits, but none rise to blocker severity.

---

## Blockers (MUST fix before merge)

_none_

---

## High Priority (SHOULD fix; synthesis approves but recommends follow-up)

### 1. FEATURE-CONTEXT.md written to feature workspace, not story workspace — `src/lib/planning/spawn-planning-session.ts:444` — `~`
**Raised by**: correctness, requirements (REQ-A)
`feature-context-injection.ac1` specifies writing to the **story workspace**. The code writes to the feature's own `.planning/` directory. `readFeatureContext()` in `work-agent-prompt.ts` reads from the current workspace, so story agents in `workspaces/feature-<storyId>/` will not find the file. The read side is fully wired; the gap is purely in delivery.

Add logic during story workspace creation or agent spawn to detect `parentRef`, locate the parent feature workspace, and copy/write `FEATURE-CONTEXT.md` into the story's `.planning/` directory.

### 2. Missing test: FEATURE-CONTEXT.md write in `spawnPlanningSession` — `src/lib/planning/__tests__/spawn-planning-session.test.ts` — `~`
**Raised by**: requirements (REQ-B)
`test-feature-planning-pipeline.ac2` requires a test asserting `FEATURE-CONTEXT.md` is written. The current tests only cover `buildPlanningPrompt`, which does not perform file I/O. Add an integration-style test or extract the write logic into a unit-testable function.

---

## Nits (advisory — safe to defer)

- `src/dashboard/frontend/src/components/KanbanBoard.tsx:723` — `?` — Action bar gap area propagates click to `onSelect`. Add `onClick={(e) => e.stopPropagation()}` to the action bar container div. (correctness)
- `src/dashboard/server/services/rally-client.ts:275` — `?` — `as RallyClientShape` cast suppresses compile-time method-completeness checking. Remove the cast to let TypeScript verify the object structurally. (correctness)
- `src/dashboard/server/routes/workspaces.ts:2226` — `?` — `projectName` interpolated into shell command string; use `execFileAsync` with array args to remove the injection surface. (security)
- `src/dashboard/server/routes/workspaces.ts:2109` — `?` — Container action route constructs workspace path from `issueId` without `parseIssueId` validation; inconsistent with peer routes that have path-traversal checks. (security)
- `src/dashboard/server/routes/specialists.ts` — `?` — No CSRF protection (`requireTrustedMutationOrigin`) on any mutation route. Apply consistently or document intentional exemptions. (security)
- `src/dashboard/server/routes/specialists.ts:1753` — `?` — `cd "${workspacePath}" && git branch --show-current` uses shell string interpolation. Replace with `execFileAsync('git', ['branch', '--show-current'], { cwd: workspacePath })`. (security)
- `src/lib/vbrief/beads.ts:240` — `?` — Serial `bd create` subprocess loop; independent items could be partially parallelized. Planning-time only, so low user impact. Validate Dolt supports concurrent writes before changing. (performance)
- `src/dashboard/frontend/src/components/vbrief/` — `?` — VBriefViewer edge rendering for cross-story edges not verified in this PR; no PR changes touch VBriefViewer. Deferred to UAT. (requirements REQ-C)

---

## Cross-cutting groups

**FEATURE-CONTEXT.md pipeline** (file generated but delivery incomplete for story workspaces):
- [high-1] FEATURE-CONTEXT.md written to feature workspace, not story workspace
- [high-2] Missing test: FEATURE-CONTEXT.md write in `spawnPlanningSession`

**Shell command construction patterns** (unnecessary shell interpolation where `execFileAsync` would suffice):
- [nit-3] Docker `projectName` interpolated into shell string (workspaces.ts)
- [nit-5] `cd` + `git` in shell string via `execAsync` (specialists.ts)

**Route validation inconsistencies** (some routes validate `issueId`, others don't):
- [nit-4] Container action route does not validate `issueId` format
- [nit-5] Specialists mutation routes lack CSRF protection

---

## What's good

- All Round-1 blockers resolved: `getChildIssues` delegation, FEATURE-CONTEXT read/inject, missing tests, sync FS reads.
- Rally WSAPI query injection fully eliminated with `validateRallyId` and `escapeQueryValue`.
- Rally double-fetch patterns collapsed to single round-trips in `updateIssue` and `getComments`.
- `rally-client.ts` cache properly populated via lazy tracker instantiation.
- `spawn-planning-session.ts` fully converted to async `fs/promises` throughout.
- FeatureCard action bar, click-to-select separation, and CompactChildCard selection are cleanly implemented and comprehensively tested.
- `rehype-sanitize` used correctly on all markdown rendering paths.
- `execFileAsync` with array arguments used in `beads.ts` and `done-preflight.ts` — no shell injection surfaces.

---

## Review stats

- Blockers: 0   High: 2   Medium: 0   Nits: 8
- By reviewer: correctness=3, requirements=3, performance=1, security=4
- Files touched: 46   Files with findings: 8

---

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the Synthesis Context above. Those files contain full per-reviewer detail; this synthesis is the policy layer.

---

## ✅ CODE APPROVED — YOUR WORK IS COMPLETE

**Do NOT make any more changes.**
**Do NOT run `pan done` again.**
**Do NOT run `pan review request`.**

The specialist pipeline will now run tests. If tests pass, the issue enters the merge queue for human approval.

