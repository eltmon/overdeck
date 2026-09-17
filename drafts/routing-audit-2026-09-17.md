# Routing audit: how Overdeck picks a model for work, and why the xBRIEF difficulty routes nothing

Author: Claude Fable 5.1 (`conv-20260917-0744`), 2026-09-17. Worktree `~/Projects/hoff-routing-audit`,
branch `hoff/routing-audit`, code cited at commit `5e26d823a18`. Live state read from `~/.overdeck`
(read-only). Config keys cite `~/.overdeck/config.yaml` as loaded by the real loader
(`loadConfigSync`, verified with a Bun script: `tieredExecution.enabled = true`, no
`tieredExecutionError`, `difficultyToTier = {trivial→trivial, simple/medium→simple-medium,
complex→complex, expert→expert}`, `byKind = {design→complex, spike→complex}`,
`swarm = {mode: off, maxSlots: 3}`).

## Short answer to "what are we routing, then?"

Every work agent in the last 30 days ran at the role default or at a per-issue `workModel` stamp.
The xBRIEF difficulty the planner assigns has routed nothing. Tiered execution is enabled and its
config is valid, but every real spawn path hands `pan start` an explicit `--model`, and an explicit
model makes the staffing code skip the tier table. Worse, `pan start` persists that explicit model
into the issue record as a durable override, so the role default of the day becomes a sticky
per-issue choice. 101 of 754 panopticon-cli records and 26 of 70 mind-your-now records carry a
`workModel`; 104 of those say `gpt-5.6-sol`, which is no current role's model.

The dead triage matcher was never part of routing. Two copies of it exist and neither has a caller.

## Q1. Is the legacy `complexityToModel` mapping on any live path?

No. It is unreachable regardless of `tiered_execution.enabled`.

- `complexityToModel` (`src/lib/cloister/complexity.ts:316-327`) hardcodes `haiku`/`sonnet`/`opus`.
  `legacyComplexityTierConfig` (`complexity.ts:335-347`) wraps it as a `ResolveTierConfig`.
- The only non-test caller is `ModelRouter.routeTask` (`src/lib/cloister/router.ts:41-62`), taken when
  `config.model_selection` is absent (`router.ts:47-53`).
- `ModelRouter`, `routeTask`, `getGlobalRouter`, `getSpecialistModel`, `getDefaultModel` have zero
  callers outside `router.ts` and its test. Verified by grep over `src/` and `packages/` excluding tests.
- `router.ts:82-92` and `router.ts:99-102` also return the literal `'sonnet'` as a default. Dead too.
- A second legacy chain: `settings.models.complexity` (`src/lib/settings.ts:61-63`, hardcoded defaults
  at `settings.ts:100`, validation at `settings.ts:217-227`) feeds only `generateRouterConfig` in
  `src/lib/router-config.ts:49-107`, which is `@deprecated` and has zero callers.
- `ComplexityLevel` type imports at `src/lib/cloister/handoff-context.ts:13` and
  `src/lib/agents/spawn-prep.ts:19` are type-only and can move to `XBriefDifficulty`.
- The comment "delete once the tiered-execution parity lock test proves the new chain" is satisfied:
  the parity test exists at `src/lib/cloister/__tests__/router.test.ts:9-11`.

One hardcoded model fallback IS on a live path: `src/lib/agents/resume.ts:333`
`requireModelOverrideSync(agentState.model || 'claude-sonnet-4-6')`. It fires only when a state file
has an empty `model`, but it violates `sync-sources/rules/no-hardcoded-model-fallbacks.md`.

Verdict: dead code, not a live bug. Delete it (cleanup ticket below). The `resume.ts:333` literal is a
live rule violation and goes in the same ticket.

## Q2. What actually ran on which model

`~/.overdeck/agents/*/state.json` modified in the last 30 days (66 files):

