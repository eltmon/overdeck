# Command Deck Restoration & Unification — Living Design Doc

> **Status:** Working design doc, in progress (started 2026-05-31). Drives a
> redesign of the dashboard's contextual views (project / issue / session).
> **Not** product docs — this is an engineering design artifact we iterate on.
>
> **Sequence:** archaeology → this outline → HTML mockups → iterate → implement.
> No implementation has started.

## 0. Why this exists

Across three refactors — the "pipeline" change, **PAN-1148** (#1184, unified
dashboard redesign), **PAN-1549** (delete legacy CommandDeck shell), and
**PAN-1561** (project-scoped nav) — each iteration **replaced** the prior
contextual-view content instead of layering the new action-affordances onto it.
The net effect: clicking a **project**, an **issue**, or an **issue child
(work/review/planning session)** today shows far less than it used to, and in
the session case shows nothing at all.

Two design failures compounded:
1. **Clobbering, not weaving.** New action UIs (Launcher / AgentDock / ActionDock,
   project-scoped 4-column nav) were genuine improvements, but they overwrote the
   information surfaces rather than integrating with them.
2. **No re-refinement.** Across all those iterations nobody asked, per context,
   *what is actually useful here* vs. *what was shown just because we could*. The
   old views erred toward dumping everything; the new views erred toward showing
   almost nothing. **The unification must be driven from first principles with
   progressive disclosure** (see §6), not by mechanically restoring every old panel.

## 1. Key finding — this is re-wiring, not rebuilding

Almost all the "lost" content is **dormant code still in the repo**. The refactors
deleted only the thin **orchestration shells**; the rich content components survived,
just unmounted/unreachable in the new Stage/pane architecture.

| Still in repo (dormant, reusable) | Truly deleted (orchestrators only — recover via `git show aa3a04786^:<path>`) |
|---|---|
| `CommandDeck/ProjectOverview.tsx` — hero billboard, stuck callout, pipeline kanban, issue cost-cards | `CommandDeck/IssueWorkbench.tsx` — 3-zone shell |
| `CommandDeck/ZoneB.tsx` — agent context strip | `CommandDeck/ZoneA.tsx` — issue header + action strip |
| `CommandDeck/SessionView/SessionPanel.tsx` + `ReviewSummary.tsx` + `IssueHeader.tsx` | `CommandDeck/ZoneCOverview.tsx` — 10-tab orchestrator |
| **All 10** `CommandDeck/ZoneCOverviewTabs/*` (Overview, Activity, Costs, MarkdownTab[PRD/STATE/INFERENCE], vBRIEF, Beads, PrDiff, Discussions, ReviewPipelineSection, StatusHistory, ContainerSection) | `CommandDeck/ZoneCConversation.tsx` — SessionPanel wrapper |
| `PlanDAG.tsx`, `CommandDeck/RoundCard.tsx`, `CommandDeck/ActivitySparkline.tsx`, `BeadsTasksPanel.tsx` | |

**Implication:** restoration ≈ re-mount surviving components into the new
project-scoped Stage/pane layout and weave them with the new affordances. Lower
risk and effort than a rewrite.

## 2. Refactor timeline (points collected so far — TO BE EXTENDED, see §7)

| Commit | Date | What it did | Effect on contextual views |
|---|---|---|---|
| `eb00cc296` | 2026-05-19 13:40 | Last build with `ProjectOverview` + `ProjectRightPaneTabs` (pre-1148) | richest **project** view (billboard/stuck/pipeline) + 10 issue overview tabs in right pane |
| `5a44fda35` | 2026-05-19 13:46 | PAN-1148 unified redesign — added primitives (VerbBadge, PhaseGlyph, MetricTile) | additive; contextual views unchanged |
| `ce3bbb576` | 2026-05-22 04:53 | "restore agent Conversation/Terminal view" | partial restore for the *old* layout; obsoleted by 1561 |
| `cb915f982` | 2026-05-28 18:09 | Stage mounted; `ProjectRightPaneTabs` retired | `ProjectOverview` orphaned; issue detail → issue tabs |
| `aa3a04786` | 2026-05-28 18:09 | PAN-1549 — delete IssueWorkbench / ZoneA / ZoneCOverview / ZoneCConversation | 3-zone orchestration removed |
| `f65307454` | 2026-05-29 08:18 | PAN-1561 — project-scoped nav, 4-column; `Stage/ProjectHome.tsx` + `Stage/IssueOverview.tsx` | project & issue views reduced to launcher/dock/timeline |
| `b43ec1431` | 2026-05-29 14:27 | PAN-1561 final — terminal drawer, sidebar rail | refinement |

