# Issue View Kit

The issue view kit gives the dashboard one semantic issue surface at three densities: the project-tree rail, the cockpit, and the full console drawer. Each shell keeps its own navigation and layout behavior, but shared issue data, status semantics, and operator actions belong in `src/dashboard/frontend/src/components/issue-view/` rather than being reimplemented per shell.

## Data model

`IssueViewModel` is a derived, read-only view model with `header`, `narrative`, `pipeline`, `agents`, `verification`, `ship`, `beads`, `activity`, `resources`, and `operator` groups. `useIssueView` builds it by composing the existing review-status, cost, workspace, activity, and ship-log query hooks plus the dashboard store's agent selector. It must reuse those hooks and their query keys; it must not introduce another endpoint, polling loop, store, or direct canonical-state access. Writes continue through the domain's existing write door.

## Shared components

The kit currently owns these reusable pieces:

- `IssueView` is the semantic boundary used by all three shells. `IssueViewFullscreenButton` and `RailShipProgress` provide the shared promotion and compact ship controls.
- `AgentStepRow` renders work, review, test, and ship sessions with the same status, model, cost, verdict, and operator affordances.
- `ActiveAgentPanel` renders the selected live session stream and its resume and message actions.
- `ShipProgress` renders compact and full merge/verification progress.
- `VerificationGates` renders the current verification cycle and gate results.
- `BeadsPanel` renders task progress in compact or full form.
- `StartAgentCta` selects one start, clear-and-start, or resume mode. Its issue-view form includes model and harness overrides; the kanban chip and Fleet inline forms deliberately do not.

`useIssueView`, `IssueViewModel`, the shared derivations, and the public components are exported through `components/issue-view/index.ts`.

## Density model

`densitySections.ts` owns `DENSITY_SECTIONS`, the declarative membership map for `rail`, `cockpit`, and `console`. Density changes layout and section visibility; it does not create three component trees or three versions of status logic. A shell wraps its existing routing and interaction glue around `<IssueView density="…">`.

To add or move an issue-view section without losing an existing surface:

1. Add the legacy or new section to `inventory.ts`, including its density and owning component. If it is a sub-section of a shared component, add it to that component's section constant and therefore `SECTION_INVENTORY`.
2. Add the section name to every intended density in `DENSITY_SECTIONS`.
3. Render the matching `data-section` attribute on the real visible element. Do not satisfy the gate with hidden marker elements.
4. Add or update the component test, then run `tests/unit/dashboard/frontend/issue-view-no-loss.test.ts` and `IssueView.test.tsx`.

The no-loss tests are a surface lock. The root test fixes the historical 44-section inventory, requires unique names and valid owning files, and fails when an old surface disappears. The frontend render test requires every inventory entry to have a declared density and rejects hidden section markers. A refactor is complete only when each old action, status, route, view, and affordance still has a real home.

## Recovery start contract

`StartAgentCta` derives availability from the shared issue actions and operator state:

- A startable issue posts to `POST /api/agents` with its issue and project IDs.
- A stopped resumable session posts to `POST /api/agents/:agentId/resume`.
- A paused or troubled issue asks for confirmation, names the gate being cleared, and then posts to `POST /api/agents` with `clearGates: true`.
- A running issue renders no start CTA, and a failed request remains visible as an inline error.

The server honors `clearGates` only for a trusted operator-origin request. It clears paused and troubled state through the same shared intervention doors used by the CLI, emits the corresponding intervention event, and refuses a gated spawn when the flag is absent. Do not clear agent state directly in a route or UI component.
