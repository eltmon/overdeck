# PAN-754: Fix Specialist Identity and Model Resolution

## Problem

Post PAN-722 (queue removal), four defects remain in specialist lifecycle. They share a single root: **the tmux session name is the identity key for agent lifecycle**, and everything downstream (registry shape, dashboard enumeration, busy-check, stuck detection) inherits the granularity of that key.

### 1. Per-project singleton baked in at three places

- `src/lib/cloister/specialists.ts:636` — `getTmuxSessionName(specialistType, projectKey)` returns `specialist-${projectKey}-${name}`. No issueId, no role-suffix for convoy. Two concurrent issues on the same project collide on one tmux session name.
- `src/lib/cloister/specialists.ts:1476-1513` — registry is `projects[projectKey][specialistType]`. Two-level. One entry per `(project, type)`.
- `src/lib/cloister/specialists.ts:1605-1648` — `getAllProjectSpecialistStatuses()` walks that two-level shape. Agents page renders one row per `(project, type)`.

At dispatch (`spawnEphemeralSpecialist` line 693), the busy check (lines 720-733) returns `specialist_busy` if the named session is active; deacon retries on patrol. Throughput is capped at 1/project for review and test specialists regardless of issue count. PAN-722's PRD claimed parallel dispatch; the implementation did not deliver it.

### 2. Inverted model priority — hidden Sonnet default

`src/lib/cloister/config.ts:246` hardcodes `specialist_models.review_agent: 'sonnet'`. That default sits at a priority level that shadows `models.overrides.specialist-review-agent` in user-facing Settings. User sets `gpt-5.4`; Sonnet runs. No trace is surfaced to log or UI — operator cannot see which layer of config won, or why.

### 3. PAN-540 convoy reviewers invisible

On `feature/pan-540`, `src/lib/cloister/review-agent.ts:438-485` (`runParallelReview`) spawns 4 sibling tmux sessions named `review-<issueId>-<timestamp>-<role>` via `createSessionAsync` + `sendKeysAsync claude --model X`. These sessions are:

- Not Claude Code subagents (they are sibling tmux processes)
- Not entered in the specialist registry
- Not shown on the Agents page
- Not seen by the busy check or deacon's stuck-detection

They execute outside the supervision boundary entirely.

### 4. Duplicate-tab risk on shared worktree

Today's only coordination primitive is the tmux session name keyed on `(project, type)`. There is no structural defense against two agents writing to the same worktree — the PAN-540 convoy in particular has 4 sibling agents reading the same worktree files. This is safe **by construction** (they write disjoint output files) but not safe **by policy** — nothing enforces the disjoint-output invariant.

## Goal

Fix the four defects at their root without a broader rearchitecture:

1. Move specialist identity from `(project, type)` to `(project, issueId, role)`. 3-level registry, 3-level Agents page enumeration.
2. Delete the hardcoded Sonnet default. Make `models.overrides.*` authoritative. Add a resolution trace visible in logs and one dashboard panel.
3. Bring PAN-540's convoy reviewers into the same 3-level registry as first-class entries — not floating tmux sessions outside supervision.
4. Enforce a "one writer per worktree" convention at dispatch with an explicit convoy allowance (reviewers share read-set; writes go to role-keyed output paths).

Strict rule: every bug above is fixed in one issue, not split across follow-ups (per `CLAUDE.md`: "Deliver Complete Features").

## Non-Goals (explicit)

Documented here so they are not drifted into during implementation. See `docs/research/specialist-redesign.md` for the broader design exploration — these are future work, not this PRD:

- Adopting vBRIEF v0.6 Plan/PlanItem/Edge as the SQLite substrate for specialist state
- Migrating execution to xumux channels as agent-identity substrate
- Generalized file-overlap audit scheduler using declared `ports`
- Bounded specialist state machines (review / test)
- Cross-plan DAG UI view
- Dashboard rewrite (Agents / Specialists / Queues page consolidation)
- Claude Code subagent (Task tool) runtime for reviewers — remains a follow-on
- Changes to the merge-agent lifecycle (merge queue stays)
- Changes to planning-agent or work-agent lifecycle

## Current Architecture (summary of what changes)

### Identity key

```ts
// src/lib/cloister/specialists.ts:636
function getTmuxSessionName(specialistType: string, projectKey: string): string {
  return `specialist-${projectKey}-${specialistType}`;
}
```

### Registry shape

```
~/.panopticon/specialists/registry.json
{
  "projects": {
    "<projectKey>": {
      "<specialistType>": { status, pid, tmuxSession, dispatchedAt, ... }
    }
  }
}
```

### Dispatch (`spawnEphemeralSpecialist`)

