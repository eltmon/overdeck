# Model Routing

Panopticon routes models by **work type**. A work type is the canonical routing ID for a specific job slot in the workflow.

For the full inventory of runtime agents and their prompt mappings, see [AGENT_TYPES_INDEX.md](./AGENT_TYPES_INDEX.md). For the full list of routable work types, see [WORK-TYPES.md](./WORK-TYPES.md).

## Canonical Sources

### Work type registry
- `src/lib/work-types.ts`

### Primary agent routing
- `src/lib/agents.ts` — `determineModel()`
- `src/lib/work-type-router.ts` — `getModelId()`

### Specialist routing
- `src/lib/cloister/specialists.ts` — specialist model resolution before spawn
- `src/lib/cloister/config.ts` — `model_selection.specialist_models`

### Settings / defaults surfaces
- `src/lib/settings-api.ts` — API-facing optimal defaults
- `src/dashboard/frontend/src/components/Settings/modelDefaults.ts` — UI fallback defaults
- `docs/WORK-TYPES.md` — documented routing slots

## Routing Precedence

## Primary agents

Primary agents (`planning-agent` and the main `work-agent` phases) resolve models in this order:

1. Explicit CLI/API override (`--model` / `options.model`)
2. Explicit work type ID (`options.workType`)
3. Phase-derived work type (`issue-agent:<phase>`)
4. Fallback default from Cloister config (`model_selection.default_model`)
5. Final hard fallback: `claude-sonnet-4-6`

Code path:
- `src/lib/agents.ts:537`

## Specialist agents

Specialists (`review-agent`, `test-agent`, `merge-agent`, `inspect-agent`, `uat-agent`) resolve models in this order:

1. Cloister specialist override (`model_selection.specialist_models.<agent_name>`)
2. Work-type router via `specialist-<agent>`
3. Final hard fallback: `claude-sonnet-4-6`

Code path:
- `src/lib/cloister/specialists.ts:722`

## Status review workflow job

`status-review` is not a runtime agent type, but it is a routable workflow job used by Mission Control.

It resolves in this order:

1. `models.overrides.status-review`
2. Final fallback: `claude-sonnet-4-6`

Code path:
- `src/dashboard/server/routes/mission-control.ts:620`

## Routable IDs that map to agent jobs

### Primary runtime agents
- `planning-agent`
- `issue-agent:exploration`
- `issue-agent:implementation`
- `issue-agent:testing`
- `issue-agent:documentation`
- `issue-agent:review-response`

### Specialist runtime agents
- `specialist-review-agent`
- `specialist-test-agent`
- `specialist-merge-agent`
- `specialist-inspect-agent`
- `specialist-uat-agent`

### Workflow-only routed jobs
- `status-review`

## Config surfaces

### User/model override config
`~/.panopticon/config.yaml` or project-local `.pan.yaml`

Example:

```yaml
models:
  overrides:
    issue-agent:implementation: gpt-5.4
    specialist-review-agent: claude-opus-4-6
    specialist-uat-agent: claude-opus-4-6
    status-review: claude-sonnet-4-6
```

### Cloister specialist config
`~/.panopticon/cloister.toml`

Example:

```toml
[model_selection]
default_model = "sonnet"

[model_selection.specialist_models]
review_agent = "opus"
test_agent = "haiku"
inspect_agent = "sonnet"
uat_agent = "sonnet"
merge_agent = "sonnet"
```

## Notes

- `modelDefaults.ts` is a UI fallback/default surface, not the canonical runtime registry.
- `settings-api.ts` exposes opinionated defaults to the settings UI/API; it should stay aligned with `work-types.ts`.
- If a new runtime agent type is added, update all of:
  - `src/lib/work-types.ts`
  - `src/lib/settings-api.ts`
  - `src/dashboard/frontend/src/components/Settings/modelDefaults.ts`
  - `docs/WORK-TYPES.md`
  - `docs/AGENT_TYPES_INDEX.md`

## Current cleanup recommendations

- Keep `src/lib/work-types.ts` as the canonical routing registry.
- Treat `docs/AGENT_TYPES_INDEX.md` as the canonical human-readable inventory.
- Avoid introducing new runtime agent types until routing, prompt mapping, and docs stay in sync for every current type.
