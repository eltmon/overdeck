# PAN-830: Unified Command Deck — Issue + Agent + Workflow as One Surface

## Status

Planned. Supersedes the narrow follow-up scope previously filed under PAN-830 (which was misnamed "PAN-825" and only addressed two surface bugs from PAN-821). Reverses the per-round reviewer fan-out introduced by PAN-821.

## TL;DR for the engineer picking this up

> You're rebuilding the right pane of Command Deck so that one issue + all of its agents + every workflow action you'd normally reach via kanban / inspector / badge bar / status flow / workspace pane lives in **one cohesive view** — and the whole thing **feels alive**: every agent action emits an event, every event drives a tiny piece of UI motion, and the user can sit and watch agents breathe, think, type, ship.
>
> The kanban, inspector, badge bar, and status-flow controls **stay exactly as they are** — Command Deck reaches feature parity by mirroring their actions, not by deleting them. The kanban revamp is a future, separate effort.
>
> Three zones, top to bottom: **(A) issue header** (always visible) — **(B) agent context** (changes with selected session) — **(C) conversation + composer** (existing components reused). Plus a new **"issue-selected" mode** that fills zone C with a tabbed dashboard when no agent is selected.
>
> Reviewers stop spawning fresh sessions per round. One canonical tmux session per role per issue, alive across rounds, with the JSONL growing across rounds and round dividers in the timeline.
>
> If you ever feel tempted to add a "refresh" button: don't. Subscribe to a domain event instead.

## Problem

PAN-821 shipped the project-rooted session tree, but the experience that landed has three structural failures plus one missed opportunity:

### 1. Reviewers fan out as fresh sessions on every round

`runParallelReview` (`src/lib/cloister/review-agent.ts:654`) builds `reviewId = review-${issueId}-${Date.now()}` and spawns brand-new tmux sessions named `review-{issueId}-{timestamp}-{role}` on each round. Reviewer state directories are wiped by `cleanupReviewerStateDirs` (`src/lib/cloister/review-agent.ts:851`) when the round completes. The result in the session tree:

```
review                  ○ ended
reviewer/correctness    ○ ended
reviewer/security       ○ ended
reviewer/performance    ○ ended
reviewer/requirements   ○ ended
reviewer/synthesis      ○ ended
reviewer/correctness    ○ ended  ← round 2, different session
reviewer/security       ○ ended
reviewer/performance    ○ ended
…
```

Twelve+ near-identical rows for a feature that went through three rounds, none of which the user can usefully click into because each is a frozen single-message transcript. The user's mental model is "one reviewer-correctness who reviewed three times" — the implementation gives them three reviewer-correctness ghosts.

### 2. Conversation view never loads for agent sessions

`resolveJsonlPath()` in `src/dashboard/server/routes/command-deck.ts:227` looks up `<sessionId>.jsonl` (e.g. `agent-800.jsonl`), but Claude Code stores JSONL files under the conversation UUID (`a41c2117-2add-47cb-be57-4eb8d27b7195.jsonl`). Every session reports `hasJsonl: false`, so clicks fall through to the raw transcript fallback — exactly the terminal-first behavior PAN-821 was supposed to retire.

### 3. The Command Deck has no opinion on issue + agent + workflow as one surface

The current project view is a session tree on the left and a transcript on the right. Everything else about the issue lives somewhere else:

- **Kanban `IssueCard`** (`src/dashboard/frontend/src/components/KanbanBoard.tsx:2486`) carries 30+ badges (review status, test status, merge status, container health, attention count, vBRIEF presence, agent presence, beads count, cycle, milestone, branch, …) plus a 6-action context menu plus per-agent operation buttons. It is the de facto control panel.
- **`InspectorPanel`** (`src/dashboard/frontend/src/components/InspectorPanel.tsx`) carries another ~25 actions across `AgentInfoSection`, `ReviewPipelineSection`, `ContainerSection`, `ActionsSection`, `BadgeBar` modals.
- **`StatusFlowControl`** carries the kanban transitions: move to Todo / In Progress / In Review / Done.
- **`WorkspacePane`** carries a separate list of buttons depending on whether work is active.

These four surfaces describe the same underlying object — an issue with agents on it, in some pipeline state, with some history of what's been done — but the user is asked to learn four different mental models for getting at it. The Command Deck project view, which should be the one place where every kanban+inspector capability is reunified, instead silently delegates everything back out.

### 4. The view doesn't feel alive

PAN-821 ships a static-looking tree and a static-looking right pane. Agents are doing work — calling tools, thinking, completing rounds, accumulating cost — and almost none of that visibly **moves** in the UI. The God View activity feed is the closest thing in the app to "agents you can feel"; Command Deck, which is more central, is the quietest surface. That's backwards.

## Goal

Make Command Deck the **single, complete, alive surface for an issue and its agents** — the be-all-and-end-all of everything you could ever need to see or do for an issue, with zero gaps versus the existing surfaces and a constant low-grade pulse of motion that lets the user *feel* the agents working.

This is **additive**: the kanban / inspector / badge bar / status-flow stay exactly as they are today. They're slated for their own future revamp; this PRD does not touch them. Command Deck reaches feature-parity by mirroring every action, not by replacing those surfaces.

