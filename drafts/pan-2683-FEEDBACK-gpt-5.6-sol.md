# GPT-5.6 feedback on drafts/pan-2683.md

> Model: gpt-5.6-sol via codex-cli 0.144.4 (read-only) · 2026-07-15 · requested by the operator; feedback only, no changes applied by the reviewer.

## Verdict

**Needs revision before implementation.** The product intent is sound, and the dead-code claim is correct, but FR-1 and NFR-1 rely on an endpoint contract that does not exist. The PRD also overstates the reliability of `staffing.resolved.tiered` for FR-2 because that endpoint omits plan metadata during resolution.

## Reference-check findings

- **POST payload shape: refuted.** The mutation endpoint is `PATCH /api/workspaces/:issueId/tiered-execution`, not POST. Its body is `{ override: 'on' | 'off' | null }`, not `{ value: ... }`. [PlanCard.tsx:39](/home/eltmon/Projects/overdeck/src/dashboard/frontend/src/components/Stage/cockpit/PlanCard.tsx:39), [workspace-data.ts:923](/home/eltmon/Projects/overdeck/src/dashboard/server/routes/workspaces/workspace-data.ts:923), [workspace-data.ts:939](/home/eltmon/Projects/overdeck/src/dashboard/server/routes/workspaces/workspace-data.ts:939)

- **Dedicated GET endpoint: refuted.** There is no `GET /api/workspaces/:issueId/tiered-execution`. The route layer registers only the PATCH mutation for that path. The nearby read endpoint is `GET /api/workspaces/:issueId/plan`, but it returns the stored document without computing a tiered-execution block. [workspace-data.ts:769](/home/eltmon/Projects/overdeck/src/dashboard/server/routes/workspaces/workspace-data.ts:769), [workspace-data.ts:789](/home/eltmon/Projects/overdeck/src/dashboard/server/routes/workspaces/workspace-data.ts:789), [workspace-data.ts:1002](/home/eltmon/Projects/overdeck/src/dashboard/server/routes/workspaces/workspace-data.ts:1002)

- **`staffing.resolved.tiered`: confirmed.** `GET /api/issues/:issueId/staffing` returns `resolved.tiered`, and the frontend type and current default-model label already consume it. [projects.ts:727](/home/eltmon/Projects/overdeck/src/dashboard/server/routes/projects.ts:727), [projects.ts:736](/home/eltmon/Projects/overdeck/src/dashboard/server/routes/projects.ts:736), [IssuePolicyStrip.tsx:14](/home/eltmon/Projects/overdeck/src/dashboard/frontend/src/components/IssuePolicyStrip.tsx:14), [IssuePolicyStrip.tsx:168](/home/eltmon/Projects/overdeck/src/dashboard/frontend/src/components/IssuePolicyStrip.tsx:168)

- **Resolver precedence: confirmed.** The resolver applies record override, then plan metadata, then global configuration. [tier-table.ts:144](/home/eltmon/Projects/overdeck/src/lib/agents/tier-table.ts:144), [tier-table.ts:168](/home/eltmon/Projects/overdeck/src/lib/agents/tier-table.ts:168), [tier-table.ts:184](/home/eltmon/Projects/overdeck/src/lib/agents/tier-table.ts:184)

- **Dead-code claim: confirmed for the application mount graph.** `IssueCockpitBody` imports and renders the cockpit `PlanCard`, but no production component imports or renders `IssueCockpitBody`. `PlanCard` is mounted independently only by its tests. [IssueCockpitBody.tsx:5](/home/eltmon/Projects/overdeck/src/dashboard/frontend/src/components/Stage/cockpit/IssueCockpitBody.tsx:5), [IssueCockpitBody.tsx:21](/home/eltmon/Projects/overdeck/src/dashboard/frontend/src/components/Stage/cockpit/IssueCockpitBody.tsx:21), [IssueCockpitBody.tsx:31](/home/eltmon/Projects/overdeck/src/dashboard/frontend/src/components/Stage/cockpit/IssueCockpitBody.tsx:31), [PlanCard.test.tsx:18](/home/eltmon/Projects/overdeck/src/dashboard/frontend/src/components/Stage/cockpit/PlanCard.test.tsx:18). The PRD’s wording that `git grep` finds “itself + test” is slightly inaccurate—the test mounts `PlanCard`, not `IssueCockpitBody`—but the dead-code conclusion stands.

- **The Policies panel is live in three surfaces.** It appears in the issue drawer, mission control, and session header. [IssueDrawer.tsx:298](/home/eltmon/Projects/overdeck/src/dashboard/frontend/src/components/drawer/IssueDrawer.tsx:298), [IssueMissionControl.tsx:768](/home/eltmon/Projects/overdeck/src/dashboard/frontend/src/components/Stage/cockpit/IssueMissionControl.tsx:768), [IssueHeader.tsx:324](/home/eltmon/Projects/overdeck/src/dashboard/frontend/src/components/CommandDeck/SessionView/IssueHeader.tsx:324)

