# PAN-821: Command Deck — Issue Session Tree with Conversation-First Agent Panels

## Problem

When a project is selected in Command Deck, each issue (e.g. PAN-539) surfaces its agents as **xterm panels with tabs**: Work, Review, plus reviewer sub-agent terminals that pop in and out as they spawn. Three problems:

1. **Terminal-first framing buries the conversation.** Across the rest of the app we already favor a JSONL conversation view with the terminal as a secondary toggle (see `ConversationTerminal.tsx`, `chat/ConversationPanel.tsx`, the conversation pattern shipped in PAN-451). The project view is the last holdout.
2. **No persistent, holistic view of every session** that ran for an issue. Reviewer sub-agents (correctness, security, performance, requirements, synthesis) appear as ad-hoc tabs while alive and disappear after they exit. There's no place to scroll back through "every agent that ever touched PAN-539."
3. **Per-issue information is vast but poorly surfaced.** Each issue accumulates a rich set of artifacts — planning docs, cost breakdowns, pipeline state, beads tasks, reviewer reports, git history — but the current view either buries this in a heavy inspector panel or scatters it across tabs. The information should be contextual and compact, not a separate destination.

## Goal

Replace the per-issue Work/Review tab strip in the project-selected view with an **issue-rooted session tree** (left rail) plus a **conversation-first right pane** with a compact contextual header. Clicking an issue auto-selects its most active (or most recent) session and opens that agent's conversation view.

```
<Project>
├── PAN-539  [$4.32]  In Review
│   ├── planning              ○ ended
│   ├── work                  ○ ended
│   ├── review                ◐ alive, active (spinner)
│   ├── reviewer/correctness  ○ ended
│   ├── reviewer/security     ○ ended
│   ├── reviewer/performance  ○ ended
│   ├── reviewer/requirements ○ ended
│   ├── reviewer/synthesis    ○ ended
│   ├── test                  ○ ended
│   └── merge                 ○ ended
├── PAN-540  [$1.10]  Working
│   ├── planning              ○ ended
│   └── work                  ● alive, idle
```

Selecting any session opens the right pane: **conversation view of its JSONL by default**, with a per-session toggle to the live xterm. The conversation view takes the lead — it's 90%+ of the pane.

## The Information Problem

Each issue in Panopticon accumulates a significant amount of data across its lifecycle. The design must account for all of it without overwhelming the conversation-first view. Here's the full inventory and where each piece lives in the new layout:

### Information available per issue

| Data | Source | Placement in new UI |
|------|--------|---------------------|
| **Issue identity** (ID, title, URL, tracker) | GitHub/Linear/Rally | Right pane header — always visible |
| **Pipeline stage** (planning → work → review → test → merge) | `ReviewStatusSnapshot` + agent state | Right pane header — compact stage indicator with color |
| **Agent sessions** (planning, work, review, reviewers, test, merge) | `fetchActivityData` | Left rail tree — each session is a node |
| **Per-session conversation** (JSONL transcript) | `~/.claude/projects/<encoded>/*.jsonl` | Right pane body — primary content area |
| **Per-session terminal** (live tmux PTY) | `/ws/terminal` WebSocket | Right pane body — toggle from conversation |
| **Per-session metadata** (model, duration, cost) | Agent state files + cost service | Session node row in tree + right pane header |
| **Total cost + per-stage breakdown** | `/api/costs/by-issue` | Issue row in tree (total) + right pane header (breakdown on hover/expand) |
| **Review pipeline status** (verification, review, test, merge stages) | `ReviewStatusSnapshot` | Right pane header — compact pipeline dots |
| **Rally stories** (child stories, progress, assignees) | Rally tracker API | Issue row in tree (progress bar, as today) |
| **Planning artifacts** (STATE.md, PRD) | Workspace `.planning/` dir | Accessible via header action buttons (compact) |
| **vBRIEF plan** (items, acceptance criteria, dependencies) | `.planning/plan.vbrief.json` | Accessible via header action button |
| **Beads/tasks** (completion status) | `.beads/issues.jsonl` | Accessible via header action button (with count badge) |
| **Git info** (branch, PR URL, commits ahead) | Git + GitHub API | Right pane header — branch name, PR link if exists |
| **Discussions** (synced from tracker) | Tracker sync | Accessible via header action button (with count badge) |
| **Transcripts/notes** (uploaded) | Workspace files | Accessible via header action button (with count badge) |
| **Inference/shadow analysis** | Shadow engineering | Accessible via header action button (if available) |
| **Status review** (auto-generated summary) | Sync endpoint | Accessible via header action button |
| **Agent presence** (active/idle/ended per session) | `AgentRuntimeSnapshot` + tmux | Session node indicator in tree |

