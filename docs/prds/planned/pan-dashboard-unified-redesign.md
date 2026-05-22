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

[Action bar: phase-primary actions · ⋯ overflow (full catalog §4.8) · View PR · Merge]
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

### 4.7 Detailed component specification

The values below are the literal contract — what an implementer follows when neither the mock nor the style guide is open. Where a value references a token, the token (not the resolved value) is the contract. Tokens come from [`design/style-guide/STYLE-GUIDE.md`](../../../design/style-guide/STYLE-GUIDE.md) §3 (color) and §5 (radius).

**Universal rules.** Body font is **DM Sans**, mono is **SF Mono**, display (Space Grotesk) is reserved for the sidebar wordmark only. Default transition is `200ms ease-in-out`. Hover on any clickable surface adds `background: var(--accent)` (4% overlay). The fractal-noise body overlay (3.5% opacity, fixed-position SVG turbulence at 256px tile) is applied to every page.

#### 4.7.1 Sidebar (left rail)

| Property | Value |
|---|---|
| Width | 232px expanded · 48px collapsed |
| Background | `var(--card)` |
| Border | `border-right: 1px solid var(--border)` |
| Padding | `14px 12px` |
| Workspace mark | 28×28, `var(--radius-md)`, label uses Space Grotesk 14px weight 600 letter-spacing `-0.01em` |
| Filter box | 30px height, `var(--radius-lg)`, 12px font, `border: 1px solid var(--input)`, muted placeholder |
| Group label | 11px DM Sans weight 500, **uppercase**, letter-spacing `0.12em`, color muted, padding `0 10px`, 4px margin-bottom |
| Nav item | 13px font, gap 10px between icon and label, padding `6px 10px`, radius `var(--radius-lg)`, color muted |
| Nav item hover | `background: var(--accent)`, color foreground, 200ms |
| Nav item active | Same + `::before` left accent bar — 2px wide, `var(--primary)`, inset 6px top/bottom |
| Nav count | 11px mono, muted, right-aligned |
| Project mark | 14×14 rounded 3px square; color = project's signal token |
| Footer | `margin-top: auto`, padding `8px 10px 0`, kbd chip uses SF Mono 10px in a 4px-radius accent pill |

#### 4.7.2 Top bar

| Property | Value |
|---|---|
| Height | 52px (Pipeline) / 48px (other surfaces) |
| Padding | `10px 22px` |
| Border | `border-bottom: 1px solid var(--border)` |
| Gap between elements | 12px |
| Breadcrumb font | 13px DM Sans; muted segments are `var(--muted-foreground)`, current segment is `var(--foreground)` weight 500 |
| Breadcrumb separator | `/` in muted color at 50% opacity |
| Meta chip | 11px, padding `2px 6px`, radius `var(--radius-sm)`, `background: var(--accent)`, color muted |
| Search input | 32px height, min-width 280px, radius `var(--radius-lg)`, 12px font, muted placeholder |
| Segmented control | 32px height, radius `var(--radius-lg)`, 12px font weight 500; active button uses `background: var(--accent)`, color foreground; dividers are 1px borders |
| Primary button | 32px height, padding `0 14px`, radius `var(--radius-lg)`, 12px font weight 500, `background: var(--primary)`, color `var(--primary-foreground)`, inset highlight `0 1px 0 rgb(255 255 255 / 6%)` |
| Ghost button | Same dims, transparent background, `border: 1px solid var(--input)`, color muted; hover → accent + foreground |

#### 4.7.3 Metric strip (Pipeline, Agents)

