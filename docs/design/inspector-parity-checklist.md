# InspectorPanel parity checklist

This checklist gates deletion of the legacy inspector surfaces in PAN-1148. `InspectorPanel.tsx`, `components/inspector/*`, `AgentList`, and `GodView/AgentGrid` can only be removed after every legacy feature below has a destination in the redesigned dashboard or an explicit out-of-scope decision.

## Deletion gate

Parity mapping is resolved for `workspace-9a7q`: every legacy row below is now either `Covered` or `Out of scope` with a user-visible rationale. The remaining checks are execution checks for the deletion bead itself.

- [x] InspectorPanel feature rows below are mapped to a redesigned surface or explicit out-of-scope decision.
- [x] `src/dashboard/frontend/src/components/inspector/*` sub-file rows below are mapped to a redesigned surface or explicit out-of-scope decision.
- [x] `src/dashboard/frontend/src/components/AgentList.tsx` and its tests have replacement coverage in the redesigned Agents surface.
- [x] `src/dashboard/frontend/src/components/GodView/AgentGrid.tsx` has replacement coverage in the redesigned Agents surface; the rest of `GodView/*` remains per PRD non-goal.
- [ ] `src/dashboard/frontend/src/components/InspectorPanel.tsx`, `InspectorPanel.test.tsx`, and `components/inspector/*` are removed by `workspace-9a7q`.
- [ ] `src/dashboard/frontend/src/components/AgentList.tsx` and its tests are removed by `workspace-9a7q`.
- [ ] `src/dashboard/frontend/src/components/GodView/AgentGrid.tsx` is removed by `workspace-9a7q` and the rest of `GodView/*` is untouched.
- [ ] `grep -r InspectorPanel src/` returns zero results after deletion.
- [ ] `grep -r AgentList src/` returns zero results after deletion.
- [ ] `npm run typecheck` passes after deletion.
- [ ] `npm test` passes after deletion.

## InspectorPanel feature inventory