Three zones in the right pane, in order top to bottom:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ZONE A — Issue header (always visible)                                  │
│   Identity · pipeline stage · live cost · activity sparkline · actions  │
├──────────────────────────────────────────────────────────────────────────┤
│ ZONE B — Agent context (changes with selected session)                  │
│   Role badge · live status · phase · tool · round history · session ops │
├──────────────────────────────────────────────────────────────────────────┤
│ ZONE C — Conversation + composer (primary content, ~70% of pane)        │
│   <MessagesTimeline /> + <ComposerFooter /> reused from ConversationPanel│
│   OR: tabbed issue-overview when the issue (not an agent) is selected   │
└──────────────────────────────────────────────────────────────────────────┘
```

The session tree (left rail) is unchanged in shape but flattened: one node per **canonical role**, not one per round.

## North-star principle: liveness

> The Command Deck should never look static. If you stare at it for 30 seconds with an active issue, you should see at least one thing moving — a dot pulsing, a number ticking, a tool name changing, a round divider sliding in. The user is watching agents work; we should make the work visible.

Concrete rules:

1. **No refresh buttons.** Anywhere. If the data is fetched at a polling interval today, prefer subscribing to the matching domain event tomorrow. The polling fallback exists, but it's a fallback, not the primary path.
2. **Every domain event triggers a small, specific motion.** The motion is short (≤500ms), low-amplitude (no full-screen flashes), and informative (the motion encodes *what* happened — a green slide-in for a tool-call success, a red shake for a failure).
3. **Motion is layered, not jarring.** A slow breathing glow on an idle agent + a 1Hz alive-dot pulse on a working agent + a one-shot slide-in for a new round divider can all happen in the same view without colliding. The mock already shows this layering (alive dot + stage dot + shimmer-on-RTM + working cursor).
4. **Cost is a heartbeat.** Every cost increment animates. The user should be able to glance at the cost number and know whether agents are *currently spending* without reading anything else.
5. **Tool calls are visible.** When an agent's `currentTool` changes (via `agent.activity_changed` event), Zone B updates within ~100ms, and the previous tool name fades out as the new one fades in. A junior dev should be able to watch the tool name field change in real time as the agent works.
6. **Activity sparkline.** Zone A carries a small (~120×16px) inline sparkline of the last hour's events for this issue, color-coded by event type. It updates with every new domain event.

The whole point is: when you're watching an agent that's running, **you can see it running**. When you're watching an agent that's idle, **you can see it idling** (slow gentle breathing, not flatline). When the agent does *anything* — picks up your message, calls a tool, finishes thinking, hits a quality gate — *something visibly moves*.

## Visual / data inventory by zone

This section is the full data map. Every field a junior dev might wonder "where does this come from?" is here, with the source path and the live-update mechanism. Use it as a checklist.

### Zone A — Issue header (always visible)

| Element | Source | Live? | Update path |
|---|---|---|---|
| Issue ID + title | `Issue.id`, `Issue.title` (`src/dashboard/frontend/src/types.ts:12-13`) | No | Snapshot bootstrap |
| Tracker URL (clickable arrow) | `Issue.url`, `Issue.source` | No | Snapshot |
| Repo / branch | `Issue.sourceRepo` + convention `feature/<issueId>` | No | Snapshot |
| Pipeline stage (planning/work/verify/review/test/merge) | derived from `ReviewStatus` (`src/lib/review-status.ts:26-41`) + `Issue.targetCanonicalState` | **Yes** | `pipeline.status_changed` event |
| Round counter | `ReviewStatus.reviewRetryCount` + reviewer round artifacts | **Yes** | `pipeline.review-started` |
| Total cost | `IssueCostData.totalCost` (`/api/costs/by-issue`) | **Yes** | `cost.event_recorded` event + 5s `useCostStream` fallback |
| Verification status | `ReviewStatus.verificationStatus` + `verificationCycleCount` | **Yes** | `pipeline.status_changed` |
| Quality gates rollup (typecheck / lint / tests pass count) | derived from `ReviewStatus.verificationNotes` parsed | **Yes** | `pipeline.status_changed` |
| Acceptance criteria progress (e.g. "6 / 9") | vBRIEF item statuses (`/api/workspaces/:id/plan`) | **Yes** | `plan.item_status_changed` |
| Stuck flag + reason | `ReviewStatus.stuck`, `stuckReason`, `stuckDetails`, `stuckAt` | **Yes** | `agent.enrichment_changed` (via deacon) |
| Ready-to-merge flag | `ReviewStatus.readyForMerge` | **Yes** | `merge.ready` event |
| PR URL + mergeable + checks | GitHub API via `gh pr view` + `ReviewStatus.prUrl` | Polled | 30s background |
| PR check rollup (CI status) | `gh pr view --json statusCheckRollup` | Polled | 30s |
| Activity sparkline (last hour) | derived from domain events filtered by `issueId` | **Yes** | every event |
| Salvageable stash warning | `git stash list` filtered for `salvageable:PAN-XXX:*` | Polled | on workspace open |
| Cycle / milestone (if Linear) | `Issue.cycle`, `Issue.milestone` | No | Snapshot |
| Container health (if running) | Docker `ps` + `inspect` (`/api/resources`) | Polled | 10s |
| Started-at / time-in-stage | `Issue.createdAt`, `ReviewStatus.updatedAt` + `useNow(60_000)` | **Yes** | 1min ticker |

### Zone B — Agent context (selected session)

| Element | Source | Live? | Update path |
|---|---|---|---|
| Role badge (work / review-correctness / test / merge / etc.) | `SessionNode.type` + `SessionNode.role` (`packages/contracts/src/types.ts:223-231`) | No | Snapshot |
| Status pill (alive · active / alive · idle / ended ✓ / ended ✗ / pending) | `SessionNode.presence` + `Agent.status` + `AgentRuntimeSnapshot.activity` | **Yes** | `agent.activity_changed`, `agent.status_changed` |
| Phase (planning / exploration / implementation / testing / documentation / pre_push / post_push / review / review-response / merge) | `Agent.agentPhase` (`src/dashboard/frontend/src/types.ts:92`) | **Yes** | `agent.enrichment_changed` |
| Current tool (Read, Edit, Bash, Grep, …) | `AgentRuntimeSnapshot.currentTool` | **Yes** | `agent.activity_changed` |
| Thinking state | `AgentRuntimeSnapshot.thinking.since`, `lastToolAt` | **Yes** | `agent.thinking_started/stopped` |
| Waiting state (tool_permission / user_question / disambiguation / other) | `AgentRuntimeSnapshot.waiting.{reason, message, startedAt}` | **Yes** | `agent.waiting_started/cleared` |
| Round number (1 / 2 / 3 …) | reviewer round artifacts (`~/.panopticon/agents/<id>/round-*.json`) | **Yes** | `pipeline.review-started` |
| Round history (per-round verdict, finding count, duration, cost) | round-N.json files | **Yes** | `pipeline.review-completed` |
| Elapsed timer | `Agent.startedAt` + `useNow(1000)` for live sessions | **Yes** | 1s ticker |
| Per-session cost | `IssueCostData.sessions[].cost` | **Yes** | `cost.event_recorded` |
| Per-session token counts (input/output) | `IssueCostData.sessions[].tokenCount` | **Yes** | `cost.event_recorded` |
| Cost rate ($/min currently) | derived: cost diff over time window | **Yes** | computed from cost stream |
| Model name | `Agent.model` | No | Snapshot |
| Process PID | from `~/.panopticon/agents/<id>/state.json` | No | Snapshot |
| tmux session name | `SessionNode.tmuxSession` | No | Snapshot |
| Claude session ID (for JSONL) | `state.json:claudeSessionId` | No | Snapshot |
| Last assistant message timestamp | `AgentRuntimeSnapshot.lastMessageAt` | **Yes** | `agent.message_received` |
| Pending question alert | `Agent.hasPendingQuestion`, `pendingQuestionCount` | **Yes** | `agent.enrichment_changed` |
| Resolution signal | `AgentRuntimeSnapshot.resolution` (`working`/`done`/`needs_input`/`stuck`/`completed`) | **Yes** | `agent.enrichment_changed` |
| Output buffer count (new tmux lines since last view) | derived from `agent.output_received` event count | **Yes** | `agent.output_received` |

### Zone C — Conversation + composer (agent-selected)

| Element | Source | Live? | Update path |
|---|---|---|---|
| Message timeline | JSONL at `~/.claude/projects/<encoded>/<claudeSessionId>.jsonl` | **Yes** | `subscribeConversationMessages` RPC stream |
| Round divider (between rounds for reviewers) | round-N.json artifacts → injected timeline rows | **Yes** | `pipeline.review-started` |
| Streaming text (typewriter cursor) | RPC chunk arrival timing | **Yes** | per-chunk |
| Working dots (when assistant is mid-response, not yet streamed) | absence of streaming chunks past threshold | **Yes** | derived |
| Tool-call collapsed groups | parsed from JSONL by existing `MessagesTimeline` logic | **Yes** | derived |
| Composer state (model, effort, attached image) | local component state in `ComposerFooter` | n/a | local |
| Slash commands (100+) | existing slash-command registry | n/a | local |
| Send target (which session the composer addresses) | derived from selected `SessionNode` | **Yes** | selection change |
| Image upload | `POST /api/conversations/:name/upload-image` | n/a | request |

### Zone C — Issue-selected mode (no agent selected)

When the user clicks the issue row in the tree (or selects "Overview" explicitly), Zone C swaps to a tabbed dashboard. See the dedicated [Issue-selected mode](#issue-selected-mode) section below for the data inventory of each tab.

## Three-zone information architecture (visual specification)

```
╔══════════════════════════════════════════════════════════════════════════╗
║ ZONE A · ISSUE HEADER  (~96px tall when expanded; always visible)        ║
║                                                                          ║
║  PAN-540 ↗  · panopticon · feature/PAN-540 · [In Review · Round 2]      ║
║  Remove convoy abstraction, inline parallel review directly into…        ║
║  ◷ started 3d ago · $4.32  · 6 / 9 acceptance · ▁▂▄▆▅▃▂  (sparkline)    ║
║                                                                          ║
║  ●─●─●─◐─○─○   ✓ typecheck  ✓ lint  ✓ tests · 184                       ║
║   plan work verify review test merge                                     ║
║                                                                          ║
║                  [Approve & Test] [Send to Work] [View PR ↗] […]         ║
╠══════════════════════════════════════════════════════════════════════════╣
║ ZONE B · AGENT CONTEXT  (~64px tall; updates per session)                ║
║                                                                          ║
║  🛡 review-correctness   ● alive · active   round 2/2   4m 12s  $0.31   ║
║  phase: review-response · tool: Grep · model: claude-opus-4-7            ║
║  Rounds: ✓ 1 (passed · 8 findings · 3m41s · $0.18)  ◐ 2 (running)        ║
║                          [Stop] [Show terminal] [Open in tmux]           ║
╠══════════════════════════════════════════════════════════════════════════╣
║ ZONE C · CONVERSATION + COMPOSER  (fills remaining height)               ║
║                                                                          ║
║  ── Round 1 · 14:02 → 14:06 · passed ───────────────────────────────     ║
║  [user bubble]                                                           ║
║  [assistant message — markdown]                                          ║
║  [tool-call group, collapsed]                                            ║
║  ── Round 2 · 14:32 ─────────────────────────────────────                ║
║  [user followup]                                                         ║
║  [assistant streaming — typewriter cursor]                               ║
║  ● working · 4m 12s elapsed                                              ║
║                                                                          ║
║  ┌─────────────────────────────────────────────────────────────┐         ║
║  │ Send a message to review-correctness…                        │         ║
║  │ [Attach] [/Slash 100+]  model:opus-4-7 · effort:max  [Send]  │         ║
║  └─────────────────────────────────────────────────────────────┘         ║
╚══════════════════════════════════════════════════════════════════════════╝
```

## Zone A — Issue header (detailed)

### Identity row (visual spec)

The mock locks this in; it's the look we're shipping:

- **`PAN-540 ↗`** — issue ID rendered in the **mono font** (`SF Mono`), `text-[11px]`, **`font-semibold`**, color `text-primary`. The arrow is `lucide-react` `ExternalLink` at 11px, opens the tracker URL in a new tab. *Bold matters here* — it's an anchor users scan to.
- **·** separator dots — `text-content-subtle`.
- **`panopticon · feature/PAN-540`** — `text-[11px] text-content-muted`. Branch is shown only when it's the conventional `feature/<issueId>` form (i.e. always; if a non-conventional branch is in use, render in `font-mono` with a small warning glyph).
- **Status tag** — pill with `inline-flex items-center gap-1 rounded border px-1.5 py-px text-[10px] font-medium`. Color tokens vary by state:
  - `In Review` → `badge-bg-review badge-border-review text-review-fg` (purple family)
  - `Working` → `badge-bg-info badge-border-info text-info-fg` (blue)
  - `Ready to merge` → `badge-bg-success badge-border-success text-success-fg` plus the `badge-shimmer-rtm` keyframe (green sweeping shimmer at 2.8s)
  - `Stuck` → `badge-bg-destructive badge-border-destructive text-destructive-fg` plus a subtle 1.5s wobble keyframe (NEW: `kf-stuck-shake` to author)
  - `Done` → `badge-bg-muted badge-border-muted text-content-muted`
- **Round counter** — when applicable, appended to the status pill text: `In Review · Round 2`.

Below the identity row, the **title** in `font-display` (Space Grotesk), `text-[20px] font-semibold leading-tight tracking-tight text-content`. The title is **truncated to 2 lines** (`line-clamp-2`) — full title in the tooltip.

Below the title, a **meta strip** (`text-[11px] text-content-muted`) with:
- ⏱ "started 3 days ago" — `useNow(60_000)` ticker so it updates without remount
- 💲 total cost in `font-mono text-cost-fg` — pulses on update (see motion catalog)
- 📋 "6 / 9 acceptance" — vBRIEF completion ratio, with a thin progress bar after it (`120×4px`, `bg-primary/60`)
- 📊 sparkline (NEW) — `120×16px` inline SVG, last hour of events, see "Activity sparkline" below

### Stage dots

Six circles connected by a thin line, representing **planning · work · verify · review · test · merge**. Each is a `24×24px` ring.

States:
- **Done** (✓): `border-success/40 bg-success/10`, success-color check icon at 11px.
- **Current** (◐): `bg-{color}/15 ring-2 ring-{color}/40` where `{color}` is the stage-specific token (`primary` for planning/work, `signal-review` for review, `info` for verify/test, `signal-cost` for merge). Inside, a `2×2px` alive dot using the `alive-dot` keyframe (1.6s pulse). The label below glows in the matching `*-foreground` token.
- **Pending**: `border-divider-strong` empty ring, label `text-content-subtle`.
- **Skipped** (✗): `border-warning/40 bg-warning/10` with a small `–` glyph; only used when verify is bypassed after 3 fails.

The connecting line between dots is `1px bg-divider-strong` for done segments, `1px bg-divider` for not-yet-reached segments.

### Quality gates rollup (right side of stage row)

Three pills, right-aligned alongside the stage dots:

- ✓ **typecheck** — `badge-bg-success badge-border-success text-success-fg`
- ✓ **lint** — same
- ✓ **tests · 184** — same; failure flips to `badge-bg-destructive badge-border-destructive` with the count

These come from `ReviewStatus.verificationNotes` — parser already exists in the inspector code (`src/dashboard/frontend/src/components/InspectorPanel.tsx`); reuse it.

### Activity sparkline (NEW, Zone A enrichment)

A small `120×16px` SVG inline next to the meta strip. The X axis is the last 60 minutes (split into 12 buckets of 5 minutes each). The Y axis is the count of domain events in that bucket. Bars are color-coded:

- 🟢 success / completion events (`pipeline.review-completed` passed, `merge.ready`, `agent.thinking_stopped` resolved=`done`)
- 🔵 info / activity (`agent.activity_changed`, `agent.message_received`)
- 🟣 review-specific (`pipeline.review-started`, `pipeline.review-completed`)
- 🟠 warning (`agent.waiting_started`, `agent.enrichment_changed` with stuck=true)
- 🔴 failure (`pipeline.test-completed` failed, `agent.status_changed` to error)

Every new event slides the sparkline window left and adds a new bar with a 200ms grow-in animation. On hover, a tooltip lists the events in that bucket.

### Live cost ticker

The total cost number animates on `cost.event_recorded`. Two motions:

1. **Number transition** — old value fades down, new value fades up (vertical scroll), 250ms ease-out. Implementation: stack two `<span>`s with translateY, swap on event.
2. **$ pulse** — the `$` character scales `1 → 1.2 → 1` over 300ms with `text-cost-fg` brightness boost.

If the cost increment is large (>$0.10 in one event), additionally pulse the meta strip background `bg-cost-fg/8` for 600ms.

### Stuck warning (when `ReviewStatus.stuck === true`)

A full-width ribbon below the meta strip:

```
⚠ Stuck — {reason}              [View details] [Mark unstuck]
```

Background `badge-bg-destructive`, border `badge-border-destructive`, text `text-destructive-fg`. The `⚠` icon shakes (NEW keyframe `kf-stuck-shake`: `translateX -1px → 1px → -1px → 0`, 1.5s ease-in-out, paused on hover). Click "View details" to open `stuckDetails` in a popover.

### Salvageable stash warning

If `git stash list` returns a `salvageable:PAN-{issueId}:*` entry, a thin `text-[11px]` notice appears above the contextual actions row:

```
⚠ Salvageable user work in stash — recover before destructive ops
                                    [View stash] [Recover] [Dismiss]
