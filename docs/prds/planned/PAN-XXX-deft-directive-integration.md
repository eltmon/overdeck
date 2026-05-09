# PAN-XXX: Deft Directive Full Integration

## PR-FAQ

### Press Release

**Panopticon CLI Ships One-Command AI Development Framework Integration**

*May 2026 — Portland, OR*

Today, Panopticon CLI announced full integration with Deft Directive, the open-source layered standards framework for AI-assisted software development. A single `pan install` command now bootstraps both multi-agent orchestration AND comprehensive coding standards — eliminating the gap between "AI agents can write code" and "AI agents write code that meets your standards."

The integration replaces Panopticon's 6-state canonical model with Deft's 9-state vBRIEF lifecycle. Issues flow through `draft → proposed → approved → pending → running → blocked → completed → failed → cancelled` — each transition enforced by deterministic scripts, not agent judgment. The kanban board gains a "Ready" column and distinguishes `blocked` from `running`, `failed` from `completed`.

Every agent session now loads a layered rule hierarchy: personal preferences (USER.md), project identity and standards (PROJECT-DEFINITION.vbrief.json), language-specific conventions (typescript.md, python.md), and framework defaults — all overridable, all version-controlled. Planning agents use structured interview strategies instead of freeform exploration, producing specs with traceable acceptance criteria.

"When an agent says 'I'm done,' that's a claim," said Edward Becker, creator of Panopticon. "When `task check` passes — lint, test, branch policy, vbrief lifecycle validation — that's proof."

Available in Panopticon CLI v0.6.0. Existing projects migrate with `pan migrate --deft`.

---

### FAQ

**Q: What is Deft Directive?**
A: An open-source framework that defines how AI coding agents should behave — layered rules, vBRIEF lifecycle management, deterministic quality gates via Taskfile, and skills for setup/build/swarm/review/release. GitHub: github.com/deftai/directive

**Q: Do I need to learn Deft to use Panopticon?**
A: No. `pan install` bootstraps everything. PROJECT-DEFINITION.vbrief.json is generated from your existing project. Language standards are auto-detected. You interact with Panopticon commands; Deft runs under the hood.

**Q: What happened to the old kanban states?**
A: The 6 canonical states (backlog, todo, in_progress, in_review, done, canceled) become 9 vBRIEF statuses. The kanban gains a "Ready" column and better terminal-state granularity (completed vs. failed). The mapping from tracker states (Linear, GitHub, etc.) still works — it just targets a richer canonical model.

**Q: How does this change what agents know?**
A: Currently agents get a task and CLAUDE.md. With Deft, they get a layered stack: USER.md (your personal preferences), PROJECT-DEFINITION (project rules, stack, coverage target), language files (TypeScript conventions, testing patterns), and the scope vBRIEF (narratives, acceptance criteria). Standards are inherited, not repeated.

**Q: What about planning?**
A: Planning agents currently do freeform exploration. With Deft, they run structured strategies — interview (one focused question per turn, sizing gate, spec generation) or speckit (5-phase specification for complex scopes). Plans become reproducible.

**Q: Can I still use Panopticon without Deft?**
A: Yes. `pan install --no-deft` skips it. The old state model remains available via `PANOPTICON_LEGACY_STATES=true`.

**Q: What about my existing projects?**
A: `pan migrate --deft` creates `vbrief/` lifecycle folders, generates PROJECT-DEFINITION from projects.yaml, maps existing states to the new model, and upgrades vBRIEF plans from v0.5 → v0.6.

---

## Problem

### No Standards Enforcement

Panopticon orchestrates agents but doesn't enforce coding standards. Agents spawn without knowing the project's language conventions, testing requirements, branching strategy, or quality gates. Standards live scattered across CLAUDE.md files, prompt templates, and memory — monolithic, not layered, not overridable per-project.

### Coarse State Model

The current 6-state canonical model (`backlog | todo | in_progress | in_review | done | canceled`) collapses important distinctions:

- `in_progress` doesn't distinguish `running` (agent actively working) from `blocked` (agent stuck on a dependency or external blocker)
- `done` doesn't distinguish `completed` (success) from `failed` (attempted but couldn't finish)
- There's no `approved` or `pending` distinction — everything ready-to-work is just `todo`
- State transitions aren't enforced — any state can jump to any other state via drag-drop or API call