| role | model | count |
| --- | --- | --- |
| review | claude-opus-5 | 20 |
| review | gpt-5.6-sol | 15 |
| review | MiniMax-M3 | 1 |
| strike | gpt-5.6-sol | 13 |
| strike | gpt-5.6-terra | 1 |
| strike | k3 | 1 |
| work | gpt-5.6-sol | 6 |
| work | claude-opus-5 | 3 |
| test | claude-sonnet-5 | 6 |

No work agent ran on `claude-haiku-4-5` or `claude-sonnet-5`. The state schema records no tier name
(keys: `consecutiveFailures, costSoFar, deliveryMethod, flywheelRunId, harness, id, issueId, ...,
model, role, ...`), so the proof that tiering never fired is the model column plus the spec cross:

| issue | first dispatchable item difficulty | tier would give | record `workModel` | ran on |
| --- | --- | --- | --- | --- |
| PAN-3836 | simple (`repo-url-parser`) | claude-sonnet-5 | claude-opus-5 | claude-opus-5 |
| PAN-3841 | medium (`retro-template`) | claude-sonnet-5 | claude-opus-5 | claude-opus-5 |
| PAN-3842 | simple (`class-table`) | claude-sonnet-5 | claude-opus-5 | claude-opus-5 |
| PAN-3668 | simple (`contracts-harness-literal`) | claude-sonnet-5 | gpt-5.6-sol | gpt-5.6-sol |
| PAN-1641 | (no canonical spec) | n/a | gpt-5.6-sol | gpt-5.6-sol |
| MIN-1030/1031/1036 | medium | claude-sonnet-5 | gpt-5.6-sol | gpt-5.6-sol |
| MIN-889 | medium (`w1-license-schema`) | claude-sonnet-5 | unset | gpt-5.6-sol (resumed by swarm-janitor, prior state model kept) |

`gpt-5.6-sol` is not `roles.work.model` (`workhorse:mid` = `claude-opus-5`) and is not any tier. It is
the stale role default from when `workhorses.mid` pointed at it, frozen into records.

Records census (`~/.overdeck/state/<project>/records/*.json`):

| project | records | with `workModel` | of which `gpt-5.6-sol` | `tieredExecutionOverride` set |
| --- | --- | --- | --- | --- |
| panopticon-cli | 754 | 101 | 86 | 0 |
| mind-your-now | 70 | 26 | 18 | 0 |

Canonical specs (`~/.overdeck/state/*/specs/*.xbrief.json`, 161 specs, 1394 items):

| difficulty | all projects | panopticon-cli only |
| --- | --- | --- |
| trivial | 43 | 28 |
| simple | 466 | 311 |
| medium | 627 | 417 |
| complex | 235 | 134 |
| expert | 23 | 4 |

No item carries a `metadata.model` override. No plan sets `plan.metadata.tiered_execution`.

How did haiku items fare versus sonnet/opus items? There is nothing to compare. No item ever ran on a
tier, so there are zero haiku-tier and zero sonnet-tier outcomes.

### Why tiering never fires: the chain

1. **Every automated spawn goes through the dashboard route with an explicit model.** The UI Start
   button, the post-planning auto-start (`src/lib/overdeck/planning-promotion.ts:357-370` POSTs
   `/api/agents` with no `model`), the containers-ready path (`spawn-helpers.ts:493`), and
   restart-fresh (`lifecycle-restart.ts:563`) all call `buildPanStartArgs`
   (`src/dashboard/server/routes/agents/shared.ts:55-72`), which emits `--model <spawnModel>`
   unconditionally. `spawnModel` is `body.model ?? record.workModel ?? role default`
   (`src/dashboard/server/routes/agents/spawn.ts:440-451`). The comment at `spawn.ts:441-446` (PAN-3022)
   shows the authors knew `pan start --model` persists: PAN-3022 stopped the route from clobbering an
   existing override but left it stamping the role default as a NEW override.
2. **`pan start` treats that model as explicit.** `resolveSpawnModel` (`src/cli/commands/start.ts:708-716`)
   returns `explicitModel || (fresh ? undefined : recorded)`, called at `start.ts:736` with
   `options.model ?? resolveIssueWorkModel(id)` and the prior agent state's model. So a record stamp OR
   a prior agent's model also counts as explicit. The result is passed as `model: spawnModel` to
   `spawnAgent` (`start.ts:1201`).