```

### Contextual actions row

A right-aligned cluster of buttons whose composition depends on **current pipeline state**. The state-to-actions map is the source of truth — implement it as a single `getZoneAActions(state, status)` pure function so testing is trivial.

| State | Primary | Secondary | Overflow `…` |
|---|---|---|---|
| `Backlog` / no agents | Spawn Planning · Spawn Work | — | View PRD · Edit Settings |
| `Planning` (active) | — | Stop Planning · Send Message | Restart · Open in tmux |
| `Planning Done · Awaiting Work` | Spawn Work | — | Re-plan · View Plan |
| `In Progress · work alive` | — | Send Message · Show Terminal | Stop · Restart · Open in tmux |
| `In Progress · work idle` | — | Send Message · Resume Work | Stop · Restart |
| `Verification failing` | Retry Verification | View Failures | Bypass (after 3 fails) |
| `In Review · reviewers running` | — | Skip Round · Cancel Review | Force Close · Send to Work |
| `In Review · CHANGES_REQUESTED` | Send to Work | View Findings | Override · Force Test |
| `In Review · APPROVED` | Approve & Test | Request Changes | Force Merge |
| `Testing · running` | — | Cancel Test | View Output |
| `Testing · failures` | Send to Work | View Failures | Bypass · Force Merge |
| `Ready to Merge` | **Merge** *(humans only)* | View PR ↗ | View Diff · Force Merge |
| `Merging` | — | View PR ↗ | Cancel |
| `Merged` | Close Issue | View PR ↗ | — |
| `Done` | — | Reopen | View PR ↗ · Archive |
| Any | — | — | View Plan · View vBRIEF · View PRD · View Costs · Open Workspace · Open in tmux · Settings |

The overflow menu is alphabetized within each section (action / view / nav). The primary button uses `bg-primary text-primary-fg`. Secondary buttons use `border border-divider-strong bg-surface text-content`. The overflow trigger is a `MoreHorizontal` icon button.

> **Density rule**: a state badge is shown only when its value is non-default for the current stage. "branch: feature/PAN-540" is the conventional name — don't show it. "container: stopped" is the default for a `Done` issue — don't show it. "container: stopped" *is* surprising for an `In Progress` issue — show it (and color it `warning`).

## Zone B — Agent context (detailed)

Zone B is the line of "what's the selected agent doing right now?" It updates within ~100ms of any `agent.*` event for the selected agent.

### Layout

A single row (wrapping if narrow) with these segments left-to-right:

1. **Role badge** with role-specific icon (see "Role identity" below).
2. **Status pill** with breathing alive-dot.
3. **Round indicator** (only for sessions that have rounds).
4. **Elapsed timer** (live; ticks every 1s for active, every 60s for ended).
5. **Per-session cost** (live).
6. **Phase + tool inline** (live).
7. **Model + PID + tmux session name** (static, monospaced muted).
8. **Action cluster** (right-aligned).

Below that row, when applicable:

9. **Round history** as horizontal mini-cards (NEW; see below).
10. **Pending-question alert** as a full-width inset (NEW; see below).
11. **Output buffer counter** as a small badge ("47 new tmux lines").

### Role identity (NEW: per-role visual)

Reviewers and other specialist roles get role-specific iconography and a colored ring around the badge:

| Role | Icon (lucide-react) | Ring color (token) | Avatar text |
|---|---|---|---|
| `planning` | `ClipboardList` | `info` | `PL` |
| `work` | `Code2` | `primary` | `WK` |
| `review-orchestrator` | `Eye` | `signal-review` | `RO` |
| `review-correctness` | `Target` | `signal-review` | `RC` |
| `review-security` | `Shield` | `signal-review` | `RS` |
| `review-performance` | `Zap` | `signal-review` | `RP` |
| `review-requirements` | `ClipboardCheck` | `signal-review` | `RQ` |
| `review-synthesis` | `GitMerge` | `signal-review` | `RY` |
| `test` | `FlaskConical` | `info` | `TS` |
| `merge` | `GitPullRequestArrow` | `signal-cost` | `MG` |

The role badge is a 22px chip with the icon at 11px, role name at `text-[11px] font-semibold`, color `text-{ring-color}-foreground`.

### Status pill (live)

The pill text comes from `(SessionNode.presence, AgentRuntimeSnapshot.activity, Agent.status)`:

| Triple | Text | Background |
|---|---|---|
| `(active, working, running)` | `alive · active` | `bg-success/10` |
| `(active, thinking, running)` | `alive · thinking` | `bg-warning/10` |
| `(active, waiting, running)` | `alive · waiting (reason)` | `bg-warning/15` |
| `(active, idle, running)` | `alive · idle` | `bg-content/5` |
| `(ended, _, stopped)` | `ended` | `bg-content/5` |
| `(ended, _, error)` | `ended ✗` | `bg-destructive/10` |
| `(_, _, completed)` | `done ✓` | `bg-success/10` |
| pending | `pending` | `bg-content/5` |

The leading dot animates per state:
- `active`: 1.6s `alive-dot` keyframe (existing).
- `thinking`: 2s slower `alive-dot` with extra `box-shadow 0 0 6px var(--warning)/40`.
- `waiting`: 1.5s pulse + amber glow.
- `idle`: 4s very slow breath (lower amplitude).
- `ended`: static (no animation).

### Phase + tool inline (NEW, live)

When the agent is `active` and `working`, show:

```
phase: review-response · tool: Grep
```

`phase` from `Agent.agentPhase`. `tool` from `AgentRuntimeSnapshot.currentTool`.

When `tool` changes (event: `agent.activity_changed`), the tool-name `<span>` cross-fades: old name fades out, new name fades in (200ms each), with a tiny "→" briefly visible between them. This is the most attention-grabbing motion in Zone B; it's deliberate — the user gets an at-a-glance read on whether the agent is *doing things* or hung.

When the agent is `thinking`, replace the phase + tool line with:

```
🧠 thinking · since 14:32:42 · last tool was Grep 8s ago
```

The brain emoji slowly rotates (3s linear infinite) while in this state.

When the agent is `waiting`, replace it with:

```
⏸ waiting · {reason} — {message}                    [Resolve]
```

Background `badge-bg-warning`. The `⏸` icon pulses. Clicking `[Resolve]` opens the appropriate dialog (permission grant, send a message, etc.) based on `reason`.

### Round history mini-cards (NEW, replaces accordion)

For sessions that have rounds (reviewers, test, work-on-rejection), render a horizontal row of mini-cards instead of an accordion. Each card is `~140px` wide:

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ ✓ Round 1    │  │ ◐ Round 2    │  │ · Round 3    │
│ 8 findings   │  │ in progress  │  │ pending      │
│ 3m 41s       │  │ 4m 12s …     │  │              │
│ $0.18        │  │ $0.13 …      │  │              │
└──────────────┘  └──────────────┘  └──────────────┘
   passed           in progress       pending
```