### Design principle

**The conversation is the primary content. Everything else is chrome.**

- The right pane header is a slim, information-dense bar — one or two rows. Issue title, pipeline stage dots, cost, and a row of compact action buttons for artifacts (STATE, PRD, Tasks, Discussions, etc.). Think of it like a GitHub issue header, not a full inspector panel.
- The right pane body is entirely the selected session's conversation (or terminal when toggled).
- The left rail tree handles session selection and shows per-session presence at a glance.
- Issue-level aggregate info (cost, Rally progress, pipeline stage) surfaces inline on the issue row in the tree, not in a separate summary pane.
- No information is lost — everything currently accessible via BadgeBar and InspectorPanel remains reachable, just promoted to the header or available as action-button popovers rather than occupying dedicated panel space.

## Non-Goals

- Changing the underlying tmux/agent lifecycle. This is a presentation-layer issue.
- Changing the JSONL conversation renderer (`ChatMarkdown`, `MessagesTimeline`) — reuse as-is from PAN-451.
- Reordering, filtering, or grouping nodes (date sort, agent-type filter) — follow-up if needed.
- Replacing the single-feature focused view (when a feature is selected directly via deep link). That view already uses `AgentSection` and is out of scope for this issue. Only the **project-selected** mode changes here.
- Aggregated cross-issue analytics. Each issue's sessions are scoped to that issue's subtree.
- Coordinating with PAN-548 (Command Deck state preservation). Use Zustand + localStorage independently; PAN-548 can adopt the same store pattern later.

## Architecture

### Tree (left rail, project-selected mode)

Extend the existing project tree:

- `ProjectTree/ProjectNode.tsx` — already renders project → issues. Unchanged.
- `ProjectTree/FeatureItem.tsx` — currently a leaf. Becomes expandable; renders a child list of **session nodes** for that issue. Clicking the issue row expands it AND auto-selects the most active (or most recent) session.
- `ProjectTree/SessionNode.tsx` (new) — one row per session: type label, presence indicator, duration.

Selecting a session sets `selectedSessionId` in Command Deck state; right pane reacts.

### Right pane

Two zones:

**1. Contextual header** (slim, always visible when an issue is selected):
- Row 1: Issue ID (linked) + title + pipeline stage indicator (colored dots for verification → review → test → merge) + total cost
- Row 2: Compact action buttons — Tasks (count badge), STATE, PRD, Discussions (count), Transcripts (count), Sync — same artifacts as current BadgeBar but more compact. Only show buttons for artifacts that exist.
- The currently selected session's info (type/role label, model, presence dot, duration) can appear inline in row 1 or as a subtle sub-header.

**2. Conversation body** (fills remaining space):
- Default: conversation view of the selected session's JSONL (via `ConversationPanel` / `MessagesTimeline`).
- Toggle: terminal view (live xterm via `XTerminal`). Per-session toggle state persisted in localStorage.
- Fallback: if no JSONL exists for a session, render the markdown transcript (raw agent output via `ChatMarkdown`). Same content as today's `AgentSection` transcript view.
- Ended sessions: conversation still readable. Terminal toggle shows "Session ended" empty state.

### Data flow