3. **An explicit model skips the tier table.** `resolveSingleWorkTierSpawnParams`
   (`src/lib/agents/spawn-prep.ts:299-338`) starts with `if (explicitModel) return {};`
   (`spawn-prep.ts:303`). The slot path `resolveSlotTierSpawnParams` does the same at `spawn-prep.ts:250`.
4. **`pan start --model` persists the stamp.** `start.ts:872` → `applyStartPolicyOptions` →
   `parseStartPolicyOverrides` (`src/cli/commands/start-policy-overrides.ts:23`) →
   `record.workModel = ...` (`start-policy-overrides.ts:53`). From then on `resolveStaffing`
   (`src/lib/agents/staffing.ts:96-111`) returns the `issue-override` tier BEFORE consulting the tier
   table, so even a future swarm slot spawn for that issue skips tiers.
5. **User-visible symptom.** `src/dashboard/frontend/src/components/IssuePolicyStrip.tsx:287` sets
   `crewSuspended` whenever `workModel` is set and renders "replaces crews". The operator sees an
   override they never chose on roughly 100 issues.

The only path where the tier table is consulted today: a pristine CLI `pan start <id>` with no
`--model`, no `record.workModel`, and no prior agent state (or `--fresh`). Even then, only the FIRST
dispatchable item's difficulty picks the model (`spawn-prep.ts:310`
`getDispatchableItems(doc, new Set())[0]`) for the one agent that then implements every item.

### Is tiered execution dormant because `swarm.mode: off`?

Not in code. The single-work path was deliberately wired to tiers (`spawn-prep.ts:292-298`). Registered
slot spawns (per-item agents) come only from the swarm foreman (`src/lib/cloister/deacon-swarm.ts:937`),
which `swarm.mode: off` suppresses (`src/lib/swarm-policy.ts:38`, `spawnForeman = manual || mode !== 'off'`).
So with swarm off there is structurally one agent per issue and one model per issue; per-item routing
cannot happen. The brief's "339 items would have gone to haiku or sonnet" is the wrong frame. Two
corrections:

- With the operator's tiers, panopticon-cli items would split 28 haiku / 728 sonnet / 134 opus / 4 fable.
- But on the single-work path the tier input is the first item. First-item census over the 123
  panopticon-cli specs: 1 trivial, 42 simple, 62 medium, 18 complex, 0 expert. If tiering fired today,
  105 of 123 issues would run ENTIRELY on haiku or sonnet, including their 134 complex items. Making
  the current path fire is a regression, not a saving.

## Q3. Is the planner's difficulty estimate trustworthy enough to be the routing input?

What the planner is told (at `5e26d823a18`):

- `src/lib/cloister/prompts/planning.md:233-243` "Difficulty Estimation": a file-count rubric
  (trivial = typo; simple = one file; medium = 3-5 files; complex = 6+ files, some risk; expert =
  architecture/security/performance) WITH a Model column saying trivial/simple→haiku, medium/complex→
  sonnet, expert→opus. That column contradicts the operator's tiers (complex→opus, expert→fable).
  PR #3856 (`origin/hoff/planner-context`) removes the column from both `planning.md:174-180` and
  `sync-sources/skills/write-xbrief/SKILL.md:261-269`.
- `roles/plan.md` never mentions difficulty.

Sample (PR-level, because squash-merge commit headlines carry the issue id but not the item id, so
per-item mapping was not mechanical):

| issue | items (difficulty mix) | merged PR | size |
| --- | --- | --- | --- |
| PAN-3743 | 8 (complex 1, medium 5, simple 2) | #3749 | +975/-142, 23 files, 13 commits of 1-9 files |
| PAN-3744 | 5 (medium 4, simple 1) | #3746 | +439/-18, 9 files |
| PAN-3745 | 3 (simple 2, trivial 1) | #3747 | +58/-5, 3 files, 4 commits of 1-2 files |
| PAN-3752 | 7 (complex 1, medium 3, simple 3) | #3756 | +397/-116, 9 files |
| PAN-3753 | 8 (complex 2, medium 4, simple 2) | #3757 | +850/-149, 41 files, 15 commits of 1-11 files |
| PAN-3754 | 5 (medium 3, simple 2) | #3755 | +571/-34, 11 files |

