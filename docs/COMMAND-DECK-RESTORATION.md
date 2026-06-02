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

## 11. ISSUE-CLICK view — complete inventory across ALL eras (focused dig)

A dedicated pass on *only* the issue-click view (distinct from agent/session click).
The issue view changed shape **six times** and the peak surfaces are scattered across
three different eras — none of which the current view retains. **Mockup #2 missed
several of these (flagged ✗MISSED below).**

### Era table (issue-click → what rendered)
| Era | Commit | Component | Issue-view shape | Issue-vs-agent routing |
|---|---|---|---|---|
| 1 | `2b2803712` 01-18 | `IssueDetailPanel`✗ | id/title/status/priority/assignee/labels/desc + Start Agent | separate component from agent (`WorkspacePanel`) |
| 2 | `3805c83fb` 02-08 | `WorkspacePanel`✗ | sidebar+content; +cost by-model/by-stage/per-session | unified; layout switches on `agent` prop |
| 3 | `96da47f42` 03-17 | `InspectorPanel`✗ (rich) | agent info · **git status + Sync Main** · workspace path+location · PRD/Beads dialogs · cost by-model/stage/session · service URLs · container controls (+Postgres refresh DB) · tmux attach · **review/test/verification status + cycle counter + auto-requeue** · **status-history tree** · Review&Test/Merge/Stop/Reopen/Reset-cycles actions · `TerminalTabs` (phase-contextual) | one wrapped `DetailPanelLayout`; agent = sub-section |
| 4–5 | `29e43a0c2` 04-26 / `5a44fda35` 05-19 | Zone: `IssueWorkbench`✗ → `ZoneA`✗+`ZoneCOverview`✗+`IssueComposer`✗ | **ZoneA** = `IssueHeader` + **ActionStrip (~41 actions, phase-gated)**; **ZoneCOverview** = **10 tabs**; **IssueComposer** = spawn-and-send | issue→ZoneCOverview; agent→ZoneB+ZoneCConversation (`isAgentSelected`) |
| 6 | `194c98643` 05-28 | Drawer: `drawer/*`✓(on disk) | **8 tabs** + right `ActivityRail`; overview tab = **PhaseTimeline → WorkspaceSection → ActiveAgent → VerificationGates → BeadsList → ReviewSpecialists** | single `selectedAgentId`, persists across tabs |
| 7 | `f65307454`→HEAD | `Stage/IssueOverview`✓ | HomePane (header/launcher/AgentDock/ActionDock/Timeline) + HomePaneSections collapsibles re-homing OverviewTab/Activity/Discussions/Costs | issue→issue tab; agent→AgentPane (conversation only) |

### Union of issue-view surfaces ever shown (the complete menu)
- **Identity/header:** id · title · branch · source link · phase glyph.
- **Action set (~41, `lib/issueActions.ts`):** plan · autoPlan · watchPlanning · donePlanning · startAgent · startSkipPlanning · swarm · tell · doneWork · stop · pause/unpause · untroubled · recoverAgent · resumeSession · switchModel · requestReview · restartReview · recoverReview · syncMain · createWorkspace · copySettings · beads · inference · discussions · transcripts · upload · syncDiscussions · statusReview · open · viewPr · reopen · closeOut · wipe · destroyWorkspace · resetIssue · cancel · resetSession · restartFromPlan · restartAgent · reviewTest · inspectBead. (phase-primary subset surfaces inline; rest in overflow.)
- **Progress/state:** ✗MISSED **PhaseTimeline** (6: triaged/planned/implemented/reviewed/shipping/merged) · **PipelineStepper** (Verify→Review→Test→Merge) · ✗MISSED **VerificationGates** (typecheck/lint/test/uat, distinct from "tests") · cycle counter + auto-requeue · status-history tree.
- **Review:** reviewer grid ×4 (correctness/security/performance/requirements) w/ round cards · ReviewSpecialists rows.
- **Work artifacts:** Plan DAG · vBRIEF · Beads (list+graph) · PRD/STATE/INFERENCE markdown · ✗MISSED **Artifacts panel** (list/filter/sort).
- **Code:** PR + diffstat + review decision · diff viewer.
- **Cost:** total · by-model · by-stage · per-session · sparkline/trend.
- **Workspace/infra:** ✗MISSED **WorkspaceSection** (path · containers start/stop/restart · services URLs · tmux attach · sync-main · containerize · Postgres refresh DB) · stack-health alert.
- **Live:** ActiveAgent output buffer · ✗MISSED **ActivityRail** (real-time, 320px) · recent activity list · ✗MISSED **IssueComposer** (spawn-and-send) · memory-summary generator.
- **Conversation/terminal:** transcript · live terminal (phase-contextual TerminalTabs in era 3).

