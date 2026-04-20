# Correctness / Requirements Review: PAN-709 — Self-Improving Flywheel

**Issue:** PAN-709
**PR:** https://github.com/eltmon/panopticon-cli/pull/721
**vBRIEF:** present but **mismatched** — `.planning/plan.vbrief.json` and `docs/prds/active/pan-709/plan.vbrief.json` both contain the PAN-714 plan, not PAN-709. Review used `docs/prds/planned/pan-709-self-improving-flywheel.md` as the authoritative requirements source.
**Requirements found:** 14 acceptance criteria (from PRD)
**Implemented:** 12 ✅ · **Partial:** 1 ⚠️ · **Missing:** 1 ❌
**Overall:** PARTIALLY COMPLETE

---

## ✅ Implemented Requirements

### REQ-1: Retro-agent fires automatically on merge (AC-1)
**Evidence:** `src/lib/cloister/retro-agent.ts`, `src/lib/cloister/merge-agent.ts`, `src/lib/cloister/prompts/retro-agent.md`, tests in `src/lib/cloister/__tests__/retro-agent.test.ts`.

### REQ-2: No-op filtering (AC-2)
**Evidence:** Retro prompt is surprise-centered with explicit `no-op` path; synthesis filters `surprise: true` in `src/lib/flywheel/synthesis.ts`.

### REQ-3: Signal threshold ≥3 (AC-3)
**Evidence:** `src/lib/flywheel/synthesis.ts` groups by signature and applies threshold; `src/lib/flywheel/__tests__/synthesis.test.ts`.

### REQ-4: `flywheel-change` issues flow through pipeline (AC-4)
**Evidence:** `src/lib/flywheel/issue-filer.ts` + tests; dashboard tab `FlywheelChangesTab.tsx`.

### REQ-5: Audience field schema + validation (AC-5)
**Evidence:** `packages/contracts/src/skills.ts` declares the audience enum; `src/lib/flywheel/skill-lint.ts` + tests enforce it on new skills. Audit command at `src/cli/commands/admin/skills-handler.ts`.

### REQ-6: `pan sync` respects audience (AC-6)
**Evidence:** `src/lib/sync.ts`, `src/lib/template.ts`; `src/lib/__tests__/template-skills-section.test.ts` covers workspace CLAUDE.md injection.

### REQ-8: Q&A `waiting-on-human` detection (AC-8)
**Evidence:** `src/lib/cloister/deacon.ts`, `src/lib/cloister/__tests__/qa-detection.test.ts`, `scripts/pre-tool-hook`, `scripts/notification-hook`. Dashboard badges in `AgentCard.tsx` / `KanbanBoard.tsx`.

### REQ-9: Autonomous flywheel daemon (AC-9)
**Evidence:** `src/lib/cloister/flywheel-daemon.ts` + `__tests__/flywheel-daemon.test.ts`. Config in `src/lib/config.ts` / `src/lib/cloister/config.ts`.

### REQ-10: FLYWHEEL-REPORT.md accumulation machinery (AC-10)
**Evidence:** `src/lib/flywheel/flywheel-report.ts` + `flywheel-report.test.ts`, `synthesis-commit.ts`. The report file itself is created on first synthesis run — AC wording ("after 3 runs") accepts pre-run absence.

### REQ-11: Public flywheel page (AC-11)
**Evidence:** `flywheel.mdx` at repo root; `docs.json` nav entry; sources from FLYWHEEL-REPORT.md via Mintlify.

### REQ-12: No approval prompts for skill edits during flywheel (AC-12)
**Evidence:** Enforced architecturally — synthesis files issues instead of editing skill files. `CLAUDE.md` documents the rule. `scripts/pre-tool-hook` + `scripts/heartbeat-hook` wire Q&A state.

### REQ-13: `all-up` Step 8 synthesis (AC-13)
**Evidence:** `skills/all-up/SKILL.md` updated; new `skills/retro-workflow/SKILL.md` added.

---

## ⚠️ Partially Implemented

