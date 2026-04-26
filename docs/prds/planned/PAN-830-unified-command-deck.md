# PAN-830: Unified Command Deck — Issue + Agent + Workflow as One Surface

## Status

Planned. Supersedes the narrow follow-up scope previously filed under PAN-830 (which was misnamed "PAN-825" and only addressed two surface bugs from PAN-821). Reverses the per-round reviewer fan-out introduced by PAN-821.

## Problem

PAN-821 shipped the project-rooted session tree, but the experience that landed has three structural failures:

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

`resolveJsonlPath()` in `src/dashboard/server/routes/mission-control.ts:227` looks up `<sessionId>.jsonl` (e.g. `agent-800.jsonl`), but Claude Code stores JSONL files under the conversation UUID (`a41c2117-2add-47cb-be57-4eb8d27b7195.jsonl`). Every session reports `hasJsonl: false`, so clicks fall through to the raw transcript fallback — exactly the terminal-first behavior PAN-821 was supposed to retire.

### 3. The Command Deck has no opinion on issue + agent + workflow as one surface

The current project view is a session tree on the left and a transcript on the right. Everything else about the issue lives somewhere else:

- **Kanban `IssueCard`** (`src/dashboard/frontend/src/components/KanbanBoard.tsx:2486`) carries 30+ badges (review status, test status, merge status, container health, attention count, vBRIEF presence, agent presence, beads count, cycle, milestone, branch, …) plus a 6-action context menu plus per-agent operation buttons. It is the de facto control panel.
- **`InspectorPanel`** (`src/dashboard/frontend/src/components/InspectorPanel.tsx`) carries another ~25 actions across `AgentInfoSection`, `ReviewPipelineSection`, `ContainerSection`, `ActionsSection`, `BadgeBar` modals — kill, restart, deep-wipe, force-merge, request-review, request-test, edit settings, view PR, view branch, view planning, view vBRIEF, view STATE.md, view INFERENCE.md, view discussions, view notes, view costs.
- **`StatusFlowControl`** carries the kanban transitions: move to Todo / In Progress / In Review / Done, with side-effects (spawn agent, request review, request test, force-merge).
- **`WorkspacePane`** carries a separate list of buttons depending on whether work is active.

These four surfaces describe the same underlying object — an issue with agents on it, in some pipeline state, with some history of what's been done — but the user is asked to learn four different mental models for getting at it. The Command Deck project view, which should be the one place where every kanban+inspector capability is reunified, instead silently delegates everything back out.

## Goal

Make Command Deck the **single, complete surface for an issue and its agents** — the be-all-and-end-all of everything you could ever need to see or do for an issue, with zero gaps versus the existing surfaces. Anything reachable from the kanban card, inspector panel, status-flow control, badge bar, or workspace pane is also reachable here, in a cohesive three-zone layout that's strictly less clicking and strictly more context.

This is **additive**: the kanban / inspector / badge bar / status-flow stay exactly as they are today. They're slated for their own future revamp; this PRD does not touch them. Command Deck reaches feature-parity by mirroring every action, not by replacing those surfaces.

Keep the conversation as the primary content. Make the controls contextual to the current pipeline state. Make reviewers single canonical nodes that resume across rounds and carry the round history inline.

## Design

