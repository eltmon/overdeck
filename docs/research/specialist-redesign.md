# Specialist Redesign — Research & Brainstorming

**Status:** Research / pre-PRD. Produced 2026-04-18.
**Context:** Investigation of per-project specialist singleton problems (post PAN-722) → rearchitecture discussion → deft.ai concept study (vBRIEF, directive/deft-swarm, deft-review-cycle) + xumux.

This document captures (a) the problem inventory, (b) the DAG reframe, (c) the deft/xumux synthesis, (d) open questions feeding the PRD. It is not itself a PRD.

---

## 1. Problem inventory

Three design disasters surfaced during the specialist/Agents-page investigation. They are not independent bugs — they share the same root: **identity-by-name instead of identity-by-data**.

### 1.1 PAN-722 (queue removal) left a per-project singleton

The queue abstraction was removed. The singleton was not.

Singleton is baked in at three places:

- `src/lib/cloister/specialists.ts:636` — `getTmuxSessionName(specialistType, projectKey)` returns `specialist-${projectKey}-${name}`. No issueId/runId. Two concurrent issues collide on the same tmux session name.
- `src/lib/cloister/specialists.ts:1476-1513` — registry shape is `projects[projectKey][specialistType]`. 2-level. One entry per type per project.
- `src/lib/cloister/specialists.ts:1605-1648` — `getAllProjectSpecialistStatuses()` walks that 2-level shape. Agents page renders one row per `(project, specialistType)`.

At dispatch (`spawnEphemeralSpecialist` line 693), a busy check (lines 720-733) returns `specialist_busy` if the named session is active. The deacon patrol retries on its next pass. **This is not reuse. It is contention-serialization via retry.** Throughput is capped at 1 review-per-project regardless of issue count.

The PAN-722 PRD itself says "we spawn N ephemeral specialists in parallel" (line 115). The code does not.

### 1.2 Inverted model priority — Sonnet lurking under every config

`src/lib/cloister/config.ts:246` hardcodes `specialist_models.review_agent: 'sonnet'`. That default sits at a priority level that shadows `models.overrides.specialist-review-agent` in `~/.panopticon.env`-derived config. User sets `gpt-5.4` in Settings; reviewer runs on `sonnet`. Silent.

This is a **priority-inversion bug expressed in configuration layers** — the deeper, older config wins over the newer user-facing one. No resolution trace is surfaced to the UI.

### 1.3 PAN-540 parallel review — invisible sibling tmux sessions

`feature/pan-540` branch, `src/lib/cloister/review-agent.ts:438-485` (`runParallelReview`) spawns 4 sibling tmux sessions via `createSessionAsync` + `sendKeysAsync claude --model X`. Session names: `review-<issueId>-<timestamp>-<role>`.

These are **not**:
- Claude Code subagents (Task tool) — would be in-process, tool-use chain integrated
- Registered in the specialist registry
- Visible on the Agents page

They are separate tmux sessions, outside the supervision boundary. The "busy check" doesn't see them. The Agents page doesn't see them. The deacon's stuck detection doesn't see them either unless it walks `tmux list-sessions`.

### 1.4 Cross-cutting: duplicate-tab failure mode

Per directive `#261`/`#263`: two agents on the same worktree corrupt each other's `tool_use` / `tool_result` message chains. Our current architecture has no structural defense against this — tmux session name is the only coordination primitive, and it's keyed on projectKey not worktree.

---

## 2. Root cause

All four symptoms share a single cause: **the tmux session name is the identity key for agent lifecycle**. Everything downstream (registry shape, dashboard listing, busy check, stuck detection) inherits the granularity of that key.

If the key is `specialist-<project>-<type>`, you get one specialist per project per type. If it's `<issueId>-<role>`, you get siblings that nobody tracks. The design cannot express "this agent is working on plan X item Y with write-set Z" because the key doesn't carry that data.

**Fix direction:** identity-by-data. The agent's identity is the work it is doing — which is a vBRIEF PlanItem. The tmux session (or subagent, or remote runner) is an implementation of that work, not its identity.

---

## 3. The DAG reframe

User's aha-intuition: "the DAG we create from the vBrief — what does it look like when all issues' DAGs are interconnected? One huge DAG where different features/issues meet."