> ⚠️ The user believes there were **earlier eras (pre-`eb00cc296`)** that exposed
> even more — including the project view that "pipeline" itself clobbered and never
> restored. The deeper pass (§7) must go back further than 2026-05-19.

## 3. Per-context inventory (Lost ⊕ Current ⊕ Weave)

### ① PROJECT view (click a project) — content in `ProjectOverview.tsx` (dormant)
- **Lost:** hero billboard (issue count · total cost · active agents · active stages); stuck/blocked callout (red banner + cards); **pipeline kanban** (Merging → Awaiting Merge → Tests → Review → Build Gate → Working → Planning → Idle) with clickable issue cost-cards (hover → model/stage cost breakdown); All/Alive/Failed filter.
- **Current (keep):** project-scoped 4-column nav; project `Launcher`; `AgentDock`; `ActionDock` (terminal/browser); project `Timeline`; `ActivityFeedSidebar`. `StatChips` shows only conversation count (dropped cost/age/diff).
- **Weave:** project Home = new launcher/dock/activity **+** restored billboard + stuck callout + pipeline-kanban (as a section or view toggle) **+** project-scoped metric chips.

### ② ISSUE view (click an issue) — content in `ZoneCOverviewTabs/*` + `ZoneA` (mostly dormant)
- **Lost:** issue header + **action strip** (plan, swarm, tell, pause/unpause, switch-model, recover, inspect beads, resume/stop); **10-tab overview**:
  - *Overview:* status billboard; **Plan DAG**; tile grid (Agent / Cost / By-Stage / Services / Attach / Actions / Workspace); **pipeline stepper** (Verify→Review→Test→Merge w/ retry/stale chips); **reviewer grid** ×4 (correctness/security/performance/requirements w/ round cards); tests section; PR + diffstat + review decision; cost sparkline; recent activity feed; quick links.
  - *Activity, Costs, PRD, STATE, INFERENCE, vBRIEF, Beads, PR/Diff, Discussions.*
  - spawn-and-send composer.
- **Current (keep):** `Launcher`, `AgentDock`, `ActionDock` (Files/Commits/Plan/Docs/terminal/browser), `Timeline`, collapsible `HomePaneSections`.
- **Weave:** issue tab = new header/launcher/dock **+** reachable Overview/DAG/pipeline-stepper/reviewer-grid/costs/PRD/vBRIEF/Beads/PR-diff **+** issue action strip — but re-refined (§6), not all-tabs-always.

### ③ ISSUE-CHILD view (click a work/review/planning **session**) — content in `SessionPanel.tsx` + `ReviewSummary.tsx` + `ZoneB.tsx` (dormant & UNREACHABLE)
- **Lost / unreachable today:** the entire session view. `SessionPanel` (conversation ⊕ findings ⊕ terminal toggle, branch chip, delivery-method toggle); `ReviewSummary` (verdict banner, per-reviewer strip, synthesis); `ZoneB` agent context strip (model, status dot, branch chip, phase/tool flash, $/hr, last-output preview, round history, idle/thinking/waiting ribbons). Clicking a session today just opens the **issue** tab.
- **Root cause:** `Stage/index.tsx:196` `resolveAgentPane` resolves only *conversations*, never *sessions*; `CommandDeck/index.tsx:~530` `handleSelectSession` routes to an issue tab.
- **Fix:** add a session-backed pane (`SessionPane` wrapping the surviving `SessionPanel`) + route single-click to it; per session type (work / review / planning / reviewer) surface the relevant default sub-view (review → findings; work/planning → conversation).