### REQ-14: Main is always clean after daemon cycle (AC-14)
**What's present:** `src/lib/flywheel/synthesis-commit.ts` commits retro archival + FLYWHEEL-REPORT.md update.
**What's missing:** No explicit end-of-cycle assertion / test that `git status` on `main` is clean post-cycle. Correctness rests on review of the commit/push path; no regression guardrail.
**Severity:** Medium — recommend a daemon-cycle integration test asserting post-cycle `git status --porcelain` is empty.

---

## ❌ Missing Requirements

### REQ-7: Audience backfill completes — zero skills missing the field (AC-7)
**Source:** PRD "Acceptance criteria" item 7: *"Every existing skill in `skills/` has an explicit `audience` value committed; `pan admin skills audit` reports zero missing fields."*
**Expected:** All SKILL.md files under `skills/` have `audience:` frontmatter.
**Actual:** 7 skills in `skills/` are missing the field:
- `skills/cliproxy/SKILL.md`
- `skills/conv-lookup/SKILL.md`
- `skills/pan-docs/SKILL.md`
- `skills/pan-release/SKILL.md`
- `skills/pan-restart/SKILL.md`
- `skills/pan-wipe/SKILL.md`
- `skills/unarchive-conversation/SKILL.md`
**Impact:** `pan admin skills audit` will report 7 missing fields instead of 0, directly violating AC-7. Under the default-fallback in `pan sync`, these skills silently route as `operator` with no deliberate classification. The PRD explicitly scopes the backfill inside this epic (Dependencies §5; Risks §7).
**Fix:** Classify each of the 7 skills and add an `audience:` value to their frontmatter. A single follow-up commit on this branch resolves it.
**Severity:** Blocker for AC-7 as worded; at minimum High.

---

## Scope / vBRIEF Anomaly

`.planning/plan.vbrief.json` and `docs/prds/active/pan-709/plan.vbrief.json` both hold the plan for **PAN-714**, not PAN-709. Implementation was evidently not driven by the workspace vBRIEF state; evaluation was done directly against PRD ACs.

This is a planning-hygiene defect, not a correctness defect, but: **do not rely on workspace vBRIEF item status to judge PAN-709 completion.** Recommend regenerating a PAN-709-specific vBRIEF (either in this PR or as a fast follow-up) and archiving the misnamed file.

---

## Scope creep / extras

None flagged that are outside PRD scope. Additions such as the heartbeat/notification/pre-tool hooks and the `qa-detection` test are all traceable to AC-8 and AC-12.

---

## Summary Table

| # | AC | Status |
|---|----|--------|
| 1 | Retro-agent fires on merge | ✅ |
| 2 | No-op filter | ✅ |
| 3 | Signal threshold | ✅ |
| 4 | Flywheel-change pipeline | ✅ |
| 5 | Audience field enforced | ✅ |
| 6 | `pan sync` audience routing | ✅ |
| 7 | Audience backfill — zero missing | ❌ (7 skills missing) |
| 8 | Q&A `waiting-on-human` state | ✅ |
| 9 | Autonomous daemon | ✅ |
| 10 | FLYWHEEL-REPORT.md accumulates | ✅ |
| 11 | Public flywheel page | ✅ |
| 12 | No approval interrupts during flywheel | ✅ |
| 13 | `all-up` Step 8 | ✅ |
| 14 | Main clean after cycle | ⚠️ (no guardrail) |

---

## Verdict

**FAIL** — one explicit AC gap that blocks clean passage of AC-7:

1. Add `audience:` frontmatter to the 7 listed skills (classify each as `operator` / `agent` / `both`).
2. Optional but recommended: fix the vBRIEF mismatch so workspace state matches the PRD being implemented.
3. Optional: add a post-cycle `git status` assertion to harden AC-14.

Once (1) is addressed, this review moves to PASS.

- Files reviewed: ~14 critical-path files spot-checked.
- Grep/ls verification performed on: skill frontmatter coverage, FLYWHEEL-REPORT.md presence, flywheel + retro-agent source layout, vBRIEF file contents.
