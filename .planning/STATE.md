# PAN-712: Fix stale pan work/cloister/specialists refs in .claude/skills/

## Status: In Progress

## Current Phase
All beads implemented. Awaiting inspection on panopticon-cli-cer.

## Completed Work
- [x] panopticon-cli-vw1: Fixed 5 stale refs in test-specialist-workflow/SKILL.md — `pan cloister start` → `pan admin cloister start`, `pan specialists wake *` → `pan admin specialists wake *` (commit: cb6c0452)
- [x] panopticon-cli-cer: Fixed EXAMPLES.md Pattern 6 — updated `cli/commands/work.ts` example to `done.ts`, replaced `pan work --help` with `pan --help`

## Remaining Work
(none)

## Key Decisions
- `pan workspace` refs are valid (not stale) — only `pan work`, `pan cloister`, `pan specialists` are the stale forms per issue scope

## Specialist Feedback
(none yet)

---
- **[2026-04-15T03:41Z] verification-gate → FAILED** — `.planning/feedback/016-verification-gate-failed.md`
- **[2026-04-15T04:03Z] verification-gate → FAILED** — `.planning/feedback/017-verification-gate-failed.md`
- **[2026-04-15T04:03Z] verification-gate → FAILED** — `.planning/feedback/018-verification-gate-failed.md`

## Problem

Code review for PAN-705 (command taxonomy reorg) flagged stale references in project-level skill files under `.claude/skills/`. Skills that reference the old taxonomy (`pan work`, `pan cloister`, `pan specialists`) mislead any agent that loads them about correct CLI syntax.

## Audit findings

Ran `grep -rn "pan work\|pan cloister\|pan specialists" .claude/skills/` against the current branch. Only **two files** contain stale refs (5 occurrences total):

### 1. `.claude/skills/test-specialist-workflow/SKILL.md` (4 refs)
- L40: `pan cloister start` → `pan admin cloister start`
- L163: `pan specialists wake review-agent` → `pan admin specialists wake review-agent`
- L164: `pan specialists wake test-agent` → `pan admin specialists wake test-agent`
- L165: `pan specialists wake merge-agent` → `pan admin specialists wake merge-agent`
- L174: `pan specialists wake test-agent --task "..."` → `pan admin specialists wake test-agent --task "..."`

### 2. `.claude/skills/update-panopticon-docs/resources/EXAMPLES.md` (1 ref)
- L294: `pan work --help` → `pan --help` (in Pattern 6's verify step; the collapsed taxonomy no longer has a `work` namespace — all lifecycle verbs are top-level: `pan start`, `pan done`, `pan kill`, etc.)

## Current taxonomy (verified against `pan --help` on feature/pan-712)

- Lifecycle verbs are **top-level**: `pan start`, `pan done`, `pan kill`, `pan recover`, `pan tell`, `pan resume`, `pan approve`, `pan close`, `pan reopen`, `pan sync-main`, `pan wipe`.
- Plumbing lives under `pan admin`:
  - `pan admin cloister {status,start,stop,emergency-stop}`
  - `pan admin specialists {list,wake,queue,reset,clear-queue,done,logs,cleanup-logs}`
- `pan workspace` **still exists** as a top-level group (create/list/start/stop/destroy/etc.) — refs like `pan workspace create PAN-42` in `pan-fly/SKILL.md`, `plan/SKILL.md`, `pan-oversee/SKILL.md`, and `test-specialist-workflow/SKILL.md` L70 are **valid** and NOT in scope.

## Out of scope

- `pan plan-finalize` (hyphenated) is referenced in `.claude/skills/pan-plan-finalize/SKILL.md` and in this workspace's PLANNING_PROMPT, but `pan --help` shows the real command is `pan plan finalize` (sub-command of `pan plan`). This looks like a separate bug (the hyphenated form falls back to top-level help instead of the subcommand). **Not PAN-712** — issue scope is strictly `pan work`/`pan cloister`/`pan specialists`. File a follow-up if needed.
- Other `pan work`/`pan cloister`/`pan specialists` refs outside `.claude/skills/` (e.g. `docs/`, `src/`, `README.md`) — issue scope is `.claude/skills/*` only.

## Approach

Two small, independently-reviewable doc edits. Each bead owns one file, uses `sed`/Edit-level changes, and re-runs the audit grep as its acceptance check. A final grep over `.claude/skills/` must return zero hits for the three stale forms.

## Decomposition

1. **Bead 1:** Fix `test-specialist-workflow/SKILL.md` — rewrite 5 occurrences (1× `pan cloister start`, 4× `pan specialists wake ...`) to `pan admin ...` equivalents. Difficulty: `trivial`.
2. **Bead 2:** Fix `update-panopticon-docs/resources/EXAMPLES.md` — replace L294 `pan work --help` with `pan --help` and update surrounding Pattern 6 prose if it still implies a `pan work` namespace. Difficulty: `trivial`.

Both beads share one final AC: `grep -rn "pan work\|pan cloister\|pan specialists" .claude/skills/` returns nothing (excluding the string "pan workspace"). The grep pattern must be anchored to avoid matching `pan workspace` — use `\bpan (work|cloister|specialists)\b` or equivalent.

Beads are independent — either can land on its own. No edges.

## Verification

- `grep -rn -E "\\bpan (work|cloister|specialists)\\b" .claude/skills/` → 0 hits.
- Each rewritten command must correspond to an entry in `pan admin --help` / `pan admin cloister --help` / `pan admin specialists --help` (captured above).
- No other skill files touched.
