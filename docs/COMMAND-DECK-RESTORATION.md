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

## 8. Deeper-archaeology findings (appended)

_(to be filled by the deeper pass)_