```
1. Compute session name from (type, projectKey)
2. If registry[projectKey][type].status === 'running' → return 'specialist_busy'
3. Else create tmux session, register, send prompt via sendKeysAsync
```

### Model resolution (current order, inverted)

```
1. cloister.specialist_models[<role>_agent]  ← 'sonnet' default HERE wins
2. models.overrides['specialist-<role>-agent']  ← user Settings value
3. fallback
```

### PAN-540 convoy (feature branch, not merged)

```
runParallelReview(issueId, prompt, agents[]) {
  for agent in agents {
    session = `review-${issueId}-${timestamp}-${agent.role}`
    createSessionAsync(session)
    sendKeysAsync(session, `claude --model ${agent.model} "${prompt}"`)
  }
  // Sessions are not registered. Completion detected by polling session existence.
}
```

## New Architecture

### 1. Identity key and registry shape

**Session name becomes:**

```ts
function getTmuxSessionName(
  specialistType: string,
  projectKey: string,
  issueId: string,
  role?: string,  // convoy sub-role: 'security' | 'correctness' | 'performance' | 'requirements' | 'synthesis'
): string {
  const suffix = role ? `-${role}` : '';
  return `specialist-${projectKey}-${issueId}-${specialistType}${suffix}`;
}
```

**Registry shape becomes 3-level:**

```
~/.panopticon/specialists/registry.json
{
  "projects": {
    "<projectKey>": {
      "<issueId>": {
        "<specialistType>[:<role>]": {
          status, pid, tmuxSession, dispatchedAt, model, runtime, ...
          resolutionTrace?: ResolutionTrace   // see §2
        }
      }
    }
  }
}
```

The leaf key is `<specialistType>` for singletons (test, inspect, uat, review-synthesis) and `<specialistType>:<role>` for convoy sub-agents (`review:security`, `review:correctness`, `review:performance`, `review:requirements`).

**`getAllProjectSpecialistStatuses()` and the `/api/specialists` route** iterate all three levels and return a flat list of specialist entries. The dashboard Agents page renders one row per leaf entry.

**Busy check is narrowed:** the check at `spawnEphemeralSpecialist` (lines 720-733) asks "is there a running entry for `(projectKey, issueId, specialistType[:role])`?" not "is there a running entry for `(projectKey, specialistType)`?" This permits parallel dispatch across different issues on the same project, which is the entire point of PAN-722.

### 2. Model resolution — authoritative chain + resolution trace

**Delete the hardcoded default** in `src/lib/cloister/config.ts:246`. The `specialist_models` object remains for user-configured per-role defaults but ships empty; no fallback string is baked into code.

**Resolution order becomes a single explicit chain, first hit wins, no hidden defaults:**

```ts
function resolveSpecialistModel(context: {
  specialistType: string;    // 'review' | 'test' | 'inspect' | 'uat' | 'merge'
  role?: string;             // convoy role, if any
  issueId: string;
  projectKey: string;
  cliOverride?: string;      // --model flag
}): ResolvedModel {
  const trace: ResolutionTrace = { steps: [] };

  // 1. Explicit CLI flag
  if (context.cliOverride) { trace.steps.push({source: 'cli', model: context.cliOverride}); return {model: context.cliOverride, trace}; }

  // 2. Convoy role override (if applicable)
  if (context.role && config.convoy[`${context.specialistType}-${context.role}`]) { ... }

  // 3. Project-level specialist model override
  if (config.projects[projectKey]?.specialist_models?.[`${specialistType}_agent`]) { ... }

  // 4. Global user-level override (models.overrides.specialist-<type>-agent)
  if (config.models.overrides[`specialist-${specialistType}-agent`]) { ... }

  // 5. Work-type router
  if (config.models.workTypeRouter[context.specialistType]) { ... }

  // 6. Global explicit fallback (if set; no baked-in string)
  if (config.models.fallback) { ... }

  // 7. Unresolved — error loudly with trace
  trace.steps.push({source: 'unresolved', reason: 'no layer matched'});
  throw new ModelUnresolvedError(trace);
}
```

**`ResolutionTrace`** is a first-class type stored on the specialist registry entry at dispatch time. It records which layers were consulted, which matched, and the final model. This is the surface operators see when a specialist ran on an unexpected model.

**Dashboard exposure:** the existing specialist row on the Agents page gains a "resolved via" tooltip / expandable section showing `trace.steps`. No new page; one UI addition per row.

**Runtime resolution (subagent vs tmux) is out of scope for this PRD.** Today all specialists run as tmux sessions. Stays that way until follow-on.

### 3. PAN-540 convoy reviewers in the registry

