# PAN-1990 no-loss surface inventory

Enumerates the dashboard surface that existed on `origin/main` before PAN-1990
("First-class workspaces and projects with per-workspace memory") landed, so
its own changes can be checked against it. `tests/unit/dashboard/no-loss-audit.test.ts`
enforces every row mechanically — it fails if a row's target module/export
disappears without this file being updated with a `relocated:` marker.

Verified by diffing every file PAN-1990 touched against `origin/main`
(`git diff origin/main -- <file>`): every file below except the two brand-new
ones (`WorkspaceView.tsx`, `workspace-registry.ts`) shows **zero removed
lines** other than widened function signatures/union types picking up a new
optional param or member. Nothing was deleted; everything is additive.

## 1. Sidebar nav items (`src/dashboard/frontend/src/components/Sidebar.tsx`)

Pre-change: `PRIMARY_ITEMS` (3) + `MORE_GROUPS` (19 across 4 groups) = 22 tabs,
matching all 22 pre-change `TAB_PATHS` entries.

| Tab id | Label | Status |
|---|---|---|
| `home` | Home | unchanged (primary rail) |
| `flywheel` | Flywheel | unchanged (primary rail) |
| `orders` | Order Book | unchanged (primary rail) |
| `backlog` | Backlog | unchanged (More · Operations) |
| `command-deck` | Command Deck | unchanged (More · Operations) |
| `kanban` | Board | unchanged (More · Operations) |
| `pipeline` | Pipeline | unchanged (More · Operations) |
| `awaiting-merge` | Awaiting Merge | unchanged (More · Operations) |
| `agents` | Agents | unchanged (More · Operations) |
| `autopreso` | AutoPreso | unchanged (More · Operations) |
| `resources` | Resources | unchanged (More · Infrastructure) |
| `activity` | Activity | unchanged (More · Observability) |
| `sessions` | Sessions | unchanged (More · Observability) |
| `metrics` | Metrics | unchanged (More · Observability) |
| `costs` | Costs | unchanged (More · Observability) |
| `health` | Health | unchanged (More · Observability) |
| `deacon` | Deacon | unchanged (More · Observability) |
| `knowledge` | Knowledge | unchanged (More · System) |
| `skills` | Skills | unchanged (More · System) |
| `context` | Context | unchanged (More · System) |
| `settings` | Settings | unchanged (More · System) |
| `god-view` | God View | unchanged (More · System) |

New in PAN-1990: `workspace` tab (`/workspace/:id`, no nav-rail entry — reached
via the Sidebar's new "Workspaces" section, the Cmd-K palette, or a deep link)
and the Sidebar's new "Workspaces" section itself (above Projects). Neither
replaces or hides any row above; the Projects section and the collapsible
"More" section render exactly as before.

## 2. Kanban action

`KanbanBoard` (`src/dashboard/frontend/src/components/KanbanBoard.tsx`) —
`onSelectIssue` opens an issue via `onOpenIssue`/`openIssue`. Untouched by
PAN-1990 (zero diff lines vs `origin/main`).

## 3. vBRIEF viewer button

Two pre-change entry points, both untouched (zero diff lines vs `origin/main`):
- Kanban issue-card → `XBriefDialog`.
- Issue drawer's Plan tab → `DrawerPlanPanel` (`components/drawer/DrawerSecondaryPanels.tsx`)
  embeds `XBriefViewer` (`components/xbrief/XBriefViewer.tsx`).

**relocated:** the historical `InspectorPanel` component referenced in
`CLAUDE.md`/`docs/XBRIEF.md` as a third vBRIEF entry point no longer exists —
this predates PAN-1990 (see `docs/COMMAND-DECK-RESTORATION.md`'s "Gone (not
shells — replaced): InspectorPanel"). Its xBRIEF affordance's living successor
is the same `DrawerPlanPanel`/`XBriefViewer` pair above, already covered.

PAN-1990 adds a third, additive vBRIEF entry point: an issue-kind
`WorkspaceView` (`components/workspace/WorkspaceView.tsx`) renders
`XBriefViewer` + `VerificationGates` directly, reusing both components
unchanged.

## 4. Conversations panel entry points

`ConversationList` (`components/CommandDeck/ConversationList.tsx`) and
`ConversationPanel` (`components/chat/ConversationPanel.tsx`) — untouched
(zero diff lines vs `origin/main`). PAN-1990 adds a new consumer
(`WorkspaceView`) that reuses both via `ConversationList`'s existing
`includeIds` prop (cwd-prefix filtering) — no new prop was added to either
component.

## 5. Cost view

`CostsPage` (`components/CostsPage.tsx`), reached via the `costs` tab —
untouched (zero diff lines vs `origin/main`).

## 6. Terminal access path

`XTerminal` (`components/XTerminal.tsx`) and its wrapper `TerminalPanel`
(`components/TerminalPanel.tsx`) — untouched (zero diff lines vs
`origin/main`). PAN-1990 adds a new consumer (`WorkspaceView`, issue-kind
workspaces only) that renders `XTerminal` directly with `sessionName =
agent.id`, the same convention `TerminalPanel` already documents.

## 7. Command palette (Cmd-K) sections

`CommandPalette` (`components/CommandPalette.tsx`) — pre-change sections:
Actions/Orchestration/Navigation, Commands (`pan` catalog), Active
Workspaces/Issues/Running Agents, Conversations, Memory/Observations. All
preserved (the file's only removed lines are the `PaletteScope` union and a
few arrays widened to include the new `workspaces` scope — same shape as the
prior two extensions, per the file's own history comment). New in PAN-1990: a
"Workspaces" section/scope for the workspace-registry switcher, additive.

## 8. Domain events (`packages/contracts/src/events.ts`)

Every event payload type that carried `issueId` before PAN-1990 still does;
none were renamed or removed. PAN-1990 added an optional `workspaceId` field
alongside `issueId` on ~40 event types — `packages/contracts/src/events.test.ts`
locks decode-compatibility for both the old (no `workspaceId`) and new (with
`workspaceId`) payload shapes for a representative sample across every
structural family (plain top-level, nested struct, already-optional issueId,
nested `ReviewStatusSnapshot`).
