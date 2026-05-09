# PAN-1048: Unify Agent Type System — Role Primitive with Reactive Cloister

**Issue:** [PAN-1048](https://github.com/eltmon/panopticon-cli/issues/1048)
**Author:** Ed Becker
**Date:** 2026-05-08
**Status:** Planning

---

## Vision

Replace Panopticon's 5 overlapping agent type enums with a single concept: **Role**. A Role is a `.md` file that tells an agent what to do. An agent process is a **Run** — a `(role, model, harness)` tuple. Cloister becomes a reactive scheduler that watches the issue tracker for state changes and spawns the appropriate role. State lives with the issue, not the agent.

## Problem

The current system has 5 separate enums that all describe "what kind of agent is this":

| Enum | Count | Location | What it represents |
|------|-------|----------|--------------------|
| `PanopticonAgentType` | 7 | `src/lib/agents.ts:108` | Agent identity (work, planning, review, test, inspect, uat, merge) |
| `SpecialistType` | 5 | `src/lib/cloister/specialists.ts:172` | Specialist identity (merge-agent, review-agent, test-agent, inspect-agent, uat-agent) |
| `LauncherAgentType` | 9 | `src/lib/launcher-generator.ts:1` | Agent types + spawn modes conflated (work, planning, specialist-dispatch, specialist-init, review, conversation, remote, runtime, resume) |
| `WorkTypeId` | 24 | `src/lib/work-types.ts` | Model routing keys across 7 categories |
| `ActivitySource` | 8 | `src/lib/activity-logger.ts:21` | Logging attribution (merge-agent, cloister, review-specialist, test-specialist, dashboard, deploy-script, planning-agent, work-agent) |

These enums conflate four orthogonal concerns:
1. **What role the agent plays** (plan, work, review, test, ship)
2. **How the agent was spawned** (conversation, remote, resume — spawn modes, not identities)
3. **What model tier to route to** (opus for review, sonnet for work)
4. **Who logged this activity** (attribution for the activity log)

This causes real bugs. PAN-1044: a planning agent spawned with `phase: "planning"` instead of `type: "planning"` + `agentPhase: "planning"` — the dashboard couldn't render the Done button. The agent then called `pan done` (work completion) instead of `pan plan done` (planning completion) because it didn't know what kind of agent it was.

Three naming conventions exist for the same concepts: `review-agent` (SpecialistType), `review` (PanopticonAgentType), `pan-review-agent` (.md file name). Agent IDs use `agent-pan-<issueId>` while agent definitions use `pan-<type>-agent`. Even the basic structure isn't consistent.

The settings UI (`AgentCardsPanel.tsx:8-114`) exposes 17 separate agent cards organized by 4 categories with 24 WorkTypeId keys — a user has to understand all of this just to say "use opus for reviews."

---

## Proposed Model

### Actions vs Roles

**Actions** are what the user does in the UI (verbs). **Roles** are agent definitions (`.md` files). They are separate concepts:

```
User Action          Cloister spawns       Role (.md)        UI
───────────────────────────────────────────────────────────────────
Right-click "Plan"   (plan, sonnet)        roles/plan.md     Planning dialog (interactive)
Click "Start"        (work, sonnet)        roles/work.md     Terminal panel (watch)
  (automatic)        (review, opus)        roles/review.md   Terminal panel (watch)
  (automatic)        (test, sonnet)        roles/test.md     Terminal panel (watch)
  (automatic)        (ship, sonnet)        roles/ship.md     Terminal panel (watch)
Click "Merge"        (no agent)            —                 Button click (human gate)
```

The action "Start" does not mean "run the work role." It means "begin work on this issue," which causes Cloister to spawn a run that uses the `work` role definition. The action is user-facing; the role is an implementation detail.

Only the `plan` action opens a dialog, because planning is interactive — the user co-authors the plan. All other roles are fire-and-watch: the user monitors progress in the terminal panel or the Directive Flow DAG.

### The Role Primitive

A **Role** is a `.md` agent definition file. Five roles:

| Role | File | Purpose | Default model |
|------|------|---------|---------------|
| `plan` | `roles/plan.md` | Read issue, research codebase, write vBRIEF, create beads | `workhorse:expensive` (planning errors cascade) |
| `work` | `roles/work.md` | Claim beads, write code, commit per bead, self-inspect (Jidoka) | `workhorse:mid` |
| `review` | `roles/review.md` | Read diff, run convoy reviewers, approve or request changes | `workhorse:expensive` (decision-maker) |
| `test` | `roles/test.md` | Run project test suite, report failures | `workhorse:mid` |
| `ship` | `roles/ship.md` | Rebase onto main, resolve conflicts, run verification, prep for merge | `workhorse:mid` |

**Inspect folds into `work`** — Jidoka (Toyota's "stop and fix" principle). The work agent self-inspects each bead before moving to the next. This is a prompt concern within `roles/work.md`, not a separate role.

**UAT folds into `test`** — browser-based testing is a tool available to the test role (via Playwright MCP), not a separate identity.

**Human-merge invariant:** The `ship` role does post-approval prep (rebase, conflict resolution, final verification). A human clicks the merge button. The role NEVER auto-merges.

### The Run

A **Run** is a process playing a role:

```
Run = (role, model, harness)
```

- **role**: which `.md` file drives the agent (`roles/work.md`)
- **model**: which model to use (`claude-sonnet-4-6`, `kimi-k2.6`, `glm-4.7`)
- **harness**: which coding agent runtime (`claude-code`, `pi`)

The run is ephemeral. It spawns, does one role's worth of work, updates the tracker, and exits. There is no long-lived agent holding state.

### Reactive Cloister

Cloister becomes a scheduler that reacts to tracker state changes:

```
Tracker (GitHub Issue)          Cloister (Scheduler)           Process (Run)
━━━━━━━━━━━━━━━━━━━━          ━━━━━━━━━━━━━━━━━━━━           ━━━━━━━━━━━━━━

Issue created ──────────────►  sees "open" ──────────────►    spawns (plan, sonnet, claude)
                                                              process reads issue,
                                                              writes vBRIEF,
                                                              updates issue → "planned"
                                                              process exits

Issue → "planned" ──────────►  sees "planned" ───────────►   spawns (work, sonnet, claude)
                                                              process reads vBRIEF,
                                                              writes code, commits,
                                                              updates issue → "in review"
                                                              process exits

Issue → "in review" ────────►  sees "in review" ─────────►  spawns (review, opus, claude)
                                                              process reads diff,
                                                              approves or requests changes,
                                                              updates issue → "testing"
                                                              or → "planned" (changes requested)
                                                              process exits

Issue → "testing" ──────────►  sees "testing" ────────────►  spawns (test, sonnet, claude)
                                                              process runs tests,
                                                              updates issue → "shipping"
                                                              or → "planned" (test failure)
                                                              process exits

Issue → "shipping" ─────────►  sees "shipping" ──────────►  spawns (ship, sonnet, claude)
                                                              process rebases, resolves,
                                                              verifies, preps PR,
                                                              updates issue → "ready to merge"
                                                              process exits

Issue → "ready to merge" ───►  HUMAN clicks merge button
```

Key properties:
- **State lives with the issue**, not the agent. The tracker is the single source of truth.
- **Event-driven at the scheduling layer.** Issue state changes are the events. Cloister's job: "issue X is in state Y → spawn role Z."
- **Orchestrated within each run.** The role's `.md` file IS the orchestration — it tells the process what to do and how to signal completion.
- **No specialist state.** No persistent session files, no specialist queues, no dispatch machinery. Each run starts cold.

### Convoy Reviewers

The 5 parallel review sub-agents (security, performance, correctness, requirements, synthesis) are **sub-runs within the review role**, not separate roles. The `roles/review.md` file spawns them as Claude Code subagents using the built-in `Agent` tool. They run within the same process, share the same harness, and report back to the review role which synthesizes and decides.

This keeps the top-level role count at 5.

### Workhorse Models — user-managed model tiers

Once roles and sub-roles exist, the user faces a new problem: there are ~12 places that need a model (5 roles + 2 work sub-roles + 4 review sub-roles + a couple of swarm/conversation slots). Picking literal model ids in 12 places means every model upgrade is a 12-place edit, and when a new flagship ships the user has to remember which slots referenced the old one.

**Workhorse Models** are a one-level indirection that makes the cost/quality tradeoff explicit at the top of Settings:

- The user maintains exactly **3 named slots** — `expensive`, `mid`, `cheap` — each pointing to a literal model id.
- Every per-role and per-sub-role model picker accepts EITHER a literal model id OR a **workhorse reference** (`workhorse:expensive`, `workhorse:mid`, `workhorse:cheap`).
- Default config uses workhorse references everywhere. Power users can pin individual slots to a literal id when a specific role needs to diverge.

When a new model ships (`claude-opus-4-8`, `kimi-k2.7`), the user updates `workhorses.expensive` once and every `workhorse:expensive` reference upgrades automatically. No grep, no audit, no missed slot. The 3 slots also make the *intent* of each role legible: **plan and review use "the expensive one"** (planning is foundational — errors cascade through every downstream bead, so the strongest model goes there; review is the decision-maker — it gates merge, so the strongest model goes there too), inspect-every-bead uses "the cheap one," everything else uses "the mid one." If the user wants to A/B a cheaper model across the whole pipeline, they flip the `mid` slot and watch the whole graph downshift while planning and review stay pinned to their tier.

```yaml
# ~/.panopticon/config.yaml — defaults
workhorses:
  expensive: claude-opus-4-7
  mid:       claude-sonnet-4-7
  cheap:     claude-haiku-4-5

roles:
  plan:   { model: workhorse:expensive }         # planning is foundational — errors cascade
  work:
    model: workhorse:mid
    sub:
      inspect:      { model: workhorse:cheap }   # every bead — fast & cheap
      inspect-deep: { model: workhorse:mid }     # flagged beads only
  review:
    model: workhorse:expensive                   # synthesis is the decision-maker
    sub:
      security:     { model: workhorse:expensive }
      correctness:  { model: workhorse:mid }
      performance:  { model: workhorse:mid }
      requirements: { model: workhorse:mid }
  test:   { model: workhorse:mid }
  ship:   { model: workhorse:mid }
```

**Resolution semantics.** `resolveModel(role, subRole?)` returns a literal model id, dereferencing `workhorse:<slot>` through the `workhorses` map. Unresolved references (typo, deleted slot, missing config) fail at **config-load time** with an error pointing at the offending field — never silently at spawn time. Workhorse references must NOT chain (`workhorse:foo: workhorse:bar` is rejected at parse).

**Provider-agnostic.** Workhorses are model ids, not Anthropic-specific. `workhorses.cheap: kimi-k2.6-flash` and `workhorses.expensive: glm-4.7-pro` are equally valid. The harness layer handles dispatch.

**Why exactly three.** Two is too few (no middle ground for the common case). Four is too many (diminishing returns; "kinda expensive" and "kinda cheap" blur). Three matches the natural tradeoff buckets users already think in: stable/strong, balanced default, fast/cheap. The 3-slot constraint is intentional and enforced — Settings does not let users add a fourth slot.

### Eval Grid

The `(role, model, harness)` tuple enables systematic evaluation. Hold two axes constant, vary the third:

```
                     model
                 ┌──────────────────────────────┐
                 │  opus    sonnet    haiku      │
          ┌──────┼──────────────────────────────┤
    role   │ plan │   ●        ●        ●       │
          │ work │   ●        ●        ●       │
          │review│   ●        ●        ●       │
          │ test │   ●        ●        ●       │
          │ ship │   ●        ●        ●       │
          └──────┼──────────────────────────────┤
                 └──────────────────────────────┘
                          × harness (claude-code, pi)
```

Example: "Does review quality degrade from opus to sonnet?" Hold role=review and harness=claude-code constant, run both models on the same 10 PRs, compare results. This isn't possible today because "review" is spread across `review` (PanopticonAgentType), `review-agent` (SpecialistType), `specialist-review-agent` (WorkTypeId), and `review-specialist` (ActivitySource).

---

## Data Model Changes

### state.json — Before

```json
{
  "id": "agent-pan-1044",
  "issueId": "PAN-1044",
  "workspace": "/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1044",
  "runtime": "claude",
  "harness": "claude-code",
  "model": "claude-sonnet-4-6",
  "status": "stopped",
  "type": "work",
  "agentPhase": "implementation",
  "phase": "planning",
  "handoffCount": 0,
  "costSoFar": 0,
  "startedAt": "2026-05-09T01:14:05.264Z",
  "lastActivity": "2026-05-09T01:14:11.892Z",
  "stoppedAt": "2026-05-09T01:44:10.047Z"
}
```

Three fields (`type`, `agentPhase`, `phase`) for the same concept, none consistently set.

### state.json — After

```json
{
  "id": "agent-pan-1044",
  "issueId": "PAN-1044",
  "workspace": "/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1044",
  "role": "work",
  "model": "claude-sonnet-4-6",
  "harness": "claude-code",
  "status": "running",
  "costSoFar": 0,
  "startedAt": "2026-05-09T01:14:05.264Z",
  "lastActivity": "2026-05-09T01:14:11.892Z"
}
```

One field (`role`) replaces three (`type`, `agentPhase`, `phase`). `runtime` is renamed to `harness`.

### AgentState interface — Before (`src/lib/agents.ts:388-433`)

```typescript
export interface AgentState {
  id: string;
  issueId: string;
  workspace: string;
  runtime: string;
  harness?: 'claude-code' | 'pi';
  model: string;
  status: 'starting' | 'running' | 'stopped' | 'error';
  type?: string;
  agentPhase?: string;
  phase?: string;
  workType?: WorkTypeId;
  complexity?: ComplexityLevel;
  handoffCount?: number;
  costSoFar?: number;
  // ...
}
```

### AgentState interface — After

```typescript
export type Role = 'plan' | 'work' | 'review' | 'test' | 'ship';

export interface AgentState {
  id: string;
  issueId: string;
  workspace: string;
  role: Role;
  model: string;
  harness: 'claude-code' | 'pi';
  status: 'starting' | 'running' | 'stopped' | 'error';
  costSoFar?: number;
  startedAt: string;
  lastActivity?: string;
  stoppedAt?: string;
}
```

Removed: `runtime`, `type`, `agentPhase`, `phase`, `workType`, `complexity`, `handoffCount`.

### Model routing — Before (WorkTypeRouter)

24 `WorkTypeId` keys mapped through `WorkTypeRouter` class (`src/lib/work-type-router.ts`) with smart model selection, capability scoring, and fallback chains. Settings UI exposes 17 agent cards with individual overrides.

### Model routing — After

5 roles, each with a default model that points at one of the 3 workhorse slots. Sub-roles (work.inspect, review.security, etc.) likewise resolve through workhorses by default. Override in settings:

```yaml
# ~/.panopticon/config.yaml
workhorses:
  expensive: claude-opus-4-7
  mid:       claude-sonnet-4-7
  cheap:     claude-haiku-4-5

roles:
  plan:   { model: workhorse:expensive }
  work:
    model: workhorse:mid
    sub:
      inspect:      { model: workhorse:cheap }
      inspect-deep: { model: workhorse:mid }
  review:
    model: workhorse:expensive
    sub:
      security:     { model: workhorse:expensive }
      correctness:  { model: workhorse:mid }
      performance:  { model: workhorse:mid }
      requirements: { model: workhorse:mid }
  test:   { model: workhorse:mid }
  ship:   { model: workhorse:mid }
```

The settings UI becomes 5 role cards (Review and Work expand to show sub-role pickers) plus a Workhorse Models panel at the top. ~12 model selections, but managed through 3 workhorse dials for the common case.

### ActivitySource — Before

```typescript
export type ActivitySource = 'merge-agent' | 'cloister' | 'review-specialist'
  | 'test-specialist' | 'dashboard' | 'deploy-script' | 'planning-agent' | 'work-agent';
```

### ActivitySource — After

Derived from `role` field + context. No separate enum:

```typescript
// In activity-logger.ts, the source is computed:
function activitySource(state: AgentState): string {
  if (state.role) return state.role;  // 'plan', 'work', 'review', 'test', 'ship'
  return 'dashboard';  // non-agent activity
}
```

### Role file location

Role definitions live at `roles/<name>.md` in the Panopticon repo. These are Panopticon's own concept, spawned via `claude --agent roles/<name>.md`. They are NOT in `.claude/agents/` — that path is for Claude Code's built-in subagent types (Explore, Plan, General-purpose, statusline-setup, claude-code-guide), which remain separate and unchanged.

---

## Settings UI Changes

### Before — 17 agent cards in 4 groups (`AgentCardsPanel.tsx:8-114`)

```
Issue Agent (5 phases: Exploration, Implementation, Testing, Documentation, Review Response)
Specialists (Review Agent, Test Agent, Merge Agent)
Review Agents (Security, Performance, Correctness, Requirements, Synthesis)
Subagents (Explore, Plan, Bash, General Purpose)
CLI (Interactive, Quick Command)
```

Each card has its own `WorkTypeId` and model override. 24 possible overrides.

### After — Workhorse panel + 5 role cards

```
┌─ Workhorse Models ──────────────────────────────────────────┐
│  Expensive  [ claude-opus-4-7        ▾ ]   strongest, costly │
│  Mid        [ claude-sonnet-4-7      ▾ ]   balanced default  │
│  Cheap      [ claude-haiku-4-5       ▾ ]   fast / low cost   │
└──────────────────────────────────────────────────────────────┘

Plan    → model: [ Workhorse: Expensive (claude-opus-4-7) ▾ ]   (planning errors cascade — strongest model)
Work    → model: [ Workhorse: Mid ▾ ]
        ├─ inspect       (every bead)    [ Workhorse: Cheap ▾ ]
        └─ inspect-deep  (flagged beads) [ Workhorse: Mid   ▾ ]
Review  → model: [ Workhorse: Expensive ▾ ]   (synthesis = decision-maker)
        ├─ security      [ Workhorse: Expensive ▾ ]
        ├─ correctness   [ Workhorse: Mid       ▾ ]
        ├─ performance   [ Workhorse: Mid       ▾ ]
        └─ requirements  [ Workhorse: Mid       ▾ ]
Test    → model: [ Workhorse: Mid ▾ ]
Ship    → model: [ Workhorse: Mid ▾ ]
```

**Workhorse panel.** Top of the page. Three dropdowns, populated from the installed/available model list (Anthropic + any provider configured in the harness layer). Editing a workhorse slot live-updates every dropdown below it that resolves through that slot.

**Role / sub-role pickers.** Each model dropdown has two groups:
- **Workhorse** (top, default options): `Expensive (claude-opus-4-7)`, `Mid (claude-sonnet-4-7)`, `Cheap (claude-haiku-4-5)` — values shown live so the user sees what each slot currently resolves to.
- **Specific model** (below, for power users): the full literal model list, for cases where a role pins a model independent of the workhorse trio.

When a picker shows `Workhorse: Mid`, the actual model id is read from `workhorses.mid` at resolution time, not frozen at the moment the user clicked. Hovering the picker reveals the current literal value as a tooltip.

**Subagent model overrides** (explore, plan, bash, general-purpose) are a Claude Code concern, not a Panopticon role concern. They can be configured via Claude Code's own settings or environment variables (`ANTHROPIC_DEFAULT_HAIKU_MODEL`, etc.), not through the Panopticon settings page.

**CLI contexts** (interactive, quick-command) are not roles — they're user sessions. Drop them from the agent settings page entirely.

### Implementation

**Delete:** `src/dashboard/frontend/src/components/Settings/AgentCards/AgentCardsPanel.tsx`
**Delete:** `src/dashboard/frontend/src/components/Settings/AgentCards/AgentCard.tsx`
**Delete:** `src/dashboard/frontend/src/components/Settings/AgentCards/ModelOverrideModal.tsx`
**Delete:** `src/dashboard/frontend/src/components/Settings/Override/WorkTypeOverrides.tsx`

**Create:** `src/dashboard/frontend/src/components/Settings/WorkhorsePanel.tsx` — three-slot workhorse picker rendered at the top of the Settings page. Edits write `workhorses.{expensive,mid,cheap}` in `config.yaml`.

**Create:** `src/dashboard/frontend/src/components/Settings/RolesPanel.tsx` — 5 role cards. Review and Work cards are expandable to reveal sub-role pickers.

```typescript
const ROLES = [
  { id: 'plan',   name: 'Plan',   description: 'Research and write vBRIEF',  defaultModel: 'workhorse:expensive', icon: 'architecture' },
  { id: 'work',   name: 'Work',   description: 'Implement code from vBRIEF', defaultModel: 'workhorse:mid',       icon: 'smart_toy',
    sub: [
      { id: 'inspect',      name: 'Inspect (every bead)',    defaultModel: 'workhorse:cheap' },
      { id: 'inspect-deep', name: 'Inspect Deep (flagged)',  defaultModel: 'workhorse:mid' },
    ] },
  { id: 'review', name: 'Review', description: 'Review diffs and approve',   defaultModel: 'workhorse:expensive', icon: 'rate_review',
    sub: [
      { id: 'security',     name: 'Security',     defaultModel: 'workhorse:expensive' },
      { id: 'correctness',  name: 'Correctness',  defaultModel: 'workhorse:mid' },
      { id: 'performance',  name: 'Performance',  defaultModel: 'workhorse:mid' },
      { id: 'requirements', name: 'Requirements', defaultModel: 'workhorse:mid' },
    ] },
  { id: 'test',   name: 'Test',   description: 'Run tests and report',       defaultModel: 'workhorse:mid',       icon: 'bug_report' },
  { id: 'ship',   name: 'Ship',   description: 'Rebase and prep for merge',  defaultModel: 'workhorse:mid',       icon: 'merge' },
] as const;
```

Each model picker (role or sub-role) renders a dropdown with a `Workhorse` group on top (3 slots, live-resolving) and a `Specific model` group below (full literal model list). The override is stored in `config.yaml` under `roles.<name>.model` (or `roles.<name>.sub.<subId>.model`).

---

## Dashboard Component Changes

### Planning detection (`AgentOutputPanel.tsx:88`)

**Before:**
```typescript
const isPlanningAgent = agent?.agentPhase === 'planning' || agentId.startsWith('planning-');
```

**After:**
```typescript
const isPlanningAgent = agent?.role === 'plan';
```

### Issue card phase label (`KanbanBoard.tsx`)

**Before:** Reads `agent.agentPhase` to show phase badge (exploration, implementation, etc.)
**After:** Reads `agent.role` to show role badge (plan, work, review, test, ship)

### Specialist label (`AgentOutputPanel.tsx:91-93`)

**Before:**
```typescript
const label = specialist
  ? `${specialist.projectKey} / ${specialist.type.replace('-agent', '')}`
  : agentId;
```

**After:**
```typescript
const label = agent?.role
  ? `${agent.issueId} / ${agent.role}`
  : agentId;
```

### Read model mapping (`src/dashboard/server/read-model.ts:57-59, 319-426`)

**Before:** `toAgentPhase()` validator, reads `a.phase` and `cachedAgent?.agentPhase`
**After:** Read `a.role` directly from state.json. No phase mapping needed.

### PlanDialog (`PlanDialog.tsx:94-104`)

**Before:** Fetches settings to determine default planning-agent model via `WorkTypeId('planning-agent')`
**After:** Fetches settings to determine model for role `plan` from `config.yaml` roles section.

### Start Agent flow (`KanbanBoard.tsx:2850-2910`)

**Before:** `startAgentMutation` POSTs to `/api/agents` with `workType`, `phase`, `agentType` fields.
**After:** POSTs to `/api/agents` with `role: 'work'`. Server resolves model from role config.

---

## Backend Changes

### Spawn path (`src/lib/agents.ts`)

**`spawnAgent()` (line 1479)** — Currently accepts `SpawnOptions` with `phase`, `workType`, `difficulty`. Change to accept `role: Role`. The function resolves the model from role config, builds the launcher command as `claude --agent roles/<role>.md`, and writes `role` to state.json.

**`determineModel()` (line 1247)** — Currently takes `{ model?, workType?, phase?, agentType?, difficulty? }`. Replace with `{ model?, role?: Role }`. If `model` is explicitly provided, use it. Otherwise look up `roles.<role>.model` from config.yaml. Delete `WorkTypeRouter` class entirely.

**`resumeAgent()` (line 2090)** — Read `role` from state.json instead of `type`/`agentPhase`.

### Planning spawn (`src/lib/planning/spawn-planning-session.ts`)

**Lines 389, 561, 582** — Currently write `type: 'planning', agentPhase: 'planning'`. Change to write `role: 'plan'`.

**Line 437-445** — Currently resolves model via `WorkTypeRouter` for `'planning-agent'`. Change to resolve from `roles.plan.model` in config.yaml.

### Launcher generator (`src/lib/launcher-generator.ts`)

**`LauncherAgentType` (line 1)** — Delete this type entirely.

**`LauncherConfig` (line 14)** — Replace `agentType: LauncherAgentType` with `role: Role` plus a separate `spawnMode?: 'conversation' | 'remote' | 'resume'` field.

**Specialist-dispatch branch (line 274, 337)** — Delete. Cloister handles dispatch directly by spawning the appropriate role.

### Specialist machinery (`src/lib/cloister/specialists.ts`)

**`SpecialistType` (line 172)** — Delete.
**`SpecialistMetadata` (line 182)** — Delete.
**`SpecialistStatus` (line 196)** — Delete.
**Session file management (lines 470-600)** — Delete `getSessionFilePath`, `getSessionId`, `getSessionGeneration`, `bumpSessionGeneration`, `setSessionId`, `clearSessionId`. Roles start cold; no persistent sessions.
**`wakeSpecialist()` (line 2459)** — Delete. Replace with role spawn.
**`wakeSpecialistOrQueue()` / queue machinery** — Delete.
**`dispatchSpecialist()` / ephemeral spawn** — Delete.

### Handoff (`src/lib/cloister/handoff.ts`)

**Lines 17-18** — Remove imports of `wakeSpecialist`, `wakeSpecialistOrQueue`.
**Lines 232-246** — Replace specialist wake with Cloister reactive spawn. When a work agent signals done, Cloister sees the issue state change to "in review" and spawns the `review` role. No explicit handoff needed.

### Work type router (`src/lib/work-type-router.ts`)

**Delete entire file.** Model resolution becomes a config lookup with workhorse dereferencing:

```typescript
type Workhorse = 'expensive' | 'mid' | 'cheap';
type ModelRef = string;  // either a literal id ("claude-opus-4-7") or "workhorse:<slot>"

function resolveModel(role: Role, subRole: string | undefined, config: NormalizedConfig): string {
  const ref: ModelRef =
    (subRole && config.roles?.[role]?.sub?.[subRole]?.model) ||
    config.roles?.[role]?.model ||
    DEFAULT_MODEL_REFS[role];

  return derefWorkhorse(ref, config);
}

function derefWorkhorse(ref: ModelRef, config: NormalizedConfig): string {
  if (!ref.startsWith('workhorse:')) return ref;  // literal model id
  const slot = ref.slice('workhorse:'.length) as Workhorse;
  const literal = config.workhorses?.[slot];
  if (!literal) {
    throw new Error(`Workhorse slot "${slot}" is not defined in config.yaml`);
  }
  if (literal.startsWith('workhorse:')) {
    throw new Error(`Workhorse "${slot}" cannot reference another workhorse: ${literal}`);
  }
  return literal;
}

const DEFAULT_WORKHORSES: Record<Workhorse, string> = {
  expensive: 'claude-opus-4-7',
  mid:       'claude-sonnet-4-7',
  cheap:     'claude-haiku-4-5',
};

const DEFAULT_MODEL_REFS: Record<Role, ModelRef> = {
  plan:   'workhorse:expensive',  // planning is foundational — errors cascade
  work:   'workhorse:mid',
  review: 'workhorse:expensive',  // synthesis is the decision-maker
  test:   'workhorse:mid',
  ship:   'workhorse:mid',
};
```

`derefWorkhorse` is also called at config-load time for every role/sub-role/workhorse value, so unresolved references fail loudly before any agent spawns.

### Work types (`src/lib/work-types.ts`)

**Delete entire file.** All 24 WorkTypeId entries become unnecessary.

### Activity logger (`src/lib/activity-logger.ts`)

**Line 21** — Delete `ActivitySource` type. Derive source from `role` field in state.json or from caller context (e.g., `'dashboard'` for dashboard-initiated actions, `'cloister'` for scheduler actions).

### Cloister service (`src/lib/cloister/service.ts`)

**Current:** Specialist dispatch logic checks agent state, manages queues, wakes specialists.
**After:** Reactive loop:

```typescript
async function onIssueStateChange(issueId: string, newState: string): Promise<void> {
  const role = stateToRole(newState);
  if (!role) return;

  const activeRun = getActiveRunForIssue(issueId);
  if (activeRun) return;  // already working

  const model = resolveModel(role, config);
  const harness = config.defaultHarness || 'claude-code';
  await spawnRun(issueId, role, model, harness);
}

function stateToRole(state: string): Role | null {
  switch (state) {
    case 'open':       return 'plan';
    case 'planned':    return 'work';
    case 'in_review':  return 'review';
    case 'testing':    return 'test';
    case 'shipping':   return 'ship';
    default:           return null;
  }
}
```

### API routes (`src/dashboard/server/routes/`)

**`POST /api/agents` (agents.ts:1847)** — Accept `role: Role` instead of `workType`/`phase`/`agentType`. Resolve model from role config. Pass `role` to `spawnAgent()`.

**`POST /api/issues/:id/start-planning` (issues.ts:550)** — Continue to work as-is but write `role: 'plan'` to state.json instead of `type: 'planning'`.

**`GET /api/settings` response** — Include `roles` section from config.yaml so the frontend can render role cards.

**`POST /api/settings`** — Accept role model overrides and write to config.yaml.

### Config schema (`~/.panopticon/config.yaml`)

Add `workhorses` and `roles` sections:

```yaml
workhorses:
  expensive: claude-opus-4-7
  mid:       claude-sonnet-4-7
  cheap:     claude-haiku-4-5

roles:
  plan:
    model: workhorse:expensive
    harness: claude-code
  work:
    model: workhorse:mid
    harness: claude-code
    sub:
      inspect:      { model: workhorse:cheap }
      inspect-deep: { model: workhorse:mid }
  review:
    model: workhorse:expensive
    harness: claude-code
    sub:
      security:     { model: workhorse:expensive }
      correctness:  { model: workhorse:mid }
      performance:  { model: workhorse:mid }
      requirements: { model: workhorse:mid }
  test:
    model: workhorse:mid
    harness: claude-code
  ship:
    model: workhorse:mid
    harness: claude-code
```

**In `src/lib/config-yaml.ts`:**
- Add `workhorses` and `roles` to `NormalizedConfig` interface and `loadConfig()` parser.
- Add `resolveModel(role, subRole?)` function that returns a literal model id, dereferencing `workhorse:<slot>` through the `workhorses` map.
- At config-load time, validate that every `workhorse:<slot>` reference resolves; fail with a precise error (`config.yaml: roles.review.sub.security.model references workhorse:expensive but workhorses.expensive is not defined`).
- Reject chained references (`workhorses.cheap: workhorse:mid` is invalid); workhorses must point at literal model ids.

---

## Migration — Backward Compatibility

### Reading old state.json files

During the transition, state.json files on disk may have old fields. Add a migration reader:

```typescript
function readRole(state: any): Role {
  if (state.role) return state.role;

  // Migrate from old fields
  if (state.type === 'planning' || state.agentPhase === 'planning' || state.phase === 'planning') return 'plan';
  if (state.type === 'work') return 'work';
  if (state.type === 'review' || state.type === 'inspect') return 'review';
  if (state.type === 'test' || state.type === 'uat') return 'test';
  if (state.type === 'merge') return 'ship';

  return 'work';  // default
}
```

### Old agent .md files

During the transition, both `agents/pan-<type>-agent.md` (old) and `roles/<role>.md` (new) exist. Once all spawn paths use `roles/`, delete the old files:
- `agents/pan-work-agent.md` → replaced by `roles/work.md`
- `agents/pan-planning-agent.md` → replaced by `roles/plan.md`
- `agents/pan-review-agent.md` → replaced by `roles/review.md`
- `agents/pan-test-agent.md` → replaced by `roles/test.md`
- `agents/pan-inspect-agent.md` → folded into `roles/work.md`
- `agents/pan-uat-agent.md` → folded into `roles/test.md`
- `agents/pan-merge-agent.md` → replaced by `roles/ship.md`

### Enum mapping table

| Old enum value | New role | What happens to the old value |
|----------------|---------|-------------------------------|
| `PanopticonAgentType.planning` | `plan` | Enum deleted |
| `PanopticonAgentType.work` | `work` | Enum deleted |
| `PanopticonAgentType.review` | `review` | Enum deleted |
| `PanopticonAgentType.inspect` | *(folded into `work`)* | Enum deleted |
| `PanopticonAgentType.test` | `test` | Enum deleted |
| `PanopticonAgentType.uat` | *(folded into `test`)* | Enum deleted |
| `PanopticonAgentType.merge` | `ship` | Enum deleted |
| `SpecialistType.review-agent` | `review` | Type deleted |
| `SpecialistType.test-agent` | `test` | Type deleted |
| `SpecialistType.merge-agent` | `ship` | Type deleted |
| `SpecialistType.inspect-agent` | *(folded into `work`)* | Type deleted |
| `SpecialistType.uat-agent` | *(folded into `test`)* | Type deleted |
| `LauncherAgentType.work` | `work` | Type deleted |
| `LauncherAgentType.planning` | `plan` | Type deleted |
| `LauncherAgentType.review` | `review` | Type deleted |
| `LauncherAgentType.conversation` | *(spawn mode, not role)* | Moved to `spawnMode` field |
| `LauncherAgentType.remote` | *(spawn mode, not role)* | Moved to `spawnMode` field |
| `LauncherAgentType.resume` | *(spawn mode, not role)* | Moved to `spawnMode` field |
| `LauncherAgentType.specialist-dispatch` | *(removed)* | Cloister handles directly |
| `LauncherAgentType.specialist-init` | *(removed)* | Cloister handles directly |
| `LauncherAgentType.runtime` | *(removed)* | Not a role or spawn mode |
| `WorkTypeId.issue-agent:*` (5) | `work` | Phases become prompt-internal |
| `WorkTypeId.specialist-*` (5) | role mapping per above | Type deleted |
| `WorkTypeId.subagent:*` (4) | *(Claude Code concern)* | Removed from Panopticon |
| `WorkTypeId.review:*` (6) | sub-runs within `review` | Type deleted |
| `WorkTypeId.planning-agent` | `plan` | Type deleted |
| `WorkTypeId.status-review` | *(workflow job)* | Removed |
| `WorkTypeId.cli:*` (2) | *(not roles)* | Removed |
| `ActivitySource.work-agent` | `work` | Derived from role |
| `ActivitySource.planning-agent` | `plan` | Derived from role |
| `ActivitySource.review-specialist` | `review` | Derived from role |
| `ActivitySource.test-specialist` | `test` | Derived from role |
| `ActivitySource.merge-agent` | `ship` | Derived from role |
| `ActivitySource.cloister` | `'cloister'` | Kept as literal string |
| `ActivitySource.dashboard` | `'dashboard'` | Kept as literal string |
| `ActivitySource.deploy-script` | *(removed)* | Not used |

---

## Implementation — Single Branch, Hard Cut

This ships in one feature branch. **No backward-compatibility shims, no `readRole()` fallback, no soft transition.** On upgrade: in-flight agents are killed, state.json files without `role` are discarded, `config.yaml.overrides` (legacy WorkTypeId map) is dropped, defaults are seeded for missing `workhorses`/`roles`. Users restart any active issues against the new pipeline.

The bead-level decomposition is the implementation plan. The high-level dependency graph:

```
Foundation
  ├─ Role type + workhorses/roles config schema + resolveModel + derefWorkhorse
  ├─ AgentState.role field (additive)
  └─ Default config seed (workhorses + roles defaults applied when missing)

Role file creation (parallel)
  ├─ roles/plan.md  ├─ roles/work.md  ├─ roles/review.md
  ├─ roles/test.md  └─ roles/ship.md

Convoy migration (precedes review wiring)
  └─ Move src/lib/cloister/prompts/review/*.prompt-template.md
       → .claude/agents/code-review-{security,correctness,performance,requirements}.md
       (Claude Code agent definitions invokable via the Agent tool)

Per-role spawn wiring (each REPLACES its existing spawn callsite — no dead-code paths)
  ├─ plan   end-to-end (smallest first, validates the pattern)
  ├─ work   end-to-end (drops phase/workType/complexity reads)
  ├─ review end-to-end (Cloister handoff → spawnRun, convoy via Agent tool)
  ├─ test   end-to-end (folds UAT)
  └─ ship   end-to-end (human-merge invariant explicit)

Reactive Cloister
  ├─ onIssueStateChange + stateToRole, hooked into existing internal emitters
  │  (issue-lifecycle issue.* events + agent.completed + work.completed + review.approved)
  └─ Delete specialist machinery (wakeSpecialist, queues, session files,
     dispatchSpecialist, deacon's specialist-dispatch path)

Settings UI (parallel; gated on Workhorse panel landing first)
  ├─ WorkhorsePanel (3-slot, all enabled providers grouped)
  ├─ RolesPanel (5 cards, sub-role expansion for work + review)
  ├─ Wire SettingsPage to new panels
  └─ Delete AgentCardsPanel, AgentCard, ModelOverrideModal, WorkTypeOverrides

Backend dead-code deletion
  ├─ Delete src/lib/work-types.ts + src/lib/work-type-router.ts (and orphaned smart-model-selector callers)
  └─ Delete LauncherAgentType branches (specialist-dispatch, specialist-init)

Enum deletions (each its own bead — TypeScript surfaces every callsite)
  ├─ PanopticonAgentType + panopticonAgentName()
  ├─ SpecialistType + SpecialistMetadata + SpecialistStatus
  ├─ LauncherAgentType (replace with Role + spawnMode field)
  ├─ WorkTypeId (already orphaned by work-types.ts deletion; this confirms zero refs)
  └─ ActivitySource (derive from role + literal contexts)

Contracts migration
  └─ packages/contracts/src/types.ts: AgentPhase → Role, delete SpecialistType + SpecialistSnapshot
     packages/contracts/src/events.ts: agent event payloads use role instead of type/phase

state.json hard cut (final data-model break)
  ├─ Delete type, agentPhase, phase, workType, complexity, handoffCount, runtime
  ├─ role becomes required
  ├─ Move Channels eligibility check from `state.runtime` to `state.harness === 'claude-code' && state.role === 'work'` (agents.ts ~775)
  └─ On startup: drop state.json files lacking `role`; kill orphan tmux sessions

Old agent .md cleanup
  └─ Delete .claude/agents/pan-{work,planning,review,test,inspect,uat,merge}-agent.md
     (after every spawn path is migrated)

Documentation
  └─ Update CLAUDE.md "Panopticon Agent Taxonomy", docs/HARNESSES.md,
     dashboard architecture sections — replace specialist references with role references
     (lands alongside specialist-machinery deletion, not at the very end)

Administrative
  └─ Move .pan/prd.md → docs/prds/planned/PAN-1048-role-primitive.md
     (so the issue body's link works post-merge)
```

**Pi harness scope:** PAN-1048 ships **claude-code-only** roles. `getAgentRuntimeBaseCommand` keeps its existing `pi --mode rpc --model <model>` short-circuit unchanged. A follow-up issue (e.g. PAN-1049) tracks Pi role-body integration. Settings still allows Pi as a per-role harness override; Pi just doesn't read the role's `.md` body.

**Test discipline:** every refactor bead must keep the existing tests green. If a test references a deleted enum or field, the bead that deletes the enum/field is responsible for updating or replacing the test. No "test cleanup" bead at the end — tests are part of each bead's acceptance criteria.

**Concurrent work runs (PAN-970 swarm):** out of scope. The reactive scheduler holds a per-issue concurrency guard (no second run spawned while one is active). Multi-bead-parallel work is tracked in PAN-970 and benefits from the role primitive without being blocked on it.

---

## Acceptance Criteria

1. Five role `.md` files exist at `roles/{plan,work,review,test,ship}.md`
2. `state.json` uses a single `role` field — no `type`, `agentPhase`, or `phase`
3. Cloister spawns roles reactively based on issue state transitions via `stateToRole()`
4. No specialist session files, no specialist queues, no dispatch machinery
5. All 5 old enums (`PanopticonAgentType`, `SpecialistType`, `LauncherAgentType`, `WorkTypeId`, `ActivitySource`) are deleted
6. Dashboard renders correctly using `role` field for all agent states
7. Settings page shows the Workhorse Models panel at the top (3 slots) plus 5 role cards (not 17 agent cards); Review and Work cards are expandable to reveal sub-role pickers
8. `pan plan`, `pan work`, and the full pipeline work end-to-end with the role model
9. Human-merge invariant preserved: `ship` role preps, human clicks merge
10. Convoy reviewers work as sub-runs within the `review` role (subagent spawns)
11. Model routing works by role lookup in config.yaml — no `WorkTypeRouter`
12. Old state.json files with `type`/`agentPhase`/`phase` fields are handled gracefully during transition (Phases 1-5)
13. **Workhorse Models** are implemented with exactly 3 slots (`expensive`, `mid`, `cheap`); every per-role and per-sub-role picker accepts either a literal model id or a `workhorse:<slot>` reference
14. **Workhorse resolution** dereferences at spawn time (not at picker-click time): editing `workhorses.mid` propagates immediately to every dropdown showing `Workhorse: Mid` without manual re-selection
15. **Workhorse validation:** unresolved references (typo, missing slot, chained reference like `workhorses.cheap: workhorse:mid`) fail loudly at config-load time with a precise error message pointing at the offending field — never silently at spawn time
16. Default config ships with workhorse references everywhere (no literal model ids in default `roles.*.model`); a fresh install is fully managed through the 3 workhorse dials
17. Workhorse panel and role cards round-trip to `config.yaml` correctly: edits in the UI write the YAML, manual YAML edits show up in the UI on reload, no field is silently dropped

---

## Open Questions

1. **Phase routing within `work`**: Today the work agent transitions through exploration, implementation, testing, documentation, review-response phases, each potentially routed to a different model via `WorkTypeId`. Should we keep sub-phase model routing (add `phases` config under the `work` role), or simplify to one model per role?

2. **Convoy reviewer model override**: Convoy reviewers are subagents within the review role. Today each has its own `WorkTypeId` for model routing. In the new model, should the review role's model apply uniformly to all sub-reviewers, or should individual sub-reviewer model overrides be supported via config?

3. **Multiple concurrent work runs**: With future swarm support, multiple `work` runs could work on independent beads in parallel. The reactive scheduler needs a concurrency policy per role per issue. Design this now or defer to PAN-970?

---

## Related Issues

- **Supersedes #1037** — retiring `planning-` tmux prefix is automatically solved when all agents use `agent-<issueId>` keyed by `role`
- **Supersedes #1040** — event-driven inspect dispatch becomes unnecessary when inspect folds into `work` (Jidoka) and Cloister is reactive
- **Absorbs PAN-754** (closed) — specialist identity/model resolution is the same problem solved differently
- **Absorbs PAN-722** (closed) — specialist queue removal happens naturally in Phase 5
- **Orthogonal to PAN-969** — Directive Flow visualization can read the `role` field but doesn't depend on this refactor
- **Orthogonal to PAN-970** — Swarm parallelism is a future extension that benefits from the role model but isn't blocked by it