The `feature/pan-540` `runParallelReview` implementation is rebased on the new 3-level registry. Each convoy sub-agent is registered at:

```
projects[projectKey][issueId][`review:${role}`]
```

Session name pattern becomes:

```
specialist-<projectKey>-<issueId>-review-<role>
```

matching the §1 scheme. This removes the `-<timestamp>-` segment currently used in `feature/pan-540` for per-run uniqueness; uniqueness now comes from `issueId`. If a review cycle is re-run on the same issue, the old entry is transitioned through its completion lifecycle before the new dispatch (same pattern as singleton specialists).

**Busy check for convoy dispatch:** check each role slot independently (`review:security`, `review:correctness`, ...). If any are busy for this `(project, issue)`, return `specialist_busy` with the specific roles named — do NOT silently skip or overwrite.

**Synthesis sub-agent** registers as `review:synthesis` and depends on completion of the 4 reviewer roles before dispatch (enforced in `runParallelReview` orchestration, not in the registry).

**Agents page rendering:** the 5 convoy entries for an issue appear as 5 sibling rows under that issue, grouped visually (a minimal grouping by `(projectKey, issueId, specialistType)` prefix).

### 4. Single-writer-per-worktree enforcement

At dispatch time in `spawnEphemeralSpecialist`, before creating the tmux session, we enforce:

- **Single-writer invariant:** if another specialist entry in the registry is currently `status === 'running'` against the same workspace path AND that entry's `writeScope !== 'readonly'`, refuse the dispatch with a typed error (`worktree_write_conflict`). This replaces ad-hoc contention handling with one explicit check.
- **Convoy exception:** reviewers declare `writeScope: 'readonly-plus-output'` with an `outputPath` of `reviews/<role>.md`. Scheduler permits parallel dispatch as long as `outputPath` values are distinct. Paths are validated before dispatch.

This is NOT a generalized file-overlap auditor — no declared `ports`, no transitive audit. It is a two-case policy:

- `writeScope: 'full'` — full write access to worktree. Only one at a time.
- `writeScope: 'readonly-plus-output'` — reads shared worktree, writes only to a single declared `outputPath`. Multiple allowed if `outputPath`s are disjoint.

`writeScope` is declared on the specialist type registration (not per-dispatch):

- `work` → `full`
- `test` → `full`
- `inspect` → `full`
- `uat` → `full`
- `review` (non-convoy) → `full`
- `review:<role>` (convoy) → `readonly-plus-output` with `outputPath: 'reviews/<role>.md'`
- `review:synthesis` → `readonly-plus-output` with `outputPath: 'reviews/synthesis.md'`
- `merge` → `full` (and human-gated, unchanged)

## Implementation

### Files to modify

**`src/lib/cloister/specialists.ts`:**
- `getTmuxSessionName()` — new signature `(type, projectKey, issueId, role?)`
- Registry shape refactor to 3-level — internal storage + file layout
  - `ensureProjectSpecialistDir()` becomes `ensureIssueSpecialistDir()`
  - All registry reads/writes updated to 3-level path
- `spawnEphemeralSpecialist(projectKey, issueId, specialistType, task, opts?)` — new required `issueId` parameter; optional `role` for convoy sub-agents; optional `writeScope`/`outputPath` override
- Busy check narrowed to `(projectKey, issueId, specialistType[:role])`
- Write-scope check added before tmux creation
- `getAllProjectSpecialistStatuses()` — walks 3-level; returns flat list with `{projectKey, issueId, specialistType, role?, ...}`

**`src/lib/cloister/config.ts`:**
- Delete `specialist_models.review_agent: 'sonnet'` default at line 246
- Delete any sibling hardcoded model defaults in the same block
- Ensure `specialist_models` ships empty
- Add `resolveSpecialistModel()` function + `ModelUnresolvedError` + `ResolutionTrace` type

**`src/lib/cloister/review-agent.ts`** (rebased from `feature/pan-540`):
- `runParallelReview` uses new `spawnEphemeralSpecialist` signature with `issueId` + `role`
- Each of 4 reviewer roles + synthesis registered with `writeScope: 'readonly-plus-output'` and distinct `outputPath`
- Remove the ad-hoc `createSessionAsync` + `sendKeysAsync` path — dispatch goes through `spawnEphemeralSpecialist`
- Remove the `-<timestamp>-` segment from session names

**`src/lib/cloister/deacon.ts`:**
- Stuck-detection walks 3-level registry
- `checkStuckSpecialists()` and related — update projections

**Dashboard server:**
- `src/dashboard/server/routes/specialists.ts` `GET /api/specialists` — returns flat list of 3-level entries. Response shape change.
- Any service reading 2-level registry directly — updated. All async, per CLAUDE.md dashboard rules.