The `STATUS_LABELS` map in `types.ts` (lines 146-182) has 30+ tracker-specific labels all collapsing into 6 buckets. Adding Deft's richer model means less information loss in that mapping.

### Ad-hoc Planning

Planning agents do freeform codebase exploration. The quality and structure of plans depends entirely on agent judgment. Two runs of the same issue can produce wildly different plans. There's no sizing gate, no structured interview, no spec generation strategy.

### Separate Standards Framework

Deft Directive solves the standards problem but lives separately. The two systems share vBRIEF as a language but Panopticon uses v0.5, Deft uses v0.6, and the lifecycle folder structure isn't implemented in Panopticon.

---

## Solution

### 1. Upgrade CanonicalState to 9-State vBRIEF Lifecycle

Replace the 6-state `CanonicalState` in `src/core/state-mapping.ts` with Deft's 9-state enum:

```typescript
// Before
type CanonicalState = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'canceled'

// After
type CanonicalState =
  | 'draft'      // Early idea, not submitted
  | 'proposed'   // Submitted for consideration
  | 'approved'   // Accepted, ready for work
  | 'pending'    // In backlog, waiting for capacity
  | 'running'    // Agent actively executing
  | 'blocked'    // In progress but blocked
  | 'completed'  // Successfully finished
  | 'failed'     // Attempted but couldn't complete
  | 'cancelled'  // Won't do / abandoned
```

**Kanban columns become 5:**

| Column | States | Color |
|--------|--------|-------|
| Backlog | `draft`, `proposed` | gray |
| Ready | `approved`, `pending` | blue |
| Active | `running`, `blocked` | yellow / orange |
| Done | `completed`, `failed` | green / red |
| Cancelled | `cancelled` | gray |

Each issue card shows its exact state as a badge inside the column — so you can see at a glance which Active items are `running` vs. `blocked`, which Done items are `completed` vs. `failed`.

**Tracker mapping updates** (extends the existing `trackerStateToCanonical()` logic):

| Canonical | Linear | GitHub | Collapse to IssueState |
|-----------|--------|--------|----------------------|
| `draft` | — | open (no label) | `open` |
| `proposed` | — | open + `proposed` | `open` |
| `approved` | — | open + `approved` | `open` |
| `pending` | Todo | open + `ready` | `open` |
| `running` | In Progress | open + `in-progress` | `in_progress` |
| `blocked` | In Progress | open + `blocked` | `in_progress` |
| `completed` | Done | closed | `closed` |
| `failed` | Done | closed + `failed` | `closed` |
| `cancelled` | Canceled | closed + `wontfix` | `closed` |

The `canonicalToIssueState` map in the `move-status` endpoint (currently 6→3) becomes 9→3 — same pattern, more granular input.

### 2. vBRIEF Lifecycle Folders

Each project gets a `vbrief/` directory with 5 lifecycle folders:

```
vbrief/
  PROJECT-DEFINITION.vbrief.json    ← project identity, rules, scope registry
  proposed/                          ← draft + proposed scope vBRIEFs
  pending/                           ← approved + pending scope vBRIEFs
  active/                            ← running + blocked scope vBRIEFs
  completed/                         ← completed + failed scope vBRIEFs
  cancelled/                         ← cancelled scope vBRIEFs
```

`plan.status` inside each scope vBRIEF is the source of truth. Folder location is a convenience view. When status changes, the file moves to the matching folder via deterministic `task scope:*` commands.

**Integration with Panopticon's existing flow:**

| Panopticon action | vBRIEF lifecycle effect |
|---|---|
| Issue filed / `pan refine` | Creates scope vBRIEF in `proposed/` |
| `pan plan <id>` | Moves vBRIEF from `proposed/` → `pending/` → `active/` (activates) |
| `pan work <id>` | Verifies vBRIEF is in `active/` with `status: running` (preflight gate) |
| Agent signals blocked | Updates vBRIEF status to `blocked` (stays in `active/`) |
| `pan done` + merge | Moves vBRIEF to `completed/` with `status: completed` |
| Agent fails / `pan reset` | Moves vBRIEF to `completed/` with `status: failed` OR `cancelled/` |

### 3. `pan install` Bootstraps Deft