This isn't abstract. It is the correct data model.

- **Plan** (vBRIEF) = one issue's decomposition.
- **PlanItem** = one atom of work (implementation step, review cycle, test run, uat, deacon tick, merge checkpoint).
- **Edge** (blocks / informs / invalidates / suggests / data / custom) = typed dependency.
- **planRef with fragment `#item-id`** = the primitive for **cross-plan** edges. This is where features meet.

The "one huge DAG" the user imagined is the UNION of all active Plans, joined on `planRef` edges. Intersection points are either:
- PlanItems shared between Plans (via planRef)
- PlanItems from different Plans that touch the same files (via `ports.out` intersection — see §4.2)

Both are first-class and queryable.

Collapse today's primitives:
- **Run** → a subgraph: one Plan's items plus their dependency closure
- **Agent** → a worker-assignment on a PlanItem (has runtime = subagent | tmux | remote; has role = work | review | test | uat | merge | deacon)
- **Specialist** → stops being a persistent entity. It is a **role** that gets assigned to a PlanItem when the item's node type demands it.

---

## 4. Concept synthesis (deft + xumux)

Five concepts, one design.

### 4.1 vBRIEF Plan schema as the SQLite substrate

**Steal:** use vBRIEF v0.6 verbatim as the database schema. Panopticon's rows serialize directly to valid vBRIEF.

Keeps:
- `id`, `uid`, `sequence`, `changeLog` — audit trail free
- `fork` — parent-child (issue spawned from parent plan, split/merge)
- `items[]` — work atoms
- `edges[]` — typed dependencies
- `status` enum: `draft | proposed | approved | pending | running | completed | blocked | failed | cancelled` — maps exactly to our lifecycle
- `narratives` — human/agent rationale on each item, live context for the reviewer/merger
- `planRef` with fragment — cross-issue intersections

**Workflow Profile extension** (strictly additive):
- `nodeType: Trigger | Processing | FlowControl | Output` — deacon ticks are Triggers; agent work is Processing; merge/push is Output
- `ports: { in, out }` on each item — **file read/write sets, declared up front**
- `data` edges between items — dataflow
- `retryOnFail`, `maxRetries`, `workflow.settings` — execution policy on the item itself

Everything we currently hang off ad-hoc DB columns (queue name, specialist name, status, attempts) collapses into vBRIEF.

**Interop bonus:** Panopticon-as-deft-engine story becomes trivial. We don't translate to/from vBRIEF at the edge; we *are* vBRIEF at the core.

### 4.2 File-overlap audit as scheduler primitive (replaces busy check)

**Steal:** deft-swarm Phase 1 Step 2. Before parallel dispatch, verify zero write-set overlap. Transitive. Shared append-only files (CHANGELOG) policy-allowed.

In the new scheduler:
- Each PlanItem declares `ports.out` (writes) and `ports.in` (reads) — required, not optional
- Scheduler walks items with no unmet `blocks` edges
- Computes pairwise write-set intersection
- Refuses to co-dispatch items with intersecting writes (transitively)
- Append-only allow-list configurable per-project

**This replaces the busy check entirely.** We never ask "is session X busy" — we ask "do the declared write-sets allow parallel execution." Deterministic, declarative, inspectable.

Eliminates:
- Duplicate-tab failure mode (two agents on same worktree ⇒ worktree path in both write-sets ⇒ scheduler serializes)
- PAN-540 safety question (4 reviewers writing to 4 distinct report files ⇒ disjoint ⇒ provably safe to parallelize)
- Contention-retry-via-deacon anti-pattern

### 4.3 Capability-detection precedence (replaces hardcoded defaults)

**Steal:** deft-swarm Phase 3 Step 1 + directive's explicit rule: "⊗ Present static launch options (A/B/C) instead of detecting capabilities at runtime."

The Sonnet-lurking bug IS this anti-pattern in disguise. Settings page offers static model dropdowns per role; under them lives a hardcoded default that wins when the dropdown is unset.

Fix: **one ordered capability chain**. Each step is a probe; first hit wins; no defaults at lower layers.

