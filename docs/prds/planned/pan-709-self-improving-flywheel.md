# PAN-709: Self-Improving Flywheel — Retro Agent, Skill-Change Pipeline, and Autonomous Daemon

## Problem

Panopticon's long-term value depends on the quality of its agents — their prompts, their skills, their context. **Skills are the agents' learned wisdom.** Every skill encodes "here's how to do X correctly based on past experience." But right now, the learning loop is ad-hoc and lossy:

1. **Retrospection is manual.** After an issue merges, nothing captures what went well or badly in a structured way. Insight lives in Edward's head until it fades.
2. **Skill refinement is episodic.** Skills get added/updated when someone remembers to write one. There's no continuous mechanism — no guarantee that the pattern you saw yesterday becomes the skill everyone benefits from tomorrow.
3. **Substrate fixes dominate flywheel runs.** The current `/all-up` flywheel is excellent at fixing Panopticon bugs, but bugs are bounded (eventually they run out). Skill improvement is unbounded — there's always more nuance to encode — but it's not currently in the loop.
4. **Skill audiences are undifferentiated.** `work-complete` and `rebase-and-submit` are meant for autonomous work agents. `pan-approve` and `all-up` are meant for human operators. `pan sync` treats them identically, pushing all 80 skills to every Claude Code session regardless of audience. No frontmatter field, no directory split, no enforcement.
5. **Approval friction halts the flywheel.** When `/all-up` edits a skill file directly, Claude Code prompts the user for approval. The session blocks until answered. This is incompatible with an autonomous always-running flywheel.
6. **Q&A state is invisible.** Planning agents in discovery Q&A and flywheel sessions waiting on approval both look "stuck" to deacon, which can trigger incorrect interventions or loss of context.

**Impact:** Panopticon plateaus at whatever skill set was written the last time someone sat down to write skills. The differentiator stops being "runs agents that learn" and stays at "runs agents that execute what they were told." The compounding mechanism never engages.

## Decision

Build an end-to-end self-improvement system where every completed issue feeds a structured retrospective, retrospectives propose concrete skill changes, skill changes flow through the normal Panopticon pipeline as PAN issues (reviewed, tested, merged like any other change), and the whole loop runs autonomously via a Cloister-hosted daemon.

**Core principles:**
- **Skill changes are issues**, not inline edits. This eliminates approval friction *by eliminating the approval* — the flywheel files issues, agents implement them, the user reviews diffs on Awaiting Merge on their own schedule.
- **Retros are surprise-centered**, not narrative-centered. Most issues merge boringly; boring merges produce 60-second `no-op` retros. Only surprises become proposals.
- **Signal threshold**: a skill change requires **3+ independent retros pointing at the same gap** before synthesis proposes it. Below that threshold, the gap goes on a watchlist in `FLYWHEEL-REPORT.md` — tracked but not acted on.
- **Audience-aware distribution**: every skill declares its audience (`operator` | `agent` | `both`). `pan sync` respects this — operator skills to `~/.claude/skills/`, agent skills injected into workspace CLAUDE.md at creation time.
- **Autonomous by default, interruptive only for blockers**: the daemon fires on events and on schedule, files issues for everything, and only falls back to inline edits for blocker-tier substrate fixes that are stopping issues from merging *right now*.
- **Every improvement is public**: `docs/FLYWHEEL-REPORT.md` is an append-only, user-facing changelog of how Panopticon is teaching itself. Rendered at `panopticon-cli.com/flywheel` as a living marketing artifact.

Ship all of this in one epic. No phased rollout.

---

## Dependencies — aligned with PAN-705 (Command Taxonomy Reorg)