After existing prereq checks (Node 22, Docker, tmux, Git), `pan install` adds:

1. **Clone Deft** — `git clone https://github.com/deftai/directive.git` into `<project>/deft/` (or shared cache at `~/.panopticon/deft/`)
2. **Write AGENTS.md** — Deft's agent entry point, wired into project root (idempotent)
3. **Generate USER.md** — Once globally, at `~/.config/deft/USER.md`. Captures: depth preference (technical/middle/non-technical), strategy, coverage target, custom rules. Panopticon runs the interview; Deft's setup skill doesn't need to.
4. **Generate PROJECT-DEFINITION.vbrief.json** — Per-project. Inferred from build files (package.json, go.mod, etc.) + `projects.yaml`. Captures: project name, type, languages, tech stack, coverage target, branching policy, project-specific rules.
5. **Create `vbrief/` folders** — 5 lifecycle subdirectories
6. **Install git hooks** — `git config core.hooksPath .githooks` (idempotent, from Deft's `task setup`)
7. **Sync Deft skills** — Copy `deft/skills/*/SKILL.md` into `~/.panopticon/skills/` with `deft-` prefix (avoids namespace collision with Panopticon skills)
8. **Add Taskfile.yml** — Include Deft's Taskfile in project root for `task check`, `task scope:*`, etc.

**Skip with**: `pan install --no-deft`
**Update with**: `pan sync --deft` (pulls latest Deft, re-syncs skills, validates PROJECT-DEFINITION)

### 4. Layered Rule Hierarchy for Agent Prompts

Currently, agent prompts get CLAUDE.md content and maybe some memory context. With Deft, prompt assembly follows a precedence stack:

```
USER.md Personal              ← HIGHEST (user's non-negotiables)
PROJECT-DEFINITION vBRIEF     ← project-specific overrides
USER.md Defaults              ← user preferences (overridable by project)
{language}.md                 ← language conventions (typescript.md, python.md)
coding.md                     ← general coding guidelines
main.md                       ← Deft framework defaults (LOWEST)
```

**What moves where:**

| Currently in | Moves to | Example |
|---|---|---|
| CLAUDE.md (project root) | PROJECT-DEFINITION narratives.ProjectRules | "No execSync in dashboard server" |
| CLAUDE.md (global `~/.claude/`) | USER.md Personal | "Never suggest breaks" |
| Hardcoded prompt templates | `deft/languages/typescript.md` | "Prefer const, use strict mode" |
| Memory files (preferences) | USER.md | User depth, strategy preferences |
| Cloister verification config | Taskfile.yml (`task check`) | Coverage ≥85%, branch policy |

**CLAUDE.md stays** for Panopticon-specific operational rules (tmux messaging, JSONL protection, postMerge idempotency guards). AGENTS.md and CLAUDE.md coexist — different purposes:
- AGENTS.md = how AI agents should write code (standards, conventions, quality)
- CLAUDE.md = how Panopticon operates (infrastructure, safety, architecture)

**Prompt assembly** (`src/lib/cloister/prompt-assembly.ts`):

When Panopticon spawns any agent, it reads the Deft hierarchy and assembles context:

1. Read AGENTS.md (Deft entry point)
2. Read USER.md (personal preferences)
3. Read PROJECT-DEFINITION.vbrief.json (project rules, stack)
4. Auto-detect language files from project (e.g., TypeScript project → include `typescript.md`)
5. Read scope vBRIEF (work item narratives, acceptance criteria)
6. Append Panopticon-specific CLAUDE.md rules

This replaces the current ad-hoc prompt construction with structured, overridable layers.

### 5. Deterministic Gates in Cloister Pipeline

Port Deft's Python gates to TypeScript (or shell out to the Python scripts):

| Gate | When it runs | What it checks |
|---|---|---|
| `vbrief:preflight` | Before work agent spawn | vBRIEF in `active/` with `status: running` |
| `verify:branch` | Before commit | Feature branch policy (not direct to main) |
| `vbrief:validate` | On every plan write | Schema compliance, folder/status consistency |
| `pr:check-closing-keywords` | Before PR creation | Prevents auto-close false positives |
| `task check` | Verification gate (replaces typecheck+lint+test) | Lint + test + coverage + branch + vbrief validate |

**Integration with existing verification gate** (`src/lib/cloister/verification-gate.ts`):

Currently runs `typecheck → lint → test` from `projects.yaml`. Expands to:

```
task check (if Deft is installed)
  → includes: lint, test, coverage, branch policy, vbrief validation
  → PLUS Panopticon's own AC gate (getVBriefACStatus)
```

Falls back to existing `typecheck → lint → test` if Deft is not installed.

### 6. Structured Planning Strategies

Replace freeform planning agent exploration with Deft's interview/speckit strategies.

**Current flow:**
1. Planning agent spawns → explores codebase freely → writes STATE.md and plan.vbrief.json → `pan plan finalize`

**With Deft:**
1. Planning agent spawns → reads AGENTS.md + PROJECT-DEFINITION → runs Deft strategy
2. **Sizing gate**: Is this Light (≤5 features, days, solo) or Full (>5 features, weeks, complex)?
3. **Interview**: ONE focused question per turn, numbered options, recommended choice marked
4. **Spec generation**: Produces `specification.vbrief.json` with narratives (Problem, Goals, UserStories, Requirements, Architecture)
5. **Scope vBRIEF emission**: Each plan item becomes a scope vBRIEF with Description, Acceptance, and Traces narratives
6. `pan plan finalize` → `createBeadsFromVBrief()` (unchanged)

The planning agent still writes STATE.md and plan.vbrief.json — but the plan quality is bounded by the strategy's structure, not by agent judgment alone.

### 7. Swarm Integration

Deft's `deft-directive-swarm` skill describes parallel agent coordination. Panopticon already runs parallel agents. The integration:

- `pan swarm <issue-ids...>` becomes a first-class command
- Deft's **file-overlap audit** prevents two agents from touching the same files (currently not enforced)
- Deft's **dependency-aware allocation** respects blocking edges between scope vBRIEFs
- Deft's **merge cascade** (rebase all, then merge in rapid succession) replaces ad-hoc parallel merges
- Deft's checkpoint tracking (Reading → Implementing → Validating → Committed → Pushed → PR Created) feeds into the kanban's agent status display

### 8. Issue Ingestion and Reconciliation

Deft has `task issue:ingest` and `task reconcile:issues`. Panopticon needs TypeScript equivalents:

- **Ingest**: Pull issues from tracker → create scope vBRIEFs in `proposed/`. `pan refine` triggers this. Each vBRIEF gets a `references` array linking back to the tracker issue.
- **Reconcile**: Scan all vBRIEFs with tracker references → report stale, externally closed, or unlinked items. Runs during `pan sync` or on demand.

This gives Panopticon a local, structured representation of tracker issues that persists across sessions — not just an API cache.

---

## Files Changed

### State Model
| File | Action | Description |
|------|--------|-------------|
| `src/core/state-mapping.ts` | Modify | 6→9 CanonicalState enum, update `trackerStateToCanonical()`, `canonicalToTrackerState()`, `mapGitHubStateToCanonical()` |
| `src/dashboard/frontend/src/types.ts` | Modify | Update STATUS_LABELS, STATUS_ORDER for 9 states |
| `packages/contracts/src/events.ts` | Modify | Update event schemas for new statuses |
| `src/dashboard/server/routes/issues.ts` | Modify | Update `canonicalToIssueState` map (9→3), `move-status` endpoint |
| `src/dashboard/server/services/issue-lifecycle.ts` | Modify | Add `blocked`, `failed` state transitions |

### Kanban
| File | Action | Description |
|------|--------|-------------|
| `src/dashboard/frontend/src/components/KanbanBoard.tsx` | Modify | 5 columns, state badges per card, updated `groupByStatus()` |

### vBRIEF
| File | Action | Description |
|------|--------|-------------|
| `src/lib/vbrief/types.ts` | Modify | Upgrade to v0.6 schema (add `failed`, scope registry) |
| `src/lib/vbrief/io.ts` | Modify | v0.6 read/write, lifecycle folder support, auto-bump v0.5→v0.6 on write |
| `src/lib/vbrief/lifecycle.ts` | Create | TypeScript wrappers for scope transitions (`promote`, `activate`, `complete`, `fail`, `block`, `unblock`, `cancel`, `restore`) |
| `src/lib/vbrief/ingest.ts` | Create | Issue ingestion: tracker → scope vBRIEF in `proposed/` |
| `src/lib/vbrief/reconcile.ts` | Create | Reconcile vBRIEF references against tracker state |

### Install & Sync
| File | Action | Description |
|------|--------|-------------|
| `src/cli/commands/install.ts` | Modify | Add Deft bootstrap steps (clone, AGENTS.md, USER.md, PROJECT-DEFINITION, vbrief folders, hooks, skills) |
| `src/lib/install/deft.ts` | Create | Deft installation logic |
| `src/lib/sync.ts` | Modify | Add Deft skill sync with `deft-` prefix |
| `src/lib/paths.ts` | Modify | Add DEFT_DIR, DEFT_SKILLS_DIR constants |

### Agent Pipeline
| File | Action | Description |
|------|--------|-------------|
| `src/lib/cloister/prompt-assembly.ts` | Create | Assemble agent prompts from Deft rule hierarchy |
| `src/lib/cloister/service.ts` | Modify | Add `vbrief:preflight` gate before work agent spawn |
| `src/lib/cloister/verification-gate.ts` | Modify | Expand to include `task check` when Deft is installed |

### Migration
| File | Action | Description |
|------|--------|-------------|
| `src/lib/migrate-deft.ts` | Create | Migration: create vbrief folders, generate PROJECT-DEFINITION, map states, upgrade v0.5→v0.6 |

### Skills
| File | Action | Description |
|------|--------|-------------|
| `skills/pan-install/SKILL.md` | Modify | Document Deft bootstrap steps |
| `skills/pan-refine/SKILL.md` | Create | Issue ingestion and triage workflow |
| `skills/pan-swarm/SKILL.md` | Create | Parallel agent coordination with file-overlap audit |

---

## Migration Path

1. `pan migrate --deft` creates `vbrief/` folder structure in project
2. Generates `PROJECT-DEFINITION.vbrief.json` from `projects.yaml` + build file detection
3. Maps existing canonical states to new 9-state model:
   - `backlog` → `draft`
   - `todo` → `pending`
   - `in_progress` → `running`
   - `in_review` → `running` (specialist pipeline handles the rest)
   - `done` → `completed`
   - `canceled` → `cancelled`
4. Existing `plan.vbrief.json` files auto-bumped from v0.5 → v0.6 on next write
5. Old 6-state model available via `PANOPTICON_LEGACY_STATES=true`

---

## Implementation Order

1. **Schema bump** (v0.5 → v0.6) — Foundation, no external dependency. Update types, IO, validation.
2. **9-state CanonicalState** — Update state-mapping, kanban columns, tracker mappings, issue lifecycle, events.
3. **`pan install --with-deft`** — Clone + bootstrap Deft into projects. AGENTS.md, USER.md, PROJECT-DEFINITION, vbrief folders, git hooks, skill sync.
4. **vBRIEF lifecycle folders** — Scope transitions (`promote`, `activate`, `complete`, `fail`, `block`, `cancel`), wire into `pan plan` / `pan work` / `pan done`.
5. **Prompt assembly** — Layered rule hierarchy from Deft files into agent prompts.
6. **Gate integration** — Preflight, branch policy, `task check` in verification pipeline.
7. **Structured planning** — Interview/speckit strategies replace freeform exploration.
8. **Swarm** — `pan swarm` with file-overlap audit and dependency-aware allocation.
9. **Issue ingestion + reconciliation** — `pan refine`, `pan sync --reconcile`.

---

## Verification

- `pan install` on a fresh project → `deft/` cloned, AGENTS.md written, `vbrief/` folders created, PROJECT-DEFINITION generated
- `pan plan` creates scope vBRIEF in `proposed/`, moves to `active/` on activation
- `pan work` verifies vBRIEF preflight before spawning agent
- `pan done` + merge moves vBRIEF to `completed/`
- Kanban board shows 5 columns with state badges
- Drag-drop between columns triggers correct lifecycle transitions
- Agent prompts include USER.md + PROJECT-DEFINITION + language files
- `task check` runs as part of verification gate (when Deft installed)
- Existing Panopticon tests pass
- `pan migrate --deft` converts existing projects without data loss
- `pan install --no-deft` skips Deft entirely, old behavior preserved
