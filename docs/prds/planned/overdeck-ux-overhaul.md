# Overdeck UX Overhaul — Simple by Default, Unified Underneath

> **Status:** Proposal · 2026-07-19 (rev 6 — all contracts except full C-FRESH and the formal one-component shell now have shipped v1s; cockpit converged onto the shared rail + strip + menu; conversation-first with actionable no-agent surface) · Author: UX audit (Playwright walkthrough + code architecture review)
> **Mockups (binding visual spec):** [`docs/design/mockups/overdeck-ux-overhaul/index.html`](../../design/mockups/overdeck-ux-overhaul/index.html) (entry point — links to all three screen mocks)
> **Style guide:** [`design/style-guide/STYLE-GUIDE.md`](../../../design/style-guide/STYLE-GUIDE.md)
> **Supersedes / completes:** [`pan-dashboard-unified-redesign.md`](./pan-dashboard-unified-redesign.md) (2026-05-16) and the PAN-2499 "three issue views" unification — this PRD is the **conformance pass** those efforts never got.
> **Tracking issue:** [#2908 — "Make overdeck not suck"](https://github.com/eltmon/overdeck/issues/2908)
> **New here? Read [§8 Implementer's field guide](#8-implementers-field-guide) first** — glossary, file map, done-means per contract.

---

## 1. Problem

The dashboard renders a single issue through **four different surfaces**, each with its own tabs, phase vocabulary, data path, and action menu. The operator cannot learn the product because the product is not one product. All findings below were verified live against `localhost:3011` on 2026-07-19 (Playwright walkthrough, 17 screenshots, menu DOM inventories) and confirmed against the source.

### 1.0 There is no on-ramp — the machinery is the first thing you see

A junior dev opening Overdeck today is greeted by: a 701-card kanban column, cards carrying five actions each ("Start agent · Tell agent · Done — mark work complete & start review · ··· 41 more"), verb badges like `QUEUED FOR PLAN` and `CHANGES REQUESTED`, two stacked system banners about boot reconciliation, and a sidebar with 17 destinations. Nowhere does the product answer the only three questions a new user has:

1. **What is it doing?**
2. **Does it need me?**
3. **Is it done?**

The system's internal lifecycle (plan/work/review/test/ship), its specialist taxonomy (convoys, review.security, UAT stacks), and its full 43-verb action catalog are all surfaced *by default*. Power for the operator and legibility for a newcomer are both legitimate needs — the failure is serving the second need with the first need's UI. This PRD's first contract is therefore **progressive disclosure**: a simple default mode a junior dev can use with zero training, with the full console one "Advanced" toggle away.

### 1.1 Four surfaces, four dialects

| Surface | Route | Component | Issue detail rendered by |
|---|---|---|---|
| Kanban card | `/board` | `KanbanBoard/cards/KanbanCards.tsx` | Per-card buttons + "··· N more" overflow. **Does not use `IssueView`.** No gates, no DAG, no phase rail, no specialists. |
| Issue drawer | `/issues/:id` | `drawer/IssueDrawer.tsx` | `IssueView density="console"` — 8 tabs (Overview·Plan·Tasks·Conversation·Terminal·Activity·Files·Artifacts), verification gates, review specialists, stage timeline. **No DAG, no status narrative, no UAT stack, no ship log.** |
| Issue cockpit | `/command-deck/:project/:issue` | `Stage/cockpit/IssueMissionControl.tsx` | `IssueView density="cockpit"` — 8 **different** tabs (Overview·Code·PRD/Plan·Timeline·Discussion·Costs·Artifacts·Terminal), status narrative, DAG ("plan as a map"), UAT stack, Agents & Steps rail. **No verification-gates card, different action menu.** |
| Expandable row | deck tree / pipeline | `CommandDeck/ProjectTree/FeatureItem.tsx` | `IssueView density="rail"` — phase rows (Work·Lint·Review·Test·Ship) + RESOURCES. Unique again. |

Concretely, an operator who learns that "the DAG tells me what the plan looks like" can only see it in the cockpit. An operator checking "did the gates pass" only finds them in the drawer. The Work/Review/Test/Ship agent rows — the single most useful operational readout — exist only in the rail and cockpit. **Every answer requires knowing which of four views holds it.**

The cruelest cut: the one surface operators *actually live in* — the rich conversation view (`components/chat/`: `ConversationPanel`, `MessagesTimeline` with thinking/tool-call work-log rows, `ChatMarkdown`, `ComposerFooter` with model picker and attachments) — is treated as a tab at best, and as a gray "No recent stream output" box with a one-line "Tell this agent…" input at worst (drawer, cards). Each agent role (plan, work, review, test, ship) owns a conversation, and those conversations are where issues actually get understood and steered — yet no issue surface puts them front and center.

### 1.2 The actions are disorganized

Live menu inventories for the same issue (PAN-2377, work complete, review running):

- **Drawer overflow:** 37 items in one flat list — `Plan`, `Auto-plan`, `Watch planning`, `Done planning`, `Start without planning`, `Stop agent`, `Pause agent`, `Unpause agent`, … `Danger (6 available)`.
- **Cockpit "⌘ Actions ▾":** 37 items, same flat shape — but `Danger (5 available)`, plus `View PR`, minus `Close Out`.

So the same issue, at the same moment, exposes **different action sets with different danger counts** depending on which surface you opened. Both lists offer state-contradictory verbs simultaneously (Start *and* Stop, Pause *and* Unpause). Under the hood:

- One registry exists (`lib/issueActions.ts`, 43 actions, 8 groups, per-action `enabledWhen`) — **but four menu skins render it**: `IssueActionMenu primary-strip` (drawer, kanban), `IssueActionMegaMenu` (cockpit), `GroupedIssueActionMenu` (rail) which adds 3 non-registry actions (`openStateDir`, `viewJsonl`, `deepWipe`), and `IssueActionMenu overflow-only` (pipeline row).
- `MergeButton` lives **outside** the registry ("decision D6") and is wired per-surface — merge availability and labels differ by surface.
- Registry rot: `syncDiscussions` points at `POST /api/issues/:id/discussions/sync`, **which does not exist server-side** (real route: `POST /api/command-deck/planning/:issueId/sync-discussions`). `upload` / `syncDiscussions` fall through to a stub dialog ("This action opens from the shared issue action surface").
- Dead code: `components/IssueAgentCard.tsx` (rendered nowhere) still carries a parallel, registry-bypassing action set (kill, poke, resume-compact, handoff).

### 1.3 Five phase vocabularies for one lifecycle

| Surface | Words used for "where is this issue" |
|---|---|
| Board columns | To Do · In Progress · In Review · Verifying · Done |
| Pipeline groups | Ship · Review · Verifying · Work · Plan |
| Drawer timeline | Triaged · Planned · Implemented · Reviewed · Shipping · Merged |
| Cockpit stepper | Planned · Building · Reviewing · Testing · Shipping |
| Rail pips (`derivePipeline`) | plan · work · review · test · ship |

The rail's five pips are the right model. Everything else is a translation tax on the operator.

### 1.4 The kanban board is worthless at real scale

- The **To Do column renders 701 cards** (live count) — unusable as a view and expensive to render. The columns that matter hold 11 issues (8 In Progress, 3 In Review, 0 Verifying).
- Cards still carry configuration-era actions (`Start agent`, `Plan`, `Tell agent`, `Done — mark work complete & start review`, `··· 41 more`) — five actions on a card, none of them state-selected beyond the primary strip.
- Status pill sprawl on cards: `QUEUED FOR PLAN`, `WORK RUNNING`, `CHANGES REQUESTED`, `INPUT`, `MERGED`, `Resume`, `Start` — overlapping vocabularies again.

### 1.5 Loading fossils and noise

- Permanent spinners observed in a healthy system: "Loading activity…" (Activity Feed rail), "Loading tasks…" (drawer), "Loading pickup state…" (drawer), "Loading the plan map…" (cockpit), "Loading project…" (deck). None carry a data boundary, a timeout, or a stale marker.
- The operator Activity Feed is polluted with self-referential noise: repeated "Dashboard event loop p99 delay exceeded 100ms" entries drown actual pipeline events.
- Two full-width banner stacks (boot reconciliation + setup-changed) consume the top ~90px of every surface, every session.

### 1.6 Why this happened (so the fix actually fixes it)

The 2026-05 unified redesign PRD specified "one vocabulary, one row, one drawer — used everywhere." PAN-2499 then unified the **code**: a shared `IssueView` density wrapper, a shared `ISSUE_ACTIONS` registry, an `IssueViewModel` "single data model", and parity tests. What shipped was structural unification without experiential unification:

- The parity tests (`issue-actions-surface-parity.test.tsx`, `no-actions-lost.test.ts`) assert that every surface *renders* actions — not that the actions are *the same, filtered, or useful*. They lock in breadth, not coherence.
- `IssueViewModel` / `useIssueView` — the intended single data model — is consumed by **exactly one tab** (`ShipTab`). The drawer, cockpit, kanban, and rail each re-derive phase, active agent, and review status from two different sources (WS store vs. HTTP react-query — both are read, on different surfaces, for the same fact).
- The cockpit was designed as a separate destination (`IssueMissionControl`) *after* the drawer shipped, re-forking tabs, vocabulary, and the action menu.

**Lesson: convergence without a conformance gate drifts.** This PRD ships the gate with the design.

---

## 2. Goal & Non-Goals

**Goal:** A junior dev can hand off a task, answer its questions, and merge the result — with zero training and zero jargon — in the **default** UI. Underneath, one issue — anywhere in the product — has exactly **one detail view** (at three densities), **one six-word lifecycle vocabulary**, **one action menu** (grouped, state-filtered, registry-complete), and **one data model**, revealed by an "Advanced" toggle. Enforced by tests, not convention.

**Non-goals:**

- No new issue-tracker integrations, no new backend capabilities. Every read already exists; the only endpoint work is *deleting* stale registry entries and wiring existing ones correctly. **Simple mode is a presentation layer over the existing read model — not a fork, not a separate app.**
- No removal of operator power. Every advanced capability survives in Advanced mode; the CLI remains the floor.
- No visual rebranding. Tokens, typography, and badge formulas come from the existing style guide, unchanged.
- No God View redesign (still scoped-out per the 2026-05 PRD). No mobile support.

---

## 3. Design

The mocks are the binding visual spec. Where this document and a mock disagree, **the mock wins for layout; this document wins for behavior and data contracts.**

### 3.1 Simple mode — the default (contract C-SIMPLE)

> **Implementation status (2026-07-20): v2 — the conversation-first hand-off.** The home composer is now **Talk it through** (`components/simple/TalkItThrough.tsx`): description + ModelPicker → `POST /api/conversations` with a discuss-first seed prompt ("do not file anything yet… only when I say it's ready, file it as an issue and give me the link") → lands in the deck's conversation view. Verified live: the spawned agent opened with scoping questions and held off filing, exactly per the seed. Newly filed issues surface in a **Just filed** section on My work (created < 24h, not started) with Open + **Start planning** (`POST /api/issues/:id/start-planning`) — the issue enters the pipeline one click after it exists. The old GitHub-new-page hand-off is deleted. Still open from this contract: expectations ("usually ~2h"), the rich conversation in simple mode proper, Get-help routing, the junior-dev usability run, and the deck's client-side popstate not auto-selecting the fresh conversation (fresh load works — deck selection timing).

**Mockups: [`simple-home.html`](../../design/mockups/overdeck-ux-overhaul/simple-home.html) · [`simple-issue.html`](../../design/mockups/overdeck-ux-overhaul/simple-issue.html) — binding for copy and state behavior.**

The default UI answers three questions only: *what is it doing · does it need me · is it done.* Everything else is Advanced.

1. **Five user-facing states.** The internal lifecycle maps onto five plain-English states. One shared function (`userFacingState(issue)`) computes them; simple mode never renders internal phase names.

| Internal machine state | User sees | The one button |
|---|---|---|
| backlog · triaged · planned | **Not started** | `Start work` |
| planning · work running | **Working** — "writing code" | `Watch` (optional) |
| review · test · ship running | **Working** — "being checked" | `Watch` (optional) |
| input requested · changes found · stuck | **Needs you** | `Answer` / `Fix it` / `Unstick` |
| approved, ready to merge | **Ready** | `Merge to main` |
| merged · verified on main | **Done** | `See what changed` |

2. **One-button rule.** Exactly one primary action per issue per state, labeled as a plain verb phrase. At most two quiet secondary actions ("Tell the agent something", "Pause the work"). **No destructive action exists in simple mode** — stop/wipe/reset live in Advanced, so they cannot be clicked by accident.
3. **Expectations, not spinners.** Every working state carries a plain sentence and an expectation: "Started 34 min ago · usually about 2 hours · you don't need to do anything." Expectations derive from historical phase durations (already in the read model).
4. **Home = "My work".** Sections in fixed order: **Needs you** (questions, found problems, stuck) → **Working now** (cards with progress + expectation) → **Ready to merge** → **Finished**. Plus a plain-words composer: "Describe what you want built or fixed" → hands off (creates + plans + starts — the pipeline already knows how).
5. **The issue page in simple mode:** status card (icon + one sentence + expectation), a four-word progress track (Started → Writing code → Checking → Ready) — **and the live conversation as the main content.** Talking to the agent is not a secondary button here; it's the interface. The feed renders agent turns in plain bubbles, a compact "doing" log (thinking → wrote file → finished task), and your messages as your bubbles. The composer ("Say something to the agent… steer it, correct it, ask why") is always visible; steering never interrupts work — the agent reads between tasks. Questions arrive *in* the conversation with the answer box right there. A "What happened" timeline and an `<Advanced — the machinery behind this task>` disclosure (deep-linking into §3.3) sit below.
6. **Banned-words list (copy lint).** Simple-mode user-facing strings must not contain: `convoy, specialist, cloister, deacon, xBRIEF, vBRIEF, beads, gate(s), UAT, flywheel, verb badge, pipeline phase, danger zone, harness, workspace, tmux`. Approved substitutions: *tasks* (beads), *checks* (gates), *helper/agent* (specialist), *ready* (ship-ready). A CI lint (`simple-copy-lint`) fails the build on violations — the same enforcement discipline as the style-guide conformance test.
7. **Escape hatches.** A quiet "Get help" link on every simple screen, and the Simple/Advanced toggle (per-view, preference persisted per user) — never a separate URL tree, so a mentor can say "click Advanced" and see exactly the same issue.

### 3.2 One lifecycle vocabulary (contract C-VOCAB)

Six phases, in order, used by every surface: **`Plan → Work → Review → Test → Ship → Done`**.

- "Verifying" folds into **Ship** (it is post-merge verification on main; the Ship phase is not complete until verify-on-main passes). "Backlog/Todo" is the absence of a phase (pre-Plan), rendered as the Backlog rollup, not a phase.
- Display mapping (mechanical, one shared function `phaseLabel()`):
  Triaged→Backlog, Planned→Plan, Building/Implemented→Work, Reviewing/In Review→Review, Testing/Verifying→Test/Ship per above, Shipping→Ship, Merged→Done.
- **One component** renders it: `<PhaseRail>` (full, in IssueDetail), `<PhaseDots>` (mini, on cards/rows — five pips, current step ringed). Board columns, Pipeline groups, and the drawer/cockpit headers are all generated from the same six-token enum. A unit test asserts the enum has six members and that every surface imports the shared label function (grep-level conformance).

### 3.3 One IssueDetail, conversation-first (contract C-DETAIL)

> **Implementation status (2026-07-20): the one component exists — `issue-detail/IssueDetail.tsx`.** The drawer's entire anatomy (paused banner, tab strip, phase rail + specialist strip as the per-agent conversation switcher, all tab bodies, the 320px status rail) is extracted into the single component with `density: 'drawer' | 'rail'`; `IssueDrawer.tsx` is now only the frame (scrim, header, close) + `IssueDetail` + the shared action bar. `density="rail"` (compact: rail + active conversation + one action strip) is implemented and unit-tested; adoption in the deck tree's FeatureItem is tracked as follow-up. The replaced `DrawerTabs` component is deleted. **Page density decision:** the cockpit keeps its deliberate session-tree → SessionPanel conversation flow (test-enshrined in IssueMissionControl.test.tsx, which asserts *no* Conversation tab); it already mounts the same `IssueDetailShell` + `ConversationPanel` renderer. A literal page-density replacement of IssueMissionControl remains a product decision (its Code/Costs/Discussion/Ship/Timeline tabs have no home in the binding tab set) and is scoped in the follow-up issue with the decisions enumerated. Still open: rail-density adoption in FeatureItem; `useIssueView` as the only data path (both shells currently share the store + `IssueView` boundary; deleting the bespoke per-shell derivations is the remaining deep item).
>
> _(2026-07-19): conversation-first drawer live — opens on Conversation by default, phase rail + specialist strip as the per-agent conversation switcher (verified live: chip → `agent-min-865-review-correctness`)._

**One shell, three densities — and the conversation is the main pane.** `components/issue-detail/IssueDetail.tsx` takes `density: 'drawer' | 'page' | 'rail'` and replaces: `drawer/IssueDrawer.tsx`, `Stage/cockpit/IssueMissionControl.tsx`, the rail expansion sections in `FeatureItem.tsx`, and the issue-detail responsibility of `KanbanCards.tsx` (cards become summary-only; clicking opens the drawer).

- **drawer** — 1120px slide-over (today's drawer frame, scrim + blur). Opened from every row/card/⌘K result. URL: `?issue=<id>&tab=<tab>` preserved.
- **page** — full-width, replaces the cockpit route `/command-deck/:project/:issue`. Same component, same tabs, wider main column. The cockpit's unique sections (DAG, UAT stack, ship log, status narrative) move into the shared shell — that is the point.
- **rail** — the deck-tree inline expansion renders the same sections at compact density (phase rail + active conversation + resources + one action strip).

**Conversation-first layout (binding).** The Conversation tab is the **default**, not a tab among eight:

- The main pane renders the existing first-class conversation stack — `components/chat/` (`ConversationPanel` + `MessagesTimeline` with thinking/tool-call work-log rows + `ChatMarkdown` + `ComposerFooter` with model picker, attachments, voice). The same renderer the deck's conversation view uses today; the drawer's gray "stream excerpt" box and "No recent stream output" states are deleted, not re-skinned.
- **The phase rail doubles as the per-agent conversation switcher.** Plan, Work, Review, Test, Ship each own a conversation; clicking a rail step (or its agent chip) switches the main pane to that conversation. This makes the user's "work and review and stuff — super important to know what's going on" directly navigable, one click apart.
- **A phase that runs a convoy shows a specialist strip.** Review typically runs four specialists (`review.security · correctness · performance · requirements`); the strip below the rail lists every agent in the active phase with its status dot, verdict badge, and last conversation line. Clicking a chip opens *that specialist's* conversation — with full history (thinking blocks, tool calls, verdict message) — and the composer addresses that specialist. Queued specialists show an explicit "conversation starts when it runs" state. The same strip pattern serves any multi-agent phase (work convoys, swarm slots).
- **Status facets move to an always-visible right rail** (verification gates, review specialists, resources, live activity) — the facts you consult *while* steering, never a tab away.
- The remaining tab set: `Conversation · Plan map · Tasks · Terminal · Activity · Files · Artifacts`. The DAG (`xbrief/DagRenderer` via `PlanMapCard`) is the body of *Plan map* at every density — no more "one view has the DAG".

**One data model.** `useIssueView` (today consumed by exactly one tab) becomes the only data source for the shell. Drawer/cockpit/rail-specific derivations (`useDrawerData` phase timeline, `derivePipeline`, `phaseStatus`, `deriveIssueActionPhase`, ad-hoc `fetch /api/workspaces/:id`) are deleted in favor of the single model. Review status reads from exactly one transport (WS store), not WS-on-one-surface / HTTP-on-another.

### 3.4 Conversation access model (contract C-CONVO)

> **Implementation status (2026-07-19): v1 shipped.** Level 1 · **Peek** (`issue-detail/IssuePeek.tsx`): 350ms hover-intent quick-look with phase dots, state sentence, last-said (memory observations), review line, and "pop into dock" — wired into Pipeline rows via a `peek` prop on the shared `IssueRow` primitive. Level 2 · **The Dock** (`components/dock/ConversationDock.tsx` + `lib/convoDock.ts` slice): persistent right rail on every surface, ≤8 issue conversations with observations feed + tell composer, needs-you pinned amber, persisted across sessions. Still open: peeks on kanban cards / agent pills / deck rows, dock panels rendering the full rich transcript (v1 renders the observations slice), ⌘J jump, two-up comparison, and the same-transcript-slice guarantee across depths (needs the C-DETAIL data model).

**Mockup: [`patterns.html`](../../design/mockups/overdeck-ux-overhaul/patterns.html) — interactive, binding for behavior.**

Steering happens in conversations, so conversation access is layered into **three depths** — one renderer (`components/chat/`), three presentations:

| Depth | Pattern | Behavior |
|---|---|---|
| **1 · Glance** | **Peek** (hover quick-look) | Every issue row, card, and agent pill carries a live "last said" line. Hover (350ms intent delay) opens a peek: last 2–3 turns + phase dots + gate state. No navigation, no layout shift. ⌥-hover pins; click opens the issue; ⏎ jumps straight into the conversation; ⌘⇧ pops it into the dock. |
| **2 · Talk** | **The Dock** (persistent conversation rail) | A collapsible right rail on every surface holding open conversations — cross-issue by design. Items show agent, issue, last line, unread/needs-you state; expanded items render the full conversation with composer. Two can be open side-by-side (work + review, the pair operators actually compare). Conversations persist in the dock while you navigate; ⌘J jumps to any conversation. |
| **3 · Deep-dive** | **IssueDetail Conversation tab** (§3.3) | The full surface: phase-rail switcher, specialist strip, complete history, Terminal/Files/Artifacts one tab away. |

Rules: peeks and dock items render the same transcript slice the deep-dive shows (no summary drift); "needs you" items pin themselves to the top of the dock until answered; the dock is per-user state, remembered across sessions. In simple mode the dock exists but starts collapsed to unread/needs-you items only — a junior dev is never greeted by a wall of other people's agents.

### 3.5 One action model (contract C-ACTIONS)

The 43-action registry **stays**. Everything wrong is in presentation and rot, not in the catalog.

1. **One menu component.** `<IssueActionMenu>` (single implementation) renders the registry in three presentations: `strip` (drawer/page footer), `overflow` (cards, rows), `context` (right-click). Deleted skins: `IssueActionMegaMenu`, `GroupedIssueActionMenu`, the rail's non-registry extras (moved into the registry as first-class entries), and the dead `IssueAgentCard` action set (component deleted).
2. **Six fixed groups, fixed order:** `Communicate · Lifecycle · Recover · Inspect · Navigate · Danger`. (Today's 8 groups collapse: planning+work+review → Lifecycle; workspace → Recover; artifacts → Inspect; navigation stays; danger stays.)
3. **State-filtered.** `enabledWhen` predicates are *enforced visually*: failing actions render greyed with a reason tooltip (`Start agent — "work already complete"`), never as live buttons, never hidden. The flat 37-item dump is banned.
4. **Phase-primary strip.** 1–2 primary actions chosen by phase: Backlog→`Plan…`/`Start — skip planning`; Plan-running→`Watch planning`; Planned→`Start agent…`; Work→`Tell agent…` + `Done`; Review→`Watch review`/`Recover`; Changes-requested→`Tell agent…`; Test/Ship-running→`Watch`; Ready→`Merge`; Done→`Close out…`.
5. **Merge joins the registry.** One entry, `kind: safe`, `enabledWhen: ready-to-merge`, rendered primary at Ship. No per-surface bolt-ons, labels from the registry only.
6. **Registry hygiene.** Delete or fix the two dead endpoint mappings (`syncDiscussions` → real route), implement or remove the two stub-dialog actions, and add the rail's three extras properly. A CI test curls each registry endpoint against the route table and fails on 404s.
7. **Danger confirms.** All `Danger` group actions open a confirm dialog; `wipe`/`destroyWorkspace` keep the typed-confirm pattern. Danger count is derived from the same filter as the menu — two surfaces can never disagree again, because there is one menu.

### 3.6 Board rebuilt around attention (contract C-BOARD)

> **Implementation status (2026-07-19): v1 shipped.** Backlog column rolls up by project above 30 issues (`KanbanBoard/BacklogRollup.tsx` — count + top-3 by priority, per-group expand to full cards); "Needs you" strip above the columns (`KanbanBoard/NeedsYouStrip.tsx` — same derivation as simple home: questions with inline answer, problems with fix-them, stuck with unstick, advanced targets open the drawer); mini phase dots on every card (`issue-detail/PhaseDots.tsx` on the shared classifier); column titles now speak the vocabulary (Backlog · Work · Review · Ship · Done). Still open: the Plan column (needs grouping by derived phase, not tracker status), virtualized rendering in active columns, drag-and-drop simplification, and Done collapsed to recent-N.

- **Backlog is a rollup, not a column of 701 cards.** The leftmost column groups backlog by project (count + top 3 by priority each), with "Show all N →" opening a virtualized, filterable list. The Board's job is WIP, not storage.
- **Columns = the vocabulary:** `Backlog · Plan · Work · Review · Ship · Done` (Test renders as the fourth pip on cards in Review/Ship; a column per phase was rejected — six columns don't fit, and Test is convoy-fast).
- **Card anatomy (fixed):** priority left-border · ID + one verb badge · title (2-line clamp) · neutral labels · mini phase dots · agent line (name·model·runtime, or "no agent yet") · **one** state-appropriate primary action + `⋯`. No configuration controls, no five-action footers, no "41 more" text.
- **"Needs you" strip above the columns.** Pending input requests, changes-requested, and stuck agents — the only three states that need a human — render as actionable cards above the board regardless of column. This becomes the answer to "what do I need to do right now" on every surface (it also heads the Pipeline page).
- Virtualized rendering in every column; Done collapsed to the cycle's recent N.

### 3.7 Freshness contract (contract C-FRESH)

> **Implementation status (2026-07-19): v1 shipped.** Event-loop p99 diagnostics no longer emit operator-feed activity entries (console + `/api/metrics` sample only — the feed is pipeline events, not self-heartbeats). System notices render in ONE slim row (`system-notices-row` in AppChrome; boot-reconciliation and sync-required are compact chips with actions, detail on title). `primitives/LoadingBoundary` gives regions an explicit data boundary — after 8s the spinner becomes a labeled "taking longer than usual · Retry" state, wired into the four worst fossils (activity feed, plan map, tasks panel, pickup gate). Still open: boundaries across every region (adopt `LoadingBoundary` per surface), `updated Ns ago` markers, feed source filters beyond the p99 case, and the freshness e2e.

- Every data region declares its boundary: **live** (WS subscription), **polled** (interval shown), **unavailable** (explicit empty state with reason). Rendered regions carry `updated Ns ago` / `stale` markers; skeletons must resolve or error within 5s. An integration test asserts no region renders a spinner past its boundary.
- **Feed hygiene:** dashboard-internal diagnostics (event-loop p99, self-heartbeats) leave the operator Activity Feed; they go to Health. The feed only carries pipeline-relevant events (issue, agent, review, merge).
- **Banner consolidation:** boot-reconciliation and setup-changed collapse into one dismissible notification center item each; at most one slim banner row renders at a time.

### 3.8 Verbosity handling & theming (contracts C-VERB, C-THEME)

**C-VERB — wordy by default, digest by design.** Measured reality (MIN-865, PAN-2377 conversations): single agent turns run 4–10 paragraphs; completion messages ship bullet lists; work-log rows carry raw ~150-char JSON exec payloads and `wait` lines; one conversation view holds ~277k characters. The conversation renderer must assume verbosity, not sample brevity:

1. **Digest-first turns.** Every agent turn leads with a one-line digest (the verdict/result sentence). Bodies longer than ~6 rendered lines auto-collapse behind "▸ N more lines"; expansion is per-turn and never resets scroll. (Today `MessagesTimeline` already collapses *some* blocks — the contract is: uniform, every block type, with a line budget.)
2. **Grouped command runs.** Consecutive exec/wait tool-call rows collapse into one group row ("6 commands · 2 waits"), expandable inline. Payloads are single-line-truncated; full payload on expand. Thinking blocks stay one-line each.
3. **Verdict extraction.** Completion/verdict messages (review passed, work complete, changes requested) render as structured result cards — outcome line + extracted bullets — not raw paragraphs.
4. **Depth budgets.** Peeks show ≤2 turns + status line; dock items show ≤3 turns or the question verbatim; the full transcript lives only in IssueDetail/Conversation. No depth invents summaries — all render the same transcript slice, truncated.
5. A snapshot test feeds the renderer a synthetic wordy transcript (10-paragraph turns, 60 tool rows) and asserts: no turn renders beyond its line budget, groups collapse, scroll anchoring holds on expand.

**C-THEME — both themes, one token system.** Every mock and every new component must render correctly in light AND dark mode using the existing token blocks (`index.css :root` and `.dark`) — no hardcoded hex, no dark-only assumptions (light-mode cards are borderless with ambient shadow per style guide; code/stream panels stay dark in both themes). The mocks ship with a theme toggle for review. Gate: the existing styleguide-conformance Playwright test runs its key screens in both color schemes; new screens join that matrix. Simple-mode screens are included — junior devs get light mode too.

### 3.9 Conformance gates (the part last time was missing)

> **Implementation status (2026-07-20): gates live in CI** (`src/lib/__tests__/conformance-gates.test.ts` + `simple-foundations.test.ts` + `issueActions.c-actions.test.ts`). Single-shell topology freeze (sanctioned importers of `IssueDetail`/`IssueDetailShell`/`DrawerAgentSession`; `DrawerTabs` stays deleted), single-menu-skin topology (`IssueActionGroupedBody` only inside the `IssueActionMenu` skin; `IssueActionMegaMenu`/`IssueAgentCard` stay deleted), vocabulary grep gate (legacy phase labels never re-enter production source — the dead `StatusNarrative` journey stages and `useDrawerData` legacy labels are burned out of the tree, not just unrendered), enabled-set snapshot across 10 representative phases, route-table probe, copy lint, and the exhaustive state-mapping parity test all run in the unit suite.

| Gate | What it asserts | Mechanism |
|---|---|---|
| Single shell | Only `IssueDetail` renders issue detail; imports of `IssueDrawer`/`IssueMissionControl` fail | import-boundary lint rule + grep test |
| Single menu skin | One `IssueActionMenu`; `IssueActionMegaMenu`/`GroupedIssueActionMenu` deleted and import-banned | import-boundary lint |
| Vocabulary | `PHASES` enum is the only phase source; the five legacy label sets don't compile | shared `phaseLabel()` + codemod + test |
| Registry validity | Every registry endpoint exists in the server route table | CI test (boot server, probe route table) |
| Action filtering | For a fixed issue state, the rendered menu's enabled set equals the registry's `enabledWhen` projection — snapshot per phase | component test × 10 phases |
| Section no-loss | Every section in the inventory renders at every density (extends PAN-2499's pattern) | existing parity test, extended |
| Freshness | No spinner older than 5s in a healthy system | Playwright e2e |
| Verbosity | No turn exceeds its line budget on a synthetic wordy transcript; command groups collapse; scroll anchor holds | component snapshot (C-VERB §3.8) |
| Theming | Key screens pass styleguide conformance in both light and dark schemes | Playwright × 2 color schemes (C-THEME §3.8) |
| Simple-mode copy | No banned word (§3.1.6) in any simple-mode user-facing string | `simple-copy-lint` CI lint over the simple-mode string catalog |
| One-button rule | Simple-mode issue page renders exactly one primary action per state | component snapshot × 6 user-facing states |
| State mapping parity | `userFacingState()` covers every internal pipeline state (exhaustive) | type-level + unit test over the state enum |

---

## 4. Migration plan

Sequenced, independently mergeable, no feature flags — same discipline as the 2026-05 plan.

1. **Foundations.** `PHASES` enum + `phaseLabel()` + `<PhaseRail>/<PhaseDots>`; `userFacingState()` mapper + simple-mode string catalog; `useIssueView` extended to full shell coverage; conformance lint scaffolding (import bans, copy lint). *No visual change yet.*
2. **Simple mode.** "My work" home (Needs you → Working now → Ready → Finished, plain-words composer) + simple issue page (status card, four-word progress, one button per state, what-happened timeline, Advanced disclosure) + the Simple/Advanced toggle. `simple-copy-lint` on from day one. **This is the highest-value surface and ships first.**
3. **Action model.** Unify menu skins onto `<IssueActionMenu>`, fold MergeButton + rail extras into the registry, fix dead endpoints/stubs, delete `IssueAgentCard`, ship the filtering + group order + phase-primary strip. *Every advanced surface improves the same week.*
4. **IssueDetail shell.** Build `issue-detail/IssueDetail.tsx` with drawer density; migrate `IssueDrawer` sections in. Then page density replaces `IssueMissionControl` on the cockpit route (sections ported: DAG, UAT, ship log, narrative). Rail density last. Delete the old shells. The simple issue page's Advanced disclosure now deep-links here.
5. **Board.** Rollup backlog column, new card anatomy, Needs-you strip, column vocabulary swap. (Pipeline page gets the same strip + column labels — it stays a list, it's already close.)
6. **Freshness.** Data-boundary annotations, feed hygiene, banner consolidation, freshness e2e.
7. **Burn-down.** Remove dead routes/components flagged in steps 3–5; run full conformance gates; close the tracking issue.

Estimated scope: ~3–4 weeks of agent-cycles at normal convoy throughput; steps 2–4 are the bulk.

## 5. Success metrics

- **Conversation is one click:** from any surface, the active agent's rich conversation (thinking, tool calls, composer) is ≤1 click away — today the drawer shows a gray stream box and the kanban card shows nothing at all. Every agent role's conversation is reachable from the phase rail in ≤1 click.
- **Junior-dev core loop:** a first-week dev with no walkthrough completes *hand off task → answer one question → merge the result* in the default UI, encountering zero banned words and never needing the sidebar. Verified by a scripted usability run (fresh account, 3 tasks).
- **One button:** simple-mode issue pages render exactly one primary action per state (snapshot-tested ×6 states); destructive actions are unreachable in simple mode.
- **One click to anything (advanced):** from any surface, any fact about an issue (DAG, gates, transcripts, PR) is reachable in ≤1 click + ≤1 tab switch — today it requires knowing which of 4 views owns it.
- **Menu discipline:** overflow menu renders ≤ 12 enabled items for any issue state (vs. ~37 today); danger-count divergence between surfaces is impossible (one menu).
- **Board performance:** initial render mounts ≤ 60 cards (vs. ~860 today); To Do interaction becomes "filter the rollup", not "scroll a wall".
- **Vocabulary:** grep for the five legacy label sets returns zero; new contributors learn six words (advanced) and five states (simple).
- **No eternal spinners:** freshness e2e passes; "Loading…" older than 5s files itself as a bug.
- **Operator trust:** the Needs-you section answers "what needs me" in one glance on Home, Board, and Pipeline.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Re-forking after convergence (happened twice) | Conformance gates in CI from step 1; import bans make the old shells un-buildable once deleted. |
| Losing cockpit-only power users' workflows (DAG-first, UAT-first) | Page density keeps those sections on Overview; tab order keeps Plan map one click away. Deep links preserve `/command-deck/:project/:issue` URLs. |
| `useIssueView` becomes a god-hook | It composes existing per-domain hooks; the change is that shells stop *re-deriving*, not that one file re-fetches everything. |
| Disabled-with-reason menus feel noisy to power users | Reasons live in tooltips, not the menu body; `Explain actions` toggle (already exists) can collapse disabled rows. |
| Operators trained on the 37-item dump | The registry is complete — nothing is removed, only filtered and grouped; keyboard-first users keep ⌘K. |
| Simple mode hides something a junior dev actually needs | The Advanced toggle is per-view and same-URL, expectations explain *why* there's nothing to do, and "Get help" is always visible; usability run (§5) validates the core loop before rollout. |
| Two modes drift into two products | Both modes render the same `useIssueView` data model; the state-mapping parity gate makes the projection exhaustive, so a new internal state must choose its user-facing label to compile. |

## 7. Appendix — audit evidence

- Playwright walkthrough, 2026-07-19: 17 screenshots + action inventories (`.tmp/ux-audit/shots/`), menu DOM dumps (`menus.txt`) showing 37-item flat lists and Danger(6) vs Danger(5) divergence.
- Code architecture review: `lib/issueActions.ts` (43 actions / 8 groups), `issue-view/` (inventory, densitySections, `useIssueView` single-consumer), `drawer/`, `Stage/cockpit/`, `KanbanBoard/`, `CommandDeck/ProjectTree/FeatureItem.tsx`, dead `IssueAgentCard.tsx`, stale `syncDiscussions` endpoint vs. `routes/command-deck.ts:1212`.
- Verbosity sampling (MIN-865, PAN-2377 conversations, 2026-07-19): single agent turns of 4–10 paragraphs, ~150-char JSON exec payloads, raw `wait` rows, ~277k characters in one conversation view — the basis for C-VERB.
- Prior art: `pan-dashboard-unified-redesign.md` (2026-05), mock series in `docs/design/mockups/` (PAN-2499 three-issue-views, PAN-1610 one-registry, PAN-2398 cockpit).

---

## 8. Implementer's field guide

*Read this section first if you are picking up the work without prior context. It defines every term, points at every file, and states what "done" means per contract.*

### 8.1 Conventions

- **The mocks are binding for layout and copy** (`docs/design/mockups/overdeck-ux-overhaul/`, start at `index.html`). **This PRD is binding for behavior and data contracts.** On conflict: mock wins for visuals, PRD wins for behavior. Mock pages carry a dashed "annotation" furniture layer (numbered callouts, a `MOCKUP n of 7` banner, theme toggle) that is *not* part of the design.
- Style: tokens from `src/dashboard/frontend/src/index.css` only (both `:root` light and `.dark` blocks). DM Sans for UI prose, SF Mono for identifiers, Space Grotesk only for the wordmark, weight ≤ 500, badges `rounded-sm` at 8%/32% tint — see `design/style-guide/STYLE-GUIDE.md`.
- Both themes always (C-THEME §3.8). No new runtime dependencies without a note in the PR.

### 8.2 Glossary (internal terms you will hit in code)

| Term | Meaning |
|---|---|
| **issue** | A unit of work from the tracker (GitHub/Linear), e.g. PAN-2377. The product's central entity. |
| **phase** | Where the issue is in the machine lifecycle: Plan → Work → Review → Test → Ship → Done (C-VOCAB). Legacy code also says pipeline-state, stage, lane. |
| **agent** | A running AI process (tmux session) doing a role for an issue: `agent-<id>` (work), `planning-<id>`, `strike-<id>`. |
| **convoy** | Several specialist agents running one phase together — e.g. Review runs `review.security · review.correctness · review.performance · review.requirements`. Each specialist owns its own conversation. |
| **conversation** | The transcript of one agent session: user/agent turns, thinking blocks, tool-call rows (the "work log"). Rendered by `components/chat/` (`ConversationPanel`, `MessagesTimeline`, `ChatMarkdown`, `ComposerFooter`). |
| **workspace** | The git worktree + services an agent works in. |
| **gates / verification** | Automated checks per issue: typecheck, lint, test, UAT. "UAT stack" = the issue's running app containers. |
| **vBRIEF / xBRIEF** | The machine-readable plan format (task DAG) an issue's work agent executes. "Plan map" = its visual DAG. |
| **beads / tasks** | The plan's checklist items (bd tracker). Simple mode calls them "tasks". |
| **read model** | The server's denormalized state projection (`src/dashboard/server/read-model.ts`) feeding the UI over WS + HTTP. |
| **cloister / deacon / flywheel** | Internal daemons (agent lifecycle watchdog, reconciler, auto-dispatcher). Never user-facing words (C-SIMPLE copy lint). |
| **cockpit / drawer / rail** | Today's three issue-detail shells being replaced (§3.3). "Density" = which frame the ONE shell renders in. |

### 8.3 Current-state file map (what to build on, what to delete)

| Exists today (reuse) | Replace / delete |
|---|---|
| `components/chat/` — the full conversation renderer (mandated everywhere) | `drawer/IssueDrawer.tsx` (shell) → `issue-detail/IssueDetail.tsx` |
| `lib/issueActions.ts` — 43-action registry (keep; fix 2 dead endpoints, 2 stub dialogs) | `Stage/cockpit/IssueMissionControl.tsx` (shell) |
| `issue-view/useIssueView.ts` — the single data model (extend to full coverage) | `components/IssueAgentCard.tsx` (dead) |
| `xbrief/DagRenderer.tsx` — the plan-map DAG (render at every density) | `IssueActionMegaMenu`, `GroupedIssueActionMenu` (menu skins) |
| `IssueActionMenu` (keep as the ONE skin; add groups+filtering) | Per-surface data re-derivations (`useDrawerData` timeline, `derivePipeline`, `phaseStatus`) |
| Parity tests `issue-actions-*.test.tsx` (extend, §3.9) | Legacy phase label sets (5 of them, §1.3) |

### 8.4 Done means (per contract)

- **C-SIMPLE:** junior-dev usability run passes (§5); one primary action per state (snapshot); zero banned words (lint); destructive actions unreachable in simple mode.
- **C-VOCAB:** one `PHASES` enum + `phaseLabel()`; legacy label sets gone from the tree (grep gate).
- **C-DETAIL:** one shell at 3 densities; Conversation is the default tab; phase rail switches agent conversations; specialist strip lists every convoy agent with per-agent conversations; DAG at every density; `useIssueView` is the only data path.
- **C-CONVO:** peek on hover everywhere rows/pills exist; dock persists conversations across navigation; needs-you pinned; same transcript slice at all three depths.
- **C-ACTIONS:** one menu skin; ≤12 enabled items per state (snapshot); disabled reasons present; Merge in registry; zero dead endpoints (route-table probe).
- **C-BOARD:** ≤60 cards mounted at first render; backlog grouped rollup; needs-you strip above columns.
- **C-FRESH:** every region declares live/polled/unavailable; no 5s+ spinners (e2e); operator feed has no event-loop diagnostics.
- **C-VERB:** wordy-transcript snapshot passes (line budgets, grouped runs, verdict cards, scroll anchor).
- **C-THEME:** conformance suite passes in both color schemes.

### 8.5 Suggested first PR

Foundations (§4 step 1) + the copy lint + the theme matrix in the conformance suite. It touches no visuals, proves the gates work, and gives every later PR a green baseline.