```
Command Deck (project selected)
  │
  ├── ProjectTree (left rail)
  │     └── for each issue → FeatureItem (expandable)
  │           └── for each session → SessionNode (with presence)
  │
  └── Right Pane
        ├── ContextualHeader (issue metadata + action buttons)
        └── SessionPanel
              ├── ConversationPanel or ChatMarkdown (default)
              └── XTerminal (toggle)
```

### Auto-selection logic

When a user clicks an issue row in the tree:
1. Expand the issue's session children (toggle if already expanded).
2. Auto-select the "best" session:
   - If any session has `presence: 'active'` → select it (prefer work > review > test).
   - Else if any has `presence: 'idle'` → select it.
   - Else → select the most recently started session.
3. Right pane updates to show that session's conversation + the issue's contextual header.

Clicking a different session node within the same issue updates the conversation body but keeps the header unchanged. Clicking a session in a different issue updates both.

## Data Model

The server already aggregates per-issue sessions in `mission-control.ts` → `fetchActivityData()`. That function returns `sections[]` containing planning, work, and specialist (review/test/merge) entries. We extend this to be the canonical source for the session tree.

### Server: extend `fetchActivityData` shape

```typescript
interface SessionNode {
  type: 'planning' | 'work' | 'review' | 'reviewer' | 'test' | 'merge' | 'legacy';
  /** Sub-role for fan-out reviewers: 'correctness' | 'security' | 'performance' | 'requirements' | 'synthesis' */
  role?: string;
  sessionId: string;
  /** tmux session name; absent or non-existent means "ended" */
  tmuxSession?: string;
  model: string;
  startedAt: string;
  endedAt?: string;
  duration: number | null;
  /** 'running' | 'completed' | 'failed' */
  status: string;
  /** Path to JSONL file for ConversationPanel */
  jsonlPath?: string;
  /** Transcript content for sessions without JSONL */
  transcript?: string;
  /** Live presence: derived from tmux + activity */
  presence: 'active' | 'idle' | 'ended';
}

interface FeatureNode {
  issueId: string;
  title: string;
  sessions: SessionNode[];
}

interface ProjectSessionTree {
  projectKey: string;
  features: FeatureNode[];
}
```

### Endpoint

```
GET /api/projects/:projectKey/session-tree
  → ProjectSessionTree
```

Backed by:

1. Reuse `fetchActivityData` per issue (already discovers planning/work/specialist sessions from `~/.panopticon/agents/` and `~/.panopticon/specialists/tasks/`).
2. Add a `presence` field derived from `getAgentRuntimeStateAsync` + a recency check on tmux pane output (last activity within N seconds → `'active'`; alive but no recent output → `'idle'`; tmux session gone → `'ended'`).
3. Add `jsonlPath` resolution by mapping `sessionId` → `~/.claude/projects/<encoded>/<sessionId>.jsonl` using the existing `encodeClaudeProjectDir()` helper from `src/lib/paths.ts`.
4. Include `transcript` content for sessions that lack JSONL (fallback rendering).

### Live updates

Two streams via the existing `/ws/rpc`:

- `subscribeProjectSessionTree(projectKey)` — emits when sessions are added/removed (e.g. a reviewer fan-out spins up) or status flips.
- Existing `subscribeConversationMessages(sessionId)` from PAN-451 — drives the conversation view content.

Presence (`active` ↔ `idle`) is high-frequency; emit it on a debounced interval (1 Hz max per issue) rather than per stdout chunk.

## Components (in implementation order)

### Phase 1 — Contracts & Server

#### 1. Add `SessionNode`, `FeatureNode`, `ProjectSessionTree` types to contracts

**File:** `packages/contracts/src/types.ts`

New types shared between server and frontend.

#### 2. Extend `fetchActivityData` to include reviewer sub-agents, presence, and JSONL paths

**File:** `src/dashboard/server/routes/mission-control.ts`

