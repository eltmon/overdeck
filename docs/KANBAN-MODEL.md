# Kanban Board Model

This document defines Panopticon's kanban board design: the columns, the mental model behind state transitions, how states map to external trackers, and the workflow lifecycle.

## Columns

The board has **4 visible columns**:

| Column | Description |
|--------|-------------|
| **Todo** | Prioritized work ready to be planned and started |
| **In Progress** | Agent actively implementing |
| **In Review** | PR created, review/test roles running — stakeholders re-engage here |
| **Done** | Merged — awaiting human close-out |

**Backlog** exists as a state but is **not a visible column**. Backlog items are accessed via a separate view/filter (see PAN-273).

**Canceled** is a terminal state, not a column.

## Lifecycle Flow

```
                                ┌─────────────────────────────────────────┐
                                │         PLANNING (activity,             │
                                │         not a column)                   │
                                │                                        │
                                │  - Casual thinking in Backlog          │
                                │  - Focused PRD work in Todo            │
                                │  - Planning agent can run at any       │
                                │    point, writing to docs/prds/drafts/ │
                                │  - No workspace needed                 │
                                └─────────────────────────────────────────┘
                                          ↕ (happens across states)

┌──────────────┐  prioritize   ┌──────────────┐  PRD ready    ┌──────────────┐
│              │  into cycle   │              │  workspace    │              │
│   BACKLOG    │──────────────►│     TODO     │──────────────►│ IN PROGRESS  │
│   (hidden)   │               │  (Column 1)  │  created,     │  (Column 2)  │
│              │               │              │  agent starts │              │
└──────────────┘               └──────────────┘               └──────┬───────┘
                                                                     │
  Issue created                  Planning completes                   │ PR created,
  here. Long tail.               with urgency here.                  │ agent done
  Out of sight.                  Auto-start planning                 │
                                 agent on move to Todo.              ▼
                                                              ┌──────────────┐
                               ┌──────────────┐  merged       │              │
                               │              │◄──────────────│  IN REVIEW   │
                               │     DONE     │               │  (Column 3)  │
                               │  (Column 4)  │               │              │
                               │              │               └──────────────┘
                               └──────┬───────┘
                                       │                         Review/test roles run.
                                      │ human clicks            Stakeholders do UAT.
                                      │ "Close Out"             Human review happens.
                                      ▼
                               ┌──────────────┐
                               │  CLOSED OUT  │
                               │  (hidden)    │
                               │  Issue closed │
                               │  on tracker  │
                               └──────────────┘
```

## Mental Model: Issue Lifecycle

### Backlog (hidden)

Creating an issue puts it in Backlog. This is the long tail — out of sight, out of mind until prioritized. Light planning and thinking can happen here (refining descriptions, adding context, rough scoping), but there's no urgency or formal process.

### Todo

Moving an issue into Todo (e.g., pulling it into a Linear cycle or prioritizing it on GitHub) signals intent: **this will be worked soon**. At this point:

- Planning should complete with urgency
- The planning agent may auto-start to produce/refine a PRD
- A PRD can exist without a workspace — pre-workspace PRDs live in `docs/prds/drafts/<issue-id>/` on main, decoupled from feature branches
- The issue stays in Todo until a human or automation decides the plan is sufficient and moves it to In Progress
- Future: moving to Todo auto-starts the planning agent; prior to that, a "Plan" button allows ad-hoc refinement

### In Progress

Moving to In Progress triggers the heavy machinery:

- Workspace created (git worktree, feature branch, Docker, DNS, ports, skills)
- Pre-workspace PRD copied into `.planning/` within the workspace
- Work agent spawned to implement
- PRD enforcement (PAN-47): a PRD must exist before the move to In Progress is allowed

### In Review

The work role has completed implementation and created a PR. Role-based verification takes over:

- `review` checks code quality, requirements, security, and performance through its convoy sub-roles
- `test` runs automated checks and required browser UAT
- Stakeholders are notified — this is the signal for **UAT and human review**
- Once approved and tested, the issue becomes ready for ship/merge preparation

### Done