| Property | Value |
|---|---|
| Layout | `grid-template-columns: repeat(5, 1fr)` on Pipeline · `repeat(6, 1fr)` on Agents · gap 12px |
| Padding | `14px 22px` (Pipeline) / `0` inside scroll (Agents — already padded) |
| Border | `border-bottom: 1px solid var(--border)` on Pipeline |
| Tile background | `var(--card)`, `border: 1px solid var(--border)`, radius `var(--radius-2xl)` (18px) |
| Tile padding | `14px 16px` (Pipeline) / `12px 14px` (Agents) |
| Eyebrow row | 11px DM Sans weight 500, **uppercase**, letter-spacing `0.06em`, color muted, 14×14 icon at the start |
| Eyebrow icon color | Inherits the metric's signal token (`--info-foreground` for machine, `--warning-foreground` for review, `--signal-review-foreground` for ship/plan, `--signal-cost-foreground` for spend, `--destructive-foreground` for stuck, `--muted-foreground` for queue/backlog). **The number stays `--foreground`** — only the icon carries signal color. |
| Value | 22px (Pipeline) / 20px (Agents), DM Sans weight 500, `line-height: 1`, `font-variant-numeric: tabular-nums` |
| Sub line | 11px (Pipeline) / 10px (Agents), muted |
| Delta | 11px inline-flex with 2px gap, color `var(--success-foreground)` for positive (cost down), `var(--destructive-foreground)` for negative |

#### 4.7.4 Phase header (group header used in Pipeline + scoped Command Deck)

| Property | Value |
|---|---|
| Layout | `display: flex; align-items: center; gap: 12px` |
| Padding | `12px 22px 10px` (Pipeline) / `10px 22px 8px` (Command Deck) |
| Background | `color-mix(in srgb, var(--background) 92%, var(--color-white))` |
| Backdrop | `backdrop-filter: blur(6px)` (keeps it legible when rows scroll under it) |
| Position | `sticky; top: 0; z-index: 2` |
| Border-top | 2px solid — color per phase: Ship=success, Review=warning, Work=info, Plan=signal-review, Todo=`rgb(255 255 255 / 15%)` |
| Border-bottom | `1px solid var(--border)` |
| Phase dot | 8×8 circle, color matches the top border |
| Title | 14px DM Sans weight 500, foreground |
| Count chip | 11px, padding `1px 6px`, radius `var(--radius-sm)`, `background: var(--accent)`, muted |
| Sub | 12px muted, margin-left 4px |
| Right meta | `margin-left: auto`, 11px mono muted, `font-variant-numeric: tabular-nums` |

#### 4.7.5 Issue Row (Pipeline + Command Deck)

| Property | Value |
|---|---|
| Grid | `grid-template-columns: 14px 78px 14px 1fr 220px 84px 30px` (Pipeline) — priority · id · phase glyph · title · agent · ledger · avatar |
| Grid (Command Deck) | `14px 78px 14px 1fr 220px 84px 26px` — same shape, slightly tighter avatar column |
| Gap | 14px (Pipeline) / 12px (Command Deck) |
| Padding | `10px 22px 10px 18px` (Pipeline) / `9px 22px 9px 18px` (Command Deck) |
| Border-bottom | `1px solid var(--border)` (except last row in group) |
| Hover | `background: var(--accent)`, 200ms |
| Priority left border | `::before` pseudo, 2px wide, inset 8px top/bottom, radius 2px. Urgent=destructive, High=warning, Medium=`rgb(255 255 255 / 22%)`, Low=transparent |
| Issue ID | SF Mono 11px muted, letter-spacing `0.02em` |
| Phase glyph | 14×14 SVG; color = phase-foreground token (todo/progress/review/ship/done) |
| Title text | 13px DM Sans foreground, single-line ellipsis |
| Title row gap | 8px between text and verb badge |
| Label row | 6px gap, 11px muted; chips at 10px weight 500, padding `1px 6px`, radius `var(--radius-sm)`, `background: rgb(255 255 255 / 5%)`, `border: 1px solid var(--border)`, color muted |
| Project tag | 11px muted with 14×14 square mark (`var(--proj-mark-*)`), gap 6px |
| Inline separator | 3×3 dot, `var(--muted-foreground)` at 50% opacity |
| Agent cell | Two-line stack, 3px gap, both lines mono, min-width 0 for ellipsis. Name: 11px foreground. Sub: 10px muted. Empty state: name in italic DM Sans 11px muted, sub still mono 10px |
| Ledger cell | Two-line stack, 2px gap, right-aligned, mono, `font-variant-numeric: tabular-nums`. Runtime: 11px muted. Cost: 10px `var(--signal-cost-foreground)`. Empty: both lines `—`, 55% opacity |
| Avatar | 22×22 circle, `border: 1px solid var(--border)`, 9px font weight 600 white, gradient fills from a 5-tone palette (purple→cyan, amber→red, emerald→cyan, blue→purple, red→amber) |