### ④ DOUBLE-CLICK → PlanDialog (fails for user; passed in Playwright)
- **Most likely cause:** single-click's side-effect (`handleSelectSession` → `setSelectedFeature` + `openIssueTabIn`) **re-renders the tree between the two clicks**, so `dblclick` never lands on the original node (Playwright's atomic dblclick dodges it); compounded by radix `ContextMenuTrigger asChild` re-cloning the button, and the silent no-op when `handleOpenPlanDialog`'s `issues.find` misses.
- **Fix direction:** make single-click non-disruptive (open the session view in a tab, don't yank the layout) **and** add an explicit affordance (context-menu "Open planning dialog" / inline button). Fixing ③ likely fixes ④.

## 4. Code anchors (current)
- `src/dashboard/frontend/src/components/Stage/index.tsx:196` — `resolveAgentPane` (conversations only).
- `src/dashboard/frontend/src/components/Stage/panes/AgentPane.tsx` — already supports `{ session }` → `SessionPanel`; never fed one.
- `src/dashboard/frontend/src/components/Stage/types.ts` — `AgentPaneData = { conversation?, session? }`.
- `src/dashboard/frontend/src/components/CommandDeck/index.tsx:~530` `handleSelectSession`, `:447-468` `openIssueTabIn/openConversationTabIn/openTerminalTabIn`, `:727` `handleOpenPlanDialog`, `:1215` PlanDialog render.
- `src/dashboard/frontend/src/components/CommandDeck/ProjectTree/SessionNode.tsx:530-537` — onClick / onDoubleClick.
- `src/dashboard/frontend/src/lib/panesStore.ts:19` — `PaneType` union; pane carries `agentId/conversationId/viewMode`.

## 5. The AskUserQuestion / planning-dialog context (related, already resolved)
- Single-click conversation view and double-click PlanDialog are SEPARATE from the AUQ Q&A modal.
- The `ask-user-question-hook` (PAN-1520) **is** the dashboard Q&A modal engine — do not remove it. (Removed 2026-05-31, reverted `0037fbb29`.) See memory `project_auq_hook_is_the_modal`.

## 6. First principles & progressive disclosure (the lens for mockups)

Do **not** restore every old panel. For each context, design from the job-to-be-done,
then apply progressive disclosure: surface the few things needed *at a glance*; reveal
depth on demand.

Guiding questions per context:
- **What is the ONE question this view answers at a glance?**
  - Project: "where is everything, and what's stuck/costing me?"
  - Issue: "what is the state of this work, and what can I do next?"
  - Session: "what is this agent doing/saying right now, and is it healthy?"
- **Glance layer** (always visible, ~5 items max): status, the single most-important metric, the blocker if any, the primary action.
- **Scan layer** (one interaction away — a tab/expand/hover): the supporting breakdown (costs, DAG, reviewer grid, tests, PR).
- **Dig layer** (deliberate — open a pane/dialog): raw transcripts, full diffs, beads graph, markdown docs.
- **Kill "because we can" surfaces:** anything that was shown by default but rarely actioned moves down a layer (or is dropped). Examples to scrutinize: always-on Plan DAG, all-10-tabs-visible, raw INFERENCE markdown, the tile grid's rarely-used tiles.
- **Unify, don't duplicate:** project/issue/session share primitives (status pill, cost chip, agent strip, timeline). Define them once; vary density by level.

Acceptance test for any mock: a new operator can answer the context's glance-question
in <2 seconds without scrolling, and can reach any "dig" detail in ≤2 clicks.

## 7. Open work
- [ ] **Deeper/earlier archaeology** (pre-`eb00cc296`, back to the contextual views' origins) — find richer earlier eras the user remembers, especially the pre-"pipeline" project view. *(in progress — appended below as found)*
- [ ] Catalog **other info surfaces** that could unify here (GodView/AgentCard, Board, Pipeline page) so we don't reinvent.
- [ ] HTML mockups per context (Project / Issue / Session), first-principles + progressive disclosure.
- [ ] Implementation order (likely: ③ session pane first — smallest, unblocks double-click; then ② issue; then ① project).

## 8. Deeper-archaeology findings (full lineage back to origin)

The view lineage goes back to **`c897ca9bf` (2026-01-18, v0.1.0)**. Crucially, the
richest contextual views predate the May-19 baseline — the user was right. Verified
component status noted inline (✓ present / ✗ deleted / mounted).

### Full era timeline
| Era | Commit | Date | Issue/Session/Project surface | Notable |
|---|---|---|---|---|
| 0 Initial | `c897ca9bf` | 01-18 | `KanbanBoard` (5 cols) · `IssueDetailPanel`✗ (id/title/status/priority/assignee/labels/desc + Start Agent) · `AgentDetailView`✓ (status, specialist state, 24h health timeline) | workspace-level only |
| 1 Unified detail | `3805c83fb` | 02-08 | `WorkspacePanel`✗ — agent status/model/uptime, terminal tail, **cost by-model/by-stage/per-session**, container controls, review status, verification gate, attempts timeline | PAN-145 |
| 2 **InspectorPanel** | `96da47f42` | 03-17 | `InspectorPanel`✗ (**richest issue view ever**) — cost by-model/by-stage/per-session, PRD/STATE modals, **Beads** task list, **verification gates + cycle counter**, status-history tree, container controls, reopen/reset-review | PAN-331, Stitch design system |
| 3 **God View** | `0ef6a3287` | 03-18 | `GodView`✓**mounted** (**richest session/agent view ever**) — multi-agent grid, **live canvas terminals**, **cost donut by phase**, infra gauges, activity feed, click-through focus modal (Beads kanban, file-activity tree, agent timeline) | PAN-341, socket.io realtime |
| 4 Inspector+terminals | `12fcada09` | 04-14 | InspectorPanel + `TerminalTabs` (phase-contextual terminal, auto-follow/pin) | PAN-509 |
| 5 Three-zone deck | `29e43a0c2` | 04-26 | `IssueWorkbench`✗ + `ZoneA`✗/`ZoneB`✓/`ZoneCOverview`✗ + `ZoneCConversation`✗ → `SessionPanel`✓ | PAN-830 |
| 6 ZoneCOverview tabs | `d850764b4` | 04-26 | the 10 issue tabs (`ZoneCOverviewTabs/*`✓) — Overview/Activity/Costs/PRD/STATE/INFERENCE/vBRIEF/Beads/PR-Diff/Discussions | — |
| 7 ProjectOverview | `463394a9b` | 05-10 | `ProjectOverview`✓ — hero billboard, stuck callout, **8-stage pipeline swimlanes**, per-issue cost-cards w/ model/stage hover | the project view "pipeline" later eclipsed |
| 8 PAN-1148 | `5a44fda35` | 05-19 | Zone architecture stabilized; tab state in URL | — |
| 9 Drawer | `194c98643` | 05-28 | `drawer/IssueDrawer`✓ + `DrawerAgentSession`✓ — conversation/terminal/findings/activity/plan/beads tabs, `PhaseTimeline` | intermediate; present, likely dormant |
| 10 PAN-1549 | `aa3a04786` | 05-28 | deleted IssueWorkbench/ZoneA/ZoneCOverview/ZoneCConversation | — |
| 11 PAN-1561 | `f65307454`→`b43ec1431` | 05-29 | current `Stage/ProjectHome`✓ + `Stage/IssueOverview`✓ (launcher/dock/timeline) | — |

### Sibling surfaces already in the app (reuse, don't reinvent) — all current/mounted
`Board` (KanbanBoard), `Pipeline` (PipelineView — phase matrix, realtime cost), `Agents`
(FleetAgentsView — fleet grid/table/timeline), `Activity`/`Sessions`, `Resources`
(containers+infra), `Metrics`, `Costs` (daily trend, by-model/stage, budget warn), `Health`,
`GodView`/Flywheel (live), `Awaiting Merge` (human merge gate).

### **Reusable primitives that already exist** (`components/primitives/`)
`VerbBadge` (status pill), `PhaseGlyph`, `PhaseHeader`, `MetricTile`, `MetricStrip`,
`IssueRow`, `IssueCard`, `AgentCard`, `TopBar`, `Button`. Plus semi-reusable:
`ActivitySparkline`, `RoundCard`, `StatusDot`/`RoleBadge`, `CostBreakdownModal`,
`BeadsTasksPanel`, `PlanDAG`, `IssueActionMenu`, `PlanDialog`. **The unified views should
compose these — a design language already exists.**

### Duplication patterns to unify (same data, ≥3 renderers each)
agent status+model · cost display · phase progression · issue summary · agent activity stream.

### Deep regressions (present in an old era, gone in ALL later)
- **Issue:** PR/Diff tab, Discussions tab, STATE/continue markdown, workspace container controls, verification-cycle counter.
- **Session:** God View's per-phase **cost donut**, infra gauges, **file-activity (git diff) tree**, multi-agent simultaneous realtime (God View still exists but is a separate top-level view, not the per-issue session context).
- **Never surfaced but relevant:** project cost **trend** (7-day), workspace git state (ahead/behind/uncommitted), related issues (blocks/blocked-by/epic), session handoff + AUQ Q&A history.

## 9. First-principles synthesis (the lens for mockups)

The lineage shows two failure modes to avoid: the **InspectorPanel/God-View era over-dumped**
(every metric, always on); the **PAN-1561 era under-showed** (launcher + timeline, nothing else).
Neither re-refined for *usefulness*. Apply progressive disclosure (glance → scan → dig), compose
the existing primitives, and demote anything historically shown-but-rarely-actioned.

### ① PROJECT — glance-question: *"What's flowing, what's stuck, what's it costing?"*
- **Glance:** MetricStrip (issues · total cost · active agents · stuck count) · stuck/blocked callout (only if >0).
- **Scan:** pipeline swimlanes (8 stages) with IssueCard cost-chips; All/Alive/Failed filter; 7-day cost trend sparkline.
- **Dig:** click issue → issue context; hover cost-chip → model/stage breakdown.
- **Drop/Demote:** anything per-issue beyond {id, title, phase, cost, blocker-reason} on the card.

### ② ISSUE — glance-question: *"What's the state, and what can I do next?"*
- **Glance:** header (id · title · phase glyph · cost chip · branch) + **action strip** (the primary next-actions: plan/start/tell/review/merge, context-gated) + blocker banner if stuck.
- **Scan:** compact status row — pipeline stepper (Verify→Review→Test→Merge) · reviewer grid (4, collapsed to dots+verdict) · tests · PR/diffstat. vBRIEF/Plan-DAG behind one tab/expand, not always-on.
- **Dig:** tabs/panes for PRD/STATE/INFERENCE, full vBRIEF DAG, Beads graph, PR diff, Discussions, full cost breakdown, activity feed.
- **Drop/Demote:** the always-on Plan DAG (520px) and the 7-tile grid → move to dig; INFERENCE raw → dig-only.

### ③ SESSION (work/review/planning/reviewer) — glance-question: *"What is this agent doing/saying now, and is it healthy?"*
- **Glance:** ZoneB-style context strip — role/model · status dot (active/idle/thinking/waiting) · branch chip · $/hr · last-output line.
- **Scan:** the conversation transcript (default) with round dividers; for **review** sessions default to the findings/verdict view (ReviewSummary).
- **Dig:** terminal (live tmux), per-round cards, findings detail, delivery-method toggle.
- **Mechanism:** add a `SessionPane` (wrap surviving `SessionPanel`) + make `resolveAgentPane` resolve sessions + route single-click here. This also fixes the double-click (single-click stops being layout-disruptive).
- **Drop/Demote:** raw output buffer beyond the last line → into terminal/dig.

### Cross-cutting
One status pill, one cost chip, one agent-context strip, one timeline — defined once in
`primitives/`, density varied per level. Acceptance test (from §6): glance-question answerable
in <2s without scrolling; any dig detail ≤2 clicks.

## 10. Recommended mockup + implementation order
1. **Session context (③)** — smallest, unblocks the single-click conversation view AND the double-click; pure re-wire of `SessionPanel` via a new `SessionPane`.
2. **Issue context (②)** — most lost; all components dormant-ready; biggest payoff.
3. **Project context (①)** — re-mount `ProjectOverview` surfaces, add 7-day trend.

Mockups (static HTML) per context before any code, iterated with the user.