- Today the function lumps parallel review sessions under one `review` section. Split each `review-<issueId>-<timestamp>-<role>` tmux session into its own `SessionNode` with `type: 'reviewer'` and `role`.
- Add `presence` field via `getAgentRuntimeStateAsync` + a "last output mtime within 5s" heuristic on the agent's `output.log` (cheap stat, no read).
- Add `jsonlPath` resolution using `encodeClaudeProjectDir()` from `src/lib/paths.ts`.
- Include `transcript` for sessions without JSONL.
- Keep the existing `/api/missions/:issueId/activity` response shape backward-compatible — additive fields only.

#### 3. New endpoint `GET /api/projects/:projectKey/session-tree`

**File:** `src/dashboard/server/routes/projects.ts` (extend)

- For the given project, list all issues (with workspaces or active agents).
- For each, call the extended `fetchActivityData`.
- Return `ProjectSessionTree`.

#### 4. RPC subscription `subscribeProjectSessionTree`

**File:** `src/dashboard/server/ws-rpc.ts` + `packages/contracts`

- New RPC method emitting tree deltas (session added, session removed, presence changed, status changed).
- Backed by the existing event store + a polling fallback for tmux presence (1 Hz).

### Phase 2 — Frontend tree

#### 5. `SessionNode.tsx` component

**New:** `src/dashboard/frontend/src/components/MissionControl/ProjectTree/SessionNode.tsx`

- Row layout: `[icon by type] [label] [role badge if reviewer] [presence indicator] [duration]`.
- Presence indicator:
  - `active` → green filled circle with `Loader2` spinner overlay.
  - `idle` → green filled circle, no spinner.
  - `ended` → hollow / muted circle.
- Click → `onSelect(sessionId)`.
- Selected state styled via `mission-control.module.css`.

#### 6. Extend `FeatureItem.tsx` to be expandable

**File:** `src/dashboard/frontend/src/components/MissionControl/ProjectTree/FeatureItem.tsx`

- Add expand/collapse caret (`ChevronRight` / `ChevronDown` from lucide).
- When expanded, render `SessionNode` children from `feature.sessions`.
- Clicking the issue row: expand + auto-select best session.
- Persist expansion state in localStorage keyed by `feature.issueId`.

#### 7. Wire tree into Command Deck project-selected mode

**File:** `src/dashboard/frontend/src/components/MissionControl/index.tsx`

- When a project is selected, fetch `/api/projects/:projectKey/session-tree` via TanStack Query.
- Subscribe to `subscribeProjectSessionTree` to apply deltas.
- Pass the tree to `ProjectNode` → `FeatureItem` → `SessionNode`.
- Track `selectedSessionId` + `selectedIssueId` in state.
- Auto-selection logic on issue click.

### Phase 3 — Frontend right pane

#### 8. Contextual issue header component

**New:** `src/dashboard/frontend/src/components/MissionControl/SessionView/IssueHeader.tsx`

- Row 1: Issue ID (linked) + title + pipeline stage dots + cost.
- Row 2: Compact action buttons — Tasks, STATE, PRD, Discussions, Transcripts, Sync. Only show what exists. Count badges where applicable.
- Slim, information-dense — two rows max.
- Reuse data from existing `BadgeBar` fetch (`/api/command-deck/planning/{issueId}`) but render it compactly.

#### 9. Session panel with conversation/terminal toggle

**New or refactored:** `src/dashboard/frontend/src/components/MissionControl/SessionView/SessionPanel.tsx`

- Takes a `SessionNode` and renders:
  - Session info sub-header (type/role, model, presence, duration).
  - View toggle: `[Conversation] [Terminal]`. Persist per-session in localStorage.
  - Conversation view: `ConversationPanel` if JSONL exists, else `ChatMarkdown` with transcript.
  - Terminal view: `XTerminal({ session: tmuxSession })`. Ended → "Session ended" empty state.
- Synthesize a `Conversation` object from `SessionNode` (same pattern as `AgentSection.tsx` line ~200 for specialists) so `ConversationPanel` works without API changes.

