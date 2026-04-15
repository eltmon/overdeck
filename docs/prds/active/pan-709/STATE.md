# PAN-709 — Self-Improving Flywheel — Planning State

**Status:** Planning complete, ready for handoff.
**Planner:** claude-opus-4-6 (planning-pan-709)
**PRD:** `docs/prds/planned/pan-709-self-improving-flywheel.md` (single source of truth)
**Issue:** https://github.com/eltmon/panopticon-cli/issues/709

---

## Context and top-level decisions

### 1. PAN-705 is the base the work agent starts from

PAN-705 (command taxonomy reorg) is in-review at planning time (PR #708, OPEN, `in-review`). The PRD's alignment section says PAN-705 must merge before PAN-709 begins. Per operator decision, **this plan assumes PAN-705 will merge before the work agent starts PAN-709**. Every bead is written against the post-PAN-705 surface:

- CLI lives under top-level verbs (`pan done`, `pan approve`, `pan issue`, `pan show`, `pan status`, `pan sync`), not `pan work *`.
- Long-tail admin commands land under `pan admin <group> <verb>` — PAN-709's `pan admin skills audit` follows that shape.
- Dashboard API routes use `/api/issues/*`, `/api/admin/*`, etc. New `/api/flywheel/*` routes follow the same resource-first convention from day one.
- `pan sync` already performs the "clean-slate delete" pass from PAN-705; PAN-709 layers audience-aware distribution on top of that cleaned state.
- Operator skills are renamed to match CLI verbs 1:1. New operator-audience skills proposed here follow the `"pan <verb> <args> — one-line what it does"` description format.

**If PAN-705 slips and the work agent starts against the legacy surface, it must pause and wait.** The `prereqs` acceptance criterion on the first bead enforces this — the work agent confirms `src/cli/commands/work/` is gone (collapsed) and `pan sync` has clean-slate semantics before proceeding.

### 2. Cost gating is explicitly out

The operator confirmed this project runs on a flat LLM plan. No per-retro cost tracking, no cost line in `FLYWHEEL-REPORT.md`, no auto-disable budget gate, no cost field in `runtime.json`, no cost metric on the dashboard. The PRD has been edited accordingly (AC-13 removed, Risk 2 rewritten around runtime bounds not spend, non-goals updated, open question #4 deleted).

Retro-agent model changes from **Haiku 4.5 → Sonnet 4.6**. Retro quality is the dominant lever (retros drive the whole skill-improvement loop), fast enough to land within the 5-minute runtime cap. Cheap is no longer a criterion.

### 3. Audience backfill is in scope for this epic (not a follow-up)

The PRD originally deferred backfill to a separate dog-fooded issue. Operator decision: **do it in PAN-709**. Two beads cover it:
1. Schema + read path ships with a default-to-`operator` fallback so existing skills keep working unchanged from the moment the schema lands.
2. A dedicated backfill bead walks every skill in `skills/`, classifies it (`operator` / `agent` / `both`) based on the naming/description heuristics in the PRD alignment table, and commits an explicit `audience:` value. Audit command reports zero missing fields after this bead.

Ordering: schema first, then `pan sync` audience routing, then backfill. Backfill depends on both being in place so the walk-and-classify runs against the live frontmatter reader.

### 4. Public flywheel page piggybacks on the existing Mintlify site

Mintlify lives at repo root — `docs.json` is at `/`, and `.mdx` content sits at top-level directories (`reference/`, `configuration/`, `guides/`, `concepts.mdx`). The public flywheel page becomes a new `flywheel.mdx` at that root plus a nav entry in `docs.json`. Rendering pulls from `docs/FLYWHEEL-REPORT.md` (source of truth). No new docs-site bootstrapping — one bead wires the page in.

### 5. Q&A detection extends the existing PreToolUse hook (only)

The host already has `~/.panopticon/bin/pre-tool-hook` wired to Claude Code's PreToolUse via `~/.claude/settings.json`. Operator decision: extend that binary only, not `heartbeat-hook`. For PostToolUse, the work agent must first determine whether pre-tool-hook can be reused for both events (same binary responding to different env/stdin signals) or whether a new binary is required. Start by attempting reuse; document the decision in the implementation. The existing binary already writes `runtime.json` via `jq`, so the `waiting-on-human` marker plugs in naturally.

Terminal-tail pattern matching is defense-in-depth (not the primary signal). Claude Code's `Notification` hook event may be the cleanest upstream signal for approval-waiting specifically — the work agent should investigate this during implementation and add it if viable, but it is not a bead blocker if Notification isn't applicable.

### 6. "Deliver complete features" rule applies — one epic, no partial landing

14 components ship together. The bead decomposition below is for reviewability, not scope reduction. Every bead's acceptance criteria must be met before it's marked done; every bead in the plan must ship before the issue itself is marked done. Phases in the PRD are organizational scaffolding, not delivery boundaries.

---

## Architecture by component

### A. Retro-agent specialist type

**Files:**
- `src/lib/cloister/specialists.ts` — extend `SpecialistType` union with `'retro-agent'`, add metadata entry
- `src/lib/cloister/prompts/retro-agent.md` — surprise-centered prompt, schema, bounded inputs
- `src/lib/cloister/prompts.ts` — map `retro-agent` → `retro-agent.md`
- `src/lib/cloister/retro-agent.ts` — spawn-run-exit lifecycle (no tmux persistence)

**Trigger:** `onMergeComplete()` hook in `src/lib/cloister/merge-agent.ts` spawns retro-agent after post-merge lifecycle finishes. Retro-agent runs in its own ephemeral tmux session, 5-minute hard cap (deacon kills on overrun), writes one markdown file under `docs/flywheel/retros/<issue-id>-<timestamp>.md`, exits.

**Inputs (bounded):** STATE.md, plan.vbrief.json, `feedback/*.md`, last 200 lines of each agent's tmux history, the issue's FLYWHEEL-STATE.md row, `gh pr view --comments`, merge commit + branch commit list.

**Output schema:** YAML frontmatter (issue, agent, run, cycle_count, friction_score, surprise, proposed_changes) + markdown body. Retro-agent self-validates schema before exiting.

**Model:** Sonnet 4.6.

### B. `retro-workflow` skill (agent audience)

New skill at `skills/retro-workflow/SKILL.md`. Audience: `agent`. Purpose: the checklist retro-agent follows — read inputs in order, apply surprise filter, write output, validate schema. Not registered as a slash command (agent skills don't surface in the `/pan` menu).

### C. Synthesis step (new Step 8 in all-up)

**Module:** `src/lib/flywheel/synthesis.ts` (new). Exports `runSynthesis(retroDir)`:
1. Read every non-archived retro in `docs/flywheel/retros/`
2. Filter to `surprise: true`
3. Group by signature (same target skill, same gap description, same audience)
4. Apply 3-signal threshold → above-threshold groups become PAN issues, below-threshold become watchlist entries
5. File PAN issues via the existing tracker client (`src/lib/tracker/` — whatever the post-PAN-705 module name is), label `flywheel-change`, title format `flywheel: <verb> <skill-name> — <summary>`, body includes links to every triggering retro and the proposed patch
6. Append a new section to `docs/FLYWHEEL-REPORT.md` (schema in PRD section 4)
7. Move processed retros to `docs/flywheel/retros/archive/run-N/`
8. Commit + push

**Wiring:** Synthesis is Step 8 of `skills/all-up/SKILL.md`, inserted between current Step 7 (main hygiene) and Step 7.5 (FLYWHEEL-STATE update). The all-up skill learns the rule "skill changes are never inline edits during /all-up — always file via synthesis." CLAUDE.md learns the rule "skill changes go through the flywheel pipeline, not direct edits."

### D. Skill-change-as-issue pipeline

**New label:** `flywheel-change`. Work agent behavior branches on this label:
- Planning is skipped by default — the synthesis-written issue body is treated as the plan
- Work agent scope is narrow: skill files only. Diffs touching non-skill code are rejected back to synthesis with a "mis-scoped" marker
- Review agent runs skill-specific lint (frontmatter schema, no broken skill refs, `audience` present, markdown coherent, diff is focused not shotgun-rewrite)
- Test agent runs `pan sync --dry-run` to validate the skill compiles into a valid synced layout

**Skill lint:** new module `src/lib/flywheel/skill-lint.ts`, shared between review-agent and test-agent. Also used by `pan admin skills audit`.

### E. Audience frontmatter field + pan sync enforcement

**Schema:** `packages/contracts/src/skills.ts` (new) declares `SkillFrontmatter` with `audience: "operator" | "agent" | "both"`. Default at read time: `operator` (backward compat). Validation lives in this module; `pan sync`, review-agent, and skill-lint all import it.

**pan sync routing (layered on PAN-705's clean-slate delete):**
- `operator` → `~/.claude/skills/<name>/`
- `agent` → injected into workspace CLAUDE.md at `pan workspace create` time, via a new `## Available Skills (agent audience)` section; NOT copied to `~/.claude/skills/`
- `both` → both locations

**Workspace create hook:** `pan workspace create` (post-PAN-705 name) extends to write the agent-skills section into the workspace CLAUDE.md during bootstrap.

**`pan admin skills audit`:** new subcommand under the post-PAN-705 admin namespace. Lists every skill with its audience, where it's synced, whether the field is missing; `--fix` flag cleans up stale copies.

**Backfill bead:** one dedicated bead walks every skill in `skills/`, classifies it using the naming convention table in the PRD alignment section, and commits an `audience` value.

### F. Dashboard — Flywheel Changes tab + provenance view + metrics

**Backend routes (under `src/dashboard/server/routes/flywheel.ts`, new):**
- `GET /api/flywheel/retros` — list non-archived retros
- `GET /api/flywheel/retros/:issueId` — fetch one retro with body
- `GET /api/flywheel/report` — fetch `docs/FLYWHEEL-REPORT.md` rendered to HTML or raw markdown
- `GET /api/flywheel/daemon/status` — flywheel daemon state (banner display)
- `GET /api/admin/skills/audit` — audit output as JSON

All routes use `fs/promises` (NEVER `readFileSync`, per CLAUDE.md blocking-call rule).

**Frontend:**
- New `FlywheelChangesTab.tsx` under `src/dashboard/frontend/src/components/` — renders on the existing Awaiting Merge page
- Each card: skill name, diff view (before/after of the SKILL.md change), retro provenance (collapsible list of triggering retros), aggregated signal count, merge button, rollback preview link
- New `/flywheel` top-level route with the same tab content plus a metrics panel:
  - Skills added (week / month / all-time)
  - Skills refined (week / month / all-time)
  - Retros processed (week / month / all-time)
  - Retros dropped by no-op filter
  - Top 5 patterns that triggered changes this period
- No cost metric. No spend chart. (Removed per operator decision.)

### G. Q&A / waiting-on-human detection

**Agent state model:** extend `AgentRuntimeState` in `src/lib/agents.ts` with a `waiting-on-human` state. The field already exists as `state: string`, so the change is declarative plus wiring.

**Signal sources:**
1. Extended `~/.panopticon/bin/pre-tool-hook` — detects when Claude Code is about to invoke a tool that needs approval (work agent determines the cleanest signal; may need to wire the `Notification` Claude Code hook event in addition, which fires specifically on approval-waiting). On approval-required event: write `state: "waiting-on-human"` + reason to `runtime.json`. On normal tool invocation: keep writing `state: "active"` as today.
2. Terminal tail heuristics in deacon: conservative pattern matching on known prompts (`[y/N]`, `Do you want to proceed?`, `Press any key`, `> $`) as defense-in-depth.
3. Planning agents in `AskUserQuestion` discovery Q&A: the planning session marker or a dedicated writer sets the state directly.

**Deacon behavior:** when `state === "waiting-on-human"`, deacon does NOT count toward the stuck-timer for the normal threshold. It uses a 4x longer threshold before even considering recovery — so genuinely stuck agents still get unblocked eventually.

**Dashboard:** yellow ⏳ badge on the agent card and kanban card. Text: "Awaiting your input." Click opens the tmux terminal panel for that agent, scrolled to the prompt line.

### H. Autonomous flywheel daemon

**File:** `src/lib/cloister/flywheel-daemon.ts` (new, mirrors `deacon.ts` shape). Exports `startFlywheelDaemon()` / `stopFlywheelDaemon()`. Registered in `CloisterService.start()` right after `startDeacon()`.

**Triggers:**
- On merge event (from merge-agent event emitter): spawn retro-agent for the merged issue
- On cycle detected in FLYWHEEL-STATE.md: file a `flywheel-change` issue if non-blocker; inline-fix only if blocker-tier (gated by an explicit severity check that the work agent hardcodes to "issues currently stuck in the pipeline this run")
- Every 30 minutes: re-read FLYWHEEL-STATE.md, run synthesis if any new retros exist
- Every 24 hours: full flywheel cycle (inventory → diagnose → file issues → synthesize → report)

**Guards:**
- Active-session backoff: check most-recent mtime under `~/.claude/projects/` for recent activity; if <10 min, back off
- Quiet hours from `~/.panopticon/config.yaml` `flywheel.quiet_hours`
- Mutex on `~/.panopticon/flywheel.lock` (file lock via `flock` or equivalent)
- Awaiting Merge threshold banner: when the queue exceeds `flywheel.awaiting_merge_notify_threshold`, write a dashboard banner event via the existing event store
- Never interrupts `waiting-on-human` agents
- Never edits skill files directly; only files issues
- Never runs more than one cycle concurrently

**Config:** new `flywheel:` section in `~/.panopticon/config.yaml` (`autonomous`, `quiet_hours`, `trigger_interval_minutes`, `full_cycle_interval_hours`, `backoff_on_active_session`, `awaiting_merge_notify_threshold`).

### I. Public flywheel page (Mintlify)

New `flywheel.mdx` at repo root, registered under `docs.json` nav as "How It Works → The Flywheel." Renders `docs/FLYWHEEL-REPORT.md` via an embed or transformation; the concrete mechanism depends on how existing `.mdx` files consume markdown content in this Mintlify setup. One bead covers write + nav entry + verify site builds.

### J. FLYWHEEL-REPORT.md and FLYWHEEL-STATE.md coexist

- `docs/FLYWHEEL-STATE.md` — already exists. Per-run living snapshot (Active Pipeline, Cycling Alerts, Infrastructure Gaps, Pattern Ledger, Skill Gaps, Run summary). Overwritten each run. Used by `/all-up` Step 0.
- `docs/FLYWHEEL-REPORT.md` — NEW. Append-only history. One section per flywheel run or autonomous daemon cycle. Schema in PRD section 4. Public-facing.

Both are written by synthesis but serve different roles. STATE is working memory; REPORT is the changelog.

---

## Decomposition strategy

Goal: many small, independently reviewable beads, per the planning prompt's "default to the smallest bead you can defend" rule. Sub-items on beads represent acceptance criteria or mechanically-identical work that lands in the same commit.

Work proceeds in roughly this order, but many beads are independent once the schema and agent-type scaffolding land:

1. **Foundation** (schema, type, prompt file, config knobs, CLAUDE.md note)
2. **Retro-agent runtime** (spawn, inputs gatherer, output writer, merge-agent wiring)
3. **Synthesis + FLYWHEEL-REPORT.md** (the piece that turns retros into issues)
4. **Skill-change pipeline behaviors** (work agent narrowing, review-agent lint, test-agent dry-run)
5. **pan sync audience routing + backfill + audit command**
6. **Q&A detection** (pre-tool-hook, deacon, state surfacing)
7. **Dashboard** (API routes, components, flywheel page, metrics)
8. **Autonomous daemon** (loop scaffold, triggers, guards, config)
9. **Public flywheel page** (Mintlify mdx)
10. **Skill/doc updates** (retro-workflow skill, all-up Step 8, CLAUDE.md skill-change pipeline note)

Dependency edges (`blocks`) are declared in the vBRIEF for hard ordering; most work within a phase can parallelize.

---

## Out of scope for PAN-709

- Cost tracking or LLM spend attribution (explicitly excluded)
- A/B testing skills (non-goal in PRD)
- Auto-merging `flywheel-change` issues (humans always click merge)
- Retros for non-PAN projects (PAN first; extend in a later epic)
- Retro-agent in-flight coaching (strictly post-mortem)

---

## Risks the work agent should watch for

1. **PAN-705 not yet merged when work starts.** Gate: first bead verifies the post-PAN-705 surface exists. If not, halt and escalate.
2. **PreToolUse hook can't distinguish auto-approve from manual-approve paths.** Claude Code fires PreToolUse on every tool call regardless of whether it needs approval. The work agent may need to add the `Notification` Claude Code hook event (fires on approval-waiting specifically) as the primary signal. Terminal-tail heuristics are the backup.
3. **Retro-agent ephemeral spawn vs. existing specialist spawn pattern.** Existing specialists are long-lived tmux sessions kept warm by deacon. Retro-agent is spawn-run-exit. The work agent must not regress specialist lifecycle while adding the new shape.
4. **Dashboard blocking-call rule.** New `/api/flywheel/*` route handlers must use `fs/promises` (never `readFileSync`/`readdirSync`). Enforced by CLAUDE.md.
5. **Audience backfill changing skill frontmatter for in-flight PRs.** If the backfill commits while another PR is mid-review touching the same skill, merge conflicts. Backfill bead should land during a quiet window; work agent checks for open PRs that touch `skills/` before starting.
6. **Synthesis issue-filing storm.** First run could file many issues if the retro backlog is large. Synthesis should cap issues-per-run to something reasonable (e.g., 10) and defer overflow to the next cycle. Covered by a sub-item on the synthesis bead.

---

## Open questions (from PRD, unresolved)

1. Should retro-agent see LLM session transcripts, not just terminal tail? Default no; revisit after 10 runs.
2. Should `flywheel-change` issues skip planning entirely? Default yes (synthesis writes the plan into the issue body).
3. How to weight retro signals by issue importance? Start with equal weight.
4. Public FLYWHEEL-REPORT.md privacy — does it ever contain internal details we don't want public? Review before first public render.

These don't block planning. The work agent adopts the PRD defaults and flags if reality deviates.