| Legacy feature | Legacy source | New home / decision | Status |
| --- | --- | --- | --- |
| Issue drawer shell with issue ID, title, and close affordance | `InspectorPanel.tsx` header | `IssueDrawer` header renders issue ID/title and close affordance. | Covered |
| Pipeline phase chip / phase label | `InspectorPanel.tsx`, `TerminalTabs.tsx` phase constants | Drawer `PhaseTimeline`, Pipeline rows, Board cards, and verb badges expose lifecycle phase. | Covered |
| Open terminal button from inspector header | `InspectorPanel.tsx` header actions | Command Deck session actions expose `viewTerminal`; drawer retains a Terminal tab entry for issue-scoped terminal access. | Covered |
| Issue title, status, priority, and labels | `InspectorPanel.tsx` issue metadata block | `IssueDrawer` header covers ID/title; Pipeline `IssueRow` and Board `IssueCard` cover priority, labels, and status/phase. | Covered |
| TTS mute/unmute for an issue | `InspectorPanel.tsx` issue actions | Out of scope for PAN-1148: the PRD unifies operations lenses and does not include per-issue TTS controls; removing this inspector-only affordance avoids preserving a non-redesign control in the new IA. | Out of scope |
| Assignee display and sensitive email display | `InspectorPanel.tsx` issue metadata | Pipeline `IssueRow` keeps the assignee avatar/name path; sensitive email display is out of scope because the redesign intentionally uses compact assignee identity, not full personal metadata. | Covered / Out of scope |
| Pipeline stuck banner with recovery action | `InspectorPanel.tsx` stuck/recover banner | Command Deck `ZoneActionStrip` exposes `recover`; Pipeline/Agents show stuck states via badges and destructive metrics. | Covered |
| Pending review stranded banner | `InspectorPanel.tsx` review status warnings | Drawer review specialists and verification gates show failed/blocked review states; Command Deck `reviewTest`/`recover` actions cover remediation. | Covered |
| Merged issue summary for no-workspace merged issues | `InspectorPanel.tsx`, `MergedSummaryCard.tsx` | Drawer phase timeline and Pipeline/Board done/merged states provide the canonical merged summary; detailed legacy merged card copy is out of scope for the compact drawer. | Covered / Out of scope |
| No workspace / no agent status messaging | `InspectorPanel.tsx` empty states | Drawer `DrawerActiveAgent` empty state plus Command Deck workspace/create actions cover this state. | Covered |
| Workspace stack broken banner | `InspectorPanel.tsx`, workspace stack health fields | Command Deck project resource tree and Zone A actions are the redesigned workspace-health surface. | Covered |
| Awaiting input banner with prompt and attach terminal action | `InspectorPanel.tsx` awaiting-input state | Drawer active-agent card exposes the `INPUT` verb badge, stream excerpt, Tell input, and Command Deck session terminal access. | Covered |
| Agent runtime/model/uptime/session summary | `AgentInfoSection.tsx` | Drawer active-agent card and Agents `AgentCard` meta rows cover model/runtime/session identity. | Covered |
| Git branch, uncommitted count, latest commit, sync with main action | `AgentInfoSection.tsx` | Command Deck project resources show branches and Zone A exposes `syncMain`; exact uncommitted/latest-commit inspector copy is out of scope for the redesigned compact surfaces. | Covered / Out of scope |
| Workspace path, VS Code link, and open-in picker | `AgentInfoSection.tsx` | Out of scope for PAN-1148: the PRD does not include editor-launch controls in the new drawer/agents surfaces; workspace drill-down belongs to Command Deck resources or a follow-up workspace inspector. | Out of scope |
| Workspace location badge for no-agent workspaces | `AgentInfoSection.tsx` | Command Deck project resources/workbench owns workspace existence and resource state. | Covered |
| Activity summary | `InspectorPanel.tsx` activity block | Drawer `Activity` tab entry and `DrawerActivityRail` provide the issue-scoped live activity surface. | Covered |
| Swarm slots summary | `InspectorPanel.tsx` swarm slots block | PRD §4.1 preserves swarm rollup as convoy cards in Agents and review specialists in Issue Detail. | Covered |
| Reviewer summary | `InspectorPanel.tsx` reviewer summary block | Drawer `DrawerReviewSpecialists` covers reviewer role states. | Covered |
| Review pipeline stepper and notes | `ReviewPipelineSection.tsx` | Drawer `DrawerVerificationGates`, `DrawerReviewSpecialists`, `PhaseTimeline`, and `DrawerActivityRail` cover step/state/history; verbose notes are out of scope for the compact drawer and remain available through Command Deck activity/conversation surfaces. | Covered / Out of scope |
| Pull request link and status | `InspectorPanel.tsx` PR block | Drawer action bar `View PR`, Command Deck resource `PrNode`, and Pipeline Ship filters cover PR status and navigation. | Covered |
| Links to issue and PRD | `InspectorPanel.tsx` links block | Drawer Plan/Files tabs and Command Deck overview/VBrief/Beads tabs are the redesigned artifact surfaces. | Covered |
| Cost summary | `InspectorPanel.tsx`, `IssueCostData` | Pipeline/Agents metric strips and Command Deck `CostsTab` cover issue/fleet costs; the PRD points canonical cost precision to Costs. | Covered |
| Corrupted workspace warning | `InspectorPanel.tsx`, `WorkspaceInfo.corrupted` | Command Deck workspace/resource tree is the redesigned workspace-health destination. | Covered |
| Service URLs | `InspectorPanel.tsx`, `WorkspaceInfo.services` | Command Deck resources own workspace/service drill-down; service URL lists in the drawer are out of scope for PAN-1148's compact issue detail. | Covered / Out of scope |
| Start containers action | `InspectorPanel.tsx`, `ContainerSection.tsx` | Command Deck `ContainerNode` context menu exposes start/stop/restart for containers. | Covered |
| Containerize action | `InspectorPanel.tsx`, workspace actions | Out of scope for PAN-1148: the redesign keeps operations lenses focused on issues/agents; containerization workflow is a workspace-management follow-up. | Out of scope |
| Container status pills and expanded details | `ContainerSection.tsx` | Command Deck `ResourcesGroup` and `ContainerNode` show container status, CPU, memory, and history sparkline. | Covered |
| Container right-click context menu | `ContainerSection.tsx` | Command Deck `ContainerNode` context menu covers logs, inspect, restart, stop, and start. | Covered |
| Start / stop / restart individual containers | `ContainerSection.tsx` | Command Deck `ContainerNode` context menu covers individual container lifecycle actions. | Covered |
| Refresh database action for Postgres | `ContainerSection.tsx` | Out of scope for PAN-1148: database refresh is a specialized workspace-service action not listed in the unified redesign surfaces. | Out of scope |
| Tmux attach command and copy action | `InspectorPanel.tsx` terminal section | Command Deck Zone B exposes `copyTmuxCommand` and `viewTerminal` for sessions. | Covered |
| Salvageable stashes recovery and dismissal | `InspectorPanel.tsx` stash section | Out of scope for PAN-1148: stash recovery is a workspace-inspector concern, not part of the four operations lenses or Issue Detail PRD. | Out of scope |
| Merge action | `ActionsSection.tsx`, `MergeButton` | Drawer action bar `Merge to main` and Command Deck Zone A `merge`. | Covered |
| Review & Test / Re-review / Re-request Review actions | `ActionsSection.tsx` | Command Deck Zone A `reviewTest` covers review/re-review/re-request flows; drawer action bar intentionally keeps only PRD-specified reset/stop/view/merge actions. | Covered |
| Stop Agent action | `ActionsSection.tsx`, `StopAgentButton` | Drawer action bar `Stop agent`, Command Deck Zone A/Zone B stop actions. | Covered |
| Switch Model action and modal | `ActionsSection.tsx` | Command Deck Zone A restart/resume model selectors and shared model picker preserve model-selection flows. | Covered |
| Recover action | `ActionsSection.tsx`, `RecoverButton` | Command Deck Zone A `recover`. | Covered |
| Start / resume agent action | `ActionsSection.tsx` | Command Deck Zone A `startAgent` / `resumeSession` with optional resume message. | Covered |
| Harness picker | `ActionsSection.tsx` | Command Deck Zone A restart/resume harness selector covers harness choice. | Covered |
| Reset Session action | `ActionsSection.tsx` | Command Deck Zone A `resetSession`; drawer action bar `Reset` covers issue reset only. | Covered |
| Create Workspace action | `ActionsSection.tsx` | Command Deck Zone A `createWorkspace`. | Covered |
| Copy Settings action | `ActionsSection.tsx` | Command Deck Zone A `copySettings`. | Covered |
| Feature-only Plan action | `ActionsSection.tsx` | Out of scope for PAN-1148: planning creation is not listed in the new issue-detail action bar or operations lens PRD; existing planning workflows remain outside the retired inspector surface. | Out of scope |
| Resume message input | `ActionsSection.tsx` | Drawer active-agent Tell input and Command Deck Zone A resume message textarea. | Covered |
| Action error/success states | `ActionsSection.tsx` | Drawer action bar uses dialog alerts; Command Deck action mutations/toasts cover command feedback. | Covered |
| Artifact links for Plan, vBRIEF, and Beads | `ActionsSection.tsx`, `ArtifactLinks` | Drawer tabs include Plan/Beads/Files; Command Deck includes VBrief/Beads/Activity/Costs tabs and `viewVbrief`. | Covered |
| Danger Zone reopen action | `ActionsSection.tsx` | Command Deck Zone A `reopen`. | Covered |
| Danger Zone restart from plan action | `ActionsSection.tsx`, `RestartFromPlanButton` | Command Deck Zone A `restartFromPlan`. | Covered |
| Danger Zone reset issue action | `ActionsSection.tsx`, `ResetIssueButton` | Drawer action bar `Reset` and Command Deck Zone A `resetIssue` retain destructive confirmation semantics. | Covered |
| Danger Zone cancel issue action | `ActionsSection.tsx` | Command Deck Zone A `cancel`. | Covered |
| Extra labels and tags | `InspectorPanel.tsx` metadata/tags | Pipeline `IssueRow` and Board `IssueCard` show labels as neutral taxonomy chips; extra tag expansion is out of scope for the compact redesign. | Covered / Out of scope |