#### 10. Compose right pane for project-selected mode

**File:** `src/dashboard/frontend/src/components/MissionControl/index.tsx` + `ActivityView/index.tsx`

- When `selectedSessionId` is set: render `IssueHeader` + `SessionPanel`.
- When no session selected but project is selected: empty state "Select an issue to view agent activity."
- Keep `AgentSection` path intact for single-feature focused view (deep link).

### Phase 4 — Styling & polish

#### 11. CSS for session tree, issue header, session panel

**File:** `src/dashboard/frontend/src/components/MissionControl/styles/mission-control.module.css`

- Session node row styles (indentation, selected state, presence indicator animations).
- Issue header styles (compact layout, pipeline dots, action buttons).
- Session panel styles (toggle, empty states).
- Both light and dark mode tokens.

## Files Changed

| File | Action |
|------|--------|
| **Phase 1** | |
| `packages/contracts/src/types.ts` | MODIFY — add `SessionNode`, `FeatureNode`, `ProjectSessionTree` types |
| `src/dashboard/server/routes/mission-control.ts` | MODIFY — split reviewer sessions, add `presence` + `jsonlPath` + `transcript` |
| `src/dashboard/server/routes/projects.ts` | MODIFY — add `/session-tree` endpoint |
| `src/dashboard/server/ws-rpc.ts` | MODIFY — add `subscribeProjectSessionTree` |
| **Phase 2** | |
| `src/dashboard/frontend/src/components/MissionControl/ProjectTree/SessionNode.tsx` | CREATE |
| `src/dashboard/frontend/src/components/MissionControl/ProjectTree/FeatureItem.tsx` | MODIFY — expandable, auto-select, renders session children |
| `src/dashboard/frontend/src/components/MissionControl/index.tsx` | MODIFY — fetch tree, track `selectedSessionId`, auto-selection |
| `src/dashboard/frontend/src/components/MissionControl/styles/mission-control.module.css` | MODIFY — session node styles |
| **Phase 3** | |
| `src/dashboard/frontend/src/components/MissionControl/SessionView/IssueHeader.tsx` | CREATE — compact issue metadata header |
| `src/dashboard/frontend/src/components/MissionControl/SessionView/SessionPanel.tsx` | CREATE — conversation/terminal panel for selected session |
| `src/dashboard/frontend/src/components/MissionControl/ActivityView/index.tsx` | MODIFY — project-selected path delegates to SessionView |
| `src/dashboard/frontend/src/components/MissionControl/ActivityView/AgentSection.tsx` | UNCHANGED — still used by single-feature focused view |

## Acceptance Criteria

- [ ] Selecting a project in Command Deck renders a tree where each issue expands to show every session that ran (or is running) for it — planning, work, review, each reviewer sub-agent, test, merge — not just currently active ones.
- [ ] Clicking an issue row expands its session children AND auto-selects the most active (or most recent) session. The right pane immediately shows that session's conversation.
- [ ] Each session node shows a presence indicator: green dot when alive, green spinner when alive AND active, dimmed/hollow when ended.
- [ ] Spinner reflects activity (recent stdout / in-flight tool call), not just "alive." Picks up the same activity signal Cloister uses for stuck detection (`getAgentRuntimeStateAsync` + recent output mtime).
- [ ] Selecting a session opens a right-pane panel that defaults to the **conversation view** of that session's JSONL. For sessions without JSONL, falls back to markdown transcript.
- [ ] The right pane has a slim contextual header showing issue ID/title, pipeline stage, cost, and compact action buttons (Tasks, STATE, PRD, Discussions, etc.).
- [ ] The conversation/terminal toggle is visible and per-session — flipping one session to terminal doesn't affect others. Toggle state persisted in localStorage.
- [ ] Reviewer sub-agent sessions (correctness, security, performance, requirements, synthesis) each appear as their own tree nodes — not collapsed into a single "review" entry.
- [ ] Ended sessions remain in the tree. JSONL conversation is still readable; terminal toggle shows an "ended" empty state.
- [ ] Single-feature focused view (deep link to a feature) is unchanged — the `AgentSection`-based UI still works there.
- [ ] No regressions in the feature kanban, vBRIEF viewer, or single-conversation Command Deck views.