**Dashboard frontend:**
- `src/dashboard/frontend/src/components/AgentList.tsx` lines 252-296 — render flat list; group convoy roles under a single issue header
- Add "resolved via" expandable section per row showing `ResolutionTrace`
- Settings page: where specialist-model dropdowns are rendered, add an inline resolution preview ("your setting → resolved to: X via `models.overrides.specialist-review-agent`")

**Tests:**
- Update `tests/lib/cloister/specialists-*.test.ts` to cover:
  - Two concurrent issues on same project → both dispatch successfully
  - Convoy of 4 reviewers + synthesis on same issue → all 5 entries in registry
  - Busy check within same `(project, issue, type:role)` → returns `specialist_busy`
  - Busy check across different `(project, issue)` with same type → dispatches
  - `writeScope: 'full'` + another `full` on same worktree → `worktree_write_conflict`
  - Two `readonly-plus-output` with disjoint `outputPath` on same worktree → both dispatch
  - Two `readonly-plus-output` with **same** `outputPath` → `worktree_write_conflict`
  - Model resolution order — each layer wins at the right precedence
  - Model resolution unresolved → `ModelUnresolvedError` with full trace
- Update integration tests covering the review flow to exercise both singleton-review path and convoy path

### Migration

**Registry migration on first run after upgrade:** existing `projects[projectKey][specialistType]` entries are read and migrated into `projects[projectKey][<unknown>][specialistType]` under the sentinel issueId `<unknown>`. A subsequent deacon patrol garbage-collects `<unknown>` entries that don't correspond to a live tmux session. This avoids losing track of in-flight work across the upgrade.

**Config migration:** `specialist_models.review_agent: 'sonnet'` (if present in user config) is left untouched. Only the hardcoded code-level default is removed. Users who explicitly set Sonnet in their YAML keep it; users who inherited the hidden default get nothing (and resolution falls through to `models.overrides`).

## Acceptance Criteria

1. Dispatching a review for issue A on project P while a review for issue B on project P is running → both dispatch and run concurrently, both appear on the Agents page.
2. Setting `models.overrides.specialist-review-agent: gpt-5.4` with no `specialist_models.review_agent` configured → the review specialist runs on `gpt-5.4`. The Agents-page row shows a resolution trace terminating at `models.overrides`.
3. PAN-540 parallel review dispatched for an issue → all 4 reviewer sub-agents AND the synthesis sub-agent appear on the Agents page, grouped under the issue, each with its own row, status, and resolution trace.
4. Attempting to dispatch a `work` specialist against a worktree currently in use by another `full`-scope specialist → returns `worktree_write_conflict` with the conflicting specialist named. No tmux session is created.
5. The deacon's stuck-detection identifies and recovers hung convoy sub-agents the same way it handles singleton specialists. Registry cleanup operates on 3-level paths.
6. Registry migration on upgrade: pre-existing 2-level entries are migrated to sentinel-issueId entries; a deacon patrol within one minute reconciles against tmux and removes stale `<unknown>` entries that have no live session.
7. Unit + integration tests above all pass. `npm run typecheck`, `npm run lint`, `npm test` all pass.

## Risks

- **Registry file layout change.** Existing users have an on-disk 2-level `registry.json`. The migration path above handles it, but a bad migration leaves in-flight specialists orphaned. Mitigation: migrate under a backup (`registry.json.pre-pan-754.bak`) and deacon-reconcile before accepting new dispatches.
- **Dashboard response shape change.** `GET /api/specialists` response changes. Frontend and server ship in lockstep from one build; no external API consumers to worry about.
- **PAN-540 feature branch conflicts.** This PRD effectively consumes and rebases `feature/pan-540`. The branch should be landed as part of PAN-754, not separately.
- **Agents page visual density.** A 4-issue project with convoy reviews produces 20+ rows (4 issues × 5 convoy sub-agents). Grouping by `(projectKey, issueId)` is required for readability; not optional.
- **Model resolution trace bloat in registry.** Trace is small (≤ 8 steps × short strings). Acceptable. Truncate or drop on registry file write if it exceeds 2 KB per entry.

## References

- Research: `docs/research/specialist-redesign.md` (broader rearchitecture options; non-goals for this PRD)
- PAN-722: `docs/prds/planned/PAN-722-remove-specialist-queues.md` (predecessor — queue removal)
- PAN-540: `feature/pan-540` branch — `src/lib/cloister/review-agent.ts` convoy implementation (to be rebased onto this)
- CLAUDE.md rules: No bandaids, Never do agent work, Deliver complete features, Humans-only merge (unchanged)
