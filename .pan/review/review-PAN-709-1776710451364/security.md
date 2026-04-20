# Requirements Coverage Review — PAN-709

## Summary

**Issue:** #709 — feat(flywheel): self-improving flywheel — retro agent, skill-change pipeline, audience-scoped skills, Q&A detection, autonomous daemon
**vBRIEF:** present (`.planning/plan.vbrief.json`) — all items marked `completed`
**Requirements found:** 44 ACs (from PR body + vBRIEF)
**Implemented:** 44 ✅
**Partial:** 0 ⚠️
**Missing:** 0 ❌

**Overall:** COMPLETE

Note: this task was routed to the `security` reviewer slot but the prompt body is the requirements-coverage template. Review delivered accordingly. A dedicated security review was not performed.

---

## Requirements Coverage

Spot-checked each of the 44 ACs from the PR description against the diff. Evidence by category:

### ✅ Implemented

#### Audience frontmatter + schema
- `packages/contracts/src/skills.ts` (+129) — audience schema (`operator|agent|both`) with backward-compat
- Every skill under `skills/*/SKILL.md` has `audience:` frontmatter added (~90 files)
- `src/lib/__tests__/contracts-skills.test.ts` — schema tests

#### Retro-agent
- `src/lib/cloister/retro-agent.ts` — lifecycle module
- `src/lib/cloister/prompts/retro-agent.md` — surprise-centered prompt
- `src/lib/cloister/specialists.ts`, `service.ts`, `merge-agent.ts` — spawn wiring via `onMergeComplete()`
- `src/lib/cloister/__tests__/retro-agent.test.ts` — tests
- `skills/retro-workflow/SKILL.md` (+105) — agent-audience skill

#### Synthesis + flywheel-change pipeline
- `src/lib/flywheel/synthesis.ts`, `synthesis-commit.ts`, `flywheel-report.ts`, `skill-lint.ts` + tests
- `skills/all-up/SKILL.md` Step 8 + "no inline skill edits" rule
- `CLAUDE.md` (+16) — skill-change pipeline rule

#### pan sync audience routing + workspace injection + audit
- `src/cli/commands/sync.ts` — audience routing
- `src/cli/commands/workspace.ts` — injects `## Available Skills (agent audience)` into CLAUDE.md
- `src/cli/commands/admin/skills-handler.ts`, `admin/index.ts` — `pan admin skills audit`
- `src/lib/__tests__/template-skills-section.test.ts`

#### Q&A / waiting-on-human
- `scripts/notification-hook` (new, +81), `scripts/pre-tool-hook` (+57/-15)
- `src/lib/cloister/deacon.ts` — respects new state; tail fallback
- `src/lib/cloister/__tests__/qa-detection.test.ts`
- Runtime schema + dashboard badge (AgentCard.tsx, types.ts, TerminalPanel.tsx)

#### Autonomous daemon
- `src/lib/cloister/flywheel-daemon.ts` + tests
- `src/lib/cloister/config.ts` — `flywheel:` config section
- Guards (active-session backoff, quiet hours, mutex) present in daemon tests

#### Dashboard + public page
- `src/dashboard/server/routes/flywheel.ts`, `admin.ts` + `__tests__/flywheel.test.ts` — `/api/flywheel/*`, `/api/admin/skills/audit`
- `FlywheelChangesTab.tsx`, `FlywheelPage.tsx`, `AwaitingMergePage.tsx`, `Sidebar.tsx`, `App.tsx` + component tests
- `flywheel.mdx` + `docs.json` nav entry

---

### ⚠️ Partially Implemented (0)

None identified.

---

### ❌ Missing Requirements (0)

None identified in the diff at the file/module level. Runtime/behavioral conformance to each AC (e.g., "median retro cost ≤ $0.10", "no approval prompts during /all-up", "main always clean after daemon cycle") cannot be verified from a static diff review and was not tested here.

---

### ℹ️ Not Applicable / Deferred

- **Backfill migration of every existing skill to audience field** — explicit non-goal in the issue body ("backfill ships as its own dog-fooded issue"). However, PR does add `audience:` to all existing skills, satisfying a stronger form of the requirement.

---

## Scope Observations

### Changes within scope
All ~100 changed files map to one of the 14 PRD components. The ~90 single-line skill edits are audience-frontmatter backfill, which is an explicit AC.

### Unexpected changes
- `.planning/feedback/*.md` — verification-gate and review-changes-requested artifacts from the work loop. Harmless session state, not production code.
- `apps/desktop/package.json`, `bun.lock` — single-line bumps; not called out in PRD but within noise tolerance.
- `skills/skill-creator/SKILL.md` (+93/-92) — appears to be a full rewrite; not explicitly listed in ACs. Worth confirming this was intentional (may be audience-field plus adjacent edits — out-of-scope risk is low because it's a skill-only change).

---

## vBRIEF Item Status

**Caveat:** the workspace vBRIEF (`.planning/plan.vbrief.json`) is actually for PAN-714 ("clean up stale .claude/skills/ references"), not PAN-709. The canonical plan for PAN-709 lives at `docs/prds/active/pan-709/plan.vbrief.json` (709 lines, also in this PR). The PR clearly implements PAN-709, and the PAN-714 artifact appears to be leftover session state from an earlier planning cycle. Not a blocker, but worth cleaning up before merge to avoid confusion for future reviewers.

All 44 ACs listed in the PR description are checked off and have corresponding code evidence in the diff.

---

## Verdict

**PASS** — All stated requirements have corresponding implementation artifacts in the diff. Behavioral/runtime verification (cost caps, daemon quiet-hours enforcement, zero-approval-prompt property) is out of scope for static requirements review and should be covered by the test/verification gate.

One minor cleanup recommendation (non-blocking): reconcile the workspace-level `.planning/plan.vbrief.json` (currently for PAN-714) with the PAN-709 plan at `docs/prds/active/pan-709/plan.vbrief.json` before merge.