#### 4.7.6 Issue Card (Board)

| Property | Value |
|---|---|
| Background | `color-mix(in srgb, var(--background) 92%, var(--color-white))` (slightly lighter than card surface — visual lift) |
| Border | `1px solid var(--border)`, radius `var(--radius-xl)` (14px) |
| Padding | `12px 12px 10px` |
| Hover | `border-color: rgb(255 255 255 / 14%)` |
| Priority left border | Same `::before` pseudo as Issue Row, inset 12px top/bottom |
| Stuck card | Border becomes `color-mix(in srgb, var(--destructive) 32%, transparent)` |
| Merge-ready card | Border becomes `color-mix(in srgb, var(--success) 32%, transparent)` |
| Row 1 | Project mark (8×8 square, radius 2px) + ID (SF Mono 10px muted) + spacer + verb badge |
| Title | 13px line-height 1.35 foreground, 2-line clamp (`-webkit-line-clamp: 2`) |
| Labels | 4px gap, wrap, same chip styling as Issue Row labels |
| Bead progress | Row of: label (10px muted, e.g. "Beads 7/12") + 3px-tall track (`background: var(--accent)`, radius 2px) with phase-colored fill |
| Foot | 8px top padding, 1px top border, agent two-line cell on the left + runtime mono on the right + 18×18 avatar |
| Action row | Below the foot, 1px top border: 1–2 **phase-primary** action buttons (28px height, ghost) + a `⋯` overflow button opening the full §4.8 action menu. Revealed on card hover (pointer devices); always visible when the issue has a running agent or a pending action. See §4.8.3 |

#### 4.7.7 Verb badges

Universal: 10px DM Sans weight 500, letter-spacing `0.05em`, **uppercase**, padding `2px 6px`, radius `var(--radius-sm)`, `border: 1px solid`, inline-flex gap 5px with optional pulse dot.

| Variant | Background | Border | Text | Pulse? |
|---|---|---|---|---|
| `WORK RUNNING` | `info / 8%` | `info / 32%` | `--info-foreground` | ✓ |
| `REVIEW RUNNING` | `warning / 8%` | `warning / 32%` | `--warning-foreground` | ✓ |
| `SHIP RUNNING` | `signal-review / 8%` | `signal-review / 32%` | `--signal-review-foreground` | ✓ |
| `PLANNING` | `signal-review / 8%` | `signal-review / 32%` | `--signal-review-foreground` | ✓ |
| `INPUT` | `warning / 8%` | `warning / 32%` | `--warning-foreground` | ✓ |
| `READY TO MERGE` | `success / 8%` | `success / 32%` | `--success-foreground` | — |
| `MERGED` | `success / 8%` | `success / 32%` | `--success-foreground` | — |
| `CHANGES REQUESTED` | `destructive / 8%` | `destructive / 32%` | `--destructive-foreground` | — |
| `STUCK · Nh` | `destructive / 8%` | `destructive / 32%` | `--destructive-foreground` | — |
| `QUEUED FOR PLAN` | transparent | `var(--border)` | muted | — |

**Pulse dot:** 6×6 circle, color `currentColor`. Animation `pulse 1.6s ease-out infinite` — keyframes ramp `box-shadow: 0 0 0 0 → 0 0 0 6px transparent` while opacity drops to 50% at 80% and returns. Pulse never applies to terminal states (MERGED, READY TO MERGE, CHANGES REQUESTED, STUCK).

#### 4.7.8 Issue Detail drawer

| Property | Value |
|---|---|
| Width | 980px max, `max-width: calc(100vw - 48px)` |
| Surface | `background: var(--background)`, full-height pinned right |
| Border | `border-left: 1px solid var(--border)` |
| Shadow | `box-shadow: -24px 0 64px rgb(0 0 0 / 40%)` |
| Backdrop | `rgb(0 0 0 / 32%)` with `backdrop-filter: blur(2px)`, z-index 50 |
| Header padding | `16px 22px 0` |
| Title | Space Grotesk 22px weight 600 letter-spacing `-0.01em`, foreground |
| ID chip | SF Mono 13px muted; priority is rendered as a 4×28 left bar at row start |
| Header meta row | 12px muted, inline chips at `var(--accent)` + `var(--radius-md)`, 8px gap; cost figure uses `var(--signal-cost-foreground)` |

