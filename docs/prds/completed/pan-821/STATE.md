# PAN-821: Command Deck — Issue Session Tree with Conversation-First Agent Panels

## Status: Planning Complete

## Decision Summary

### Core Design: Conversation-First with Contextual Chrome

The project-selected view in Command Deck is being redesigned around two principles:

1. **The conversation is the primary content.** When you select an agent session, its JSONL conversation fills 90%+ of the right pane. Terminal is a per-session toggle. The old Work/Review tab strip with transcript markdown is replaced.
2. **Issue metadata is compact chrome, not a destination.** The heavy DetailPanelLayout (InspectorPanel + TerminalTabs) is replaced with a slim 2-row header showing issue identity, pipeline stage, cost, and compact action buttons for artifacts.

### Key Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Issue click behavior | Auto-select most active session | User wants immediate context — expand tree + open conversation in one click |
| Right pane layout | Slim header + conversation body | Information-dense but conversation-first; metadata doesn't steal space |
| No-JSONL fallback | Markdown transcript | All session types should render something; transcript is already computed |
| PAN-548 coordination | Independent | Use localStorage + Zustand; PAN-548 can adopt later |
| Rally/cost display | Inline on tree row + header | Cost badge on issue row (already exists), pipeline/cost in header. No separate summary pane |
| Session tree location | Inline in left sidebar | FeatureItem becomes expandable; session nodes are children |

### Architecture Overview

```
Command Deck (project selected)
  │
  ├── ProjectTree (left rail)
  │     └── for each issue → FeatureItem (expandable)
  │           └── for each session → SessionNode (with presence)
  │
  └── Right Pane
        ├── IssueHeader (slim: ID, title, pipeline dots, cost, action buttons)
        └── SessionPanel
              ├── ConversationPanel or ChatMarkdown (default)
              └── XTerminal (toggle)
```

### Auto-Selection Logic

When a user clicks an issue row:
1. Expand the issue's session children (toggle if already expanded).
2. Auto-select the "best" session:
   - Active sessions first (prefer work > review > test > merge).
   - Then idle sessions.
   - Then most recently started.
3. Right pane updates immediately.

### Data Flow

- **Server:** Extend `fetchActivityData()` to split reviewer sub-agents, add `presence` (active/idle/ended), `jsonlPath`, and `transcript` fallback. New endpoint `GET /api/projects/:projectKey/session-tree` aggregates per-project.
- **RPC:** New `subscribeProjectSessionTree` for live tree updates (session add/remove, presence changes). Presence polled at 1 Hz max, only for alive sessions.
- **Frontend:** TanStack Query for initial fetch, RPC subscription for deltas. Zustand + localStorage for tree expansion and selected session state.

### Per-Issue Information Inventory

Every piece of data that exists per issue is mapped to the new UI:

| Data | New Location |
|------|-------------|
| Issue ID, title, URL | Header row 1 |
| Pipeline stage (verify → review → test → merge) | Header row 1, colored dots |
| Total cost | Header row 1 |
| Per-stage cost breakdown | Header cost tooltip/popover |
| Agent sessions | Left rail tree nodes under issue |
| Per-session conversation | Right pane body (JSONL) |
| Per-session terminal | Right pane body (toggle) |
| Per-session model, duration | Session node row + header |
| Rally stories/progress | Issue row in tree (progress bar, as today) |
| Planning artifacts (STATE.md, PRD) | Header action buttons row 2 |
| vBRIEF plan | Header action button |
| Beads/tasks | Header action button (count badge) |
| Discussions | Header action button (count badge) |
| Transcripts/notes | Header action button (count badge) |
| Git branch, PR link | Header |

### Key Patterns to Follow

- **Conversation synthesis:** `AgentSection.tsx` already synthesizes a `Conversation` object from `ActivitySection` for specialists (lines 103-119). The new `SessionPanel` should use the same pattern — build a `Conversation` from `SessionNode` so `ConversationPanel` works without API changes.
- **JSONL path encoding:** Use `encodeClaudeProjectDir()` from `src/lib/paths.ts` (replaces non-alphanumeric chars with hyphens). Never reimplement.
- **Presence derivation:** Map `AgentRuntimeSnapshot.activity` to presence: `working`/`thinking` → `active`, `idle` → `idle`, `stopped`/missing → `ended`. Supplement with output.log mtime check (within 5s → `active`).
- **Reviewer role parsing:** Extract from tmux name `review-<issueId>-<timestamp>-<role>`. Parse in one place with unit test. Surface unmatched as `type: 'review'` (no role).

### What's Preserved

- `AgentSection.tsx` remains untouched — still used by single-feature focused view (deep link).
- `/api/missions/:issueId/activity` response shape stays backward-compatible (additive fields only).
- Feature kanban, vBRIEF viewer, and single-conversation views are unaffected.

### Risks

1. **Tree fan-out:** Large projects with many issues × 8+ sessions each. Mitigate: collapsed by default, lazy fetch on expand, virtualize if >200 rows.
2. **Presence polling:** 1 Hz per alive session. Mitigate: only poll alive sessions, batch per issue, cache mtime.
3. **Header density:** Must be slim enough to not steal conversation space. Start at 2 rows max, use tooltips/popovers for details.

### Playwright Isolation

Browser-based verification should use an isolated Playwright browser instance. Any required dashboard state (projects with active agents, sessions with JSONL) should be verifiable from a fresh browser session without depending on other agents' Playwright instances.
