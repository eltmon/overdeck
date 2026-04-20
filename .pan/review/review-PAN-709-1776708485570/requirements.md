# Requirements Coverage Review — 2026-04-20

## Summary

**Issue:** PAN-709 — Self-Improving Flywheel (retro agent, skill-change pipeline, autonomous daemon)
**vBRIEF:** present, but stale — `.planning/plan.vbrief.json` on disk belongs to **PAN-714** (pan-705 followup skill cleanup), not PAN-709. The canonical requirements source for this PR is therefore the PRD at `docs/prds/planned/pan-709-self-improving-flywheel.md` (14 acceptance criteria).
**Requirements evaluated:** 14 PRD ACs
**Implemented:** 12 ✅
**Partial:** 2 ⚠️
**Missing:** 0 ❌

**Overall:** PARTIALLY COMPLETE — the epic ships end-to-end, but two ACs can only be confirmed by live execution, not by static review.

---

## vBRIEF Artifact Discrepancy (scope note, not a blocker)

The workspace `.planning/plan.vbrief.json` is for **PAN-714** ("clean up stale `.claude/skills/` references and add unit tests for `doneCommand`/`approveCommand`"), while the branch, commits, and PR body all target **PAN-709**. The PR includes a copy of the PAN-709 plan at `docs/prds/active/pan-709/plan.vbrief.json` plus the PRD, so requirements traceability is possible, but the top-level workspace plan does not match this PR. Recommend confirming with planning before merge that PAN-714's plan file was intentionally left as the workspace artifact (e.g., bundled in a previous merge) and that `docs/prds/active/pan-709/` is the authoritative plan for this PR.

---

## Requirements Coverage (PRD acceptance criteria)

### ✅ Implemented (12)

#### AC-1: Retro-agent fires automatically on merge
**Source:** PRD AC 1
**Evidence:** `src/lib/cloister/retro-agent.ts`, `src/lib/cloister/prompts/retro-agent.md`, wired into merge lifecycle (commit `3d5bdec1` "wire retro-agent into merge lifecycle + config + inputs"), `src/lib/flywheel/retro-writer.ts` writes to `docs/flywheel/retros/`.

#### AC-2: No-op filtering
**Source:** PRD AC 2
**Evidence:** Retro-agent prompt (`src/lib/cloister/prompts/retro-agent.md`) enforces the surprise-centered "`no-op` and stop" rule; synthesis filters `surprise: true` retros (`src/lib/flywheel/synthesis.ts`); archiver handles no-op retros (`src/lib/flywheel/retro-archiver.ts`, tests in `retro-archiver.test.ts`).

#### AC-3: Signal threshold enforced (≥3 retros)
**Source:** PRD AC 3
**Evidence:** `src/lib/flywheel/synthesis.ts` (302 lines) groups retros by signature and applies threshold; watchlist flow handled via `flywheel-report.ts`; unit tests in `__tests__/synthesis.test.ts` cover the threshold logic.

#### AC-4: Skill-change issues flow through the pipeline
**Source:** PRD AC 4
**Evidence:** `src/lib/flywheel/issue-filer.ts` files labeled issues; commit `684535e3` "flywheel-change gates in review and test agents" wires the gates; `src/cli/commands/admin/skills-handler.ts` provides audit.

#### AC-5: Audience field enforced
**Source:** PRD AC 5
**Evidence:** `packages/contracts/src/skills.ts` defines `SkillFrontmatter` with `audience: 'operator'|'agent'|'both'`; parser throws on invalid values; `src/lib/flywheel/skill-lint.ts` (231 lines + tests) validates; audit command in `src/cli/commands/admin/skills-handler.ts`.

#### AC-6: `pan sync` respects audience
**Source:** PRD AC 6
**Evidence:** `src/lib/sync.ts` diff (~72 lines changed) + commit `5107fc2f` "route skills by audience field"; workspace CLAUDE.md injection in commit `6fb9f7ba` "inject agent-audience skills section into workspace CLAUDE.md".