## Inspector sub-file inventory

| File | Legacy responsibility | New home / deletion rationale | Status |
| --- | --- | --- | --- |
| `ActionsSection.tsx` | Inspector action groups, issue actions, danger zone, artifact links, resume message input | Split between Drawer action bar, Drawer active-agent Tell input/tabs, and Command Deck Zone A/Zone B actions. | Covered |
| `ActionsSection.test.tsx` | Tests for legacy inspector action behavior | Replacement behavior is covered by drawer tests, Command Deck action-parity tests, ZoneActionStrip/ZoneBActionStrip tests, and shared action button tests. | Covered |
| `AgentInfoSection.tsx` | Agent, git, and workspace metadata blocks | Drawer active-agent card and Agents `AgentCard` cover agent state; Command Deck resource tree covers workspace/git resources. | Covered |
| `AgentInfoSection.test.tsx` | Tests for legacy agent info blocks | Replacement assertions live with drawer active-agent, Agents fleet, and Command Deck resource tests. | Covered |
| `ContainerSection.tsx` | Container status, menu, controls, and database refresh UI | Command Deck `ResourcesGroup` / `ContainerNode` covers container status and lifecycle controls; database refresh is out of scope for PAN-1148. | Covered / Out of scope |
| `ContainerSection.test.tsx` | Tests for legacy container section | Replacement coverage belongs to Command Deck ProjectTree/ContainerNode tests; Postgres refresh assertions are retired as out of scope. | Covered / Out of scope |
| `MergedSummaryCard.tsx` | Merged issue summary for completed/no-workspace view | Drawer phase timeline and Pipeline/Board done states cover merged status; verbose merged-card copy is retired. | Covered / Out of scope |
| `MergedSummaryCard.test.tsx` | Tests for merged summary card | Replacement assertions belong to drawer phase timeline and Pipeline/Board completed-state tests. | Covered |
| `ReviewPipelineSection.tsx` | Build/review/test/merge stepper, verification cycles, CI checks, merge queue, specialist logs, collapsible notes, status history | Drawer verification gates, review specialists, phase timeline, and activity rail cover state; Command Deck activity/conversation surfaces preserve detailed history. | Covered |
| `ReviewPipelineSection.test.tsx` | Tests for review pipeline rendering | Replacement assertions belong with drawer verification/review/activity tests and Command Deck overview/activity tests. | Covered |
| `StatusHistory.tsx` | Renders review status history entries | Drawer activity rail/tab and Command Deck activity surfaces are the issue-history destinations. | Covered |
| `StatusHistory.test.tsx` | Tests for status history rendering | Replacement assertions belong with drawer activity and Command Deck activity tests. | Covered |
| `TerminalSessionWrapper.tsx` | Legacy terminal session wrapper for inspector terminal flows | Command Deck Zone B `viewTerminal` and session panel are the terminal destinations; drawer keeps a Terminal tab entry. | Covered |
| `TerminalSessionWrapper.test.tsx` | Tests for terminal wrapper behavior | Replacement assertions belong with Command Deck session/terminal tests. | Covered |
| `TerminalTabs.tsx` | Phase labels/colors and terminal tab UI/constants | Phase semantics now live in `pipeline-state`, `PhaseTimeline`, `IssueRow`, `IssueCard`, and verb badges; terminal entry lives in Drawer tabs / Command Deck session. | Covered |
| `TerminalTabs.test.tsx` | Tests for terminal tabs/phase behavior | Replacement assertions belong with drawer tabs, phase timeline, and pipeline-state tests. | Covered |
| `types.ts` | Legacy inspector prop/data contracts for review, containers, workspace, cost, and stash data | Delete with the inspector; surviving contracts are already represented in dashboard shared types, Command Deck action inputs, and component-local props. | Covered |
| `usePipelinePhase.ts` | Derives inspector pipeline phase from issue/agent/review state | `src/dashboard/frontend/src/lib/pipeline-state.ts` is the redesigned shared classifier. | Covered |
| `usePipelinePhase.test.ts` | Tests for legacy pipeline phase derivation | Replacement assertions belong to `pipeline-state` consumers and PhaseTimeline/Pipeline tests. | Covered |
| `utils.ts` | Inspector formatting/helpers | Delete with the inspector unless a surviving redesigned component imports a helper; `workspace-9a7q` should move any remaining live helper before removal. | Covered |

## AgentList and GodView/AgentGrid deletion notes

| Legacy surface | Deletion condition | Status |
| --- | --- | --- |
| `AgentList.tsx` | `FleetAgentsView` renders a fleet grid with one `AgentCard` per live/stuck/idle agent, metrics, filters, stream excerpts, and issue drawer entry. Deacon status has moved to Health per PRD §4.1. | Covered |
| AgentList tests | `FleetAgentsView.test.tsx`, primitive `AgentCard` tests, and Command Deck action tests replace legacy AgentList assertions. | Covered |
| `GodView/AgentGrid.tsx` | PRD §3 keeps God View interior out of scope, but PRD §4.2/§6 says the Agents fleet grid replaces the old AgentGrid scan use case. Only `AgentGrid.tsx` is deleted; the rest of God View remains. | Covered |

## Cleanup decision

`workspace-9a7q` may proceed with deletion because the parity inventory is resolved: no row remains `Must confirm before deletion` or `Partially covered`. Rows marked `Out of scope` are deliberate PAN-1148 scope decisions; if those features need to return, track them as follow-up workspace-inspector or Command Deck beads rather than preserving the legacy InspectorPanel.
