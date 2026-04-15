# Agent Types Index

Code-first reference for Panopticon runtime agent types and adjacent routed workflow jobs.

This document answers four questions for each type:
- does it exist in code,
- is it actually used,
- where/how is it spawned,
- which prompt and model-routing path apply.

For model precedence details, see [MODEL_ROUTING.md](./MODEL_ROUTING.md). For specialist sequencing, see [SPECIALIST_WORKFLOW.md](./SPECIALIST_WORKFLOW.md).

## Runtime agent inventory

These are the **actual runtime agent types** in the current codebase.

| Type | Category | Status | Spawn / trigger | Prompt source | Model routing | User-facing surface |
|---|---|---|---|---|---|---|
| `planning-agent` | primary | Active | `src/lib/planning/spawn-planning-session.ts` via `pan plan` / dashboard planning start | `src/lib/cloister/prompts/planning.md` via `buildPlanningPrompt()` | `planning-agent` | CLI + dashboard |
| `work-agent` | primary | Active | `src/dashboard/server/services/agent-spawner.ts` -> `src/lib/agents.ts` | `src/lib/cloister/prompts/work.md` plus phase-specific work-agent prompt building | `issue-agent:<phase>` | CLI + dashboard |
| `review-agent` | specialist | Active | spawned by `spawnEphemeralSpecialist()` from Cloister verification/handoff pipeline | `src/lib/cloister/prompts/review.md` via `buildTaskPrompt()` | `specialist-review-agent` + `cloister.toml` specialist override | automatic / specialist tooling |
| `test-agent` | specialist | Active | spawned by verification pipeline after review | `src/lib/cloister/prompts/test.md` via `buildTestAgentPromptContent()` | `specialist-test-agent` + `cloister.toml` specialist override | automatic / specialist tooling |
| `inspect-agent` | specialist | Active | `src/lib/cloister/inspect-agent.ts` via `pan inspect <issue> --bead <id>` | `src/lib/cloister/prompts/inspect-agent.md` via prompt override built in `inspect-agent.ts`, plus fallback handler in `buildTaskPrompt()` | `specialist-inspect-agent` + `cloister.toml` specialist override | CLI-triggered during implementation |
| `uat-agent` | specialist | Active | specialist pipeline after test pass | `src/lib/cloister/prompts/uat-agent.md` via `buildTaskPrompt()` | `specialist-uat-agent` + `cloister.toml` specialist override | automatic / specialist tooling |
| `merge-agent` | specialist | Active | specialist pipeline after verification/UAT success | `src/lib/cloister/prompts/merge.md` via `buildTaskPrompt()` | `specialist-merge-agent` + `cloister.toml` specialist override | explicit approval path + specialist tooling |

## Canonical type definitions

### Primary agents
- `planning-agent` is a routable pre-work job in `src/lib/work-types.ts`
- `work-agent` is the main implementation runtime in `src/lib/agents.ts` and is routed by phase rather than by a dedicated `work-agent` work type

### Specialist agents
Canonical runtime specialist type definition:
- `src/lib/cloister/specialists.ts` — `SpecialistType = 'merge-agent' | 'review-agent' | 'test-agent' | 'inspect-agent' | 'uat-agent'`

Canonical specialist registry metadata:
- `src/lib/cloister/specialists.ts` — `DEFAULT_SPECIALISTS`

## Spawn map

## Planning flow
- `planning-agent`
  - spawn path: `src/lib/planning/spawn-planning-session.ts`
  - entrypoints: CLI `pan plan`, dashboard planning start
  - prompt builder: `buildPlanningPrompt()`

## Implementation flow
- `work-agent`
  - spawn path: dashboard start agent -> `POST /api/agents` in `src/dashboard/server/routes/agents.ts` -> detached `pan start <id> --local --phase <phase>` -> `spawnAgent()` in `src/lib/agents.ts`
  - entrypoints: CLI `pan start`, dashboard start agent
  - routing path: explicit work type or `issue-agent:<phase>`

## Per-bead verification flow
- `inspect-agent`
  - spawn path: `src/lib/cloister/inspect-agent.ts` -> `spawnEphemeralSpecialist()`
  - entrypoint: CLI `pan inspect`
  - note: this is a real runtime specialist, but it is not started from the generic dashboard `startWork()` endpoint

## Post-implementation specialist pipeline
- `review-agent`
  - specialist verification/review stage after implementation completion
- `test-agent`
  - specialist testing stage after review approval
- `uat-agent`
  - browser UAT stage after tests pass