**Phase timeline:** `grid-template-columns: repeat(6, 1fr)`, gap 0, 6 steps. Each step has a 2px top accent (transparent → success once `done`; `signal-review` for `current`). Per step: 10px uppercase lbl muted (or signal-colored for the active state) over 11px when-stamp mono over 10px sub. The current step's when-stamp goes foreground weight 500.

**Tabs:** padding `10px 14px`, 13px DM Sans weight 500, color muted (hover/active foreground). Active tab gets a 2px `var(--primary)` underline inset 14px from each side. Count chips are 10px SF Mono in a 5px-padded accent pill.

**Body grid:** `grid-template-columns: 1fr 320px` — main + side rail.

**Active-agent card (inside drawer):**
- `background: var(--card)`, `border: 1px solid var(--border)`, radius `var(--radius-xl)`, padding 14px
- 3px `signal-review` left accent inset 14px top/bottom
- Row 1: 8px phase dot + SF Mono 13px name + small verb badge (9px instead of 10px) + right-aligned mono meta (model · runtime · spend)
- Stream excerpt: SF Mono 11px in a `rgb(0 0 0 / 32%)` panel with `border: 1px solid var(--border)`, radius `var(--radius-md)`, padding `10px 12px`, line-height 1.55, max-height 180px scroll. Inline color helpers: `.verb-line` signal-review, `.ok` success, `.warn` warning, `.err` destructive, `.neutral` foreground
- Tell input row: 32px input + 32px primary "Send" button, gap 8px

**Verification gates:** `grid-template-columns: repeat(4, 1fr)`, gap 8px. Each gate: card surface, padding `10px 12px`, radius `var(--radius-lg)`. Pass borders use `color-mix(success / 32%)`, fail use `color-mix(destructive / 32%)`. Value: 14px weight 500 in the matching `*-foreground` token. Sub: 10px mono muted.

**Beads list:** wrapped in a single card surface with `border-radius: var(--radius-xl) overflow: hidden`. Each row: `grid-template-columns: 18px 1fr auto auto`, padding `9px 14px`, 1px bottom border (except last). Check circle: 14×14, 1.5px border. Done: filled success, white checkmark 9px. Current: filled info + animated 1.5px ring `ping 1.6s ease-out infinite` (scale 1 → 1.5, opacity 1 → 0). Done titles get `text-decoration: line-through` at 18% white. ID column: SF Mono 10px muted. Duration: SF Mono 10px muted tabular.

**Review specialists list:** card surface with rows of `grid-template-columns: 14px 1fr auto auto`, padding `8px 0`, 1px bottom border. 8×8 status dot (run/idle/done/fail) + SF Mono 11px name + SF Mono 10px meta + SF Mono 10px duration.

**Side rail (live activity):** `border-left: 1px solid var(--border)`, background `color-mix(in srgb, var(--background) 97%, var(--color-white))`, padding `16px 18px`, overflow-y auto. Stream items: `grid-template-columns: 14px 1fr`, gap 10px, padding-bottom 10px, 1px bottom border. 8×8 status dot (work/review/ship/done/info) + 12px text foreground with a 10px mono muted "when" line below.

**Action bar (drawer footer):** padding `12px 22px`, 1px top border, background `color-mix(in srgb, var(--background) 96%, var(--color-white))`. Left cluster is the **phase-aware action set** from §4.8 (ghost buttons for the applicable verbs plus a `⋯` overflow), spacer, then ghost "View PR" + primary "Merge to main" (primary uses `background: var(--success)`, color `#000` for contrast). The drawer is the canonical full-coverage action surface — every issue-scoped `pan` verb is reachable here per §4.8.

#### 4.7.9 Agent Card (Agents view)

