# Issue View Kit

The issue view kit gives the dashboard one semantic issue surface at three densities: the project-tree rail, the cockpit, and the full console drawer. Each shell keeps its own navigation and layout behavior, but shared issue data, status semantics, and operator actions belong in `src/dashboard/frontend/src/components/issue-view/` rather than being reimplemented per shell.

## Data model

`IssueViewModel` is a derived, read-only view model with `header`, `narrative`, `pipeline`, `agents`, `verification`, `ship`, `activity`, `resources`, and `operator` groups. `useIssueView` builds it by composing the existing review-status, cost, workspace, activity, and ship-log query hooks plus the dashboard store's agent selector. Tasks remain owned by the canonical `TasksPanel`, `TasksRail`, and `TasksTab` queries so the issue view does not fabricate a second task model. It must reuse those hooks and their query keys; it must not introduce another endpoint, polling loop, store, or direct canonical-state access. Writes continue through the domain's existing write door.

## Shared components

The kit currently owns these reusable pieces:

- `IssueView` is the semantic boundary used by all three shells. `IssueViewFullscreenButton` and `RailShipProgress` provide the shared promotion and compact ship controls.
- `AgentStepRow` renders work, review, test, and ship sessions with the same status, model, cost, verdict, and operator affordances.
- `ActiveAgentPanel` renders selected-agent metadata plus resume and message actions; the rich transcript stays in the Session surface.
- `TellComposer` is the shared message form used by `ActiveAgentPanel`; the Session transcript keeps its own selected-agent composer inside `IssueDetail`, so one visible conversation cannot send to another agent.
- `NeedsYouSlot` prioritizes one operator decision. Shared issue actions use the registry; cockpit-specific alerts use the existing exact-agent and review-unstick simple actions, leaving the protected `IssueActionMenu` subsystem unchanged.
- `RunDetailsCard` presents the active role, model, harness, start time, and workspace from `IssueViewModel`.
- `ShipProgress` renders compact and full merge/verification progress.
- `VerificationGates` renders the current verification cycle and gate results.
- `TasksPanel`, `TasksRail`, and `TasksTab` retain the canonical PAN-2696 task-status semantics. Collapsed rail rows use the shared `taskTotals` rollup and never poll task detail per issue.
- `StartAgentCta` selects one start, clear-and-start, or resume mode. Its issue-view form includes model and harness overrides; the kanban chip and Fleet inline forms deliberately do not.

`useIssueView`, `IssueViewModel`, the shared derivations, and the public components are exported through `components/issue-view/index.ts`.

## Density model

`densitySections.ts` owns `DENSITY_SECTIONS`, the declarative membership map for `rail`, `cockpit`, and `console`. Density changes layout and section visibility; it does not create three component trees or three versions of status logic. A shell wraps its existing routing and interaction glue around `<IssueView density="…">`.

### Cockpit layout

The cockpit is organized around the live run. Its header carries one phase sentence plus branch, PR, cost, tracker, and shared issue actions; a prioritized `NeedsYouSlot` appears immediately below it when the operator must answer or intervene. `CockpitPhaseRail` follows with live actor, model, harness, start-time, and duration metadata driven by the shared reactive tick; clicking an occupied phase opens that exact session id. It is cockpit-only: the console/drawer `IssuePhaseRail` and the default filled idle `StatusDot` keep their frozen behavior, while cockpit rows opt into the hollow idle and outcome colors. The persistent tab band has exactly six destinations:

- **Overview** — lifecycle summary, review-specialist outcomes, recent events, pickup state, and the full Ship progress/log surface. It has explicit live, merged, and pre-work teaching states.
- **Session** — Conversation and Terminal are view modes of one agent-session surface. The drawer/page `IssueDetail` tab strip exposes one Session destination, and both that surface and the cockpit embed switch modes with the shared segmented `components/shared/ViewToggle.tsx` control. `ConversationPanel` and `FlywheelConversationPane` use the same selector, while `IssueDetail` owns selected-agent state and the single transcript composer.
- **Plan** — Tasks, dependency Map, and PRD segments. The tab owns the task count and the map retains its full-screen xBRIEF promotion; there is no floating Tasks chip or task drawer.
- **Changes** — Files, Checks, and Artifacts segments, with the existing check-state badge on the parent tab.
- **Activity** — Feed and Status history segments.
- **Discussion** — the canonical discussion surface.

Legacy `?tab=` values keep working: `?tab=conversation` and `?tab=terminal` open the consolidated Session surface in the matching view mode, while Tasks, Code, Files, Artifacts, Timeline, Costs, and Ship normalize into the other five destinations. Costs opens Overview with the persistent cost rail available, while Ship opens Overview with the full merge progress and live log visible. When no route selection is present, an issue with any session opens Session; an issue without a run opens Overview.

The conversation panel distinguishes loading from settled empty states. The awaiting-payload skeleton means the transcript has not arrived and makes no claim about its contents. “How can I help you?” means the first payload arrived and confirmed an empty live conversation. “Starting…” means a new session remains within its spawn window. The orphaned state means a non-live session loaded with no saved activity. The fetch-failed state offers Retry because the request failed and the saved history may remain intact.