## Testing

### Server

```
tests/services/session-tree.test.ts
  - fetchActivityData splits parallel reviewers into separate sessions with role
  - presence: 'active' when output.log mtime within 5s
  - presence: 'idle' when tmux alive but no recent output
  - presence: 'ended' when tmux session does not exist
  - jsonlPath resolves to ~/.claude/projects/<encoded>/<sessionId>.jsonl
  - transcript included for sessions without JSONL
  - subscribeProjectSessionTree emits deltas on session add/remove/status change
```

### Frontend (Vitest)

```
tests/frontend/SessionNode.test.tsx
  - Renders type icon and label correctly for each type
  - Presence: active shows green dot + spinner
  - Presence: idle shows green dot, no spinner
  - Presence: ended shows hollow indicator
  - Click fires onSelect with sessionId

tests/frontend/FeatureItem.test.tsx
  - Caret toggles expansion
  - Expansion state persists to localStorage
  - Renders one SessionNode per session in feature.sessions
  - Click auto-selects best session

tests/frontend/IssueHeader.test.tsx
  - Renders issue ID and title
  - Shows pipeline stage indicators
  - Shows cost when available
  - Action buttons only shown for existing artifacts

tests/frontend/SessionPanel.test.tsx
  - Default view is Conversation
  - Toggle switches to Terminal
  - Per-session toggle state is independent
  - Falls back to transcript when no JSONL
  - Ended session shows terminal empty state
```

### Integration (Playwright)

```
tests/integration/project-session-tree.spec.ts
  - Open Command Deck, select a project with multiple issues
  - Click issue → expands and auto-selects active session
  - Each issue is collapsible; expanding shows session children
  - Active session shows green spinner
  - Click session → right pane shows conversation with issue header
  - Click Terminal toggle → xterm renders with live data
  - Ended session: terminal toggle shows empty state, conversation still works
  - Reviewer fan-out: each role appears as its own node
  - Issue header action buttons open appropriate artifacts
```

## Risks

1. **Tree fan-out for long-running projects.** A project with many issues each with 8+ sessions becomes a large tree. Mitigation: collapsed by default, virtualize the tree if row count > 200, only fetch session details lazily when an issue is expanded.

2. **Presence polling cost.** Per-session `getAgentRuntimeStateAsync` + `stat(output.log)` at 1 Hz across many sessions. Mitigation: poll only sessions whose tmux is alive (most are ended); batch via a single sweep per issue; cache mtime stats with a short TTL.

3. **JSONL path resolution.** Claude Code encodes workspace paths in the directory name (e.g. `-home-eltmon-Projects-panopticon-cli`). The encoding rule must match what the running agent uses. Mitigation: reuse `encodeClaudeProjectDir()` from `src/lib/paths.ts` — do not reimplement.

4. **Reviewer session naming drift.** The `review-<issueId>-<timestamp>-<role>` tmux name format is the contract that lets us split reviewers into nodes. If review fan-out changes its naming, the split breaks silently. Mitigation: parse role from the tmux name in one place (`extractReviewerRole()`) with a unit test, and surface unmatched sessions as `type: 'review'` (no role) rather than dropping them.

5. **Existing `AgentSection` users.** `AgentSection.tsx` is still imported by the single-feature focused view. The refactor must not break that path. Mitigation: leave `AgentSection` untouched; only change which component the project-selected `ActivityView` renders.

6. **Header information density.** The contextual header must be slim enough to not steal conversation space, but dense enough to be useful. Mitigation: start with two-row max, use tooltips and count badges to compress, add popovers for details (e.g. per-stage cost breakdown on cost hover). User can iterate on density post-ship.