[PAN-705](https://github.com/eltmon/panopticon-cli/issues/705) is **already merged**. It reshaped three surfaces PAN-709 touches: the CLI command tree, the `~/.claude/skills/` set, and dashboard HTTP routes. PAN-709 builds on PAN-705's end-state. The following alignment rules describe **current reality**, not future dependencies:

### 1. Operator skills are already renamed

Operator skills already match CLI verbs 1:1 (`pan-start`, `pan-show`, `pan-review`, `pan-done`, `pan-approve`, `pan-close`, `pan-issues`, `pan-plan`, `pan-status`) and long-tail admin skills live under the `/pan` umbrella. PAN-709 does not rename any operator skills — it introduces a new category on top of the existing surface.

### 2. Skill naming — operator vs. agent split

PAN-709 introduces **agent-audience skills** — reference knowledge for autonomous agents. They are not CLI commands and do not fit the `pan-<verb>` rule.

**Naming conventions by audience:**

| Audience | Naming convention | Example | Description format |
|----------|-------------------|---------|--------------------|
| `operator` | Match CLI verb 1:1 (PAN-705 rule) | `pan-approve` | `"pan approve <id> — merge a ready-for-merge issue"` (lead with literal CLI) |
| `agent` | `wf-<name>` for workflow skills; descriptive for reference skills | `wf-retro`, `wf-work-complete`, `clear-writing` | `"Triggered when <condition>. Use to <action>."` (lead with trigger context — agents don't type CLI verbs) |
| `both` | CLI verb if it's a CLI command both sides invoke | `pan-sync` | Operator-style description |

**Agent workflow skills use the `wf-` prefix.** This makes them immediately distinguishable from operator `pan-<verb>` skills in any listing. Reference skills (e.g., `clear-writing`, `code-review`) that are not step-by-step workflows do not need the `wf-` prefix — they use descriptive names.

**Agent skills are NOT registered under the `/pan` umbrella.** They're not slash commands — they're loaded into workspace `CLAUDE.md` by `pan sync` at workspace creation. The slash menu only shows operator skills.

### 3. `pan sync` — two changes, one codebase

PAN-705 changed `pan sync` to delete legacy skill files on upgrade (clean slate). PAN-709 layers **audience-aware distribution** on top of that cleaned-up state:

1. Clean-slate delete (PAN-705 behavior — unchanged by PAN-709)
2. Read each skill's `audience` field
3. Route by audience:
   - `operator` → `~/.claude/skills/<name>/`
   - `agent` → workspace CLAUDE.md injection only (not `~/.claude/skills/`)
   - `both` → both locations

The implementation of #2 and #3 happens in the same `pan sync` code module PAN-705 modified. The PAN-709 work agent inherits PAN-705's edits and extends them — it does not conflict with or duplicate them.

### 4. Dashboard API routes follow PAN-705 conventions

PAN-705 renamed `/api/work/*` → `/api/issues/*`, `/api/review/*`, `/api/show/*`, `/api/admin/*`. PAN-709 adds new API routes for the flywheel subsystem; these follow the same pattern from the start — **no `/api/work/flywheel/*` or legacy-shaped paths.**

PAN-709's new routes:
- `/api/flywheel/retros` — list retros
- `/api/flywheel/retros/:issueId` — fetch a single retro
- `/api/flywheel/report` — fetch FLYWHEEL-REPORT.md content (rendered)
- `/api/flywheel/daemon/status` — autonomous daemon state (for dashboard banner)
- `/api/admin/skills/audit` — PAN-709's audit command endpoint (under `/api/admin/` per PAN-705)

### 5. Audience backfill and skill renaming

PAN-709 files a one-time backfill issue that:
1. Audits every existing skill and adds the `audience` field
2. **Renames existing agent workflow skills to the `wf-` prefix** (dogfooding the new convention)

This backfill is itself a `flywheel-change` issue and flows through the normal pipeline.

Skills to rename:
- `work-complete` → `wf-work-complete`
- `rebase-and-submit` → `wf-rebase`
- `all-up` → TBD based on audience classification (`agent` or `both`)

Skills that stay as-is (reference skills, not step-by-step workflows):
- `beads`, `code-review`, `refactor`, `clear-writing`, `github-cli`

Sequencing:
1. PAN-709 adds `audience` field to frontmatter schema, updates `pan sync` to respect it (default `operator` for missing)
2. PAN-709 files the backfill as its own `flywheel-change` issue → agent walks `skills/`, classifies each, adds the audience field, and renames workflow skills
3. Retro-agent and synthesis step enforce audience field on any *new* skills proposed after backfill

### 6. Operator-skill description format for any new operator skills PAN-709 adds

If PAN-709's retro process proposes a new operator-audience skill, it **must** follow PAN-705's description format: `"pan <verb> <args> — one-line what it does"`. The retro-agent's prompt enforces this; the review agent's skill-lint validates it. Agent-audience skills follow a different convention (see table above) and are exempt from this rule.

---

## Architecture Overview

```
  ┌─────────────────────────────────────────────────────────────────┐
  │                    AUTONOMOUS FLYWHEEL DAEMON                    │
  │                    (new Cloister loop, meta-deacon)              │
  └──────┬──────────────────────────┬───────────────────────────────┘
         │ on merge event           │ every 30 min + on cycle detected
         ▼                          ▼
  ┌──────────────┐         ┌──────────────────┐
  │ retro-agent  │         │ flywheel cycle   │
  │ (new agent   │         │  - inventory     │
  │  type, fires │         │  - diagnose      │
  │  on merge)   │         │  - file issues   │
  └──────┬───────┘         │  - synthesis     │
         │                  └────────┬─────────┘
         │ writes retro              │
         ▼                           │ reads retros, synthesizes
  ┌──────────────────┐                │
  │ docs/flywheel/   │◀───────────────┘
  │   retros/        │
  │     <id>.md      │
  └──────┬───────────┘
         │ synthesis reads
         ▼
  ┌──────────────────────────────┐         ┌────────────────────────┐
  │ docs/FLYWHEEL-REPORT.md      │         │ PAN issues w/ label    │
  │ (append-only public report)  │         │  `flywheel-change`     │
  └──────────────────────────────┘         └──────────┬─────────────┘
                                                       │ normal pipeline
                                                       ▼
                                            ┌────────────────────────┐
                                            │ plan → work → review   │
                                            │ → test → merge         │
                                            └──────────┬─────────────┘
                                                       │ lands on
                                                       ▼
                                            ┌────────────────────────┐
                                            │ Awaiting Merge         │
                                            │ "Flywheel Changes" tab │
                                            │ (user UAT + merge)     │
                                            └────────────────────────┘
```

---

## Components

### 1. `retro-agent` — New agent type

**Role:** Fire automatically on merge, read a bounded set of workflow artifacts, emit one structured retro markdown file, exit.

**Lifecycle:**
- Triggered by Cloister's `onMergeComplete()` hook immediately after post-merge lifecycle finishes successfully
- Bounded runtime: **5 minutes max** (killed by deacon if exceeded)
- Lightweight model: **Haiku 4.5** (cheap, fast, focused)
- No tmux session persistence — spawn, run, write file, exit
- Cost target: **~$0.05/retro** (bounded inputs + short outputs)

**Inputs (bounded):**
- `.planning/STATE.md` — narrative of what happened
- `.planning/plan.vbrief.json` — plan vs. actual delta
- `feedback/*.md` — every review/test feedback file written during the run
- Last 200 lines of each tmux session history from `~/.panopticon/agents/<id>/`
- This issue's row in `FLYWHEEL-STATE.md` (cycle count, runs stuck, blocker history)
- PR review comments via `gh pr view --comments`
- Merge commit + list of commits on the feature branch

**Prompt framing — surprise-centered, not narrative-centered:**

> You are retro-agent. Your ONLY job is to identify what **surprised** you about how this issue moved through the Panopticon pipeline. Not what happened — surprises.
>
> A surprise is any moment where:
> - An agent did something that an experienced Panopticon operator would not have predicted
> - A skill that should have existed was missing, so the agent improvised
> - A skill that exists was invoked but didn't help (or hurt)
> - The pipeline cycled, retried, or bypassed in a way that suggests a gap
> - Something worked suspiciously well and you want to make sure it's encoded as a pattern (not luck)
>
> **If nothing surprised you, write `no-op` and explain in one line why this issue was boring. Boring is good — it means the pattern is already encoded. Do not invent surprises to fill the form.**
>
> Output a file at `docs/flywheel/retros/<issue-id>-<timestamp>.md` with this schema:
>
> ```markdown
> ---
> issue: PAN-NNN
> agent: retro-agent
> run: <flywheel-run-number-or-"event">
> cycle_count: <number>
> friction_score: <0-10>
> surprise: <true|false>
> proposed_changes: [...]  # structured list, see below
> ---
>
> # Retro: PAN-NNN
>
> ## What surprised me
> (1-2 paragraphs. Only write this if surprise: true. If no-op, write "Routine merge, no surprises: <one-line-why>" and stop.)
>
> ## Proposed changes
> (At least ONE of the following, or explicit no-op reason. No narrative-only retros.)
>
> - add_skill: <name> | audience: operator|agent|both | purpose: <one line>
> - update_skill: <name> | section: <which part> | change: <one line>
> - deprecate_skill: <name> | reason: <one line>
> - file_substrate_issue: <title> | reason: <one line>
> - no_op: <one-line explanation>
> ```

**New skill supporting retro-agent:** `wf-retro` (agent audience) — checklist the retro-agent follows to read inputs in the right order, apply the surprise filter, write the output, and validate its own schema before exiting.

### 2. Retro storage

- **Location:** `docs/flywheel/retros/<issue-id>-<run-number>-<timestamp>.md`
- **Processed retros** move to `docs/flywheel/retros/archive/run-N/` when synthesis runs.
- **Watchlist retros** (single-signal, below threshold) stay in main directory until either more signals arrive or they're archived with a `wontfix` reason after 30 days.

### 3. Synthesis step — new Step 8 in `all-up` skill

Between Step 7 (main hygiene) and Step 7.5 (FLYWHEEL-STATE update):

1. **Read every non-archived retro** in `docs/flywheel/retros/`.
2. **Filter** to `surprise: true` retros.
3. **Group by signature** — retros proposing similar changes (same target skill, same gap description, same audience).
4. **Apply threshold**: any change with **≥3 independent signals** becomes a PAN issue proposal. Below threshold → watchlist entry in `FLYWHEEL-REPORT.md`.
5. **File PAN issues** for each above-threshold change:
   - Label: `flywheel-change`
   - Title: `flywheel: <verb> <skill-name> — <summary>` (e.g., `flywheel: update all-up — add retro enforcement to Step 8`)
   - Body: the structured proposal, links to every retro that triggered it, and the proposed patch as a code block
   - Priority: derived from aggregated friction scores (median across triggering retros)
6. **Append a new section** to `docs/FLYWHEEL-REPORT.md` (see schema below).
7. **Archive processed retros** to `docs/flywheel/retros/archive/run-N/`.
8. **Commit + push** the archive move and FLYWHEEL-REPORT.md update.

### 4. `docs/FLYWHEEL-REPORT.md` — user-facing living doc

Append-only. One section per flywheel run or autonomous daemon cycle.

**Schema:**

```markdown
# Flywheel Report

_Living record of how Panopticon teaches itself. Each section documents one flywheel revolution._

---

## Run 12 — 2026-04-15 — _human-invoked via /all-up_

### Quick stats
- Issues merged this run: 4 (PAN-544, PAN-611, PAN-509, PAN-457)
- Substrate bugs fixed inline: 2
- Skill-change issues filed: 3
- Retros processed: 6 (4 surprise, 2 no-op)

### Skill-change issues filed
- [PAN-709](…) — update `all-up` skill — add retro enforcement to Step 8 (signals: 3)
- [PAN-710](…) — add `recover-from-rebase-conflict` skill (agent audience; signals: 4)
- [PAN-711](…) — deprecate `pan-tell-legacy` — superseded by `pan-tell` (signals: 3)

### Substrate bugs fixed inline (blocker tier)
- Commit `abc123` — `checkFailedMergeRetry()` now detects CI check failures
- Commit `def456` — `repairClosedPRs()` clears stale prUrl on startup

### Top friction patterns this run
1. **Local-vs-CI lockfile divergence** — 3 issues affected (PAN-544 seen again; PAN-611, PAN-457 newly). Watchlist → candidate for "clean-checkout verification gate" work.
2. **Review circuit breaker manual reset** — 2 issues. Still below threshold; watchlist.

### Watchlist (below 3-signal threshold)
- Deacon re-dispatch gate blocked for null-prUrl issues with passed history — 2 signals
- Orphaned planning sessions after rate-limit reset — 1 signal

### Wins
- Cycle detection caught PAN-611 loop in Run 11; saved ~2hrs of LLM time in Run 12.
- Retro threshold (3-signal) correctly filtered out 4 single-data-point proposals that would have been noise.

---

## Run 11 — 2026-04-13 — _human-invoked via /all-up_
…
```

The rendered public version at `panopticon-cli.com/flywheel` uses this file as its source.

### 5. Skill-changes-as-PAN-issues pipeline

**New label:** `flywheel-change`. Pipeline is identical to normal PAN issues with a few twists:

- **Planning phase can be skipped.** The synthesis step writes the full proposal + patch into the issue body. The work agent treats the issue body as the PRD.
- **Work agent scope is narrow**: write/edit skill files only. If the proposal touches non-skill code, it's a mis-classified issue and the work agent rejects it back to synthesis.
- **Review agent runs skill-specific checks**:
  - Skill frontmatter is valid (has `name`, `description`, `audience`, optional `triggers`)
  - No syntax errors in the markdown
  - No references to removed skills
  - Consistent with existing skill conventions
  - Diff is coherent (not a shotgun rewrite where a focused edit was proposed)
- **Test agent** runs `pan sync --dry-run` to validate the skill file compiles into the synced layout, and runs a skill-lint (new; see component 8).
- **Merge** via the normal flow. Post-merge, `pan sync` runs automatically to push the change out.
- **Awaiting Merge** shows these in a dedicated "Flywheel Changes" tab (see component 6).

### 6. Dashboard — "Flywheel Changes" tab on Awaiting Merge

**New route:** `/flywheel` (separate from `/awaiting-merge`, but also rendered as a tab on it).

**Card layout for each `flywheel-change` issue:**
- Skill name and one-sentence summary
- **Diff view** of the proposed SKILL.md change, rendered inline (before/after)
- **Retro provenance** — the retros that triggered this change, collapsible. Click-through shows the full retro content.
- **Aggregated signal count** — "proposed by retros from: PAN-611, PAN-544, PAN-509 — 3 independent signals"
- **Merge** button (identical UX to existing Awaiting Merge)
- **Rollback preview** — link to the revert commit that would be generated if the change turns out bad

**Metrics panel** (top of page):
- Skills added this week / this month / all-time
- Skills refined this week / this month / all-time
- Retros processed this week / this month / all-time
- Retros dropped by no-op filter (signal that boring is working)
- Top 5 patterns that triggered changes

### 7. Audience field on skills

**New frontmatter field:** `audience: operator | agent | both`

**Default for backward compat:** if missing, treated as `operator` (current behavior — every skill goes to `~/.claude/skills/`).

**Validation:**
- New retros proposing new skills **must** populate audience
- Review agent rejects new skills missing the field
- `pan admin skills audit` shows which skills are missing audience and flags them for backfill

**Backfill:** ship a one-time PAN issue that walks every existing skill, classifies it, and adds the field. This is itself a skill-change issue, so it goes through the pipeline.

### 8. `pan sync` audience enforcement

**Behavior change:**
- `operator` skills → `~/.claude/skills/<name>/` (current behavior)
- `agent` skills → **NOT** copied to `~/.claude/skills/`. Instead, referenced from workspace `CLAUDE.md` at workspace creation time via a new `## Available Skills` section
- `both` → copied to both locations

**Workspace CLAUDE.md injection:**
- `pan workspace create` adds a `## Available Skills (agent audience)` section to the workspace's `CLAUDE.md`
- Each agent skill is listed with name + description + link to its SKILL.md in the repo
- Agent reads its CLAUDE.md on startup and discovers the skills

**New command:** `pan admin skills audit`
- Lists every skill with its audience, where it's currently synced, whether it's missing the field
- Flags discrepancies (skill declared `agent` but sitting in `~/.claude/skills/` as stale copy)
- Optional `--fix` flag to clean up

**New skill lint:**
- Run by test agent on skill-change issues
- Validates frontmatter schema
- Validates no broken skill references
- Validates audience field is present

### 9. Q&A / waiting-on-human detection — enhancement

**Current state:** Panopticon has two agent states: `running` (actively working) and `stuck` (deacon should intervene). Reality is three:
1. **Working** — agent is productively executing
2. **Stuck** — actually stuck, needs intervention
3. **Waiting on human** — productively paused for input (planning Q&A, approval prompt in a Claude Code session, interactive confirmation)

**Detection:**
- Terminal tail heuristics: look for `?`, `[y/N]`, `[y/n/?]`, `Press any key`, `Waiting for input`, `> `, `claude-code approval prompt` markers
- Signal from Claude Code itself when available (if an approval prompt is active, it should emit a marker to the tmux session or write a state file)
- PreToolUse hook writes `waiting: true` to `runtime.json` when Claude Code is about to invoke a tool that requires approval; PostToolUse clears it

**New state:** `waiting-on-human` in agent state model.

**Dashboard UX:**
- Yellow ⏳ badge on the agent card
- Text: "Awaiting your input"
- Click-through opens the tmux session (terminal panel) focused on the bottom where the prompt lives
- On the kanban, the issue card shows the same badge

**Deacon respects it:** never counts toward stuck-timer, never triggers recovery, never resets. The agent is making progress; it just needs a human.

**Flywheel integration:** when the main flywheel session (or the autonomous daemon) hits an approval prompt, the dashboard surfaces it. User has a single place to see "things waiting on me." Combined with skill-changes-as-issues, this should be rare for the main flywheel loop.

### 10. Autonomous flywheel daemon

**New Cloister loop:** `flywheelDaemon` (think "meta-deacon" — sits alongside deacon's existing loops).

**Trigger sources:**
- **Event-driven:**
  - Merge complete → spawn retro-agent for the merged issue
  - Cycle detected in FLYWHEEL-STATE → diagnose inline (file substrate issue if not blocker; fix inline if blocker)
  - Awaiting Merge queue exceeds threshold → notify user via dashboard banner
- **Scheduled:**
  - Every 30 min: re-read FLYWHEEL-STATE.md, check for watchlist items that have crossed threshold, run synthesis step if any new retros exist
  - Every 24 hours: full flywheel cycle (inventory, diagnose, file issues, synthesize, report)
- **Resource-aware:**
  - Back off when user is active in a Claude Code session on the same machine (check for recent session activity)
  - Back off during declared "quiet hours" (configurable in `~/.panopticon/config.yaml`)
  - Never interrupt a running planning agent that's in `waiting-on-human` state

**What it never does:**
- Edit skill files directly (always files issues)
- Edit non-blocker substrate code directly (always files issues)
- Wake the user outside quiet hours unless a P0 hotfix is filed
- Run more than one flywheel cycle concurrently (mutex via `~/.panopticon/flywheel.lock`)

**Configurable in `~/.panopticon/config.yaml`:**

```yaml
flywheel:
  autonomous: true
  quiet_hours: "22:00-08:00"
  trigger_interval_minutes: 30
  full_cycle_interval_hours: 24
  backoff_on_active_session: true
  awaiting_merge_notify_threshold: 5
```

### 11. Public flywheel dashboard page

**Location:** `panopticon-cli.com/flywheel`

**Source:** `docs/FLYWHEEL-REPORT.md` rendered by the existing Mintlify docs pipeline.

**Content:**
- Timeline of runs (newest first)
- Metrics: skills added, retros processed, substrate bugs fixed — cumulative and per-month sparklines
- Top patterns recognized this month
- Wins highlighted
- Public marketing artifact: "Panopticon taught itself 47 new patterns this month."

Add a new nav entry in the docs site under "How It Works" → "The Flywheel."

### 12. Updated `all-up` skill

Add Step 8 (synthesis) after Step 7.5. Document the new rules:

- Skill changes are **never** inline edits during `/all-up`. Always file a `flywheel-change` issue via synthesis.
- Substrate bugs: tier-gated — blocker tier (stopping issues in *this* run) can be inline; non-blocker becomes a `flywheel-change` issue too (but with a different label like `substrate-improvement`).
- Add explicit acknowledgment that retro-agent fires automatically on merge — don't run retros manually during `/all-up`.
- Document the `docs/flywheel/retros/` directory, the FLYWHEEL-REPORT.md schema, and the signal threshold.

### 13. Updated `CLAUDE.md` (repo-level)

Add a section explaining the skill-change pipeline so future Claude Code sessions (and agents) understand why they shouldn't edit skills directly:

> **Skill changes go through the flywheel pipeline, not direct edits.** If you notice a skill that should be added, updated, or deprecated, do NOT edit `skills/<name>/SKILL.md` directly. Either: (a) file a `flywheel-change` PAN issue with your proposed change, or (b) write a retro note in `docs/flywheel/retros/` and the next flywheel synthesis cycle will pick it up.

---

## Data model changes

### `skills/<name>/SKILL.md` frontmatter

**Before:**
```yaml
---
name: work-complete
description: …
triggers: [...]
---
```

**After:**
```yaml
---
name: work-complete
description: …
audience: agent              # NEW: operator | agent | both
triggers: [...]
---
```

### `docs/flywheel/retros/<issue-id>-<timestamp>.md` (new)

See retro-agent prompt above for the full schema.

### `docs/FLYWHEEL-REPORT.md` (new)

Append-only. One section per run. See section 4 schema above.

### `~/.panopticon/config.yaml` — new `flywheel` section

```yaml
flywheel:
  autonomous: true
  quiet_hours: "22:00-08:00"
  …
```

### Agent state — new `waiting-on-human` state

Extend the existing agent state enum. Store in `runtime.json` as `state: "waiting-on-human"`. Deacon skips stuck-check when this is set.

### Dashboard schema — new kanban badge + Awaiting Merge sub-tab

- Kanban issue card: yellow ⏳ badge when `waiting-on-human`
- Awaiting Merge: new "Flywheel Changes" tab filtered by label `flywheel-change`

---

## Acceptance criteria

1. **Retro-agent fires automatically on merge.** Given a merged issue, a retro markdown file appears in `docs/flywheel/retros/` within 5 minutes, conforming to the schema.
2. **No-op filtering works.** Routine merges produce `no-op` retros (~60 seconds, < $0.02 cost) and are archived without triggering synthesis.
3. **Signal threshold is enforced.** A skill change with only 2 retros does not produce a PAN issue — it appears on the watchlist. A change with 3+ retros produces a PAN issue.
4. **Skill-change issues flow through the pipeline** end-to-end: filed by synthesis → planned (or PRD-skipped) → implemented by work agent → reviewed → tested → merged → appears in `~/.claude/skills/` (for operator audience) or in workspace CLAUDE.md (for agent audience).
5. **Audience field is enforced.** `pan admin skills audit` identifies all skills missing the field. New skills proposed by retros include it. Review agent rejects new skills that don't.
6. **`pan sync` respects audience.** Operator skills land in `~/.claude/skills/`. Agent skills are referenced from workspace CLAUDE.md but not copied to `~/.claude/skills/`. `both` lands in both places.
7. **Q&A detection works.** An agent waiting on a prompt (planning Q&A OR Claude Code approval) is marked `waiting-on-human`. Dashboard shows the badge. Deacon does not intervene. Clicking the badge opens the terminal focused on the prompt.
8. **Autonomous daemon runs.** With `flywheel.autonomous: true`, Cloister fires retro-agents on merge without user intervention. Every 30 min the daemon re-reads FLYWHEEL-STATE and runs synthesis if there are new retros. Quiet hours and active-session backoff are respected.
9. **`docs/FLYWHEEL-REPORT.md` accumulates.** After 3 runs, the report has 3 sections with all required fields.
10. **Public dashboard renders.** `panopticon-cli.com/flywheel` shows the timeline from FLYWHEEL-REPORT.md via the Mintlify pipeline.
11. **Skill-change pipeline never interrupts the flywheel for approval.** During `/all-up`, zero approval prompts are raised for skill edits. All skill changes flow through filed issues.
12. **`all-up` skill updated** with Step 8 synthesis and the rule "skill changes are never inline edits during `/all-up`."
13. **Retro cost is bounded.** Median retro cost across 10 runs is ≤ $0.10. Max retro cost is ≤ $0.30 (including surprising retros with more proposals).
14. **Main is always clean.** After every daemon cycle, `git status` on `main` is clean and pushed. No approval-requiring side effects left dangling.

---

## Risks and mitigations

### Risk 1: Retros produce too much noise (every issue triggers a "proposal")

**Mitigation:**
- Surprise-centered prompt framing ("if nothing surprised you, write no-op and stop")
- 3-signal threshold before any PAN issue is filed
- Watchlist captures single-signal proposals without acting on them
- Synthesis step reports aggregate filter ratio ("6 retros this run → 2 reached threshold → 2 issues filed"); if the filter ratio is consistently > 80% becoming issues, the threshold gets raised

### Risk 2: Retro-agent cost escalates

**Mitigation:**
- Haiku 4.5 for retro model (cheap, fast)
- Hard 5-minute runtime cap enforced by deacon
- Output cap via schema (≤500 words)
- Cost tracking in `FLYWHEEL-REPORT.md` so drift is visible
- Hard budget: if median retro cost exceeds $0.15 over a rolling 10-retro window, retro-agent auto-disables and alerts via dashboard

### Risk 3: The skill-change pipeline introduces new failure modes

**Mitigation:**
- Skill-change issues are narrow scope (skill files only, work agent rejects anything else)
- Review agent runs skill-specific lint
- Test agent runs `pan sync --dry-run` before approving
- Rollback is free (git revert) — no migration pain

### Risk 4: Autonomous daemon runs during user's active work and causes unwanted side effects

**Mitigation:**
- Active-session detection (any Claude Code session touched a file in the last 10 min → backoff)
- Quiet hours enforced
- Mutex on `~/.panopticon/flywheel.lock`
- Daemon only ever files issues and runs read-only diagnosis — never directly edits main code except for blocker-tier substrate fixes (which are explicitly gated)

### Risk 5: Q&A detection false positives (agent gets marked `waiting-on-human` when it's actually stuck)

**Mitigation:**
- Pattern matching errs conservative (only well-known prompt patterns)
- PreToolUse/PostToolUse hook writes explicit state when Claude Code is definitely waiting on approval
- Deacon still runs stuck-timer on `waiting-on-human` state but with a 4x longer threshold before intervening, so genuine stuck agents are still recovered eventually

### Risk 6: Proposed skill changes by the retro-agent are low-quality or hallucinated

**Mitigation:**
- Review agent is the gate — skill-specific lint catches malformed frontmatter, broken references, syntactic errors
- Signal threshold (3+ retros) means a single hallucinated retro can't force a change
- Every skill change is a PR diff the user sees on Awaiting Merge; the UAT is "does this look right"
- Rollback is a revert

### Risk 7: Existing skills break when we add the audience field

**Mitigation:**
- Default for missing field is `operator` → exactly current behavior
- Backfill ships as its own skill-change issue (eating our own dogfood)
- `pan sync` is backward-compat: skills without audience field sync to `~/.claude/skills/` as before

---

## Non-goals

- **A/B testing of skills.** The provenance infrastructure makes it *possible* later, but we're not building experimentation/attribution in this epic.
- **Auto-merging skill-change issues.** Humans still click merge. Always.
- **Retros for non-Panopticon projects.** Initial scope is PAN issues only. If the pattern works, we extend to MIN, AUR, KRUX later as a separate epic.
- **Retro-agent interacting with agents during their run.** Retro-agent is strictly post-mortem. No in-flight coaching.
- **Migrating every existing skill to the new audience field in this epic.** Backfill ships as a separate dog-fooded skill-change issue once the pipeline is live.

---

## Open questions

1. **Should retro-agent have access to LLM session transcripts** (not just terminal tail)? Gives deeper insight but increases cost. Default no; revisit after first 10 runs.
2. **Should `flywheel-change` issues skip planning entirely**, or go through a minimal planning phase for validation? Default skip (synthesis writes the proposal into the issue body). Revisit if we see mis-scoped issues.
3. **How to weight retro signals by issue importance?** A retro from a P0 hotfix issue vs. a routine enhancement — do they carry equal weight? Start with equal weight; add tiering if we see high-value signals getting drowned out.
4. **Rate limiting for the autonomous daemon** — should it cap at N daemon cycles per day to avoid LLM spend spikes? Start uncapped with cost tracking in FLYWHEEL-REPORT.md; add caps if spend is surprising.
5. **Public dashboard privacy** — does `FLYWHEEL-REPORT.md` include internal details we don't want public? Review before first render; add a `public: true/false` flag per section if needed.

---

## Implementation notes

- **Retro-agent prompt lives in** `src/lib/cloister/prompts/retro-agent.md` (new file).
- **New agent type registered in** `projects.yaml` and `src/lib/cloister/agent-types.ts`.
- **Cloister lifecycle hook** `onMergeComplete()` in `src/lib/cloister/merge-agent.ts` spawns retro-agent after post-merge lifecycle succeeds.
- **Synthesis logic** lives in `src/lib/flywheel/synthesis.ts` (new module).
- **`flywheelDaemon` loop** lives in `src/lib/cloister/flywheel-daemon.ts` (new module, mirrors deacon's structure).
- **`waiting-on-human` state detection** extends `src/lib/cloister/deacon.ts` with a new check function.
- **Skill frontmatter schema** defined in `packages/contracts/src/skills.ts` (new or extended).
- **`pan admin skills audit`** command in `src/cli/commands/admin/skills/audit.ts` (new).
- **Dashboard "Flywheel Changes" tab** in `src/dashboard/frontend/src/components/AwaitingMergePage.tsx` + new `FlywheelChangesTab.tsx`.
- **Public flywheel page** — add `flywheel.mdx` in `panopticon-cli.com/content/` (or wherever Mintlify pulls from) that embeds the rendered FLYWHEEL-REPORT.md.

---

## Why this is worth doing as one epic, not phased

Each component depends on the next. Retros without synthesis are notes nobody reads. Synthesis without skill-change-as-issues forces inline edits and approval friction. Skill-change-as-issues without the audience field has no enforcement. Audience field without `pan sync` changes has no effect. None of it is autonomous without the daemon. None of it is visible without FLYWHEEL-REPORT.md. **Phasing this would ship a half-built system that doesn't compound.** Ship the whole loop or don't ship it at all.