### Dormant & reusable (no rebuild)
Zone tabs (`ZoneCOverviewTabs/*`✓), `ZoneB`✓, the **entire `components/drawer/*`✓** (PhaseTimeline, DrawerVerificationGates, DrawerReviewSpecialists, DrawerArtifactsPanel, DrawerActivityRail, DrawerWorkspaceSection, DrawerActiveAgent, DrawerBeadsList — all on disk, functional, unmounted), `lib/issueActions.ts`✓ (the 41-action registry), `InspectorPanel` recoverable from `96da47f42`.

### What mockup #2 (command-deck-issue-pane.html) must add on revision
1. It's planning-phase-skewed → make **phase-agnostic** (show a work/review-phase issue so PR/diff/reviewers/tests/gates populate).
2. Add **PhaseTimeline** (issue-level progress) — distinct from the review PipelineStepper.
3. Add **VerificationGates** (typecheck/lint/test/uat) — distinct from a single "tests" card.
4. Add **WorkspaceSection** surfaces (containers/services/attach/sync-main) — likely SCAN card + DIG.
5. Add **Artifacts** + **ActivityRail** (Drawer innovations) — decide layer.
6. The **ActionStrip** must reflect the real ~41-action, phase-gated registry (primary inline, rest overflow), not 4 hand-picked buttons.
7. Consider the **IssueComposer** (spawn-and-send) — message an issue with no live agent.
All still subject to progressive disclosure (§6/§9): glance = state + next-action; most of the above is SCAN cards or DIG panes, NOT all-on.

## 12. Data-wiring verdict — what was REAL vs tacked-on

A dedicated pass classified every issue-view surface by whether it was backed by
live data or was an aspirational shell. **Result: nearly everything was REAL.**

- **REAL (live endpoint/store), safe to restore:** PhaseTimeline (derived from ReviewStatus),
  VerificationGates (typecheck/lint/test/uat from ReviewStatus), ReviewSpecialists, Artifacts
  (`/api/workspaces/:id/artifacts`), ActivityRail (WS `subscribeIssueEvents`), WorkspaceSection +
  containers (`/api/workspaces/:id` + container actions), services URLs, tmux attach, sync-main,
  containerize, Postgres refresh-db, memory-summary, ActiveAgent output (WS `subscribeAgentOutput`),
  status-history tree, verification cycle counter + auto-requeue, status billboard, Plan DAG,
  the 7-tile grid (Agent/Cost/By-Stage/Services/Attach/Actions/Workspace), pipeline stepper,
  reviewer grid ×4 + RoundCard, tests, **PR + diffstat + review decision** (`/api/issues/:id/pr`,
  fully wired despite an old "placeholder" comment), cost total/by-model/by-stage/per-session/sparkline,
  CostsTab, ActivityTab, DiscussionsTab (Linear+GitHub), BeadsTab, PrDiffTab, MarkdownTab (PRD/STATE/INFERENCE),
  recent activity, memory status.
- **TACKED-ON / hardcoded:** only the OverviewTab **quick-links footer chips** (static nav, no data).
- **Gone (not shells — replaced):** InspectorPanel, phase-contextual TerminalTabs (the Drawer's single
  terminal tab replaced them).

**Implication for the rebuild:** the kitchen-sink is justified — throw it all in, surface the
obviously-important prominently, scale back by human judgment (not by "was it ever real"), and drop
the hardcoded quick-links. See `docs/design/command-deck-issue-pane.html` (rev 2, kitchen-sink).

## 13. DECISIONS LOG (live — read this first after a compaction)

Running record of what's been **decided** with the user (2026-05-31 session). Mockups
live in `docs/design/command-deck-*.html`. The doc above (§0–12) is the archaeology;
this section is the agreed direction.

### Locked decisions
1. **The real shell is 4 regions and the LEFT is already correct — do NOT redesign it.**
   Outer sidebar (Home · Flywheel · PROJECTS · grouped lenses OPERATIONS[Command Deck/Board/
   Pipeline/Awaiting Merge/Agents/AutoPreso]/INFRASTRUCTURE[Resources]/OBSERVABILITY[Activity])
   · **Command Deck rail** (Conversations + Issues tree→agents→Resources) · **Stage** (tabbed
   conversations) · **Project Activity** (right feed). The gap is the **Stage**, not the rail.