The body uses a collapsible crew spine, a main tab workspace, and a persistent awareness rail. The crew spine nests review specialists beneath Review and uses one semantic status signal per row. The awareness rail keeps Now, Run details, Gates, Cost, Environment, and Recent activity visible; its links promote the full cost rollup or switch to Activity. On narrower containers the rail reflows below the spine and main workspace rather than disappearing. See the [cockpit redesign v2 mockup](../design/issue-detail-redesign-mockup-v2.html).

To add or move an issue-view section without losing an existing surface:

1. Add the legacy or new section to `inventory.ts`, including its density and owning component. If it is a sub-section of a shared component, add it to that component's section constant and therefore `SECTION_INVENTORY`.
2. Add the section name to every intended density in `DENSITY_SECTIONS`.
3. Render the matching `data-section` attribute on the real visible element. Do not satisfy the gate with hidden marker elements.
4. Add or update the component test, then run `tests/unit/dashboard/frontend/issue-view-no-loss.test.ts` and `IssueView.test.tsx`.

The no-loss tests are a surface lock. The root test fixes the historical inventory, requires unique names and valid owning files, and fails when an old surface disappears. The frontend render test requires every inventory entry to have a declared density and rejects hidden section markers. A refactor is complete only when each old action, status, route, view, and affordance still has a real home.

### Full-screen artifact overlays

The xBRIEF expand controls stay inside the existing `DrawerPlanPanel / XBriefViewer` and `PlanMapCard` sections. They set `xbriefViewerIssueId`, which opens the globally mounted `XBriefFullscreen` overlay above the current issue surface. The overlay is an interaction layer, not another density section, so it does not belong in `ISSUE_VIEW_INVENTORY` or `DENSITY_SECTIONS`.

The tasks and PRD resource chips follow the same global-mount pattern with their own store fields. Keep the originating chip or expand control inside its protected section, and keep overlay hosts beside `IssueDrawer` in `App.tsx`.

## Issue action registry contract

Every issue-action surface renders from the single executable registry in `src/dashboard/frontend/src/lib/issueActions.ts`. Surfaces declare only their presentation: `grouped-panel` for the cockpit popover, `grouped-context` for right-click menus, `primary-strip` for phase-primary buttons with grouped overflow, `overflow-only` where only the grouped menu is shown, and pinned slots for declared registry actions or React controls such as the drawer merge button. Action identity, availability, grouping, ordering, descriptions, confirmation, and invocation remain registry-owned.

Registry actions may expose option submenus through `IssueActionView.submenu`. The `requestReview` action uses that contract for Full, Quick, and None review-mode selection, so choosing a mode both saves it and requests review in one interaction. Primary-strip buttons render the options in a popover; grouped and context-menu surfaces render the same options as an expandable sub-list. Both presentations remain covered by the cross-surface parity gate below.

The Recover group includes `resyncPipelineState`, the never-gated action backed by `pan review resync <id>` and `POST /api/review/:id/resync`. It re-emits the canonical review status without changing a verdict, so operators can repair stale action gating even when the stale state itself would disable other recovery paths.

`src/dashboard/frontend/src/lib/__tests__/issue-actions-surface-parity.test.tsx` is the cross-surface parity gate. It compares each rendered surface with an explicit registry-derived oracle, including legitimate rail and Zone B session actions and declared pinned controls, so a surface-local action, gating change, order drift, or missing extra fails the test.

The PAN-2499 inventory records action-renderer relocations separately from each visible shell's stable `home`, so `IssueActionMegaMenu`, `FeatureContextMenu`, and `DrawerActionBar` retain their protected sections while their shared renderer ownership is explicit. No Mintlify surface documents action menus as of the 2026-07-15 verification; that omission is deliberate, so this developer contract is the documentation owner.

## Protected issue-row action menu

`FeatureContextMenu (issue-row right-click)` is a protected rail inventory surface. `FeatureItem.tsx` renders it through the shared `GroupedIssueActionMenu`, which derives its semantic sections from the issue-action registry's `GROUP_ORDER`; changes must preserve its matching visible `data-section` marker and no-loss inventory entry.

## Recovery start contract

`StartAgentCta` derives availability from the shared issue actions and operator state:

- A startable issue posts to `POST /api/agents` with its issue and project IDs.
- A stopped resumable session posts to `POST /api/agents/:agentId/resume`.
- A paused or troubled issue asks for confirmation, names the gate being cleared, and then posts to `POST /api/agents` with `clearGates: true`.
- A running issue renders no start CTA, and a failed request remains visible as an inline error.

The server honors `clearGates` only for a trusted operator-origin request. It clears paused and troubled state through the same shared intervention doors used by the CLI, emits the corresponding intervention event, and refuses a gated spawn when the flag is absent. Do not clear agent state directly in a route or UI component.