| Property | Value |
|---|---|
| Grid container | `grid-template-columns: repeat(auto-fill, minmax(360px, 1fr))`, gap 14px |
| Card | `background: var(--card)`, `border: 1px solid var(--border)`, radius `var(--radius-2xl)`, padding 14px, vertical stack with 12px gap |
| Left accent | 3px `::before` inset 14px top/bottom, color per phase (work=info, review=warning, ship/plan=signal-review, stuck=destructive) |
| Stuck card | Border becomes `color-mix(destructive / 32%)` |
| H1 row | Phase dot + SF Mono 13px name + verb badge (right) + 22×22 menu icon button |
| Issue panel | `background: rgb(0 0 0 / 20%)`, `border: 1px solid var(--border)`, radius `var(--radius-md)`, padding `10px 12px`, contains project mark + ID/title (12px foreground 2-line clamp) |
| Meta tri-column | `grid-template-columns: 1fr 1fr 1fr`, gap 8px. Per cell: 9px uppercase lbl muted over 11px mono val foreground (cost uses signal-cost; warn uses warning-foreground) |
| Stream excerpt | `background: rgb(0 0 0 / 28%)`, `border: 1px solid var(--border)`, radius `var(--radius-md)`, SF Mono 10.5px line-height 1.55, padding `8px 10px`, max-height 84px, **fade-out gradient** via `::after` (24px tall, linear gradient transparent → var(--card)) |
| Stuck banner | Inline `display: flex` row, padding `6px 10px`, radius `var(--radius-md)`, `background: color-mix(destructive / 8%)`, `border: color-mix(destructive / 32%)`, 11px text in `--destructive-foreground` |
| Foot | 8px top padding, 1px top border, gap 6px. Links: 11px, padding `4px 8px`, radius `var(--radius-md)`. Primary actions use `--info-foreground`, danger uses `--destructive-foreground` (right-aligned via `margin-left: auto`) |

#### 4.7.10 Command Deck — project tree

| Property | Value |
|---|---|
| Pane width | 280px |
| Background | `var(--card)`, `border-right: 1px solid var(--border)` |
| Tree-head padding | `14px 14px 10px` |
| Tree title | Space Grotesk 14px weight 600 letter-spacing `-0.01em` |
| Tree sub | 10px uppercase muted letter-spaced 0.12em |
| Search | 30px height, radius `var(--radius-lg)`, 12px font, slightly transparent bg `rgb(255 255 255 / 3%)` |
| Section label | 11px uppercase letter-spaced 0.12em muted, padding `6px 6px 4px`, right-aligned counts at 11px muted |
| Project item | 13px DM Sans, gap 8px, padding `6px 8px`, radius `var(--radius-lg)`. Includes 12×12 chevron (rotated 90° when active), 14×14 project mark, label, monospace tag pill on the right (10px in 4px-radius accent pill) |
| Active project item | `background: var(--accent)`, color foreground, with a 2px primary left accent positioned at `left: -4px` |
| Feature list (nested) | 22px indent, 2px gap between rows |
| Feature item | 12px DM Sans, gap 8px, padding `5px 8px`, radius `var(--radius-md)`. Includes 6×6 phase indicator dot (todo/progress/review/ship/done) + 10px mono ID (min-width 54px) + ellipsised title |
| Selected feature item | `background: var(--accent)`, color foreground, with a 2px primary left accent at `left: -2px` |

#### 4.7.11 Animation contract

| Pattern | Duration | Easing |
|---|---|---|
| Hover state change (color / background) | 200ms | ease-in-out |
| Drawer open / close | 200ms | ease-in-out; scale 0.98 → 1, opacity 0 → 1 |
| Tooltip appear | 150ms | ease-in-out; same scale/opacity ramp |
| Sidebar collapse width | 200ms | ease-in-out |
| Verb badge pulse | 1.6s | ease-out, infinite |
| Bead "current" ring ping | 1.6s | ease-out, infinite |
| Theme toggle | 0ms (transitions suppressed via `.no-transitions` for one rAF) | — |

No bounce, no spring, no elastic — per style-guide §12.3.

#### 4.7.12 Surface-by-surface chrome reference