2. **Issue view = tree (in the existing rail) + cockpit (in the Stage).** Clicking an issue or
   an agent in the rail tree opens a Stage **issue-cockpit tab**. The agent tree is NOT duplicated
   in the body — it lives in the rail.
3. **"Session" is dissolved.** Never say "session pane." You click *the Security reviewer* / *the
   Work agent*; the conversation component renders that agent's conversation. (See memory
   `project_issue_view_is_tree_plus_conversation`.)
4. **Cockpit = status band + body.** Status band (persistent issue-context header): WorkspaceHeader
   (id·title·branch·phase) · **PhaseTimeline (6: Triaged→Planned→Implemented→Reviewed→Shipping→Merged)**
   · **ActionStrip** (phase-gated, ~41-action registry `lib/issueActions.ts`; primary inline + ⋮overflow)
   · **Cost top-right** · **VerificationGates** (typecheck/lint/test/uat) · **PR card** (#/state/diffstat).
   Body = overview when issue-row selected / that agent's conversation when an agent selected.
   (User explicitly LOVED: VerificationGates visible, PR card, header/phase/actions. Cost MUST be top-right.)
5. **Tab behavior = HYBRID + pop-out.** Default **A** (one issue tab; body follows rail selection);
   **⌘/double-click an agent → opens it in its own tab (B)**; **any pane can pop out to its own window.**
6. **Scoped Launcher** kept, but must show it's scoped ("on PAN-1242") with issue-limited autocomplete.
7. **Data verdict:** nearly every historical issue surface was REAL/live-data-backed (§12); only the
   OverviewTab quick-links were hardcoded (drop). Restoration = re-wiring dormant components.
8. **Vocabulary = pan-1549 Stage→PaneBar→Pane** (HomePane/AgentPane/PlanPane/DocsPane/CommitsPane/
   TerminalPane/FilesPane/BrowserPane). Renames: ZoneB→AgentContextStrip · ZoneCConversation→AgentPane ·
   ReviewPipelineSection→PipelineStepper · PlanDAGViewer→PlanPane · MarkdownTab→DocsPane.

### Tentative / open
- **Q2** (issue-row body): leaning **overview** (gates/reviewers/PR/cost dashboard) when the issue row
  itself is selected, conversation when an agent is. NOT finally confirmed.
- **Q3** (Project Activity right panel): scope-to-issue vs project-wide — open.
- **Project-level landing** (click a project → what lands?) — OPEN, under investigation. User notes there
  may be **multiple pipeline views** and it's unclear which is used where (investigating §14).

### Mockup inventory (docs/design/)
- `command-deck-session-pane.html` — rev2 conversation-first agent view (now subsumed into the issue cockpit body).
- `command-deck-issue-pane.html` — rev2 kitchen-sink issue (superseded by the rethink).
- `command-deck-issue-rethink.html` — tree+conversation issue cockpit (the direction).
- `command-deck-stage-options.html` — A vs B vs hybrid tab behavior (decided: hybrid).
- Canonical vocabulary ref: `pan-1549-workspace-panes.html`.

### Implementation order (when we start coding — not yet)
1. **Session/agent reachability** — add session resolution to `resolveAgentPane` (Stage/index.tsx:196) +
   route rail agent-click to open the cockpit/conversation. This also fixes the double-click bug.
2. **Issue cockpit** — status band as a Stage tab (re-mount dormant ZoneCOverviewTabs/* + drawer/* surfaces).
3. **Project landing** — re-mount ProjectOverview into the project Home (pending §14 + landing decision).

### Reusable / dormant (no rebuild)
`components/primitives/*` (VerbBadge/PhaseGlyph/PhaseHeader/MetricTile/IssueRow/IssueCard/AgentCard),
all `components/drawer/*` (PhaseTimeline/VerificationGates/ReviewSpecialists/Artifacts/ActivityRail/
WorkspaceSection), `ZoneCOverviewTabs/*`, `ZoneB.tsx`, `SessionPanel`/`ReviewSummary`, `ProjectOverview.tsx`,
`PlanDAG`, `RoundCard`, `ActivitySparkline`, `BeadsTasksPanel`, `lib/issueActions.ts`.

## 14. Project-level landing + pipeline-view audit

### Where clicking a project lands TODAY
Selecting a project (Sidebar.tsx:400 → `setSelectedProjectKey`) renders **`Stage/ProjectHome.tsx`**
(CommandDeck/index.tsx:1150-1166) — a sparse Home pane: project name + stat chips (conv count only) +
Launcher + AgentDock + ActionDock (terminal/browser) + Timeline. **NOT a pipeline/overview.** And the
global **Pipeline / Board / Agents / Resources tabs do NOT filter to the selected project** (cross-project).
So there is **no project-scoped pipeline view live today.**

### Pipeline/board audit (the "multiple pipelines, unsure what's used where")
| Component | Path | Status | Render |
|---|---|---|---|
| `PipelineView` | `components/Pipeline/PipelineView.tsx` | **LIVE** `activeTab==='pipeline'` (global) | swimlanes by phase (ship/review/verifying/work/plan/todo) |
| `KanbanBoard` | `components/KanbanBoard.tsx` | **LIVE** Board/`kanban` (global) | drag-drop kanban by status |
| `ProjectOverview` | `components/CommandDeck/ProjectOverview.tsx` | **DORMANT/DEAD** (never mounted) | **project-scoped** pipeline swimlanes + hero metrics + stuck callout + cost cards |
| `ReviewPipelineSection` | `ZoneCOverviewTabs/ReviewPipelineSection.tsx` | **LIVE** in OverviewTab (per issue) | per-issue Verify→Review→Test→Merge (= cockpit PipelineStepper) |

**Verdict:** 4 pipeline-ish things — 2 global live (Pipeline=phase-swimlanes, Board=status-kanban; genuinely
distinct), 1 per-issue live, and **1 dead project-scoped `ProjectOverview`** = exactly the rich project
pipeline the user "spent tokens on," orphaned by PAN-1561, never re-mounted.

### Recommended project landing (mirrors the issue cockpit)
Project-click → **project cockpit** in the Stage Home = re-mount dormant **`ProjectOverview`** (hero metrics ·
**project-scoped pipeline swimlanes** · stuck/blocked callout · per-issue cost cards), rail alongside for nav.
Keep **global** Pipeline + Board as cross-project **zoom-out lenses** (outer sidebar). Open: keep BOTH global
Pipeline (swimlanes) AND Board (kanban), or is one redundant?

## 15. Synthesis — three nested cockpits, one shell (all three mocked)
Design phase essentially complete. The model: **Project → Issue → Agent**, each a "cockpit" in the same Stage, navigated from the unchanged left rail (Conversations + Issues→agents), with global Pipeline/Board as cross-project zoom-out lenses.

| Level | Stage shows | Click-through | Mockup |
|---|---|---|---|
| **Project** (Home tab) | revived ProjectOverview: hero metrics · stuck callout · project phase swimlanes · cost | issue card → issue cockpit tab | `command-deck-project-pane.html` |
| **Issue** (issue tab) | status band (phase/gates/PR/actions/cost-top-right) + agent-tree-driven body | agent → its conversation (in-tab; ⌘/dbl-click = new tab; pop-out) | `command-deck-issue-rethink.html` |
| **Agent** (in issue / popped) | conversation · Findings · Terminal | — | `command-deck-session-pane.html` (subsumed) |

Lenses reference: `pipeline-views-compared.html`. Tab behavior: hybrid (A default + B on ⌘/dbl-click) + pop-out (§13). Project landing = revive dormant `ProjectOverview` (§14). All historical surfaces verified real-data-backed except hardcoded quick-links (§12). Implementation order unchanged (§13): (1) `resolveAgentPane` session resolution + rail→Stage wiring, (2) issue cockpit Stage tab, (3) project cockpit Home.

## 16. IMPLEMENTATION LOG (live — update as slices land)
User authorized full implementation on `main`, incrementally, dogfooded. Discipline:
every commit must `npm run typecheck` clean; keep the dashboard building (Vite HMR is live).
"When there are options, make them selectable and keep all options available."

Slices (in dependency order):
- [x] **S1 · Agent reachability (foundation).** `Stage` `resolveAgentPane` resolves sessions
  (not just conversations) via a new `resolveSession` prop; clicking an agent in the rail tree
  opens its conversation as an `agent` pane (SessionPanel). Fixes the broken tree-click AND the
  double-click side-effect. Files: Stage/index.tsx, Stage/types.ts, CommandDeck/index.tsx.
- [x] **S2 · Issue cockpit Stage tab.** Status band (WorkspaceHeader + PhaseTimeline + ActionStrip
  + cost-top-right + VerificationGates + PR) above the body; body = overview (issue) / agent convo.
  Re-mount dormant ZoneCOverviewTabs/* + drawer/* (PhaseTimeline, VerificationGates, ReviewSpecialists).
- [x] **S2.5 · Issue cockpit BODY redesign (glance/scan/dig).** The body the status band sits above
  was itself re-refined into the glance→scan→dig progressive-disclosure model: glance band
  (blocker spotlight + single-source metric strip), scan cards + dig tabs (dedup/reorder/restore),
  all cards sourced from authoritative APIs (beads/activity/gates), dead OverviewTab + HomePaneSections
  removed. Mockup `docs/design/command-deck-issue-cockpit-v2.html`. NOTE: these landed mislabelled `(S3)`
  in commit subjects (e3e2b73be, 86140084d, f1378770a, a9a74bd58, b76d07ce4) — they are the issue-cockpit
  body, NOT the hybrid-tabs slice below.
- [ ] **S3 · Hybrid tabs + pop-out.** A default (body follows rail) + ⌘/dbl-click → own tab; pane pop-out.
  *(still pending — not what the mislabelled `(S3)` commits did.)*
- [ ] **S4 · Project cockpit Home.** Re-mount ProjectOverview as ProjectHome body (hero/stuck/swimlanes/cost).
  Mirrors the issue cockpit's glance/scan/dig. Mockup `docs/design/command-deck-project-cockpit-v2.html`.
- [ ] **S5 · Polish/options.** View toggles where options exist; keep global Pipeline/Board lenses.

Progress notes appended below as slices land (commit hashes).

### Progress
- **S1 DONE** (`7fb1d9984`, frontend tsc clean). Stage `resolveSession` prop + `resolveAgentPane`
  session resolution; `handleSelectSession` → `openSessionPaneIn` (agent pane carrying
  `agentId=sessionId`,`issueId`); `AgentPane` uses `pane.issueId`; `handleOpenPlanDialog` no longer
  silently no-ops. Net: clicking an agent in the Command Deck rail tree now opens that agent's
  SessionPanel (conversation/Findings/Terminal) in a Stage `agent` tab; re-clicks focus the existing
  tab. Verify: Command Deck → expand an issue → click Work/Review/a reviewer → its conversation opens.
  NEXT (S2): wrap that pane (or the issue tab) with the issue **status band** (PhaseTimeline + gates +
  PR + ActionStrip + cost-top-right) per the rethink mockup; then S3 hybrid tabs/pop-out, S4 project cockpit.

- **S1 VERIFIED LIVE** (browser): clicking Work in the PAN-1242 rail tree opened its SessionPanel (branch chip + Conversation/Terminal toggle + real transcript), no unavailable-placeholder. The core tree→conversation interaction now works on main.

- **Planning terminal toggle VERIFIED** (2026-06-01): clicking the live `planning-pan-1395`
  agent in the rail opens its SessionPanel with both Conversation **and Terminal** toggles;
  Terminal renders the live xterm PTY (no "unavailable" placeholder). The original
  "no way to switch a planning agent to terminal view" complaint is resolved — it was a
  side-effect of planning sessions not reaching the frontend (fixed by the AUQ-popup tmux
  filter fix `360edc268`) + S1 session resolution. No code change needed for this item.

- **#1520 awaiting-input subsystem (parallel workstream) landed**: shared indicator +
  isAwaitingInput predicate, non-blocking minimizable AUQ dialog, title-not-id, unified
  notification (#1102), and a multi-kind "Needs you" list that now covers PermissionRequest
  too (`selectPendingInputSubjects`, `0a1703f07`). Activity-feed "Needs you" is the
  cross-surface recovery affordance the remodel's Project Activity column needed.

- **S2 DONE** (2026-06-01, `5661c1d19` + `c712b4757` + `6dcf2a144`, frontend tsc clean, 127
  drawer+Stage tests pass). Issue cockpit **status band** now renders above the IssueOverview
  body: PhaseTimeline (6-step) + hybrid ActionStrip (the ~41-action phase-gated registry via
  `IssueActionMenu mode="hybrid"`) + PR card (#num + diffstat tooltip) + cost-top-right +
  VerificationGates (typecheck/lint/test/uat). Key refactor: extracted `useIssueData(issueId)`
  as the pure parameterized core of `useDrawerData()` so the dormant drawer components render
  ANY issue without touching the global `drawer` slice (no legacy IssueDrawer overlay / URL
  rewrite). PhaseTimeline + DrawerVerificationGates gained an optional `issueId` prop.
  PR + cost use the same robust query hooks as the body (`usePrQuery`, `useIssueCostsQuery`).
  VERIFIED LIVE on PAN-1242: PR #1516 (open, +831/-21), $96.79 cost, gates typecheck/lint/test
  pass + UAT pending. NEXT (S3): hybrid tabs + pop-out; then S4 project cockpit, S5 polish.