## Gaps

- Rewrite FR-1 to specify `PATCH` plus `{ override }`, including `{ override: null }` for reset. The current “POST null” language is wrong. [pan-2683.md:13](/home/eltmon/.overdeck/state/panopticon-cli/drafts/pan-2683.md:13), [pan-2683.md:17](/home/eltmon/.overdeck/state/panopticon-cli/drafts/pan-2683.md:17)

- NFR-1 is false. FR-1 requires the initial override, effective value, and source, but no existing GET supplies all three. The staffing GET supplies only an effective boolean; its `source` describes the **work-model** source, not tiered-execution source. [projects.ts:737](/home/eltmon/Projects/overdeck/src/dashboard/server/routes/projects.ts:737), [projects.ts:740](/home/eltmon/Projects/overdeck/src/dashboard/server/routes/projects.ts:740)

- Choose an explicit backend/read contract:

  - Add `GET /api/workspaces/:issueId/tiered-execution`, or
  - Extend staffing with a separate block such as `tieredExecution: { effective, source, override }`.

  Either choice contradicts “No resolver/backend changes.”

- `staffing.resolved.tiered` currently calls the issue-aware resolver **without plan metadata**. Therefore, plan-level `tiered_execution: on/off` is ignored by FR-2’s proposed condition. Runtime spawn paths do pass plan metadata. [projects.ts:727](/home/eltmon/Projects/overdeck/src/dashboard/server/routes/projects.ts:727), [tier-table.ts:168](/home/eltmon/Projects/overdeck/src/lib/agents/tier-table.ts:168), [spawn-prep.ts:297](/home/eltmon/Projects/overdeck/src/lib/agents/spawn-prep.ts:297)

- Add acceptance coverage for plan-metadata resolution, not merely global and record overrides.

- Add the new crew override to “Reset all”; the current reset sequence enumerates every existing override explicitly. [IssuePolicyStrip.tsx:203](/home/eltmon/Projects/overdeck/src/dashboard/frontend/src/components/IssuePolicyStrip.tsx:203)

- Define the exact default label, including source—for example, `Default · On · plan` versus `Default · On (plan metadata)`. AC-1 requires source, but FR-1 specifies only `<effective>`.

## UX concerns for new users

- “Standing crew,” “crew routing,” and “every item” assume domain knowledge. Add short helper copy explaining that crews select models per work item based on difficulty or kind.

- `Default · crews` does not tell a new user whether crews are currently on or off. The crew row should expose the effective state and inheritance source in plain language.

- “On / Off” may appear to affect currently running agents. State whether the change applies only to future spawns, similar to the existing work-model restart message. [IssuePolicyStrip.tsx:314](/home/eltmon/Projects/overdeck/src/dashboard/frontend/src/components/IssuePolicyStrip.tsx:314)

- The proposed suspension helper is useful, but the collapsed suffix `replaces crews` is terse. `crew routing off for this issue` would be clearer if space permits.

- Mutation failures currently receive no visible feedback: `save` refreshes only on success and otherwise silently exits. Adding another policy mutation increases the chance that a user believes an override was saved when it was rejected. [IssuePolicyStrip.tsx:101](/home/eltmon/Projects/overdeck/src/dashboard/frontend/src/components/IssuePolicyStrip.tsx:101)

## Risks

- **Incorrect suspension messaging:** issues enabled through plan metadata can show no warning because staffing reports the wrong effective value.

- **Implementation dead end:** following the PRD literally leads to a 404/405 because the claimed GET/POST pair does not exist.

- **Response-shape inconsistency:** PATCH returns `tieredExecution` at the document’s top level, while the dead `PlanCard` reads `plan.tieredExecution`. Reviving or copying that pattern would preserve a latent mismatch. [workspace-data.ts:992](/home/eltmon/Projects/overdeck/src/dashboard/server/routes/workspaces/workspace-data.ts:992), [PlanCard.tsx:36](/home/eltmon/Projects/overdeck/src/dashboard/frontend/src/components/Stage/cockpit/PlanCard.tsx:36)

- **Resolver drift:** the PATCH route manually duplicates precedence logic instead of calling the canonical resolver, increasing the chance that route and runtime behavior diverge. [workspace-data.ts:968](/home/eltmon/Projects/overdeck/src/dashboard/server/routes/workspaces/workspace-data.ts:968), [tier-table.ts:168](/home/eltmon/Projects/overdeck/src/lib/agents/tier-table.ts:168)