#### AC-7: Audience backfill completed
**Source:** PRD AC 7
**Evidence:** Commit `c93000f1` "backfill audience field on all 82 skills" — 82 SKILL.md files touched in diff stat, each with a single-line addition consistent with frontmatter insertion.

#### AC-8: Q&A detection / `waiting-on-human` state
**Source:** PRD AC 8
**Evidence:** `src/lib/cloister/deacon.ts` tracks `waiting-on-human` state (refs at lines 505, 963, 977–991, 1070–1097, 2818, 2929–2934); hooks `scripts/pre-tool-hook` and `scripts/notification-hook` set the flag; dashboard badge in `AgentCard.tsx:21/30/162` + kanban badge in `KanbanBoard.tsx:2134`.

#### AC-9: Autonomous daemon
**Source:** PRD AC 9
**Evidence:** `src/lib/cloister/flywheel-daemon.ts` (commit `ad684dd3` "flywheel daemon loop scaffold"); async-ified in `91fbf344`; config hooks present.

#### AC-10: `docs/FLYWHEEL-REPORT.md` accumulates
**Source:** PRD AC 10
**Evidence:** `src/lib/flywheel/flywheel-report.ts` (150 lines) plus `__tests__/flywheel-report.test.ts` exercising append semantics.

#### AC-11: Public dashboard renders
**Source:** PRD AC 11
**Evidence:** `flywheel.mdx` (48 lines, valid Mintlify frontmatter + content) and `docs.json` updated (commit `1288e62d` converted invalid Mintlify import to static content).

#### AC-13: `all-up` skill updated with Step 8 + rule
**Source:** PRD AC 13
**Evidence:** `skills/all-up/SKILL.md` (+39 lines) and `.claude/skills/all-up/SKILL.md` (+38 lines mirrored).

---

### ⚠️ Partially Implemented (2)

#### AC-12: Skill-change pipeline never raises approval prompts during `/all-up`
**Source:** PRD AC 12
**Requirement:** "During `/all-up`, zero approval prompts are raised for skill edits. All skill changes flow through filed issues."
**What's present:** `all-up/SKILL.md` now contains Step 8 and the rule "skill changes are never inline edits during /all-up." Review/test gates reject non-skill changes in `flywheel-change` issues. `CLAUDE.md` adds a repo-level guardrail (AC-13 style) forbidding direct skill edits.
**What's missing / unverifiable:** This is a behavioral assertion that requires a live `/all-up` run to confirm zero approval prompts are raised. Nothing in the diff demonstrates an end-to-end dry run captured for this PR. The policy is documented; execution evidence is not attached.
**Severity:** Medium — the enforcement surface (docs, review gate, test gate) is in place; the outcome assertion is untested in-PR.
**Recommendation:** Either attach a dry-run transcript of `/all-up` touching a skill change, or mark AC-12 as verified-by-flywheel (self-referential check on the next autonomous run).

#### AC-14: Main is always clean after every daemon cycle
**Source:** PRD AC 14
**Requirement:** "After every daemon cycle, `git status` on `main` is clean and pushed. No approval-requiring side effects left dangling."
**What's present:** `src/lib/flywheel/synthesis-commit.ts` (102 lines) exists and is intended to commit+push archive and report updates; daemon scaffold in `flywheel-daemon.ts`.
**What's missing / unverifiable:** No test asserts `git status` cleanliness at the end of a cycle, and no dry-run log is included. The commit flow exists but the "always clean" invariant is not proven.
**Severity:** Medium — mechanism present, invariant not demonstrated.
**Recommendation:** Add an integration test or daemon post-cycle invariant check; or mark as verified on first autonomous run and file a watchlist entry if it fails.

---

### ❌ Missing Requirements (0)

None of the 14 PRD ACs are wholly missing based on static review.

---

## Scope Observations