```
resolveAgent(context) =
  1. context.runtimeOverride          (CLI --model, explicit)
  2. context.planItem.workflow.model   (vBRIEF-level model override)
  3. context.plan.workflow.model       (plan-level)
  4. project.convoyConfig[role]        (convoy roles)
  5. project.agentConfig[role]         (per-project role default)
  6. global.workTypeRouter[workType]   (work-type routing)
  7. global.fallback                   (explicit, loud, visible)
  8. → emit "unresolved" error, surface to UI
```

**No hidden defaults.** If nothing resolves, we error out with a resolution trace. Settings page stops being a flat dropdown grid and becomes "show me the resolution for `role=review` on `project=X`" — the trace.

Applies identically to **runtime** resolution (subagent vs tmux vs remote), not just model.

### 4.4 Bounded review loop as reviewer state machine

**Steal:** deft-review-cycle Phase 2 loop, verbatim.

Current reviewer: spawned once, opaque internal logic, unclear exit condition.

New reviewer: explicit state machine, **data-driven exit**.

```
IDLE
 ↓ dispatch
FETCH        ← gather all findings (dual source: gh + mcp with capability probe)
 ↓
ANALYZE      ← classify P0/P1/P2/P3; collect confidence scores
 ↓
BATCH_FIX    ← commit all trivial fixes; push one batch
 ↓
PUSH
 ↓
WAIT_RE_REVIEW (cadence: 20-30s → 60s → 90s adaptive)
 ↓
FETCH (again)
 ↓
(no P0/P1 && confidence > 3) → DONE
(has P0/P1 && iterations < max) → ANALYZE
(iterations >= max) → BLOCKED (human attention)
```

Exit is data-driven (query findings). Not agent-judgment-driven. Auditable.

**Same pattern for test specialist:** RUN → ANALYZE → FIX → PUSH → RE-RUN → EXIT_ON_GREEN_OR_BLOCK. Merge stays human-only (hard rule).

Deacon becomes the Trigger node: emits PlanItems like `review-cycle` or `stuck-recovery` based on patrol observations. Not a persistent agent — a scheduler that generates items.

### 4.5 xumux as the execution substrate