Judgment: the labels are file-count-consistent with the diffs that landed. `medium` is 47% of all
items, `expert` is under 1% (4 of 894 in panopticon-cli), so the rubric measures breadth, not
reasoning depth. Nothing consumes the label today, so there is no calibration loop and no way to say
where it is systematically off in a way that mattered.

Escalation (`src/lib/agents/tier-escalation.ts`) is the corrective for a wrong estimate. It has three
defects:

1. **Promotions change nothing.** The only consumer of `applyEffectiveDifficulty` is
   `src/lib/agents/tier-replay.ts:263`, and every export of `tier-replay.ts` has zero live callers
   (`replayStandingAgent`, `replayCrashedStandingAgent`, `shouldReplayCompactAtTierRunBoundary`;
   `standing-tiers.ts:1-20` is marked RETIRED). `resolveSlotTierSpawnParams`,
   `resolveSingleWorkTierSpawnParams`, and `resolveStaffing` never read `readTierOverrides`. Evidence:
   0 of the `~/Projects/*/workspaces/*/.pan/continue.json` files contain `tierOverrides`.
2. **`retries_at_tier` cannot retry for supervisor-blocked.** The one live caller,
   `src/dashboard/server/routes/tiered-inspect-escalation.ts:56-61`, passes
   `attemptsAtCurrentTier: tiered.escalation.retries_at_tier`, and `decideEscalation` retries only when
   `attemptsAtCurrentTier < config.retries_at_tier` (`tier-escalation.ts:81-84`). Verify intent; it
   reads as an off-by-design.
3. **Two triggers have no caller.** `decideVerificationFailureEscalation` and
   `decideFlounderingEscalation` have no non-test callers, so `escalation.flounder_budget_minutes: {}`
   is inert.

## Q4. The `by_kind` block

`resolve-tier.ts:5-17` documents the chain and `resolve-tier.ts:80-105` implements it:
`metadata.model` override (model only) → `byKind[item.metadata.kind]` → `difficultyToTier[difficulty]`
→ `roleDefault`. `byKind` wins over difficulty outright. The operator's config maps `design` and
`spike` to the `complex` tier (claude-opus-5). Validation at `tier-table.ts:456-465` requires the tier
name to exist.

Usage in specs: 3 `design` and 5 `spike` items across all projects (panopticon-cli: 2 design at medium,
2 spike at medium, 1 spike at simple). Had tiering fired, those would have gone to opus instead of
sonnet. Two consequences worth an operator decision, not a ticket:

- A `design` item marked `expert` gets the `complex` tier, not `expert`. `byKind` caps as well as floors.
- Escalation promotes `difficulty` only (`tier-escalation.ts:95-100`), and `byKind` still outranks it,
  so a `design`/`spike` item can never be promoted past `complex`.

## Q5. The dead triage surface

Two keyword matchers, neither reachable:

- `GET /api/issues/:id/analyze` (`src/dashboard/server/routes/issues.ts:270-281`) calls `analyzeIssue`
  from `src/lib/overdeck/issue-reads.ts:101-135`, an inline matcher that requires `LinearClient`
  (`issue-reads.ts:103-105`). The tracker is GitHub Issues, so it answers 404 for every PAN issue today.
  No frontend or CLI code references `/analyze`.
- `src/lib/planning/triage-agent.ts` (217 lines; `analyzeIssue`, `triageMultiple`, `sortByPriority`) is
  exported only through `src/lib/planning/index.ts:13-18`, which has zero importers. Its only reference
  is `tests/lib/planning/triage-agent.test.ts` and a comment at `src/lib/sync.ts:274`.