| Surface | Top-bar height | Has metric strip? | Has filter row? | Layout |
|---|---|---|---|---|
| Pipeline | 52px | 5-tile strip below top bar | — | Sidebar (232px) + main |
| Board | 52px | — | Cycle pills + project pills + filters + group | Sidebar (232px) + main with 4-column grid |
| Command Deck | 48px (within feature header) | 5-tile mini stats in feature header | Per-tab toolbar | App rail (48px) + tree (280px) + feature detail |
| Agents | 52px | 6-tile strip | Phase pills + project/model dropdowns | App rail (48px) + main |
| Issue Detail | — | — | — | Drawer over any surface, 980px |

### 4.8 Action surface

> **Amendment — 2026-05-21.** Added after the redesign shipped. It revises the
> original §1 / §4.3 position that Board cards are "status-only" and that the
> drawer carries a fixed four-button action bar. That position assumed
> configure-then-launch had fully moved to dedicated planning; in practice it
> stranded ~20 issue-scoped `pan` verbs with no dashboard entry point outside
> the Command Deck. The redesign did **not** delete those actions —
> `ZoneActionStrip` (~25 actions) and every dialog (`PlanDialog`, `BeadsDialog`,
> model/harness pickers, `SwitchModelModal`) still exist — it only failed to
> wire them into Board, Pipeline, Agents, and the drawer. This section makes the
> action surface a first-class, system-wide contract.

**Principle.** Every `pan` verb that operates on a single issue has a dashboard
entry point. The CLI is the lower bound on capability, never the upper bound.
Actions are defined **once** in a canonical registry and rendered by **one
shared primitive** on every surface — the same "build once, fix once" rule the
redesign already applies to Issue Row / Issue Card / verb badges.

#### 4.8.1 Canonical action registry

A single `issueActions` registry is the source of truth, replacing the stale
`commandDeckSurfaceRegistry.ts` parity table (which currently *claims* the
drawer carries actions it does not render). Each entry declares: `key`, `label`,
the `pan` verb it mirrors, the HTTP endpoint, an `enabledWhen` phase/state
predicate, a `kind` (`safe` · `dialog` · `destructive`), and a lifecycle
`group`. The registry is surface-agnostic — surfaces *select and present* from
it, they never define actions inline.

