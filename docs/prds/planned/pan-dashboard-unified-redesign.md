# Panopticon Dashboard — Unified Redesign

> **Status:** Design complete · Awaiting PAN issue · Author: Opus 4.7 pass · 2026-05-16
> **Mockups (canonical):** [`docs/design/mockups/system-map-opus.html`](../../design/mockups/system-map-opus.html) (entry point — links to all five surface mocks)
> **Style guide:** [`design/style-guide/STYLE-GUIDE.md`](../../../design/style-guide/STYLE-GUIDE.md)

---

## 1. Problem

The dashboard has accreted six operationally distinct destinations — Command Deck, Board, Awaiting Merge, Agents, Activity, God View — each with its own vocabulary, card shape, color usage, and mental model. The surfaces tell the same story (issues moving through a pipeline, agents acting on them) but say it in different dialects:

- **Board** cards expose configuration controls (Harness picker, Agent model, Start button) on every row, optimizing for "configure-then-launch" — a flow that's already been moved to dedicated planning. Cards are config-dense and status-thin.
- **Agents** is two pages glued together: a `AgentList` for the Deacon and specialists, and a separate `GodView` grid for work agents. Neither surfaces stuck agents, idle convoys, or fleet-level cost in a unified way.
- **Awaiting Merge** is a standalone route for a state that's better expressed as a badge on the issue everywhere else.
- **Command Deck** is the one surface users consistently like — but its right pane is a single-purpose conversation viewer, not a project drill-down.
- **God View** is cinematic but isolated from the rest of the IA, and uses its own scoped tokens that drift from the style guide.