Recommendation: delete both, the route, the `planning/index.ts` re-exports, and the test. Do not
replace. The flywheel reads issue bodies on `gpt-5.6-sol` when it picks work, and the planner (on
`workhorse:expensive`) assigns difficulty per item. A third pass that guesses P0-P4 from substrings
adds no routing input anyone consumes.

## Q6. Recommendations

### Bugs (filed)

- [PAN-3857](https://github.com/eltmon/overdeck/issues/3857) routing bypass (item 1 below)
- [PAN-3858](https://github.com/eltmon/overdeck/issues/3858) escalation inert (item 2 below)

1. **Dashboard spawn path stamps the role default as a per-issue override and bypasses tiered
   staffing.** Fix: `buildPanStartArgs` emits `--model` only when the request body named one;
   `pan start` persists `workModel` only from an explicit `--model` flag; the resume/prior-agent model
   fallback in `resolveSpawnModel` travels as a separate `resumeModel` so it does not suppress
   `resolveSingleWorkTierSpawnParams`. Plus a one-time reconciliation for the 127 stamped records
   (clear `workModel` where it equals a historical role default; the operator should confirm the list).
   Files: `src/dashboard/server/routes/agents/shared.ts:55-72`, `spawn.ts:440-451`,
   `src/cli/commands/start.ts:708-716, 736, 872`, `start-policy-overrides.ts:23,53`,
   `src/lib/agents/spawn-prep.ts:303, 250`.
2. **Tier escalation is inert.** Promotions are never read by any live staffing path; two of three
   triggers have no caller; the live trigger cannot retry. Fix: make `resolveStaffing` apply
   `readTierOverrides(workspacePath)` via `applyEffectiveDifficulty` before `resolveTier`; wire or
   delete the verification-failed and floundering triggers; pass the real attempt count.
   Files: `src/lib/agents/staffing.ts:96-111`, `tier-escalation.ts`,
   `src/dashboard/server/routes/tiered-inspect-escalation.ts:56-61`, `tier-replay.ts`.

### Cleanup (filed)

- [PAN-3859](https://github.com/eltmon/overdeck/issues/3859) dead triage + dead legacy chain + resume fallback (item 3 below)

3. **Delete the dead triage surface and the dead legacy complexity chain, and remove the live hardcoded
   fallback.** `triage-agent.ts` + test + `planning/index.ts` exports; `/analyze` route +
   `issue-reads.ts:101-135`; `router.ts` whole file + its test; `complexityToModel` +
   `legacyComplexityTierConfig` (`complexity.ts:316-347`); `settings.models.complexity`
   (`settings.ts:61-63, 100, 217-227`); `router-config.ts` `generateRouterConfig`; `resume.ts:333`
   literal.

### Design choices for the operator (not filed)

- **With `swarm.mode: off`, per-item routing is impossible by construction.** Pick one: (a) set
  `tiered_execution.enabled: false` until swarm is on, so the config stops describing routing that
  cannot happen; (b) set `swarm.mode: auto` to get real per-item tiers via slot agents; (c) keep
  single-agent issues but key staffing on the plan's MAX difficulty instead of the first item's.
  Recommendation: (c) as a code change in bug 1 regardless, and (a) or (b) as the operator's call.
  Do not simply "make tiering fire" on the current first-item rule: 105 of 123 issues would drop
  entirely to haiku/sonnet.
- **`by_kind` caps difficulty and blocks escalation for `design`/`spike`.** Either accept, or change
  the chain so `byKind` sets a floor (max of byKind tier and difficulty tier).
- **Tier table intent.** `trivial→haiku-4-5` and `simple/medium→sonnet-5` mean that under (b) or (c)
  above, most items run on sonnet. If the operator wants opus for medium, change the table before
  turning routing on.

## Not done / caveats

- PR #3856 was not merged by this session. Its `test` check was still running at the time of writing;
  the source conversation's "CI green" note is stale.
- Per-item commit-to-difficulty mapping (Q3) was not mechanical because squash-merge headlines lack
  item ids; findings are PR-level.
- No live state was modified. No `pan` mutation was run.
