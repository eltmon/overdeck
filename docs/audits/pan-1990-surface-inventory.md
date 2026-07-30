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

---

## 9. PAN-3286 additions (workspace parity with Subspace)

PAN-3286 is additive to everything above. No verb, flag, DTO field, route, or
component from the PAN-1990 inventory was removed or renamed; the two changes
that touch pre-existing behavior are called out explicitly at the end.

Mechanically gated by `tests/unit/dashboard/no-loss-audit-cli.test.ts`, whose
expected pre-change surface was extracted from
`packages/contracts/src/composer-commands.generated.ts` at this branch's
merge-base with `origin/main` — not written from memory. That test also asserts
every row below is present, and that this document mentions each one.

### 9.1 New `pan workspace` surface

| Surface | What it does |
| --- | --- |
| `pan workspace new --target-path <dir>` | Target any existing directory as the workspace path. Rejects `--isolated` (D-3), since a worktree defines its own path. |
| `pan workspace new --dry-run` | Print the resolved creation intent as JSON and create nothing (Subspace `workspaces plan` parity, D-4 — no separate `plan` verb). |
| `pan workspace relocate <ref> --path <dir>` | Point an existing workspace at a new existing directory (Subspace `workspaces update --relocate` parity). Refuses `kind=issue`; `kind=main` requires `--force` because it diverges the row from `projects.yaml` (D-5). |

### 9.2 New `pan memory` surface

| Surface | What it does |
| --- | --- |
| `pan memory search --target [path]` | Every non-archived workspace whose path targets a directory; bare flag = cwd. Mutually exclusive with `--workspace`/`--issue`/`--global`. |
| `pan memory status --workspace <id\|name>` | Address status by workspace instead of the issue positional. |
| `pan memory status --history <n>` | Current status, then archived statuses newest-first with their archive timestamp. Capped at 50; on-disk retention is 3. |
| `pan memory summary --workspace <id\|name>` | Same three addressing modes as `status`. |
| `pan memory timeline` | Chronological observations for a workspace (`--workspace`, `--days`, `--limit`, `--json`). |
| `pan memory read <path>` | Print a file from the workspace's memory home (`--workspace`, `--from`, `--lines`), containment-checked against that home. |

The `status <issue>` and `summary <issue>` positionals still exist — they became
*optional* rather than being removed, and the audit test asserts both are still
declared and now optional. Their output for a positional invocation is unchanged.

### 9.3 New DTO field

`GET /api/workspace-registry` rows gain `memoryPhase: string | null` — the
memory-synthesized phase for `main`/`scratch` rows, always `null` for `issue`
rows (which badge the pipeline phase instead). Every pre-existing list field is
unchanged; `tests/unit/dashboard/workspace-registry-memory-phase.test.ts`
asserts each one is still present.

### 9.4 Presentation change: pipeline worktrees collapse

The sidebar WORKSPACES rail and the Cmd-K `workspaces` scope now default to
`kind !== 'issue' || isFavorite`, with the hidden rows behind an expandable
"N pipeline worktrees" count row (state in
`overdeck.ui.sidebarWorkspacesPipelineExpanded`). Nothing is dropped: the API
still returns every kind, expanding the row reveals all of them, and issues stay
reachable through the Issues scope and the pipeline views.

### 9.5 Hygiene change: `rebuild-workspaces` archives terminal-issue rows

`pan admin db rebuild-workspaces` gains a pass that **archives — never deletes**
`kind='issue'` rows whose issue reached a terminal stage. The rows keep owning
their memory homes, remain readable through
`listWorkspaces({ includeArchived: true })`, and `unarchiveWorkspace` reverses
it. `--dry-run` writes nothing.

### 9.6 Two deliberate behavior changes (not losses)

- **Cross-workspace injection.** A prompt-time turn with no `issueId` used to get
  nothing in the sibling slot (PAN-1990 D-6). It now gets same-project hits from
  other workspaces, under the same sibling budget. Issue-turn rendering is
  unchanged, locked by a snapshot in `tests/lib/memory/injection.test.ts`.
- **SessionStart briefing.** The SessionStart hook response now carries a rendered
  briefing that the local hook script emits as `additionalContext`, at most once
  per session id. Every failure path returns the previous response unchanged.