### Changes within scope
- Flywheel module: `src/lib/flywheel/*` (8 new source files + 7 test files)
- Cloister integration: `retro-agent.ts`, `flywheel-daemon.ts`, `merge-agent.ts` hook, prompts
- Contracts: `packages/contracts/src/skills.ts` (SkillFrontmatter schema)
- CLI: `pan admin skills audit` via `skills-handler.ts`
- Sync: `src/lib/sync.ts` audience-aware routing + workspace CLAUDE.md injection
- Dashboard: `FlywheelChangesTab.tsx`, `FlywheelPage.tsx`, waiting-on-human badge in `AgentCard.tsx` + `KanbanBoard.tsx`
- Hooks: `scripts/pre-tool-hook`, `scripts/notification-hook` for waiting-on-human signal
- Docs: `flywheel.mdx`, `docs.json`, `CLAUDE.md` update
- Audience backfill across 82 `skills/*/SKILL.md` files

### Unexpected / tangential changes (not blockers)
- `src/lib/tmux.ts` (+9 lines) — per-commit-message, a race fix (`e148e0b1`). Unrelated to PAN-709 scope but low risk; a legitimate drive-by fix.
- `src/dashboard/frontend/src/components/.../TerminalPanel.tsx` type corrections (commit `172fd02a`) — also drive-by, unrelated.
- Planning-session spawn logic (`src/lib/planning/spawn-planning-session.ts` +100/-) — plausible if flywheel needs retro sessions, but worth confirming it's intentional.
- `src/lib/template.ts` (+74) — new file, likely for workspace CLAUDE.md injection; in-scope.
- `.planning/feedback/*` and `.planning/prd.md` — ephemeral planning artifacts; should not have been committed to the PR branch, but harmless.

### Scope concern
The PR bundles several non-PAN-709 fixes (tmux race, terminal panel types) into the flywheel epic. Per CLAUDE.md ("narrow scope"), these might have merited separate issues. Non-blocking for requirements coverage but worth flagging.

---

## vBRIEF Item Status

The on-disk vBRIEF is for PAN-714, not PAN-709, so a direct item-by-item mapping is not meaningful. The copy at `docs/prds/active/pan-709/plan.vbrief.json` (709 lines) is the correct artifact for this PR and presumably carries the per-bead statuses. All 14 PRD ACs have corresponding code as noted above.

| PRD AC | Evidence | Assessment |
|--------|----------|------------|
| AC-1 retro on merge | retro-agent.ts + merge hook | OK |
| AC-2 no-op filter | synthesis + archiver + prompt | OK |
| AC-3 3-signal threshold | synthesis.ts + tests | OK |
| AC-4 pipeline e2e | issue-filer + review/test gates | OK |
| AC-5 audience enforced | skills.ts schema + skill-lint | OK |
| AC-6 pan sync audience | sync.ts + injection | OK |
| AC-7 backfill | 82 SKILL.md updates | OK |
| AC-8 waiting-on-human | deacon + hooks + badges | OK |
| AC-9 daemon | flywheel-daemon.ts | OK (static) |
| AC-10 FLYWHEEL-REPORT | flywheel-report.ts + tests | OK |
| AC-11 public page | flywheel.mdx + docs.json | OK |
| AC-12 no approval prompts | policy docs + gates | PARTIAL (behavioral) |
| AC-13 all-up Step 8 | skills/all-up/SKILL.md | OK |
| AC-14 main clean post-cycle | synthesis-commit.ts | PARTIAL (unproven) |

---

## Verdict

**PASS (with two behavioral caveats).**

All 14 PRD acceptance criteria have corresponding implementation code. The two "partial" items (AC-12 and AC-14) are behavioral assertions that require a live daemon or `/all-up` cycle to verify — the mechanisms and policy docs are in place, but the invariants are not demonstrated in-PR.

Recommended follow-ups before final merge:
1. Clarify the workspace vBRIEF artifact mismatch (on-disk plan is PAN-714, not PAN-709).
2. Either attach a dry-run transcript proving AC-12 (zero approval prompts during `/all-up` skill edits) or explicitly defer verification to the first autonomous daemon cycle and add a watchlist entry for failure.
3. Either add an automated invariant check for AC-14 (`git status` clean + pushed after every daemon cycle) or similarly defer with a monitoring entry.
4. Confirm the tangential fixes (tmux race, TerminalPanel types, spawn-planning-session changes) were intentionally bundled with PAN-709 rather than split into separate PRs.
