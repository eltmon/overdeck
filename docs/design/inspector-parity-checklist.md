# InspectorPanel parity checklist

This checklist gates deletion of the legacy inspector surfaces in PAN-1148. `InspectorPanel.tsx`, `components/inspector/*`, `AgentList`, and `GodView/AgentGrid` can only be removed after every legacy feature below has a destination in the redesigned dashboard or an explicit out-of-scope decision.

## Deletion gate

- [ ] `src/dashboard/frontend/src/components/InspectorPanel.tsx` is removed only after all InspectorPanel feature rows below are mapped.
- [ ] `src/dashboard/frontend/src/components/InspectorPanel.test.tsx` is removed with the component.
- [ ] `src/dashboard/frontend/src/components/inspector/*` is removed only after each sub-file row below is mapped.
- [ ] `src/dashboard/frontend/src/components/AgentList.tsx` and its tests are removed only after agent list/grid parity is covered by the redesigned Agents surface.
- [ ] `src/dashboard/frontend/src/components/GodView/AgentGrid.tsx` is removed; the rest of `GodView/*` remains unless separately approved.
- [ ] `grep -r InspectorPanel src/` returns zero results after deletion.
- [ ] `grep -r AgentList src/` returns zero results after deletion.
- [ ] `npm run typecheck` passes after deletion.
- [ ] `npm test` passes after deletion.

## InspectorPanel feature inventory