- `merge-agent`
  - final merge-prep / merge stage after verification success

The shared specialist spawner is:
- `src/lib/cloister/specialists.ts` — `spawnEphemeralSpecialist()`

## Prompt correlation

### Primary agents
- `planning-agent`
  - prompt file: `src/lib/cloister/prompts/planning.md`
  - render path: `src/lib/planning/spawn-planning-session.ts`
- `work-agent`
  - prompt file: `src/lib/cloister/prompts/work.md`
  - render path: work-agent prompt building in `src/lib/agents.ts` / work-agent helpers

### Specialists
- `review-agent` -> `src/lib/cloister/prompts/review.md`
- `test-agent` -> `src/lib/cloister/prompts/test.md`
- `merge-agent` -> `src/lib/cloister/prompts/merge.md`
- `inspect-agent` -> `src/lib/cloister/prompts/inspect-agent.md`
- `uat-agent` -> `src/lib/cloister/prompts/uat-agent.md`

Canonical specialist prompt switch:
- `src/lib/cloister/specialists.ts` — `buildTaskPrompt()`

Special case:
- `inspect-agent` commonly uses a prompt override assembled in `src/lib/cloister/inspect-agent.ts`, which is still grounded in `inspect-agent.md`

## Routed workflow jobs that are not runtime agent types

These are routable model slots that appear in settings/UI/docs, but they are **not** members of the runtime agent-type inventory above.

| Work type | Kind | Current usage | Guidance |
|---|---|---|---|
| `status-review` | workflow job | Used by Mission Control route `POST /api/command-deck/planning/:issueId/status-review` in `src/dashboard/server/routes/mission-control.ts` | Keep as a workflow-routed job, not a runtime agent type |
| `issue-agent:review-response` | work-agent phase | Used as a routable phase for follow-up fixes after review feedback | Keep documented as a work-agent phase, not a separate agent type |
| `convoy:requirements-reviewer` | convoy reviewer | Present in routing registry and docs for convoy review flows | Keep as convoy-only, not a Panopticon runtime agent type |

## Legacy / drift that should not be treated as source of truth

## Stale audit document
- `docs/audits/AGENT_AUDIT_REPORT.md` previously claimed `inspect-agent` / `uat-agent` were not fully wired.
- Current code shows both exist and are used.
- Treat that file as an audit narrative, not as the canonical inventory.

## Historical specialist defaults drift
Before this cleanup, some files only knew about three specialists (`review`, `test`, `merge`) while runtime code already used five (`+ inspect`, `+ uat`). The canonical runtime list is now the five-type `SpecialistType` union in `src/lib/cloister/specialists.ts`.

## What should be disabled or deprecated?

### Not runtime agent types
The following should **not** be moved into the runtime agent inventory unless new orchestration code is added:
- `status-review`
- `convoy:requirements-reviewer`
- `issue-agent:review-response`

They are valid routed jobs/phases, but they are not runtime Panopticon agent types.

### Specialist enable/disable state
Specialist enablement is tracked in:
- `src/lib/cloister/specialists.ts` registry metadata
- `src/lib/cloister/config.ts` default Cloister config

Current intended specialist defaults:
- `review-agent` — enabled
- `test-agent` — enabled
- `inspect-agent` — enabled
- `uat-agent` — enabled
- `merge-agent` — enabled

## Recommended future agent types

These are proposals only — not currently implemented runtime agent types.

### `requirements-agent`
Suggested workflow placement:
- after planning, to verify beads/acceptance criteria fully cover the PRD
- or before merge, to validate requirement coverage independently from code review

Why:
- Panopticon already relies heavily on PRDs, beads, and acceptance criteria
- a dedicated requirements pass would make spec drift easier to catch early

### `release-readiness-agent`
Suggested workflow placement:
- after UAT, before merge, for projects that need release hygiene checks

Why:
- useful when release notes, migrations, docs, or deployment checks frequently slip

## Maintenance checklist for adding a new runtime agent type

If a new runtime agent type is added, update all of:
- `src/lib/cloister/specialists.ts` or the relevant primary-agent type definition
- `src/lib/work-types.ts`
- `src/lib/settings-api.ts`
- `src/dashboard/frontend/src/components/Settings/modelDefaults.ts`
- `docs/WORK-TYPES.md`
- `docs/AGENT_TYPES_INDEX.md`
- prompt template under `src/lib/cloister/prompts/`
- the spawn path and workflow docs in `docs/SPECIALIST_WORKFLOW.md`