### Three-zone information architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ZONE A — Issue header (always visible)                                  │
│ PAN-540  Remove convoy abstraction…   In Review · Round 2 · $4.32       │
│ [stage dots: plan ✓ work ✓ verify ✓ review ◐ test · merge]              │
│ contextual-actions: [Approve & Test] [Request Changes] [View PR] […]    │
├──────────────────────────────────────────────────────────────────────────┤
│ ZONE B — Agent context (changes with selected session)                  │
│ Selected: review-correctness  ◐ alive · round 2 · 4m elapsed · $0.18    │
│ Model: claude-opus-4-7  Temp: default  PID: 11442                       │
│ Round history: ▸ Round 1 (passed) ▸ Round 2 (in progress)               │
│ session-actions: [Stop] [Restart] [Open in tmux] [Show terminal]        │
├──────────────────────────────────────────────────────────────────────────┤
│ ZONE C — Conversation + composer (primary content, ~70% of pane)        │
│   <MessagesTimeline /> reused as-is from ConversationPanel              │
│   <ComposerFooter /> reused as-is — composer addresses selected session │
└──────────────────────────────────────────────────────────────────────────┘
```

The session tree (left rail) is unchanged in shape but flattened: one node per **canonical role**, not one per round. PAN-540's review fan-out becomes:

```
PAN-540  In Review · Round 2 · $4.32
├── planning            ○ ended       $0.42
├── work                ○ ended       $1.85
├── review-orchestrator ○ ended       $0.04   ← the spawning agent
├── review-correctness  ◐ alive       $0.31   ← single node, 2 rounds
├── review-security     ○ ended (✓)   $0.28
├── review-performance  ○ ended (✓)   $0.35
├── review-requirements ○ ended (✓)   $0.22
├── review-synthesis    ○ ended (✓)   $0.18
└── test                · pending      —
```

Inside `review-correctness` the conversation timeline shows both rounds in chronological order with a round divider. Selecting the node opens the live session if alive, or the most recent round if ended.

### Canonical reviewer naming

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

Where `role ∈ { 'correctness', 'security', 'performance', 'requirements', 'synthesis' }`. The `review-orchestrator` (the agent that spawns the fan-out and runs `parseConvoySynthesis`) keeps the existing `getTmuxSessionName('review', project, issueId)` name.

This is **one tmux session per canonical role per issue**, for the lifetime of the issue. Rounds never spawn new sessions.

Concretely for PAN-540:

| Round | Old (PAN-821 behavior) | New (PAN-830) |
|---|---|---|
| 1 | `review-540-1714000000-correctness` | `specialist-panopticon-540-review-correctness` |
| 2 | `review-540-1714003600-correctness` | `specialist-panopticon-540-review-correctness` *(same session)* |
| 3 | `review-540-1714007200-correctness` | `specialist-panopticon-540-review-correctness` *(same session)* |

### Reviewer resumption mechanism

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

Side effect we want: reviewer state dirs are no longer destroyed by `cleanupReviewerStateDirs`. That function is renamed to `archiveReviewerRound` and instead writes `round-N.json` artifacts (model, duration, cost, verdict, finding count) into the reviewer's state dir, leaving JSONL and tmux alive.

### JSONL resolution fix (subsumes prior PAN-830 issue 1)

`resolveJsonlPath()` in `src/dashboard/server/routes/mission-control.ts:227` is replaced with a lookup that mirrors `resolveSessionFile()` in `conversations.ts`:

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

For reviewers (which are spawned as `claude --resume` flows after round 1), `claudeSessionId` is already correct in `state.json` and we just need to keep it stable. For pre-existing reviewer state dirs that don't have a `claudeSessionId` yet, the fallback is `glob('*.jsonl')` in the encoded dir scoped to "files modified after the agent's start time" so we don't mismatch with sibling sessions.

### Reunified action layer

Every action currently surfaced on `IssueCard`, `InspectorPanel`, `StatusFlowControl`, and `WorkspacePane` is folded into the three zones, with **density triage**:

- **State badges** appear only when non-default. (No "branch: feature/PAN-540" when that's just the conventional name. No "container: stopped" when the workspace is in `done`.)
- **Action buttons** appear only when contextual to the current pipeline state. (No "Approve & Test" when there is no review to approve. No "Force Merge" until tests pass.)

Concretely, by zone:

#### Zone A — Issue header

Always visible:

- **Identity:** `PAN-540  Remove convoy abstraction…  ⧉` (clickable to GitHub/Linear/Rally)
- **Pipeline stage dots** with color: planning, work, verify, review, test, merge — current stage glows, prior stages tick, future stages dim.
- **Round counter** if review/test has multiple rounds: `Round 2`
- **Total cost:** `$4.32` (live)

Contextual actions (visible only when applicable):

| State | Primary action | Secondary actions |
|---|---|---|
| `Todo` (no agents) | Spawn Planning · Spawn Work | — |
| `In Progress · work alive` | — (work is autonomous) | Stop · Restart · Send Message |
| `Verification failing` | Retry Verification | View Failures · Bypass (after 3 fails) |
| `In Review · reviewers running` | — | Skip Round · Cancel Review |
| `In Review · all done, CHANGES_REQUESTED` | Send to Work | View Findings · Override |
| `In Review · all done, APPROVED` | Approve & Test | Request Changes · Force Merge |
| `Testing · failures` | Send to Work | View Failures · Bypass |
| `Ready to Merge` | **Merge** *(humans only — never auto)* | View PR · View Diff |
| `Merged` | Close Issue | View PR |
| Any | View Plan · View vBRIEF · View PRD · View Costs · Open Workspace | (overflow `…` menu) |

#### Zone B — Agent context (selected session)

Identity row:

- Role badge (`work` / `review-correctness` / `test` / `merge` / etc.)
- Status pill (`alive · active` / `alive · idle` / `ended ✓` / `ended ✗` / `pending`)
- Round indicator if applicable
- Elapsed timer (live for active sessions)
- Per-session cost

Round history (only for reviewers/test/work with multiple rounds):

- Collapsible accordion: each round shows verdict + finding count + duration + cost
- Clicking a prior round scrubs the conversation timeline back to that round's segment

Session actions (contextual):

| Session state | Actions |
|---|---|
| `alive` | Stop · Send Message · Show Terminal · Open in tmux |
| `ended` | Restart · Replay · Show Terminal · Export JSONL |
| `pending` | Spawn Now · Skip Stage |
| Any | Open State Dir · View State.md · View vBRIEF |

#### Zone C — Conversation + composer

**Reuse without modification:**

- `MessagesTimeline.tsx` (`src/dashboard/frontend/src/components/chat/MessagesTimeline.tsx`)
- `ChatMarkdown.tsx` (`src/dashboard/frontend/src/components/chat/ChatMarkdown.tsx`)
- `ComposerFooter.tsx` (`src/dashboard/frontend/src/components/chat/ComposerFooter.tsx`)

The single addition is a **round divider** in the timeline for reviewers/test sessions that spans rounds. The divider is a non-virtualized row injected by the parent — a thin horizontal rule with a `Round 2 · started 14:32` label centered on it. This is a 5-line change in the parent component, not a redesign of the timeline.

Composer addresses the selected session: messages from the user are sent via existing `POST /api/conversations/:name/message` to whatever session ID is in Zone B.

### Surfaces left untouched (for now)

The kanban-side surfaces — `IssueCard`, `InspectorPanel`, `BadgeBar` modal pattern, `StatusFlowControl`, `WorkspacePane` — are **not modified by this PRD**. They keep their current behavior. The kanban itself is slated for a separate revamp later; this PRD is scoped to making Command Deck reach feature-parity with all of them.

In practice that means the same action lives in two places during the parity window: e.g. "Approve & Test" exists on the kanban card *and* in Zone A of Command Deck. That duplication is intentional and temporary. When the kanban revamp lands, the kanban will be free to drop or reshape any of these affordances knowing Command Deck is already the canonical surface.

### Tree node behavior

Replaces the multi-round flat list shipped by PAN-821:

- **One node per canonical role per issue.** Reviewers become 5 fixed nodes (correctness, security, performance, requirements, synthesis) plus 1 orchestrator.
- **Node icon reflects current state**, not a log of past states: `◐ alive` (active, breathing dot) / `● alive idle` / `○ ended ✓` (passed) / `○ ended ✗` (failed) / `· pending`.
- **Tooltip on hover** shows round count, total duration, total cost.
- **Right-click** opens session-action menu (mirrors Zone B contextual actions).
- **Status filter on tree header**: `[All] [Alive] [Failed]` toggle. Default: All.

Trees collapse by default for `Done` issues — clicking the issue row expands. `In Progress` / `In Review` / `Testing` issues default expanded with the alive node selected.

## Out of scope

- Per-round JSONL splitting. Reviewers keep one continuous JSONL across rounds; the round divider is a UI affordance only.
- Issue creation flow. Command Deck is for working on existing issues.
- Bulk actions across issues. Single-issue surface only.
- Mobile / narrow-viewport layout. Command Deck is desktop-first.

## Implementation plan

### Phase 1 — Reviewer naming + resumption

Files:

- `src/lib/cloister/specialists.ts` — add `getReviewerSessionName`
- `src/lib/cloister/review-agent.ts` — replace `runParallelReview` round-spawn logic with resume-or-spawn; rename `cleanupReviewerStateDirs` → `archiveReviewerRound`; keep `claudeSessionId` stable across rounds
- `src/lib/cloister/review-agent.ts:720` — reviewer spawn block: use canonical name, set `remain-on-exit on`
- `src/dashboard/server/routes/mission-control.ts:451-598` — multi-round handling deleted; one canonical node per role; round metadata aggregated from `round-N.json` artifacts
- `src/dashboard/server/routes/mission-control.ts:124` — `extractReviewerRole` simplified to canonical name parse
- `src/dashboard/server/routes/mission-control.ts:227` — `resolveJsonlPath` rewritten per "JSONL resolution fix" above

### Phase 2 — Three-zone Command Deck shell

New component: `src/dashboard/frontend/src/components/CommandDeck/IssueWorkbench.tsx`

- Zone A: `IssueHeader` (extracts identity/stage/cost from existing snapshot data; contextual action map keyed by pipeline state)
- Zone B: `AgentContext` (reads selected session from tree; round-history accordion)
- Zone C: wraps existing `ConversationPanel` with a session-id prop and round-divider injection point

Replaces the current `<ActivityView />` / `<AgentSection />` rendered in `Sidebar.tsx` for project-selected mode.

### Phase 3 — Action surface parity (additive only)

Goal: every action reachable on `IssueCard` / `InspectorPanel` / `BadgeBar` / `StatusFlowControl` / `WorkspacePane` is also reachable from Command Deck. Nothing on those surfaces is removed or modified.

- Audit the action lists on each existing surface (kanban-card menu, inspector sections, badge modals, status-flow buttons, workspace-pane buttons).
- For each action: confirm it has a contextual home in Zone A (issue-level), Zone B (session-level), or the overflow `…` menu. File a small follow-up if any action has no good home.
- Reuse the same backend RPCs / endpoints those surfaces already call — no new APIs needed for parity.
- Drag-to-column kanban gesture is **not** mirrored; column transitions in Command Deck happen via Zone A primary/secondary buttons.

### Phase 4 — Round divider + tree polish

- Round divider row in `MessagesTimeline` (non-virtualized, parent-injected)
- Tree node redesign in `Sidebar.tsx`: canonical node icons, status filter, right-click menu
- Done-issue collapse default

## Acceptance criteria

- [ ] Reviewers reuse the same tmux session and same JSONL across rounds. Round 2 of `review-correctness` does not spawn a new tmux session.
- [ ] Session tree shows exactly 6 reviewer nodes for an issue with N review rounds (1 orchestrator + 5 roles), regardless of N.
- [ ] Clicking any session node opens `ConversationPanel` with the conversation timeline. Sessions without JSONL still get the terminal fallback (read-only).
- [ ] Every action reachable on `IssueCard` / `InspectorPanel` / `BadgeBar` / `StatusFlowControl` / `WorkspacePane` is also reachable from the three Command Deck zones — and only when contextual to the current pipeline state.
- [ ] No state badge in Zone A is shown when its value is the default for the current stage.
- [ ] Kanban / inspector / badge bar / status-flow surfaces are unchanged by this PR (their own revamp lands separately).
- [ ] Merge button is human-only — no automated path triggers it.
- [ ] `resolveJsonlPath()` correctly returns the JSONL file for any session that has a `claudeSessionId` in its state.
- [ ] Composer in Zone C sends messages to the selected session (any of: work, review-orchestrator, review-correctness, …, test, merge).
- [ ] Round divider appears in the conversation timeline when scrolling across round boundaries for reviewers/test/work sessions.
- [ ] Done-state issues default to collapsed; in-flight issues default to expanded with the alive node selected.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Reviewer session resumption corrupts the JSONL if Claude Code's resume protocol changes | Pin to the same `--resume` flow already used by `pan tell`. Add an integration test that opens a JSONL, runs two synthetic rounds, and validates message count. |
| Density triage hides actions a user wants | Every contextual-only action is also reachable from a stable overflow `…` menu. The triage is about default visibility, not access. |
| Round divider hurts scroll virtualization | Inject as a non-virtualized row outside the virtualizer (existing pattern: timeline already mixes virtualized + non-virtualized for the last 8 rows). |
| Action parity drifts as kanban / inspector evolve | Add a parity smoke test that walks the kanban-card menu + inspector action list and asserts each label is reachable somewhere in Command Deck. Cheap to keep current, catches drift before the future kanban revamp. |
| Removing `cleanupReviewerStateDirs` accumulates JSONL | Reviewer state dirs are bounded by the issue lifecycle. On `merge` complete, archive the issue's reviewer state dirs to `~/.panopticon/agents/.archive/<issue-id>/`. |

## References

- PAN-821 (parent — replaces its multi-round fan-out behavior)
- `src/lib/cloister/review-agent.ts:654` — `runParallelReview`
- `src/lib/cloister/specialists.ts:660` — `getTmuxSessionName` (canonical pattern to extend)
- `src/dashboard/server/routes/mission-control.ts:227` — `resolveJsonlPath` (JSONL bug)
- `src/dashboard/frontend/src/components/chat/ConversationPanel.tsx` — reused as-is in Zone C
- `src/dashboard/frontend/src/components/KanbanBoard.tsx:2486` — `IssueCard` (parity reference; not modified)
- `src/dashboard/frontend/src/components/InspectorPanel.tsx` — parity reference; not modified
- `CLAUDE.md` "Session lifecycle rules" — `remain-on-exit on` precedent
- Mock: `docs/design/mockups/PAN-830-unified-command-deck.html`