- Past rounds: `border-success` (passed) or `border-destructive` (failed). Click to scrub the conversation timeline to that round's segment.
- Current round: `border-warning` with `badge-shimmer-rtm`-style sweep animation (NEW: `kf-round-active`, similar shimmer at 2.4s).
- Future rounds: `border-divider` empty card.

Cards scroll horizontally if there are too many to fit; they're `flex` with `overflow-x-auto`.

### Per-session cost rate (NEW)

Below the metadata, when the session has been active for >30s and is currently spending:

```
$0.04/min currently · projecting $1.20 for this session at this rate
```

Computed from the cost stream over the last 5 minutes. The "$/min" updates every 5s; the projection updates every 15s. When the rate is low (<$0.01/min), this line is hidden to avoid clutter.

### Output buffer counter (NEW)

A small ghosted badge on the right of the action cluster:

```
+47 lines
```

Counts `agent.output_received` events since the user last viewed the terminal for this session. Clicking it switches Zone C to the terminal tab.

### Idle warning (NEW)

If the agent has been `idle` (resolution=`done` or activity=`idle`) for >2 minutes without ending:

```
○ idle for 4m 12s — needs nudge?    [Send Message] [Stop]
```

Subtle amber background. The "needs nudge?" hint disappears on hover (so it doesn't yell at the user).

### Action cluster

| Session state | Primary | Secondary |
|---|---|---|
| `alive · active/thinking` | — | Stop · Send Message · Show Terminal · Open in tmux |
| `alive · idle` | Send Message | Stop · Show Terminal |
| `alive · waiting` | Resolve | Stop · Show Terminal |
| `ended` | Restart | Replay · Show Terminal · Export JSONL |
| `pending` | Spawn Now | Skip Stage |

Plus an overflow `…` menu always present with: Open State Dir · View State.md · View vBRIEF · View claudeSessionId · Copy tmux command · Export round history JSON.

## Zone C — Conversation + composer (agent-selected)

This zone is the **least changed** by this PRD. We are deliberately reusing:

- `src/dashboard/frontend/src/components/chat/ConversationPanel.tsx` (unchanged)
- `src/dashboard/frontend/src/components/chat/MessagesTimeline.tsx` (one addition: round-divider injection point)
- `src/dashboard/frontend/src/components/chat/ChatMarkdown.tsx` (unchanged)
- `src/dashboard/frontend/src/components/chat/ComposerFooter.tsx` (unchanged)

### What changes

The single addition to `MessagesTimeline.tsx` is an **optional `roundMarkers` prop**:

```typescript
interface RoundMarker {
  roundNumber: number;
  startedAt: string;       // ISO
  endedAt?: string;        // ISO (omitted if current round)
  verdict?: 'passed' | 'failed' | 'in_progress';
  position: number;        // index in the message array where the divider goes
}

interface MessagesTimelineProps {
  // … existing props
  roundMarkers?: RoundMarker[];
}
```

When provided, the parent (the new `IssueWorkbench` wrapper) injects non-virtualized divider rows at the marker positions:

```
── Round 1 · 14:02 → 14:06 · passed · 8 findings ─────
```

Style: full-width thin line with centered pill, `text-[10.5px] font-mono text-content-subtle`, top/bottom margins `0.5em`. Pill background changes by verdict: `passed` = `badge-bg-success`, `failed` = `badge-bg-destructive`, `in_progress` = `badge-bg-warning` with the sweep keyframe.

The dividers are rendered outside the virtualizer (the timeline already mixes virtual + non-virtual; reuse that pattern).

### Composer addressing

The composer addresses the *selected session*. The `name` prop passed to `ComposerFooter` is the canonical tmux session name (e.g. `specialist-panopticon-540-review-correctness`). Below the composer, a small `text-[10.5px] text-content-subtle` line shows:

```
addressing: specialist-panopticon-540-review-correctness     2 / 8000
```

### Session-tab strip (NEW)

A thin tab strip above the messages timeline with three tabs:

- **Conversation** (default) — JSONL via `MessagesTimeline`
- **Terminal** — `<XTerminal>` with the session's tmux name
- **Findings** (only for reviewer/test sessions) — structured view of round-N artifacts

The Findings tab carries a count badge (e.g. `3` for unresolved findings). When a new finding event arrives, the badge pulses once.

A right-aligned cluster shows live status: `● streaming · 2s poll` and `147 messages`. The `●` is a tiny alive-dot animated whenever a chunk arrives within the last 5s, otherwise grey.

## Issue-selected mode

This is a new section. It defines what Zone C shows when **the issue itself** is selected in the tree (clicking the issue row, not a session under it).

### Why have this mode

The session tree's natural default is to auto-select the alive (or most-recent) session of an issue. But the user often wants to look at the *issue as a whole* — read the PRD, scan the diff, see the cost breakdown, browse all conversations together. Without this mode, those views are scattered (kanban modal, badge bar modal, costs page, planning page, etc.). Issue-selected mode collapses them into the same Command Deck surface.

### Selection rules

- Click the issue row in the tree → issue-selected mode.
- Click a session row → agent-selected mode.
- Loading the project view fresh: if the issue has at least one alive session, default to **agent-selected** on the alive session. Otherwise default to **issue-selected**.
- Switching modes is instant (no transition) and preserves Zone A/B (Zone A is always the issue; Zone B becomes a slim "Issue overview" line in issue-selected mode — see below).

### Zone B in issue-selected mode

Zone B is collapsed to a single-line summary of the issue's agent population:

```
8 sessions · 1 alive · 7 ended · last activity 2m ago · idle for 12m
                              [Spawn Work] [Request Review] [Force Merge]
```

Action buttons here are issue-level (matching Zone A's contextual map) but are NOT redundant with Zone A — Zone A's primary actions are workflow transitions (Approve & Test, Send to Work). Zone B in issue-selected mode shows agent-population shortcuts (Spawn Work, etc.) that don't fit cleanly in Zone A.

### Zone C tab strip (NEW)

A horizontal tab strip with the following tabs. Each tab is a self-contained view; they can be implemented as separate React components.

| Tab | Source | Notes |
|---|---|---|
| **Overview** *(default)* | Aggregated dashboard | The killer view — see below |
| **PRD** | `docs/prds/active/<issueId>/<file>.md` (or `.planning/prd.md`) | Rendered markdown via existing ChatMarkdown |
| **vBRIEF** | `/api/workspaces/:issueId/plan` | Reuse existing `VBriefViewer` (List / DAG / Raw JSON tabs); embed it |
| **STATE.md** | `.planning/STATE.md` (or archived) | Rendered markdown |
| **INFERENCE.md** | `.planning/INFERENCE.md` if present | Rendered markdown; tab hidden if not present |
| **PR / Diff** | `gh pr view` + `gh pr diff` | Lightweight diff viewer with file tree; PR comments and CI checks below |
| **Beads** | `/api/issues/:issueId/beads` | List of beads tasks with status, like a mini kanban |
| **Costs** | `IssueCostData` from `/api/costs/by-issue` | Per-stage and per-model breakdown with sparklines |
| **Activity** | Filtered domain event stream for this issue | Same component as God View ActivityFeed, scoped by `issueId` |
| **Discussions** | Linear comments + GitHub PR comments | Combined timeline |

A tab badge shows count when relevant (`PRD ●` when unread changes, `Findings 3`, `Beads 5 open`).

The tab strip is sticky at the top of Zone C with a `border-b border-divider`. Active tab uses `bg-surface-active text-content`, inactive `text-content-muted hover:bg-surface-hover`.

### Overview tab (default)

The Overview is the most important new view. It's a **single scrollable surface** with these stacked sections:

#### 1. Status billboard

A ~120px-tall hero panel:

```
┌─────────────────────────────────────────────────────────────────┐
│ In Review · Round 2                  $4.32 spent · 6 / 9 done   │
│                                                                 │
│ [Stage progress bar with all 6 stages, ◐ at review]             │
│                                                                 │
│ ◷ in this stage for 12m · last activity 14s ago                 │
└─────────────────────────────────────────────────────────────────┘
```

Background uses the stage-tinted gradient (subtle `bg-gradient-to-br from-{stage-color}/10 to-transparent`).

#### 2. Reviewer summary (when in review)

A 5-column grid, one column per reviewer role:

```
┌──────────┬──────────┬──────────┬──────────┬──────────┐
│ ◐ correct│ ✓ secur  │ ✓ perf   │ ✓ req    │ ✓ synth  │
│ R2 active│ R1 passed│ R1 passed│ R1 passed│ R1 passed│
│ 0 / ?    │ 0 issues │ 1 fixed  │ 0 issues │ summary  │
│ $0.31    │ $0.28    │ $0.35    │ $0.22    │ $0.18    │
└──────────┴──────────┴──────────┴──────────┴──────────┘
```

Each column is clickable and switches to agent-selected mode for that reviewer.

#### 3. Test summary (when test has run)

```
┌──────────────────────────────────────────────────────────────┐
│ ✓ Tests passed · 184 / 184                                   │
│   typecheck ✓ · lint ✓ · vitest ✓ · playwright ✓             │
│                                                              │
│   Slowest test: src/lib/cloister/foo.test.ts (1.2s)          │
│                                                              │
│                                  [View output] [Re-run tests]│
└──────────────────────────────────────────────────────────────┘
```

If failing, replace with a list of failed tests and a "Send to Work" CTA.

#### 4. PR summary (when PR exists)

```
┌──────────────────────────────────────────────────────────────┐
│ PR #540 ↗ · 23 files changed · +840 / -1240 · 4 commits     │
│ CI: ✓ build ✓ test ✓ typecheck                               │
│ Mergeable: ✓ no conflicts                                    │
│ Reviewers: 0 human / synthesis recommends APPROVE            │
│                                            [View PR ↗]       │
└──────────────────────────────────────────────────────────────┘
```

#### 5. Cost breakdown sparkline

A 200×60px stacked-bar chart, one bar per stage, segments per model. Hover for breakdown popover.

#### 6. Recent activity feed (combined across all sessions)

Embed the God View `ActivityFeed` component scoped by `issueId`, capped at 20 events, with the same slide-in animations. New events at top push older events down.

#### 7. Quick links

Footer row of small chips: `View PRD ↗` `View vBRIEF ↗` `View Beads ↗` `View Costs ↗` `Open Workspace ↗`. Each opens the matching tab (or external URL).

### Composer behavior in issue-selected mode

The composer is **disabled** in issue-selected mode with a hint:

```
   Select a session in the tree to send a message …
```

(Disabled state: opacity 50, no focus ring, send button greyed out.)

We deliberately don't make the composer "send to lifecycle manager" — that's a more ambitious feature (`/route` slash command for example) and out of scope here. The hint nudges the user to select a specific session.

Two exceptions where the composer becomes contextual instead of disabled:

1. **Issue has zero sessions**: Composer shows `Send a directive to spawn the planning agent…` and the send button reads "Spawn & Send" — first message kicks off planning with that prompt as the initial directive.
2. **All sessions ended**: Composer shows `Send a follow-up to spawn a fresh work agent…` with "Spawn Work & Send" button.

## Event-driven motion catalog

This section is the cookbook a junior dev opens to build the live-feel. Every domain event has a prescribed motion. Implement these as reusable components and hooks; do not bolt motion into individual views.

### Reusable building blocks (build first)

#### `<StatusDot status="active|thinking|waiting|idle|ended" />`

```typescript
// Renders a 6×6 (small) or 8×8 (medium) circle with the right pulse.
// Active: 1.6s alive-dot pulse (existing keyframe)
// Thinking: 2s slower pulse + warning glow
// Waiting: 1.5s pulse + amber glow
// Idle: 4s very slow breath
// Ended: static dim
```

File: `src/dashboard/frontend/src/components/CommandDeck/StatusDot.tsx` (new). Used in tree nodes, Zone B status pill, Overview reviewer cards, kanban card future revamp.

#### `<LiveCounter value={number} unit="$" precision={2} pulseOnIncrement />`

```typescript
// Animates the number on change (vertical scroll fade, 250ms).
// Pulses the unit symbol on increment (300ms scale).
// Big-jump highlight: if delta > threshold, briefly bg-{color}/8 for 600ms.
```

File: `src/dashboard/frontend/src/components/CommandDeck/LiveCounter.tsx` (new). Used for cost in Zone A, Zone B, Overview billboard, kanban future revamp.

#### `<ActivitySparkline events={Event[]} windowMinutes={60} buckets={12} />`

```typescript
// Inline SVG, ~120×16px.
// Slides left and grows in new bars on event arrival.
```

File: `src/dashboard/frontend/src/components/CommandDeck/ActivitySparkline.tsx` (new). Used in Zone A.

#### `<RoundCard round={RoundData} active={bool} onClick={fn} />`

```typescript
// 140-wide mini card with verdict, finding count, duration, cost.
// active=true gets the kf-round-active sweep animation.
```

File: `src/dashboard/frontend/src/components/CommandDeck/RoundCard.tsx` (new). Used in Zone B, Overview reviewer summary.

#### `<ToolFlash currentTool={string} />`

```typescript
// Cross-fades the tool name on change (200ms each, with → between).
```

File: `src/dashboard/frontend/src/components/CommandDeck/ToolFlash.tsx` (new). Used in Zone B.

#### `<RoleBadge role={SessionNodeType} role_={ReviewerRole?} size="sm|md|lg" />`

```typescript
// Wraps a lucide icon with the right ring color and avatar text.
```

File: `src/dashboard/frontend/src/components/CommandDeck/RoleBadge.tsx` (new). Used everywhere a session role is rendered.

### Hooks (existing — reuse, don't duplicate)

| Hook | Use case in Command Deck |
|---|---|
| `useNow(intervalMs)` | Elapsed timers, "started Xm ago" labels |
| `useCostStream({ issueId })` | Live cost in Zone A, Zone B, Overview |
| `useDomainEvents({ filter })` | Subscribe to filtered event stream for a single issue/session |
| `subscribeConversationMessages(conversationId)` (RPC) | Streams message chunks into MessagesTimeline |

If `useDomainEvents` doesn't exist yet (filter-by-issueId), build it on top of the existing `subscribeDomainEvents` stream. Filter client-side; the stream is already cheap.

### Event → motion mapping (definitive)

| Domain event | Where in Command Deck | Motion |
|---|---|---|
| `agent.activity_changed` | Zone B `<ToolFlash>` | Cross-fade tool name (200ms) |
| `agent.activity_changed` (idle → working) | Zone B `<StatusDot>` | Speed up to 1.6s alive-dot |
| `agent.thinking_started` | Zone B status pill | Switch to `thinking` style + brain emoji rotate |
| `agent.thinking_stopped` | Zone B status pill | Crossfade back to active |
| `agent.waiting_started` | Zone B status pill + ribbon | Show waiting ribbon with amber glow |
| `agent.waiting_cleared` | Zone B status pill | Hide waiting ribbon, brief toast |
| `agent.status_changed` (→ error) | Zone B + tree node | One-shot red shake (NEW: `kf-error-shake`, 200ms) |
| `agent.status_changed` (→ stopped) | Zone B + tree node | Fade alive-dot to idle |
| `agent.message_received` (assistant) | Zone C messages | Slide-in new message (existing) |
| `agent.message_received` (any) | Tree node | Brief node-row highlight (NEW: `kf-row-flash`, 600ms `bg-primary/10`) |
| `agent.output_received` | Zone B output buffer counter | Increment counter, brief pulse |
| `agent.enrichment_changed` (hasPendingQuestion=true) | Zone B + tree node | Show pending-Q badge with 1.5s pulse |
| `agent.started` | Tree | Slide-in new node (Framer Motion, 200ms) |
| `agent.stopped` | Tree | Fade node + status update |
| `pipeline.review-started` | Zone A stage dots + Zone B round card | Switch active stage to "review", new round card with sweep |
| `pipeline.review-completed` (passed) | Zone A stage dots + Zone B round card | Tick the round card, advance progress |
| `pipeline.review-completed` (failed) | Same | Red round card, shake, attention pulse |
| `pipeline.test-started` | Zone A stage dots | Stage dot becomes current with sweep |
| `pipeline.test-completed` (passed) | Zone A | Tick, quality-gates rollup updates |
| `pipeline.test-completed` (failed) | Zone A | Failure pulse on gate, "Send to Work" primary action becomes pulsing CTA |
| `merge.ready` | Zone A status pill | Apply `badge-shimmer-rtm`, scale 1→1.05→1 |
| `cost.event_recorded` | Zone A cost ticker, Zone B cost ticker, sparkline | LiveCounter pulse + sparkline grow-in |
| `plan.item_status_changed` | Zone A acceptance progress | Tick the next item, progress bar grow |
| `activity.entry` | Overview activity feed (if open) | Slide-in (200ms) |
| `workspace.created` | Tree | Slide-in workspace node (if added later) |
| `dashboard.lifecycle_started` | Zone A | Brief grey overlay, "Reconnecting…" |
| `dashboard.lifecycle_completed` | Zone A | Fade out, brief green flash |

### Animation-timing reference

All custom keyframes for this PRD live in `src/dashboard/frontend/src/index.css` next to existing `badge-shimmer`. Add only the ones not already there:

```css
/* Existing — reuse */
@keyframes badge-shimmer { … }   /* 2.8s */
@keyframes pulse { … }           /* 2s */

/* New — to author */
@keyframes alive-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.55; transform: scale(0.85); }
}
/* applied at 1.6s for active, 2s for thinking, 4s for idle */

@keyframes kf-stuck-shake {
  0%, 100% { transform: translateX(0); }
  25%      { transform: translateX(-1px); }
  75%      { transform: translateX(1px); }
}
/* 1.5s ease-in-out infinite */

@keyframes kf-error-shake {
  0%, 100% { transform: translateX(0); }
  25%      { transform: translateX(-3px); }
  75%      { transform: translateX(3px); }
}
/* 200ms ease-in-out, one-shot */

@keyframes kf-row-flash {
  0%   { background: color-mix(in srgb, var(--primary) 20%, transparent); }
  100% { background: transparent; }
}
/* 600ms ease-out, one-shot */

@keyframes kf-round-active {
  0%   { background-position: 150% 50%; }
  100% { background-position: -50% 50%; }
}
/* 2.4s ease-in-out infinite, applied to round-card current state */
```

Don't add full Framer Motion blocks where a CSS keyframe will do — they're cheaper and more consistent.

## Canonical reviewer naming

Extend the canonical pattern at `src/lib/cloister/specialists.ts:660` with a sibling helper:

```typescript
// src/lib/cloister/specialists.ts
export function getReviewerSessionName(
  role: ReviewerRole,
  projectKey: string,
  issueId: string,
): string {
  // matches getTmuxSessionName shape: specialist-{project}-{issue}-{name}
  return `specialist-${projectKey}-${issueId}-review-${role}`;
}
```

Where `role ∈ { 'correctness', 'security', 'performance', 'requirements', 'synthesis' }`. The `review-orchestrator` keeps the existing `getTmuxSessionName('review', project, issueId)` name.

This is **one tmux session per canonical role per issue**, for the lifetime of the issue. Rounds never spawn new sessions.

| Round | Old (PAN-821 behavior) | New (PAN-830) |
|---|---|---|
| 1 | `review-540-1714000000-correctness` | `specialist-panopticon-540-review-correctness` |
| 2 | `review-540-1714003600-correctness` | `specialist-panopticon-540-review-correctness` *(same session)* |
| 3 | `review-540-1714007200-correctness` | `specialist-panopticon-540-review-correctness` *(same session)* |

## Reviewer resumption mechanism

Reviewer tmux sessions are spawned with `remain-on-exit on` + `destroy-unattached off` (the same flags planning sessions already use — see `CLAUDE.md` "Session lifecycle rules"). When a round completes, the agent process exits inside the tmux pane but the pane and JSONL stay alive.

For the next round, the orchestrator does not respawn — it injects a new prompt into the existing pane via `sendKeysAsync` using the load-buffer + paste-buffer pattern (`src/lib/tmux.ts`):

```typescript
// pseudocode for review-agent.ts after PAN-830
async function runReviewerRound(role: ReviewerRole, ctx: ReviewContext): Promise<void> {
  const session = getReviewerSessionName(role, ctx.projectKey, ctx.issueId);
  const exists = await tmuxSessionExists(session);

  if (!exists) {
    await spawnReviewer({ session, role, prompt: ctx.initialPrompt });
    return;  // first round; agent is now running
  }

  // Subsequent rounds: same session, new prompt
  const followupPrompt = buildFollowupPrompt(role, ctx);  // diff since last round, etc.
  await sendKeysAsync(session, followupPrompt);
}
```

The reviewer's Claude Code session is **resumed** (the JSONL grows; it's the same conversation UUID). The `claudeSessionId` in `~/.panopticon/agents/review-{issueId}-{role}/state.json` is written once on first spawn and never overwritten.

Side effect: reviewer state dirs are no longer destroyed by `cleanupReviewerStateDirs`. That function is renamed to `archiveReviewerRound` and instead writes `round-N.json` artifacts (model, duration, cost, verdict, finding count) into the reviewer's state dir, leaving JSONL and tmux alive.

```
┌───────────────────────────────────────────────────────────────────┐
│  Round 1 launch                                                   │
│   ┌─ orchestrator spawns ──┐                                      │
│   ▼                        ▼                                      │
│  tmux create               sendKeys initial-prompt                │
│  remain-on-exit on         claudeSessionId saved → state.json     │
│  ───────────────────                                              │
│  Round 1 complete                                                 │
│   ▼                                                               │
│  agent exits (pane stays); orchestrator writes round-1.json       │
│  ───────────────────                                              │
│  Round 2 launch (CHANGES_REQUESTED → orchestrator wakes)          │
│   ▼                                                               │
│  tmuxSessionExists → true; sendKeys followup-prompt               │
│  same JSONL (UUID is stable) — Claude Code resumes                │
│  Round 2 complete                                                 │
│   ▼                                                               │
│  round-2.json appended to state dir                               │
└───────────────────────────────────────────────────────────────────┘
```

## JSONL resolution fix

`resolveJsonlPath()` in `src/dashboard/server/routes/command-deck.ts:227` is replaced with a lookup that mirrors `resolveSessionFile()` in `conversations.ts`:

```typescript
async function resolveJsonlPath(session: SessionDescriptor): Promise<string | null> {
  // 1. Look up claudeSessionId from agent state (~/.panopticon/agents/<id>/state.json)
  const claudeSessionId = await readAgentClaudeSessionId(session.id);
  if (!claudeSessionId) return null;

  // 2. Build path: ~/.claude/projects/<encoded-cwd>/<claudeSessionId>.jsonl
  const encoded = encodeClaudeProjectDir(session.cwd);
  const path = join(home(), '.claude', 'projects', encoded, `${claudeSessionId}.jsonl`);
  return (await fileExists(path)) ? path : null;
}
```

For reviewers (which are spawned as `claude --resume` flows after round 1), `claudeSessionId` is already correct in `state.json` and we just need to keep it stable. For pre-existing reviewer state dirs that don't have a `claudeSessionId` yet, the fallback is `glob('*.jsonl')` in the encoded dir scoped to "files modified after the agent's start time".

Use `fs/promises` only (no sync FS in server routes — see `CLAUDE.md` "No Blocking Calls in Dashboard Server Code").

## Reunified action layer (parity, additive)

Goal: every action reachable on `IssueCard` / `InspectorPanel` / `BadgeBar` / `StatusFlowControl` / `WorkspacePane` is also reachable from Command Deck. **Nothing on those surfaces is removed or modified.** This is a parity audit + Command Deck implementation, not a deletion.

The full action catalog (you can think of this as the master TODO checklist for parity):

### From `IssueCard` (kanban card)

| Action | Lives in (Command Deck) |
|---|---|
| Click card to open Inspector | Tree row click → agent-selected (alive) or issue-selected |
| Click cost badge | Zone A overflow → "View Costs" tab in issue-selected |
| Click vBRIEF badge | Zone A overflow → "View vBRIEF" tab in issue-selected |
| Click stuck badge | Zone A stuck ribbon (always shown when stuck) |
| Click container badge | Zone A overflow → "Open Workspace" |
| Click "Ready to Merge" badge | Zone A primary "Merge" button (humans only) |
| Hover for tooltip | Hover on Zone A elements gives same tooltips |
| Right-click card → context menu | Zone A overflow `…` menu mirrors all 6 actions |

### From `InspectorPanel` sections

| Section | Action | Lives in |
|---|---|---|
| AgentInfoSection | View state dir | Zone B overflow → "Open State Dir" |
| AgentInfoSection | Stop agent | Zone B "Stop" button |
| AgentInfoSection | Restart agent | Zone B "Restart" (ended state) |
| AgentInfoSection | Deep-wipe (destructive) | Zone B overflow → "Deep wipe…" with confirmation dialog |
| ReviewPipelineSection | View round history | Zone B round mini-cards |
| ReviewPipelineSection | View per-reviewer JSONL | Click reviewer in tree → agent-selected |
| ContainerSection | Start container | Zone A overflow → "Start Container" |
| ContainerSection | Stop container | Same |
| ContainerSection | View logs | Issue-selected → "Activity" tab (or dedicated logs tab if needed) |
| ActionsSection | Spawn Work | Zone A primary in `Backlog`/`Todo` state |
| ActionsSection | Request Review | Zone A primary in `In Progress` state |
| ActionsSection | Approve & Test | Zone A primary in `In Review · APPROVED` |
| ActionsSection | Force Merge | Zone A overflow always |
| ActionsSection | Edit Settings | Zone A overflow → "Settings" |

### From `BadgeBar` modals

| Modal | Lives in |
|---|---|
| Cost breakdown | Issue-selected → "Costs" tab |
| Review findings | Agent-selected (reviewer) → "Findings" tab |
| Test failures | Issue-selected → "Activity" tab filtered by test events; or PR/Diff tab |
| Merge conflicts | Issue-selected → "PR / Diff" tab |

### From `StatusFlowControl`

| Action | Lives in |
|---|---|
| Move to Todo | Zone A overflow → "Reset to Todo" |
| Move to In Progress | Zone A primary "Spawn Work" |
| Move to In Review | Zone A primary "Request Review" |
| Move to Done | Zone A primary "Merge" or "Close Issue" |
| Drag-to-column gesture | NOT mirrored in Command Deck; remains kanban-only shortcut |

### From `WorkspacePane`

| Action | Lives in |
|---|---|
| Start Workspace | Zone A overflow → "Start Workspace" (when no container) |
| Start Planning | Zone A primary "Spawn Planning" (when no plan) |
| Stop All | Zone A overflow → "Stop All Agents" |
| Open in Tmux | Zone A + Zone B overflow → "Open in tmux" |

### Parity smoke test

Add a Vitest spec that walks the action lists in `KanbanBoard.tsx`, `InspectorPanel.tsx`, `BadgeBar.tsx`, `StatusFlowControl.tsx`, `WorkspacePane.tsx` and asserts each labeled action exists by label in the Command Deck `getZoneAActions(state)` / `getZoneBActions(state)` maps. Cheap to keep current, catches drift before the future kanban revamp.

## Tree node behavior

- **One node per canonical role per issue.** Reviewers become 5 fixed nodes (correctness, security, performance, requirements, synthesis) plus 1 orchestrator.
- **Node icon reflects current state**, not a log of past states. Use `<StatusDot>` from the building-block kit.
- **Tooltip on hover** shows round count, total duration, total cost.
- **Right-click** opens session-action menu (mirrors Zone B contextual actions).
- **Status filter on tree header**: `[All] [Alive] [Failed]` toggle. Default: All.
- **Issue row** carries a `<StatusDot>` matching the dominant agent state of its sessions.
- **Done-issue collapse default**: clicking the issue row expands.
- **Live updates** via `subscribeProjectSessionTree` — every `session_added`, `session_removed`, `presence_changed`, `status_changed` event animates the tree (slide-in, fade, dot color change).
- **Cost on issue row** uses `<LiveCounter>` and pulses on `cost.event_recorded`.

Trees collapse by default for `Done` issues — clicking the issue row expands. `In Progress` / `In Review` / `Testing` issues default expanded with the alive node selected.

## Out of scope

- Per-round JSONL splitting. Reviewers keep one continuous JSONL across rounds; the round divider is a UI affordance only.
- Issue creation flow. Command Deck is for working on existing issues.
- Bulk actions across issues. Single-issue surface only.
- Mobile / narrow-viewport layout. Command Deck is desktop-first.
- Rebuilding the kanban / inspector / badge bar / status-flow surfaces. Those keep their current behavior; future kanban revamp is its own initiative.
- Sound design (event-driven audio cues). Tempting but separate.
- "Lifecycle director" composer mode in issue-selected with no sessions yet. Out for now; the simpler "spawn-and-send" exception above is enough.

## Implementation plan

This plan is sequenced for a junior developer to follow without deep prior context. Each phase ends in a demoable state.

### Phase 0 — Reading

- Read this PRD end to end.
- Read `CLAUDE.md` (especially "Session lifecycle rules", "No Blocking Calls in Dashboard Server Code", "tmux Message Delivery").
- Read `src/lib/cloister/specialists.ts:660-680` (the canonical naming pattern).
- Read `src/lib/cloister/review-agent.ts:600-900` (the parallel review fan-out logic you'll be modifying).
- Read `src/dashboard/server/routes/command-deck.ts:120-270` (the resolver and snapshot endpoints).
- Read `src/dashboard/frontend/src/components/chat/{ConversationPanel,MessagesTimeline,ChatMarkdown,ComposerFooter}.tsx` so you don't accidentally redesign them.
- Skim `src/dashboard/frontend/src/components/GodView/ActivityFeed.tsx` — your liveness benchmark.

### Phase 1 — Reviewer canonical naming + resumption (server-side)

Files:

- `src/lib/cloister/specialists.ts` — add `getReviewerSessionName(role, projectKey, issueId)`.
- `src/lib/cloister/review-agent.ts` — replace `runParallelReview` round-spawn logic with resume-or-spawn. Keep `claudeSessionId` stable. Rename `cleanupReviewerStateDirs` → `archiveReviewerRound` (writes `round-N.json`, leaves JSONL/tmux alive).
- `src/lib/cloister/review-agent.ts:720` — reviewer spawn block: use canonical name, set `remain-on-exit on`.
- `src/dashboard/server/routes/command-deck.ts:451-598` — multi-round handling deleted; one canonical node per role; round metadata aggregated from `round-N.json` artifacts.
- `src/dashboard/server/routes/command-deck.ts:124` — `extractReviewerRole` simplified to canonical name parse.
- `src/dashboard/server/routes/command-deck.ts:227` — `resolveJsonlPath` rewritten per "JSONL resolution fix" above.

Tests:

- Unit: `getReviewerSessionName` round-trip names match expected pattern.
- Unit: `resolveJsonlPath` resolves correctly with `claudeSessionId` from state.json.
- Integration: spawn a reviewer, complete round 1, send a follow-up, verify the same tmux session and same JSONL UUID are used in round 2.

Demo: at end of Phase 1, the session tree shows 5 fixed reviewer nodes for an issue regardless of how many rounds it's been through.

### Phase 2 — Three-zone Command Deck shell (frontend)

Build the wrapper component first; bring in Zone C reuse last so the layout is locked.

New files:

- `src/dashboard/frontend/src/components/CommandDeck/IssueWorkbench.tsx` — orchestrates zones A/B/C.
- `src/dashboard/frontend/src/components/CommandDeck/ZoneA.tsx` — issue header.
- `src/dashboard/frontend/src/components/CommandDeck/ZoneB.tsx` — agent context.
- `src/dashboard/frontend/src/components/CommandDeck/ZoneCConversation.tsx` — wraps `ConversationPanel` with `roundMarkers` injection.
- `src/dashboard/frontend/src/components/CommandDeck/ZoneCOverview.tsx` — issue-selected mode tabs (start with Overview tab; other tabs land in Phase 4).

Selection state:

- Add a Zustand slice `selectedSessionByIssue: Record<IssueId, SessionId | null>`.
- The tree calls `selectSession(issueId, sessionId | null)`.
- `IssueWorkbench` reads selection to render agent-selected vs issue-selected.

Wire in `subscribeDomainEvents` filtered by `issueId` for live updates in zones A/B.

Demo: at end of Phase 2, you can click any session → Zone B updates and Zone C shows the conversation. Click the issue row → Zone B collapses and Zone C shows the Overview.

### Phase 3 — Liveness building blocks

Build these in order, with Storybook stories so they're inspectable:

1. `<StatusDot status>` — six variants, all keyframes wired.
2. `<LiveCounter value unit precision pulseOnIncrement>` — number scroll + symbol pulse.
3. `<RoleBadge role role_>` — mapping table to icons + ring colors.
4. `<RoundCard round active>` — mini-card with sweep animation.
5. `<ToolFlash currentTool>` — cross-fade.
6. `<ActivitySparkline events windowMinutes buckets>` — inline SVG.

Plug each into Zone A and Zone B. Confirm visually that **something is moving** in Zone A and Zone B at all times when the issue is in progress.

### Phase 4 — Issue-selected mode

Tabs in dependency order (build cheapest first, demo as you go):

1. **Overview** — billboard + reviewer summary + test summary + PR summary + cost sparkline + activity feed + quick links.
2. **Activity** — filtered ActivityFeed (cheapest, mostly reused).
3. **Costs** — uses `useCostStream` data, simple stacked-bar chart.
4. **PRD** / **STATE.md** / **INFERENCE.md** — markdown-render existing files.
5. **vBRIEF** — embed existing `<VBriefViewer>` component.
6. **Beads** — list view of `/api/issues/:id/beads`.
7. **PR / Diff** — most complex; use `gh pr view` + `gh pr diff` data; render a file tree + diff hunks.
8. **Discussions** — combined Linear + GitHub PR comments.

### Phase 5 — Action surface parity (additive only)

For each surface (`IssueCard`, `InspectorPanel`, `BadgeBar`, `StatusFlowControl`, `WorkspacePane`):

- Walk the action list (use the catalog above as a checklist).
- Confirm Zone A or Zone B has a contextual home.
- Wire it up using the existing backend RPC/endpoint — no new APIs.
- File a small follow-up bug if any action has no good home.

Add the parity smoke test at the end of this phase.

### Phase 6 — Tree node redesign + dividers

- Tree node redesign in `Sidebar.tsx`: one node per canonical role, status-dot icons, status filter, right-click menu.
- Round divider in `MessagesTimeline` (non-virtualized, parent-injected via `roundMarkers` prop).
- Done-issue collapse default.
- Issue-row state-dot dominant aggregation.

### Phase 7 — Polish, perf, parity test

- Run a 30-second "did anything move?" test on a real in-progress issue. Verify all the prescribed motions are firing.
- Profile: confirm sparkline + ToolFlash + LiveCounter don't cause re-render storms (use React DevTools profiler).
- Run the parity smoke test (Phase 5).
- Verify motion-reduce preference: `@media (prefers-reduced-motion: reduce)` disables alive-dot/breathing/sweep keyframes (still allow one-shot fades).

## Acceptance criteria

### Reviewer canonical naming + resumption

- [ ] Reviewers reuse the same tmux session and same JSONL across rounds. Round 2 of `review-correctness` does not spawn a new tmux session.
- [ ] `getReviewerSessionName('correctness', 'panopticon', '540')` returns `specialist-panopticon-540-review-correctness`.
- [ ] `claudeSessionId` in `state.json` is written once on first spawn and never overwritten.
- [ ] Session tree shows exactly 6 reviewer nodes for an issue with N review rounds (1 orchestrator + 5 roles), regardless of N.
- [ ] `archiveReviewerRound` writes `round-N.json` to the reviewer's state dir; JSONL and tmux session remain.

### JSONL resolution

- [ ] `resolveJsonlPath()` correctly returns the JSONL file for any session that has a `claudeSessionId` in its state.
- [ ] Sessions without JSONL still get the terminal fallback (read-only).

### Three-zone Command Deck

- [ ] Zone A is always visible and reflects the issue identity, pipeline state, cost, and acceptance progress.
- [ ] Zone B is always visible in agent-selected mode and reflects the selected agent's role, status, phase, current tool, round number (if applicable), elapsed time, and cost.
- [ ] Zone C contains `ConversationPanel` (reused) in agent-selected mode and the tabbed Overview in issue-selected mode.
- [ ] Composer in agent-selected mode addresses the selected session (any of: planning, work, review-orchestrator, review-correctness, …, test, merge).
- [ ] Composer in issue-selected mode is disabled with a hint, OR contextual-spawn ("Spawn & Send") when zero sessions exist.

### Issue-selected mode

- [ ] Clicking the issue row in the tree switches to issue-selected mode.
- [ ] Loading the project view fresh: defaults to agent-selected on the alive session if one exists, otherwise issue-selected.
- [ ] Overview tab renders the status billboard, reviewer summary (when in review), test summary (when test has run), PR summary, cost sparkline, recent activity feed, and quick links.
- [ ] Other tabs (PRD, vBRIEF, STATE.md, INFERENCE.md, PR/Diff, Beads, Costs, Activity, Discussions) each render their respective data without leaving Command Deck.

### Liveness

- [ ] Every domain event in the catalog triggers its prescribed motion within 200ms.
- [ ] No "refresh" buttons exist in the Command Deck UI.
- [ ] Cost ticker animates on every `cost.event_recorded`.
- [ ] Tool name in Zone B cross-fades on `agent.activity_changed`.
- [ ] Activity sparkline updates on every domain event for the issue.
- [ ] `prefers-reduced-motion: reduce` disables breathing/sweep keyframes; one-shot fades remain.

### Action parity

- [ ] Every action reachable on `IssueCard` / `InspectorPanel` / `BadgeBar` / `StatusFlowControl` / `WorkspacePane` is also reachable from the three Command Deck zones.
- [ ] Parity smoke test passes.
- [ ] Kanban / inspector / badge bar / status-flow surfaces are unchanged by this PR.
- [ ] Merge button is human-only — no automated path triggers it.

### Density

- [ ] No state badge in Zone A is shown when its value is the default for the current stage.
- [ ] Action buttons in Zone A appear only when contextual to the current pipeline state.

### Tree

- [ ] Round divider appears in the conversation timeline at round boundaries for reviewers/test/work sessions.
- [ ] Done-state issues default to collapsed; in-flight issues default to expanded with the alive node selected.
- [ ] Right-click on a session node opens the session-action menu.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Reviewer session resumption corrupts the JSONL if Claude Code's resume protocol changes | Pin to the same `--resume` flow already used by `pan tell`. Add an integration test that opens a JSONL, runs two synthetic rounds, and validates message count. |
| Density triage hides actions a user wants | Every contextual-only action is also reachable from a stable overflow `…` menu. The triage is about default visibility, not access. |
| Round divider hurts scroll virtualization | Inject as a non-virtualized row outside the virtualizer (existing pattern: timeline already mixes virtualized + non-virtualized for the last 8 rows). |
| Action parity drifts as kanban / inspector evolve | Parity smoke test asserts each existing surface label is reachable in Command Deck. Cheap to keep current, catches drift before the future kanban revamp. |
| Removing `cleanupReviewerStateDirs` accumulates JSONL | Reviewer state dirs are bounded by the issue lifecycle. On `merge` complete, archive the issue's reviewer state dirs to `~/.panopticon/agents/.archive/<issue-id>/`. |
| Liveness motion overwhelms users / is distracting | Honor `prefers-reduced-motion: reduce`. Cap simultaneous animations per zone at 2. Use low-amplitude breathing rather than punchy effects for ambient state. |
| Re-render storms from event-driven motion | Build the live components (LiveCounter, ToolFlash, ActivitySparkline) with stable refs and `useMemo`/`useRef` over event subscriptions; assert with React Profiler that idle issues cause <5 re-renders/sec in Zone A and Zone B. |
| Issue-selected Overview becomes a dumping ground | Constrain Overview to the 7 sections listed; new sections require a PRD update. |

## References

- PAN-821 (parent — replaces its multi-round fan-out behavior)
- `src/lib/cloister/review-agent.ts:654` — `runParallelReview`
- `src/lib/cloister/specialists.ts:660` — `getTmuxSessionName` (canonical pattern to extend)
- `src/dashboard/server/routes/command-deck.ts:227` — `resolveJsonlPath` (JSONL bug)
- `src/dashboard/frontend/src/components/chat/ConversationPanel.tsx` — reused as-is in Zone C
- `src/dashboard/frontend/src/components/KanbanBoard.tsx:2486` — `IssueCard` (parity reference; not modified)
- `src/dashboard/frontend/src/components/InspectorPanel.tsx` — parity reference; not modified
- `src/dashboard/frontend/src/components/GodView/ActivityFeed.tsx` — liveness benchmark
- `src/dashboard/frontend/src/index.css:246-262` — existing keyframes (`badge-shimmer`, etc.)
- `packages/contracts/src/events.ts` — full domain event catalog (102+ event types)
- `packages/contracts/src/rpc.ts` — RPC subscription methods
- `CLAUDE.md` — "Session lifecycle rules" `remain-on-exit on` precedent; "No Blocking Calls" rule
- Mock: `docs/design/mockups/PAN-830-unified-command-deck.html`
