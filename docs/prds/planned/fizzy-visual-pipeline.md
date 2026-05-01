# Fizzy Visual Pipeline — Kanban Mirror for Panopticon

**Status:** Draft
**Created:** 2026-04-30
**Author:** Edward Becker

---

## Problem Statement

Panopticon's specialist pipeline (work agent → review → test → merge → close-out) produces rich output — review findings, test results, agent progress — but it's all buried in tmux sessions, workspace files (`.planning/feedback/`), and SQLite state. There's no visual surface where you can see an issue move through the pipeline, read reviewer comments, or interact with a running agent without opening a terminal.

GitHub Issues tracks state (open/closed + labels) but has no native column-based workflow view, and the specialist pipeline's comments go to workspace files rather than the issue thread.

## Solution

Add Fizzy (37signals' open-source Kanban board) as a **visual mirror layer** on top of GitHub Issues. GitHub remains the source of truth for issue CRUD and state. Fizzy provides:

1. A Kanban board where cards move through pipeline columns automatically
2. Agent progress, review findings, and test results posted as card comments
3. **Interactive feedback** — user comments on Fizzy cards get delivered to the running work agent via `pan tell`, and the agent can reply

## Non-Goals

- Replacing GitHub Issues as the canonical tracker
- Building a full bidirectional sync (Fizzy card creation doesn't create GitHub issues)
- Multi-tenant / managed instance (this is for Panopticon's own development use)

---

## Column Mapping

Fizzy columns map to Panopticon's pipeline stages, extending the existing canonical states:

| Fizzy Column | Canonical State | Trigger |
|---|---|---|
| **Triage** | `todo` | Card created when GitHub issue exists |
| **Working** | `in_progress` | `pan start` picks up the issue |
| **In Review** | `in_review` | Work agent signals done, review specialist spawns |
| **Awaiting Merge** | `in_review` (sub-state) | Review specialist posts LGTM, all checks pass |
| **Done** | `done` | PR merged |
| **Closed Out** | `done` (post-cleanup) | `postMergeLifecycle` completes — worktree deleted, branches pruned, Docker cleaned |

"Awaiting Merge" and "Closed Out" are Fizzy-specific columns that provide finer granularity than the canonical state model. Internally they map to existing states with additional metadata (review passed, cleanup completed).

Column colors follow the existing Panopticon dashboard palette:
- Triage: `#6b7280` (gray)
- Working: `#eab308` (yellow)
- In Review: `#ec4899` (pink)
- Awaiting Merge: `#8b5cf6` (purple)
- Done: `#22c55e` (green)
- Closed Out: `#71717a` (muted gray)

---

## Architecture

### Fizzy as a Secondary Tracker

Fizzy is NOT a replacement for the primary tracker (GitHub). It's a **secondary output channel** — a read-heavy mirror that receives state from Panopticon.

```
GitHub Issues (source of truth)
       ↓ (existing tracker adapter)
  Panopticon Core
       ↓ (new: FizzySyncService)
  Fizzy Board (visual mirror)
       ↑ (new: webhook receiver)
  User comments on cards
```

### Component Overview

#### 1. FizzyApiClient (`src/lib/tracker/fizzy-client.ts`)

HTTP client for the Fizzy REST API. Based on the official API (`docs/API.md` in the Fizzy repo):

- **Cards**: create, update, close, reopen, move between columns
- **Comments**: create, list, get, update, delete
- **Columns**: list (for column ID resolution)
- **Boards**: list, get
- **Tags**: create, toggle on cards
- **Webhooks**: register, list, delete

Authentication via personal access token (Bearer header). Token stored in `~/.panopticon.env` as `FIZZY_API_TOKEN`.

This is a standalone HTTP client, NOT an `IssueTracker` implementation — Fizzy is a mirror, not a tracker backend.

#### 2. FizzyCardMapping (SQLite)

New table mapping GitHub issues to Fizzy cards:

```sql
CREATE TABLE fizzy_card_mapping (
  id TEXT PRIMARY KEY,           -- UUID
  issue_id TEXT NOT NULL,        -- GitHub issue ref (e.g., "PAN-123" or "#123")
  fizzy_card_id TEXT NOT NULL,   -- Fizzy card ID
  fizzy_board_id TEXT NOT NULL,  -- Fizzy board ID
  fizzy_column_id TEXT,          -- Current column ID (cached)
  last_synced_at TEXT,           -- ISO timestamp
  created_at TEXT NOT NULL,
  UNIQUE(issue_id)
);
```

#### 3. FizzySyncService (`src/lib/fizzy/sync-service.ts`)

Listens to Panopticon's existing `PipelineEvent` notifications and mirrors state to Fizzy:

**State transitions → column moves:**
- `pan start` (issue picked up) → create card in "Working" column, or move existing card
- Review specialist spawns → move card to "In Review"
- Review passes (LGTM) → move card to "Awaiting Merge"
- PR merged → move card to "Done"
- `postMergeLifecycle` completes → move card to "Closed Out"

**Specialist output → card comments:**
- Work agent progress: key milestones posted as comments (PR created, tests passing, etc.)
- Review specialist findings: full review posted as card comment with formatting
- Test specialist results: test summary posted as card comment
- Merge result: merge confirmation or failure posted as card comment

**Integration point:** Hook into `notifyPipeline()` in `src/lib/pipeline-notifier.ts` — register FizzySyncService as a listener alongside the existing dashboard handler.

#### 4. FizzyWebhookReceiver (`src/dashboard/server/routes/fizzy-webhooks.ts`)

New Effect route: `POST /api/webhooks/fizzy`

Receives Fizzy webhook events, specifically `comment_created`:

1. Verify HMAC-SHA256 signature (`X-Webhook-Signature` header)
2. Parse the comment payload — extract card ID, author, body
3. Look up `fizzy_card_mapping` to find the associated issue ID
4. **Loop prevention**: skip comments authored by the Panopticon bot user
5. Identify the running agent for that issue (via `parseSpecialistAgentSession()`)
6. Deliver the comment body to the agent via `sendKeysAsync()` — equivalent to `pan tell`
7. Post a confirmation reaction on the Fizzy comment (acknowledgment)

Webhook signing secret stored in `~/.panopticon.env` as `FIZZY_WEBHOOK_SECRET`.

#### 5. FizzyColumnResolver (`src/lib/fizzy/column-resolver.ts`)

Caches board column IDs on startup (columns rarely change). Maps pipeline stages to Fizzy column IDs. Invalidated on board structure changes.

---

## Configuration

In `~/.panopticon/config.yaml`:

```yaml
fizzy:
  enabled: true
  instance_url: https://fizzy.do        # or self-hosted URL
  board_slug: panopticon                # board to mirror to
  bot_username: panopticon-bot          # for loop prevention
  token_env: FIZZY_API_TOKEN            # env var name for access token
  webhook_secret_env: FIZZY_WEBHOOK_SECRET  # env var name for webhook signing secret
```

In `~/.panopticon.env`:

```
FIZZY_API_TOKEN=fizzy_pat_xxxxx
FIZZY_WEBHOOK_SECRET=whsec_xxxxx
```

Per-project override in `.panopticon.yaml`:

```yaml
fizzy:
  board_slug: my-other-board            # override board per project
```

---

## Comment Threading

### Outbound (Panopticon → Fizzy)

Comments are posted by the bot user and formatted with markdown:

**Work agent progress:**
```
**[work-agent]** PR #47 created: `fix-null-check-in-cloister`
Branch: `feature/PAN-123`
```

**Review specialist findings:**
```
**[review-specialist]** Review complete — 2 issues found

1. **Missing null guard** at `src/lib/cloister/service.ts:247`
   Variable `session` may be undefined when tmux session dies mid-heartbeat

2. **Unused import** at `src/lib/cloister/service.ts:3`
   `execSync` imported but never used (replaced by `execAsync` in PAN-70)

**Verdict:** Changes requested
```

**Test specialist results:**
```
**[test-specialist]** All checks passed

- Typecheck: PASS (0 errors)
- Lint: PASS (0 warnings)
- Tests: PASS (147/147, 12.3s)
```

### Inbound (Fizzy → Panopticon)

When the user writes a comment on a card:

1. Webhook fires `comment_created`
2. Panopticon identifies the running agent
3. Comment body is delivered via `pan tell` semantics
4. Agent processes the feedback and posts a reply as a new Fizzy comment

If no agent is currently running for that issue, the comment is stored in the issue's workspace feedback directory (`.planning/feedback/fizzy-comment-<timestamp>.md`) for the next agent session to pick up.

---

## Implementation Phases

### Phase 1: One-Way Mirror (MVP)

- FizzyApiClient with card CRUD + comment CRUD
- FizzyCardMapping SQLite table
- FizzySyncService hooked into pipeline notifier
- Column resolver with caching
- Card creation on `pan start`, column moves on state transitions
- Specialist output posted as card comments
- Configuration in config.yaml + .panopticon.env
- Board setup CLI command: `pan fizzy setup` (creates board + columns + webhook)

### Phase 2: Interactive Feedback

- Webhook receiver route with HMAC verification
- `comment_created` → `pan tell` delivery
- Loop prevention (bot user filtering)
- Offline comment queuing (stored in workspace for next session)
- Agent reply posting back to Fizzy card

### Phase 3: Rich Integration

- Tag sync (Fizzy tags mirror GitHub labels)
- Card description kept in sync with GitHub issue body
- Assignee display (map agent name to Fizzy user)
- Board-level metrics (cycle time per column, time in review)
- Dashboard link to Fizzy card on kanban issue cards

---

## Tracker Interface Considerations

Fizzy is deliberately NOT implemented as an `IssueTracker` adapter. The `IssueTracker` interface assumes the tracker is a source of truth for issue CRUD — Fizzy is a downstream mirror. Implementing `IssueTracker` would imply Fizzy can `createIssue()`, `getIssue()`, etc., which is the wrong abstraction.

Instead, FizzySyncService is a **side-effect listener** on the existing pipeline, similar to how `notifyPipeline()` already works for the dashboard WebSocket.

The `TrackerType` union and `state-mapping.ts` do NOT need modification. Fizzy columns are mapped from canonical states inside FizzySyncService, not through the shared state-mapping infrastructure.

---

## Dependencies

- Fizzy personal access token (free tier: 1,000 cards, sufficient for Panopticon development)
- Webhook endpoint reachable from Fizzy (requires Panopticon dashboard to be publicly accessible, or use a tunnel for local dev)
- Fizzy SDK (`@37signals/fizzy` npm package) OR direct HTTP calls — evaluate SDK maturity vs. thin client

---

## Success Metrics

- Every in-flight issue visible as a Fizzy card in the correct column
- Review/test specialist output readable on the card without opening a terminal
- User can redirect a running agent by commenting on a Fizzy card (< 30s delivery)
- Zero missed state transitions (card column always matches pipeline state)