| Legacy feature | Legacy source | New home | Status |
| --- | --- | --- | --- |
| Issue drawer shell with issue ID, title, and close affordance | `InspectorPanel.tsx` header | `IssueDrawer` header | Covered |
| Pipeline phase chip / phase label | `InspectorPanel.tsx`, `TerminalTabs.tsx` phase constants | Drawer overview `PhaseTimeline` plus redesigned issue row/status chips | Covered |
| Open terminal button from inspector header | `InspectorPanel.tsx` header actions | Drawer `Terminal` tab / command deck terminal affordance | Must confirm before deletion |
| Issue title, status, priority, and labels | `InspectorPanel.tsx` issue metadata block | Drawer overview issue summary or redesigned board issue card | Must confirm before deletion |
| TTS mute/unmute for an issue | `InspectorPanel.tsx` issue actions | Command Deck or issue-level controls outside drawer | Must confirm before deletion |
| Assignee display and sensitive email display | `InspectorPanel.tsx` issue metadata | Drawer overview issue summary or board detail metadata | Must confirm before deletion |
| Pipeline stuck banner with recovery action | `InspectorPanel.tsx` stuck/recover banner | Drawer overview `VerificationGates` / action bar recovery destination | Must confirm before deletion |
| Pending review stranded banner | `InspectorPanel.tsx` review status warnings | Drawer overview review specialists / verification gates | Must confirm before deletion |
| Merged issue summary for no-workspace merged issues | `InspectorPanel.tsx`, `MergedSummaryCard.tsx` | Drawer overview merged/phase state or board done state | Must confirm before deletion |
| No workspace / no agent status messaging | `InspectorPanel.tsx` empty states | Drawer overview empty states or issue row workspace state | Must confirm before deletion |
| Workspace stack broken banner | `InspectorPanel.tsx`, workspace stack health fields | Drawer files/activity area or command deck workspace health surface | Must confirm before deletion |
| Awaiting input banner with prompt and attach terminal action | `InspectorPanel.tsx` awaiting-input state | Drawer active agent card with stream / Tell input and terminal tab | Covered by drawer Active Agent + Terminal plan |
| Agent runtime/model/uptime/session summary | `AgentInfoSection.tsx` | Drawer active agent card | Covered |
| Git branch, uncommitted count, latest commit, sync with main action | `AgentInfoSection.tsx` | Drawer files/activity tab or command deck workspace actions | Must confirm before deletion |
| Workspace path, VS Code link, and open-in picker | `AgentInfoSection.tsx` | Drawer files tab or command deck workspace actions | Must confirm before deletion |
| Workspace location badge for no-agent workspaces | `AgentInfoSection.tsx` | Drawer overview workspace metadata | Must confirm before deletion |
| Activity summary | `InspectorPanel.tsx` activity block | Drawer `Activity` tab and `DrawerActivityRail` | Covered |
| Swarm slots summary | `InspectorPanel.tsx` swarm slots block | Agents surface / command deck agents summary | Must confirm before deletion |
| Reviewer summary | `InspectorPanel.tsx` reviewer summary block | Drawer overview `DrawerReviewSpecialists` | Covered |
| Review pipeline stepper and notes | `ReviewPipelineSection.tsx` | Drawer overview `DrawerVerificationGates`, `DrawerReviewSpecialists`, and phase timeline | Partially covered; notes/history need confirmation |
| Pull request link and status | `InspectorPanel.tsx` PR block | Drawer action bar `View PR` plus merge state | Covered |
| Links to issue and PRD | `InspectorPanel.tsx` links block | Drawer files/overview artifact links | Must confirm before deletion |
| Cost summary | `InspectorPanel.tsx`, `IssueCostData` | Command Deck / Agents surface cost summary | Must confirm before deletion |
| Corrupted workspace warning | `InspectorPanel.tsx`, `WorkspaceInfo.corrupted` | Drawer files/workspace health area or command deck workspace health | Must confirm before deletion |
| Service URLs | `InspectorPanel.tsx`, `WorkspaceInfo.services` | Drawer files/workspace tab or command deck services list | Must confirm before deletion |
| Start containers action | `InspectorPanel.tsx`, `ContainerSection.tsx` | Command Deck workspace controls | Must confirm before deletion |
| Containerize action | `InspectorPanel.tsx`, workspace actions | Command Deck workspace controls | Must confirm before deletion |
| Container status pills and expanded details | `ContainerSection.tsx` | Command Deck workspace health / services surface | Must confirm before deletion |
| Container right-click context menu | `ContainerSection.tsx` | Command Deck container controls | Must confirm before deletion |
| Start / stop / restart individual containers | `ContainerSection.tsx` | Command Deck container controls | Must confirm before deletion |
| Refresh database action for Postgres | `ContainerSection.tsx` | Command Deck container controls | Must confirm before deletion |
| Tmux attach command and copy action | `InspectorPanel.tsx` terminal section | Drawer terminal tab / command deck terminal surface | Must confirm before deletion |
| Salvageable stashes recovery and dismissal | `InspectorPanel.tsx` stash section | Drawer files/workspace tab or command deck workspace inspector | Must confirm before deletion |
| Merge action | `ActionsSection.tsx`, `MergeButton` | Drawer action bar `Merge to main` | Covered |
| Review & Test / Re-review / Re-request Review actions | `ActionsSection.tsx` | Drawer action bar or command deck issue actions | Must confirm before deletion |
| Stop Agent action | `ActionsSection.tsx`, `StopAgentButton` | Drawer action bar `Stop agent` | Covered |
| Switch Model action and modal | `ActionsSection.tsx` | Agents surface / command deck agent controls | Must confirm before deletion |
| Recover action | `ActionsSection.tsx`, `RecoverButton` | Drawer overview recovery affordance or command deck actions | Must confirm before deletion |
| Start / resume agent action | `ActionsSection.tsx` | Command Deck issue actions | Must confirm before deletion |
| Harness picker | `ActionsSection.tsx` | Command Deck / settings-backed start controls | Must confirm before deletion |
| Reset Session action | `ActionsSection.tsx` | Drawer action bar reset only if semantics match; otherwise command deck | Must confirm before deletion |
| Create Workspace action | `ActionsSection.tsx` | Command Deck workspace actions | Must confirm before deletion |
| Copy Settings action | `ActionsSection.tsx` | Command Deck/settings surface | Must confirm before deletion |
| Feature-only Plan action | `ActionsSection.tsx` | Command Deck issue actions | Must confirm before deletion |
| Resume message input | `ActionsSection.tsx` | Drawer active agent Tell input | Covered |
| Action error/success states | `ActionsSection.tsx` | DialogProvider alerts / command deck action feedback | Must confirm before deletion |
| Artifact links for Plan, vBRIEF, and Beads | `ActionsSection.tsx`, `ArtifactLinks` | Drawer tabs: Plan, Beads, Files | Covered by destination tabs; content parity must be implemented before deletion |
| Danger Zone reopen action | `ActionsSection.tsx` | Command Deck issue actions | Must confirm before deletion |
| Danger Zone restart from plan action | `ActionsSection.tsx`, `RestartFromPlanButton` | Command Deck issue actions | Must confirm before deletion |
| Danger Zone reset issue action | `ActionsSection.tsx`, `ResetIssueButton` | Drawer action bar `Reset` if destructive confirmation semantics match | Covered for reset entry point; must confirm danger-zone copy/semantics |
| Danger Zone cancel issue action | `ActionsSection.tsx` | Command Deck issue actions | Must confirm before deletion |
| Extra labels and tags | `InspectorPanel.tsx` metadata/tags | Drawer overview issue summary or board cards | Must confirm before deletion |

## Inspector sub-file inventory