The split forces operators to mentally translate between dialects (a card "in review" on Board ≠ a Deacon "review specialist" on Agents ≠ a `READY TO MERGE` row on Awaiting Merge — but they're the same state). It also makes every redesign a per-surface effort rather than a system-wide investment.

## 2. Goal

**One vocabulary, one row, one drawer — used everywhere.**

Replace the six destinations with **four operations lenses** on the same data, plus a single shared **Issue Detail drawer** that opens from any of them. Use the canonical Panopticon style guide for every surface (no scoped overrides except God View).

The four lenses:

| Lens | Question it answers | Shape |
|---|---|---|
| **Pipeline** | "What's happening right now, across everything?" | Cross-project list grouped by lifecycle phase |
| **Board** | "Where are cards stacked? Let me re-prioritize quickly." | Column-per-phase kanban (read-mostly) |
| **Command Deck** | "Drill into a single project's full surface area." | Project tree + per-project lens |
| **Agents** | "Which agents are running? Any stuck? Show me their streams." | Fleet grid, one card per running agent |

The drawer:

- **Issue Detail** opens from any row or card on any lens. Holds the phase timeline, active agent with live stream, beads, verification gates, review specialist verdicts, and live activity rail. The single deep-dive surface — kanban modals, agent modals, conversation popouts all consolidate into it.

The IA collapses to: **Operations** (the four lenses) · **Observability** (Activity, Costs, Health) · **System** (Skills, Settings, God View). Awaiting Merge is retired — `READY TO MERGE` becomes a verb badge that surfaces in Pipeline and Board.

## 3. Non-Goals

- **Drag-to-phase on Board.** The current implementation has been unsupported for some time and is not coming back. Phase transitions are driven by agent state, not by hand. Board's `Phase` columns are visual buckets only; dragging a card has no effect on its phase. (We can keep drag-to-reorder within a column for prioritization, but no cross-column drop.)
- **God View redesign.** Out of scope. God View keeps its scoped typography and effects (per style-guide §1.4 / §15). It will gain the new sidebar entry but its interior stays as-is.
- **Mintlify-published mock URLs.** Mockups remain repo-internal HTML; no Mintlify embed work in this initiative.
- **New issue-tracker integrations.** Read paths remain GitHub + Linear as today.
- **Mobile / small-screen support.** The dashboard is desktop-first; this redesign continues that posture.

## 4. Design

### 4.1 Information Architecture

```
Operations
├── Pipeline          ← new default landing
├── Board             ← redesigned
├── Command Deck      ← refreshed, project tree kept
└── Agents            ← wholesale replacement (fleet view)

Observability
├── Activity
├── Costs
└── Health

System
├── Skills
├── Settings
└── God View
```

**What changed from today**

- **Pipeline (new)** — takes the default-landing slot from Board. Cross-project rollup grouped by lifecycle phase (Ship · Review · Work · Plan · Todo), with one row per issue including its active agent's name, model, role, and runtime.
- **Board** — same kanban metaphor, redesigned card. Configuration controls (Harness, Agent model, Start) pulled off the card; they now live in Issue Detail. Card is status-only.
- **Command Deck** — keeps the project tree (the surface users explicitly like). Right pane is reframed as a *per-project lens* that mirrors Pipeline filtered to one project, plus tabs for Plans, Beads, Conversations, Activity, Settings.
- **Agents** — was issue-grouped (or split across `AgentList` + `GodView`). Becomes fleet-centric: one card per *running* agent, with stream excerpt, model meta, idle/stuck emphasis, and a back-link into Issue Detail.
- **Awaiting Merge** — retired as a route. `READY TO MERGE` is a verb badge already visible in Pipeline and Board's Ship column.

**What's preserved**

- Project tree in Command Deck (unchanged shape, refreshed styling).
- The "swarm rollup" that nests review specialists under their parent issue — preserved in two places: as the convoy agent card in Agents view, and as the *Review specialists* section inside Issue Detail.
- Deacon status — moved to **Health**.

### 4.2 Five Surfaces (canonical mockups)

| Surface | Mockup file | Notes |
|---|---|---|
| Pipeline | [`pipeline-cross-project-opus.html`](../../design/mockups/pipeline-cross-project-opus.html) | Default landing |
| Board | [`board-opus.html`](../../design/mockups/board-opus.html) | Replaces today's kanban |
| Command Deck | [`pipeline-command-deck-opus.html`](../../design/mockups/pipeline-command-deck-opus.html) | Tree + drilldown |
| Agents | [`agents-opus.html`](../../design/mockups/agents-opus.html) | Replaces `AgentList` + `GodView` grid |
| Issue Detail | [`issue-detail-opus.html`](../../design/mockups/issue-detail-opus.html) | Shared slide-out shell |
| System map | [`system-map-opus.html`](../../design/mockups/system-map-opus.html) | Documents the whole IA |

The mocks are the binding visual spec. Where this PRD and a mock disagree, the **mock wins for visual layout**; the **PRD wins for behavior and data contracts**.

### 4.3 Shared Primitives

Three components carry the redesign. Every surface composes them.

#### Issue Row (used in Pipeline, Command Deck, search results)

```
┌──┬─────────┬──┬─────────────────────────────────────────┬─────────────────┬────────┬───┐
│ ▌│ PAN-1052│ ● │ Activity feed: per-turn observations  ⊕│ agent-pan-1052  │ 19 min │ ⓔ │
│ ▌│         │   │ dashboard · observability             │ opus-4-7 · ship │ $0.81  │   │
└──┴─────────┴──┴─────────────────────────────────────────┴─────────────────┴────────┴───┘
  ▲    ▲       ▲    ▲                              ▲           ▲                ▲      ▲
  │    │       │    │                              │           │                │      └── assignee
  │    │       │    │                              │           │                └── ledger: runtime (mono, muted) over cost (mono, cyan)
  │    │       │    │                              │           └── agent meta (mono)
  │    │       │    │                              └── verb badge (one per row)
  │    │       │    └── title + label row (taxonomy labels only)
  │    │       └── pipeline-phase glyph
  │    └── issue id (mono)
  └── priority left border heat-map
```

**Grid:** `14px 78px 14px 1fr 220px 84px 26px` (priority · id · phase glyph · title · agent · ledger · avatar)

**The ledger cell** stacks runtime over cost vertically — these two derived measurements are always co-located. Runtime in `text-muted-foreground`, cost in `text-signal-cost-foreground` (cyan, per the style-guide rule that money always uses signal-cost). When no agent is active, both rows show `—`.

**Color rules:** priority sets the left-border heat (destructive · warning · muted · transparent); the verb badge and the cost figure are the only colored elements to the right of the title; labels are always neutral. The cost figure is the single style-guide-mandated exception to "one colored signal per row" — currency must always render in cyan regardless of context.

#### Issue Card (used only in Board)

The same row data, laid out vertically with a bead-progress strip:

- Row 1: project mark + ID + verb badge
- Row 2: title (2-line clamp)
- Row 3: label chips
- Progress: `Beads N/M` + thin progress bar (color matches phase)
- Footer: agent name · model · runtime · avatar

Left-border heat-map identical to Issue Row.

#### Issue Detail (slide-out drawer, used everywhere)

```
[Phase timeline: Triaged ─ Planned ─ Implemented ─ Reviewed ─ ⊙ Shipping ─ Merged]
[Tabs: Overview · Plan · Beads N/M · Conversation · Terminal · Activity · Files]

Main column                                      │ Live activity (right rail)
─────────────────────────────────────────────────┼─────────────────────────
Active agent (name, verb badge, model, runtime, │ ● Ship pushed feature/...
spend, live stream excerpt, Tell input)         │ ● Opened PR #1052
                                                │ ● Rebase clean
Verification gate (typecheck/lint/test/UAT)     │ ● Review approved
Beads (closed list with mono IDs and durations) │ ● review-perf finished
Review specialists (4 verdict rows)             │ ● work closed bd-3479
                                                │ ● Plan approved · 9 beads

[Action bar: Reset · Stop agent · View PR · Merge]
```

Width: 980px max, full-height drawer pinned to right. Parent surface dims (4% accent overlay + 2px blur) behind. Closed via Esc, X button, or click-on-scrim. URL is the persistence layer: `?issue=PAN-1052&tab=overview`.

The drawer is **owned by a single global store slice**, not per-surface. Two surfaces cannot have it open simultaneously; opening from anywhere replaces any prior content.

### 4.4 Verb Badges

A short, fixed vocabulary covering every observable agent state. One per row/card.

| Verb | Color token | Pulse? | When shown |
|---|---|---|---|
| `WORK RUNNING` | info (blue) | ✓ | Work agent actively in workspace |
| `REVIEW RUNNING` | warning (amber) | ✓ | Review convoy in flight |
| `SHIP RUNNING` | signal-review (purple) | ✓ | Ship agent rebasing/pushing |
| `PLANNING` | signal-review (purple) | ✓ | Plan agent producing vBRIEF |
| `READY TO MERGE` | success (green) | — | Branch pushed, awaiting human |
| `MERGED` | success (green) | — | Closed-out state |
| `CHANGES REQUESTED` | destructive (red) | — | Review verdict not approved |
| `STUCK · Nh` | destructive (red) | — | Idle past Cloister threshold |
| `INPUT` | warning (amber) | ✓ | Agent waiting on AskUserQuestion |
| `QUEUED FOR PLAN` | neutral border | — | Triaged, no agent yet |

Mapping to the existing role / pipeline-state taxonomy (`docs/ROLES.md`) is one-to-one: WORK = `work` role active; REVIEW = `review` role active with at least one specialist running; SHIP = `ship` role active; PLANNING = `plan` role active. The "extra" badges (STUCK, INPUT, READY TO MERGE, CHANGES REQUESTED) are derived properties already computed in the read model.

### 4.5 Color & Style Discipline

Per the style guide, with this redesign tightening usage:

| Token | Always means | Never used for |
|---|---|---|
| `--destructive` | Action required: broken, stuck, failed gate, urgent priority | Decoration; label backgrounds |
| `--warning` | A **human** needs to do something | Machine activity; cost figures |
| `--info` / `--primary` | A **machine** is actively doing something | Static state; secondary actions |
| `--signal-review` | Review / ship / planning specialist activity | General-purpose accents |
| `--success` | Done / merged / verification passing | Idle agents; queued items |
| `--signal-cost` | Money — runtime spend, model cost, fleet totals | Anything that isn't currency |
| `--muted-foreground` | Neutral / no live signal — the rest state | Active signals masquerading as neutral |

**Labels are taxonomy, never status.** `bug`, `feature`, `backend`, `frontend` use `bg-muted` + `text-muted-foreground` regardless of value.

**One signal per element.** A row already conveys priority via left border and phase via the status glyph — the verb badge is the only additional colored element. A card with both a colored badge AND a colored label fails the rule.

### 4.6 Interaction Model

Every row, every card, every agent surface opens the same drawer:

```
Pipeline row     ┐
Board card       │
Command Deck row ├──► Issue Detail (slide-out)
Agents card      │
⌘K result        ┘
```

- **Parent stays in context.** Drawer slides over, parent dims. Closing returns to the exact scroll position.
- **URL-addressable.** `?issue=<id>` opens the drawer on load. Pre-existing query state is preserved.
- **Sequential, not stacked.** Opening another issue from inside the drawer (e.g. a related-issue link) replaces content — no infinite stack.
- **⌘K command palette** is the universal jump: type ID, branch, or fragment of a title to land in the drawer from anywhere.

Surface-specific entry behaviors:

- **From Board:** click card → drawer.
- **From Command Deck:** click row → drawer; tree selection persists.
- **From Agents:** click "Open issue" link → drawer scrolled to the Active Agent section, focused on that agent.
- **From Pipeline:** click row → drawer.

## 5. Data & API

### 5.1 No new endpoints

All data the redesign needs is already computed in the read model:

| Need | Source today |
|---|---|
| Pipeline phase per issue | `read-model.ts` — pipeline-state classifier already in use by Board |
| Active agents per issue | `agents` service · `state.json` per agent dir |
| Live stream excerpt | tmux capture-pane (already used by ConversationView) — re-exposed as a snapshot endpoint or trimmed via the existing observation stream from PAN-1052 |
| Verification gate status | `projects.yaml` gate results, written by Cloister into agent state |
| Beads | `findPlan().items[]` with `statusOverrides` overlay from workspace continue.json |
| Review specialist verdicts | `reviewStatusByIssueId` (already shipping in dashboard store) |
| Activity feed | PAN-1052 observation feed |
| Cost figures | `cost_events` per-issue rollup, used today on Board metric tiles |

### 5.2 Subscription contract for Issue Detail

The drawer is the most subscription-heavy component in the system. It needs to design its data contract once, not surface-by-surface. Required streams:

- `subscribeDomainEvents` (already shipping) for pipeline-state transitions, bead closures, agent state changes — filtered by `issueId`
- A trimmed observation stream for the live activity rail (filtered to issue scope, last N items)
- Optional tmux PTY connection for the Terminal tab (existing `/ws/terminal` path; only opened when the tab is active)

These are existing streams; the drawer's job is **server-side filtering by issue id**, not new transports. The frontend uses a single Effect-managed subscription that the drawer owns and tears down on close.

### 5.3 Routes

New / changed dashboard routes:

| Route | Today | After |
|---|---|---|
| `/` | Board | Pipeline |
| `/pipeline` | — | Pipeline (alias of `/`) |
| `/board` | Board | Board (redesigned) |
| `/command-deck` | Command Deck | Command Deck (refreshed) |
| `/agents` | AgentList + GodView grid | Agents fleet view |
| `/awaiting-merge` | Awaiting Merge | **Removed**; redirect → `/pipeline?phase=ship` |
| `/issues/:id` | — | Direct-link rehydrates to the surface the user came from, drawer open |

Query-string contract: `?issue=<id>&tab=<tab>` is the canonical addressing for the drawer. Refresh-safe and shareable.

## 6. Migration / Build Order

A feature is a feature — the redesign ships as one initiative. The order below is **implementation sequencing only**, not separate releases.

1. **Shared design tokens & primitives.** Extract the row/card/drawer components into `packages/contracts` (if shared with desktop) or `src/dashboard/frontend/src/components/primitives/`. Wire them into Storybook stories sourced from the mock HTML.
2. **Issue Detail drawer.** Build the drawer + subscription contract first — every other surface references it.
3. **Pipeline.** Greenfield page composing only the new primitives. Becomes the new `/` route.
4. **Board.** Replace the existing kanban card with the new Issue Card. Remove configuration controls from cards. Hook column dot indicators to phase semantics. Drop drag-to-phase wiring; keep drag-to-reorder within a column.
5. **Command Deck.** Keep the project tree component. Replace the right pane content with the new tabbed lens (Pipeline scoped + Plans / Beads / Conversations / Activity / Settings). Preserve the existing conversation thread component inside the Conversations tab — no rewrite of conversation rendering.
6. **Agents.** Wholesale replacement. New fleet grid composing the Agent Card primitive. Deacon status moves to Health.
7. **Retire `/awaiting-merge`.** Add 301-equivalent redirect to `/pipeline?phase=ship`. Remove the route and component.

Each step is mergeable on its own (no flag gates), because the IA change at step 1 already exposes the new sidebar — Pipeline starts as a placeholder, Board / Command Deck / Agents adopt the new shell incrementally. The cut-over for `/` happens at step 3.

## 7. Risks & Open Questions

| Risk | Mitigation |
|---|---|
| Issue Detail subscription fan-out — multiple drawers being opened/closed rapidly could leak streams | Single store-owned drawer instance with `useEffect` teardown; integration test for open→close→open burst |
| `READY TO MERGE` badge as a derived state must update reactively across surfaces | Already a computed projection in `reviewStatusByIssueId`; emit a domain event so Pipeline / Board / Agents all react |
| Operators relying on `/awaiting-merge` muscle memory | 301-style redirect plus a sidebar tooltip ("Awaiting Merge is now a filter on Pipeline") for one release |
| God View consistency drift — its scoped tokens may look more out of place after surrounding surfaces refresh | Acceptable for this initiative; God View redesign is a follow-up |
| The drawer subsumes today's Inspector Panel — risk of regressing some Inspector Panel features | Audit Inspector Panel usages before deletion; explicit feature parity checklist in the migration step |
| Cost figure precision — fleet view at minute-grain may diverge from issue-level totals due to event lag | Acceptable; surface a tooltip on `Spend · 24h` that links to Costs for canonical numbers |

## 8. Success Metrics

The redesign succeeds if, three weeks after merge:

- The number of distinct top-level routes (operations cluster) drops from **6 → 4**.
- All five issue surfaces are visually unified (verified by a styleguide-conformance Playwright test that asserts component class usage across pages).
- "Stuck agents in the fleet" becomes a single-glance answer on Agents (the `STUCK` badge is visible without scrolling for the first stuck agent).
- Time-to-context for an unfamiliar issue (open drawer → see phase, agent, beads, last activity) is **one click** from any operations surface.

## 9. Out-of-Scope Follow-ups

- God View IA integration (sidebar entry exists; interior unchanged).
- Mintlify-published mockup URLs.
- Drag-and-drop phase transitions on Board (explicitly out per non-goals).
- Per-organization theming / white-labeling.
- A "search anything" omnibar beyond the existing ⌘K command palette.

## 10. References

- Mockups: [`docs/design/mockups/`](../../design/mockups/)
- Style guide: [`design/style-guide/STYLE-GUIDE.md`](../../../design/style-guide/STYLE-GUIDE.md)
- Agent taxonomy: [`docs/ROLES.md`](../../ROLES.md)
- Dashboard architecture: [`CLAUDE.md` — Dashboard Server Architecture section](../../../CLAUDE.md)
- vBRIEF spec: [`docs/VBRIEF.md`](../../VBRIEF.md)
- Prior partial redesign (now superseded): [`PAN-1044-project-overview-panel.md`](./PAN-1044-project-overview-panel.md), [`agents-page-redesign-spec.md`](./agents-page-redesign-spec.md), [`PAN-1029-harness-picker-ui.md`](./PAN-1029-harness-picker-ui.md)