**Steal (new, not in user's ranked list):** xumux channels replace tmux-session-name as agent identity.

Today: tmux session name is identity. Dashboard walks `tmux list-sessions`. Streaming via ttyd. Claude Code subagents and remote workers don't fit the model.

xumux reframe: every agent, regardless of runtime, is a **named channel** with metadata on a multiplexed connection.

- `OPEN_CHANNEL` carries `{ planId, planItemId, role, runtime }` as metadata
- Control plane (channel 0) is reliable+ordered — lifecycle, findings, errors
- Per-agent application channel carries streaming I/O — reliability tunable (unreliable for hot output, reliable for structured findings)
- `PING/PONG` with RTT gives free heartbeat / stuck-detection
- `CLOSE_CHANNEL` with code = `completed | failed | blocked | cancelled` — lifecycle termination typed

Dashboard subscribes to the connection and enumerates channels. **Sibling tmux sessions cannot be invisible** because they don't exist as tmux sessions — they exist as channels on the same connection.

Unifies runtime:
- **Subagent** (Claude Code Task tool) → channel wrapped around in-process Task handle
- **Local tmux** → channel wrapped around stdio of the tmux window
- **Remote worker** → channel wrapped around ws connection to remote runner
- Scheduler sees one abstraction: "assign PlanItem → runtime → OPEN_CHANNEL"

xumux is v0.1.0-draft. We would be early adopter. Aligned with the Panopticon-as-deft-engine story (Jonathan's discussion).

---

## 5. The unified design in one sentence

**Panopticon is a vBRIEF Plan executor over xumux channels, scheduled by file-overlap audit, with capability-detected workers and bounded-loop specialists.**

Each layer kills a specific current-architecture problem:

| Layer | Kills |
|---|---|
| vBRIEF schema | ad-hoc DB shape, tracker/agent impedance mismatch, cross-issue invisibility |
| file-overlap audit | busy check, duplicate-tab failure, PAN-540 safety question, contention-via-retry |
| capability chain | Sonnet-lurking default, static-dropdown anti-pattern, hidden resolution |
| bounded specialist loops | opaque reviewer exit, stuck-reviewer mystery, unbounded merge-agent (enforces human-only) |
| xumux channels | per-project singleton, invisible siblings, tmux-name-as-identity, heterogeneous runtime patchwork |

---

## 6. What goes away

- `specialist_models` config section — absorbed into capability chain
- Busy check + `dispatch_failed` + deacon-contention-retry — replaced by write-set audit
- `getTmuxSessionName(type, projectKey)` — no session-name identity
- `projects[key][type]` registry shape — replaced by Plan/PlanItem rows
- `getAllProjectSpecialistStatuses` — replaced by xumux channel enumeration
- Convoy as special case — becomes generic "N disjoint-write PlanItems scheduled in parallel"
- Queue abstraction residue — all gone

---

## 7. Risks & open questions

- **vBRIEF v0.6 is draft.** If deft churns the spec, we either pin or track. Tracking is consistent with the Jonathan/engine pitch. Pin with explicit extension field for Panopticon-specific data.
- **xumux v0.1.0-draft** — same tradeoff, same recommendation (track, contribute upstream).
- **Migration is pause-the-world.** User wants "stop everything else, do it all at once in place." With live workspaces and 60 skills depending on the current shape, we need a hard cutover plan: flag-day, ledger-replay into new schema, new runtime parallel until parity, switch.
- **Subagent vs tmux tradeoffs** — which roles benefit from in-process subagent isolation (review, analysis) vs need their own process (long work, user-observable)? Capability chain must resolve runtime, not just model.
- **Resolution trace UI** — when capability chain yields "unresolved" or surprising results, operator needs first-class visibility. Not a log line — a dashboard panel per dispatch attempt.
- **planRef graph visualization** — how to render the cross-plan DAG at 10+ plans, 100+ items, without becoming noise. Force-directed layout? Layered by project? Collapse per-plan to super-node by default, expand on focus?
- **Dashboard rewrite scope** — Agents page, Queues page, Specialists page all collapse into "Channels on connection" + "Plan DAG view." Queues page probably dies entirely.
- **Append-only allow-list policy** — per-project config. Needs a sane default (CHANGELOG, docs/index), override surface.
- **planItem.workflow.model precedence vs convoy role** — convoy should probably be expressed as planItems with role-tagged workflow.model, not a separate config block. Then precedence is trivial.

---

## 8. PRD deliverables (forward reference)

The PRD that grows from this research should produce:

1. SQLite schema aligned to vBRIEF Plan/PlanItem/Edge (verbatim column names, `extensions` column for Panopticon-specific data)
2. Unified `resolveAgent(context)` API with explicit capability chain + resolution trace surfaced to dashboard
3. File-overlap scheduler using `ports` declared in Workflow Profile
4. xumux channel registry replacing tmux-session-name registry
5. Review and test specialist state machines (explicit, bounded, data-driven exit)
6. Dashboard rewrite: Agents page → channel enumeration; new Plan-DAG view
7. Cutover plan: hard migration, no long coexistence period

---

## 9. Source material

All referenced content extracted locally:

- `/tmp/vbrief-0.6.md` — vBRIEF spec v0.6 (`~/Projects/vbrief` branch `origin/feat/builder-v0.6`)
- `/tmp/vbrief-workflow.md` — vBRIEF Workflow Profile extension
- `/tmp/deft-swarm-full.md` — `~/Projects/directive` `skills/deft-swarm/SKILL.md`
- `/tmp/deft-review-cycle-full.md` — `~/Projects/directive` `skills/deft-review-cycle/SKILL.md`
- `/tmp/xumux/README.md`, `PRD.md`, `SPECIFICATION.md` — `github.com/deftai/xumux`

Upstream repos (deftai org): `vBRIEF`, `directive`, `xumux` (relevant); `dashdash`, `socketpipe`, `vroom` (scoped out for this research per user).

---

## 10. Not yet decided

- Whether convoy reviewers remain a separate concept or fully dissolve into generic parallel PlanItems
- Whether deacon remains a single patrol loop or dissolves into per-trigger-type Processing items
- Whether `uat` becomes a PlanItem role or stays external
- Which runtime (subagent vs tmux) is the default for each role
- Whether we contribute xumux TypeScript reference impl upstream or ship our own internal one first