| Action | `pan` verb | Endpoint | Enabled when | Kind |
|---|---|---|---|---|
| Plan… | `plan` | opens `PlanDialog` | no plan, or re-plan allowed | dialog |
| Auto-plan | `plan --auto` | `PlanDialog` (auto) | same | dialog |
| Watch planning | — | `PlanDialog` (live) | `PLANNING` | dialog |
| Done planning | `plan` (finalize) | `POST /api/issues/:id/complete-planning` | plan proposed, plan agent idle | safe |
| Start agent… | `start` | opens start dialog → `POST /api/agents` | plan proposed/approved, no work agent | dialog |
| Start — skip planning | `start --auto` | `POST /api/agents` (`auto:true`) | Todo, no plan (closes #637) | dialog |
| Swarm… | `swarm` | `POST /api/swarm` | plan has parallelizable items | dialog |
| Tell agent… | `tell` | `POST /api/agents/:id/tell` | any agent running | dialog |
| Done (complete work) | `done` | `POST /api/agents/:id/done` | `WORK RUNNING` | safe |
| Request review | `review` | `POST /api/review/:id/trigger` | work complete, not in review | safe |
| Restart review | `review restart` | `POST /api/specialists/:id/review/restart` | review running/stalled | safe |
| Recover (reset review) | `review reset` / `recover` | `POST /api/review/:id/reset` | review/test/merge stuck | safe |
| Stop agent | `kill` | `POST /api/agents/:id/stop` | agent running | safe |
| Pause agent… | `pause` | `POST /api/agents/:id/pause` | agent running, not paused | dialog |
| Unpause agent | `unpause` | `POST /api/agents/:id/unpause` | agent paused | safe |
| Clear troubled | `untroubled` | `POST /api/agents/:id/untroubled` | agent troubled | safe |
| Recover agent | `recover` | `POST /api/agents/:id/recover` | agent crashed/stopped | safe |
| Resume session… | `resume` | `POST /api/agents/:id/resume` | stopped agent w/ saved session | dialog |
| Switch model / restart… | — | restart-with-model | agent running | dialog |
| Sync with main | `sync-main` | `POST /api/issues/:id/sync-main` | workspace exists, behind main | safe |
| Inspect bead… | `inspect` | per-bead inspect *(verify/new endpoint)* | bead awaiting inspection | dialog |
| Reopen | `reopen` | `POST /api/issues/:id/reopen` | issue closed/completed/cancelled | safe |
| Close out… | `close` | `POST /api/issues/:id/close-out` | merged / `verifying-on-main` | destructive |
| Wipe… | `wipe` | `POST /api/issues/:id/deep-wipe` | always | destructive |
| Destroy workspace… | `destroy` | `POST /api/workspaces/:id/destroy` | workspace exists | destructive |
| Open in editor | `open` | `PanOpenInPicker` (client) | workspace exists | safe |
| View PR | — | external link | PR exists | safe |
| Merge to main | — (human only) | `POST /api/issues/:id/merge` | `READY TO MERGE` | safe |
| Reset issue… | — | `POST /api/issues/:id/reset` | always | destructive |

All endpoints already exist except where flagged. §5.1's "no new endpoints"
holds for the read model; the action surface may add the small set of
write-endpoint gaps the table flags (per-bead `inspect`), which is in scope.

#### 4.8.2 Shared rendering — `<IssueActionMenu>`

One primitive renders the registry everywhere. It takes an issue, computes the
enabled subset via each `enabledWhen` predicate, and renders either a menu
(`⋯` / right-click) or an inline button cluster. Rules:

- **`destructive` actions** require a typed/confirm dialog (matching today's
  `ResetIssueButton` / deep-wipe confirm). Never one-click.
- **`dialog` actions** open the existing dialog component — no re-implementation
  (`PlanDialog`, start dialog, `SwitchModelModal`, Tell composer).
- **Disabled** actions whose `enabledWhen` is false are shown greyed with a
  tooltip reason, not hidden — discoverability over a moving target.
- **Merge** stays human-only; no agent or automation path may invoke it.

#### 4.8.3 Per-surface presentation

| Surface | Presentation |
|---|---|
| **Board card** | Hybrid: 1–2 **phase-primary** inline ghost buttons + `⋯` overflow with the full enabled set (§4.7.6 Action row). Right-click also opens the menu. |
| **Issue Detail drawer** | Canonical full surface. Footer action bar shows the phase-primary set as ghost buttons + `⋯` overflow; `View PR` + `Merge` stay pinned right. Every registry action reachable here. |
| **Command Deck** | Already near-complete — reconcile `ZoneActionStrip` + the project-tree context menu onto the shared registry so coverage and labels match. Add the gaps it still lacks (Clear troubled, per-bead Inspect). |
| **Pipeline row** | `⋯` overflow on row hover + right-click — same primitive, no inline buttons (rows stay dense). |
| **Agents card** | Wire the existing dead `⋯` button to the menu (agent-scoped subset: Tell, Stop, Pause, Recover, Switch model). |

**Phase-primary inline selection** (the 1–2 buttons surfaced before the `⋯`):

| Phase / verb badge | Primary inline actions |
|---|---|
| `QUEUED FOR PLAN` / Todo | Plan… · Start agent… |
| `PLANNING` | Watch planning · Done planning |
| Planned (proposed, idle) | Start agent… |
| `WORK RUNNING` | Tell agent… · Done |
| `INPUT` | Open (respond) · Tell agent… |
| `REVIEW RUNNING` / `SHIP RUNNING` | Tell agent… · Recover |
| `CHANGES REQUESTED` | Open · Request review |
| `STUCK` | Recover · Tell agent… |
| `READY TO MERGE` | View PR · Merge to main |
| `MERGED` | Close out… |

#### 4.8.4 CLI ↔ dashboard parity gate

The `pan` ↔ skill convention (CLAUDE.md) already keeps the CLI honest. The
mirror gate for the dashboard: a test asserts every issue-scoped `pan` verb has
a registry entry, and every registry entry resolves to a `<IssueActionMenu>`
render on the drawer. This is the action-surface analogue of the §8
styleguide-conformance test — it makes "the CLI is the lower bound" enforceable
rather than aspirational, and closes the long-standing #243 audit.

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