| File | Legacy responsibility | New home / deletion rationale | Status |
| --- | --- | --- | --- |
| `ActionsSection.tsx` | Inspector action groups, issue actions, danger zone, artifact links, resume message input | Split between Drawer action bar, drawer tabs, active-agent Tell input, and Command Deck issue actions | Partially covered; command-deck-only actions must be confirmed |
| `ActionsSection.test.tsx` | Tests for legacy inspector action behavior | Delete with `ActionsSection.tsx`; replacement behavior must be covered by drawer/action tests and command deck tests | Must confirm replacement tests |
| `AgentInfoSection.tsx` | Agent, git, and workspace metadata blocks | Drawer active agent card for agent state; Files/workspace or Command Deck for git/workspace actions | Partially covered |
| `AgentInfoSection.test.tsx` | Tests for legacy agent info blocks | Delete with `AgentInfoSection.tsx`; replacement assertions belong with drawer active-agent/files tests | Must confirm replacement tests |
| `ContainerSection.tsx` | Container status, menu, controls, and database refresh UI | Command Deck workspace/container controls | Must confirm before deletion |
| `ContainerSection.test.tsx` | Tests for legacy container section | Delete with `ContainerSection.tsx`; replacement assertions belong with command deck workspace tests | Must confirm replacement tests |
| `MergedSummaryCard.tsx` | Merged issue summary for completed/no-workspace view | Drawer overview phase/merged state or board done-state summary | Must confirm before deletion |
| `MergedSummaryCard.test.tsx` | Tests for merged summary card | Delete with `MergedSummaryCard.tsx`; replacement assertions belong with drawer/board completed-state tests | Must confirm replacement tests |
| `ReviewPipelineSection.tsx` | Build/review/test/merge stepper, verification cycles, CI checks, merge queue, specialist logs, collapsible notes, status history | Drawer verification gates, review specialists, phase timeline, and activity/history surfaces | Partially covered; details/history/CI rollup need confirmation |
| `ReviewPipelineSection.test.tsx` | Tests for review pipeline rendering | Delete with `ReviewPipelineSection.tsx`; replacement assertions belong with drawer verification/review/activity tests | Must confirm replacement tests |
| `StatusHistory.tsx` | Renders review status history entries | Drawer activity tab / activity rail | Must confirm before deletion |
| `StatusHistory.test.tsx` | Tests for status history rendering | Delete with `StatusHistory.tsx`; replacement assertions belong with activity tab tests | Must confirm replacement tests |
| `TerminalSessionWrapper.tsx` | Legacy terminal session wrapper for inspector terminal flows | Drawer terminal tab / command deck terminal | Must confirm before deletion |
| `TerminalSessionWrapper.test.tsx` | Tests for terminal wrapper behavior | Delete with wrapper; replacement assertions belong with terminal tab tests | Must confirm replacement tests |
| `TerminalTabs.tsx` | Phase labels/colors and terminal tab UI/constants | Phase timeline/status chips and drawer terminal tab | Partially covered |
| `TerminalTabs.test.tsx` | Tests for terminal tabs/phase behavior | Delete with `TerminalTabs.tsx`; replacement assertions belong with drawer tabs/terminal tests | Must confirm replacement tests |
| `types.ts` | Legacy inspector prop/data contracts for review, containers, workspace, cost, and stash data | Delete when no legacy inspector imports remain; surviving contracts should move to shared dashboard types only if still used | Must confirm no imports remain |
| `usePipelinePhase.ts` | Derives inspector pipeline phase from issue/agent/review state | Phase timeline / issue row pipeline status derivation | Must confirm before deletion |
| `usePipelinePhase.test.ts` | Tests for legacy pipeline phase derivation | Delete with hook; replacement assertions belong with phase timeline/status tests | Must confirm replacement tests |
| `utils.ts` | Inspector formatting/helpers | Delete when no inspector imports remain; move only helpers still used by redesigned surfaces | Must confirm no imports remain |

## AgentList and GodView/AgentGrid deletion notes

| Legacy surface | Deletion condition | Status |
| --- | --- | --- |
| `AgentList.tsx` | Redesigned Agents surface covers active/stopped agents, status, harness/model/session identity, issue association, and primary agent actions | Must confirm before deletion |
| AgentList tests | Replacement Agents surface tests cover list rendering, state changes, and actions | Must confirm before deletion |
| `GodView/AgentGrid.tsx` | Redesigned Agents or Command Deck grid covers the same agent-card scan use case; only `AgentGrid.tsx` is deleted and the rest of GodView remains | Must confirm before deletion |

## Cleanup decision

Do not proceed with `workspace-9a7q` deletion while any row above is `Must confirm before deletion` or `Partially covered` unless the row is deliberately changed to `Out of scope` with a reason in this document.