Merged and **moved to Done on the tracker by the ship/post-merge lifecycle**. The PRD moves to `docs/prds/completed/`. The issue appears in the Done column, where the human can run the **Close-Out Ceremony** (dashboard button or `pan close`) to archive workspace artifacts, clean up agent state, and apply the `closed-out` label. Closed-out issues are hidden from the board by default (toggle "Include closed-out" to see them).

### Close-Out Ceremony

The close-out ceremony is the final human-gated step in the issue lifecycle. It runs after merge and performs these steps in order:

1. **Verify PRD preserved** — Ensures the PRD is in `docs/prds/completed/`. If it's still in `active/`, moves it. (Warn, don't fail)
2. **Verify branch merged** — Confirms no unmerged commits exist on the feature branch. (**Hard fail** if unmerged)
3. **Archive workspace artifacts** — Copies `.planning/feedback/`, `STATE.md`, and `beads/` to `~/.panopticon/archives/{issue}/`
4. **Clean up workspace** — Kills tmux sessions, stops Docker containers, removes git worktree
5. **Clean up agent state** — Removes `~/.panopticon/agents/agent-{issue}/` and `planning-{issue}/`
6. **Close issue on tracker** — Ensures issue is in Done/Closed state (usually already done by the post-merge lifecycle). (**Hard fail**)
7. **Apply `closed-out` label** — Creates the label if missing (blue `#1d4ed8`), adds to issue
8. **Clear review status** — Removes from `review-status.json`

**Invocation:**
- **Dashboard**: Click "Close Out" on a Done card
- **CLI**: `pan close PAN-XXX` (or `MIN-XXX` for Linear)

If a hard-fail step fails, the ceremony aborts and the issue stays open.

## Planning is an Activity, Not a State

A key design decision: **planning is not a kanban column**. Planning happens across multiple states:

- In Backlog: casual thinking, rough notes
- In Todo: focused planning with urgency, PRD creation
- The planning agent can run at any point, writing to `docs/prds/drafts/` before a workspace exists

This eliminates the artificial "Planning" column that previously sat between Todo and In Progress, reducing horizontal scrolling and matching how planning actually works in practice.

## Pre-Workspace PRD Flow

Previously, creating a PRD required a workspace (and therefore a feature branch). This was backwards — you had to create heavy infrastructure just to write a document.

The new model:

```
docs/prds/
  drafts/          <-- PRDs being written, before any workspace exists (on main)
  active/          <-- PRDs for work in progress (copied into workspace on creation)
  completed/       <-- PRDs for merged work
```

- Planning agent writes to `drafts/` — no workspace, no branch needed
- When an issue moves to In Progress, the draft PRD is copied into the workspace's `.planning/` directory
- PRD enforcement checks `drafts/` (not just workspace existence) before allowing In Progress

### Polyrepo Projects

For polyrepo projects (e.g., MYN with frontend, api, infra, docs, splash, meta repos), `docs/prds/` lives at the **project root**, not within any individual repo. This is configured via `projects.yaml`.

Currently the PRD directory path is hardcoded to `{projectPath}/docs/prds/`. A `prdDir` config option should be added to `WorkspaceConfig` so projects can customize where PRDs live (e.g., a project without a `docs/` repo could put them at the root).

**Strongly discouraged: per-repo PRDs.** Some teams with separate frontend and backend repos may want separate PRDs for each. This is an anti-pattern — a single PRD per issue keeps scope unified and prevents drift between frontend and backend plans. If the implementation touches multiple repos, that context belongs in one PRD with sections for each repo, not scattered across repos. Panopticon will not support per-repo PRD directories.

## Tracker Mapping

The 4-column model maps cleanly to all supported trackers:

| Panopticon | Linear (defaults) | GitHub | Rally (User Stories) |
|---|---|---|---|
| Backlog | Backlog | open | New |
| Todo | Todo | open | Defined |
| In Progress | In Progress | open + `in-progress` label | In-Progress |
| In Review | In Progress | open + `in-review` label | In-Progress |
| Done | In Progress (shadow) | open (shadow) | In-Progress (shadow) |
| Closed Out | Done | closed + `closed-out` label | Completed/Accepted |

Key implications:

- **Linear**: The custom "In Planning" and "In Review" states added to the MIN team can be removed. Only default states are needed. In Review maps to Linear's "In Progress" (or we keep "In Review" in Linear if the team finds it useful — but it's optional, not required).
- **GitHub**: Uses labels (`in-progress`, `in-review`) on open issues to distinguish sub-states, since GitHub only has open/closed natively.
- **Rally**: Both In Progress and In Review map to Rally's "In-Progress" since Rally doesn't distinguish review from active work.

## Canonical States (Internal)

Panopticon's internal state model (used in code, shadow state, and drag-drop):

```
backlog      -- Hidden from board, separate view
todo         -- Column 1
in_progress  -- Column 2
in_review    -- Column 3
done         -- Column 4
canceled     -- Terminal state, not a column
```

The previous `planning` canonical state is **removed**.

## Labels

**Principle: Labels describe WHAT something is, not WHERE it is in the workflow.** Workflow tracking belongs in states. Labels are for classification and metadata.

The one exception: GitHub and GitLab need "workflow labels" because they only have open/closed natively. These are Panopticon-managed and should feel invisible to users.

### Workflow Labels (GitHub/GitLab only)

Auto-managed by Panopticon on every state transition. Users should never add or remove these manually.

| Label | Color | Applied When | Removed When |
|-------|-------|-------------|-------------|
| `in-progress` | `#fbbf24` (yellow) | Issue moves to In Progress | Moves to In Review or Done |
| `in-review` | `#ec4899` (pink) | Issue moves to In Review | Moves to Done |
| `closed-out` | `#1d4ed8` (blue) | Human runs close-out ceremony | Issue reopened |

That's the complete set. Three labels.

**Auto-cleanup rule**: On every state transition for GitHub/GitLab issues, Panopticon removes all workflow labels that don't match the target state, then adds the label for the new state (if applicable). This replaces the current approach where cleanup only happens on reopen and deep-wipe.

**Not applicable to**: Linear, Rally, Jira — these have native workflow states and don't need label-based pseudo-states.

### Classification Labels (all trackers)

Describe the type of work. User-assignable. Used for:
- Complexity estimation (feeds into `COMPLEXITY_LABELS` in cloister)
- Grouping in the "All" list view (PAN-273)
- Filtering and reporting

| Label | Color | Complexity Mapping |
|-------|-------|--------------------|
| `bug` | `#d73a4a` (red) | medium |
| `feature` | `#0075ca` (blue) | medium |
| `enhancement` | `#a2eeef` (cyan) | medium |
| `chore` | `#6b7280` (gray) | simple |
| `docs` | `#22c55e` (green) | trivial |
| `refactor` | `#e4e669` (yellow-green) | complex |
| `security` | `#d93f0b` (orange) | expert |
| `performance` | `#fbca04` (gold) | expert |

These are defaults. Projects can add custom classification labels — they just won't have automatic complexity mapping unless added to the complexity config.

### Metadata Labels (prefixed, machine-managed)

| Prefix | Values | Purpose | Managed By |
|--------|--------|---------|------------|
| `difficulty:` | trivial, simple, medium, complex, expert | Beads task difficulty | Planning agent |

### Removed Labels

| Label | Reason |
|-------|--------|
| `planning` | Planning state removed from kanban |
| `planned` | Planning state removed from kanban |
| `done` | Redundant — closing the issue IS marking it done |
| `review-ready` | Redundant — In Review state already signals this |
| `Review Ready` (Linear) | Redundant — `readyForMerge` boolean in review-status.json tracks merge readiness; In Review column signals stakeholder involvement |
| `wontfix` | Optional GitHub convention, not Panopticon-managed |
| `pan:*` prefix | Over-engineered fallback strategy; direct labels are simpler |

### Label Anti-Patterns

- **Don't use labels for workflow state** on trackers that have native states (Linear, Rally, Jira). That's what states are for.
- **Don't duplicate state in labels** (e.g., adding a "Review Ready" label when the issue is already in an "In Review" state). Pick one source of truth.
- **Don't use labels for priority**. Linear, Rally, and Jira have native priority fields. For GitHub, use the Panopticon shadow state for priority rather than labels.
- **Don't use labels for assignee or ownership**. That's what the assignee field is for.
