# Specialist Workflow Guide

This document explains how the work agent and specialist agents (`inspect-agent`, `review-agent`, `test-agent`, `uat-agent`, `merge-agent`) interact through Panopticon's validation pipeline.

If you are new to Panopticon, start with [AGENT_TYPES_INDEX.md](./AGENT_TYPES_INDEX.md) for the high-level map of what each agent type is for. This document is the deeper workflow guide.

## Overview

Specialist agents are ephemeral Claude Code sessions that handle specific tasks:

- **inspect-agent (Sonnet)**: Per-bead verification — checks implementation matches spec and constraints
- **review-agent (Sonnet)**: Full MR code review, security checks, quality analysis
- **test-agent (Haiku)**: Test execution, failure analysis, simple fixes
- **uat-agent (Sonnet)**: Browser-based requirement verification via Playwright — visual quality, CORS, auth flows
- **merge-agent (Sonnet)**: Merge conflict resolution, CI handling

## Architecture

### Full Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│  DURING IMPLEMENTATION (per-bead)                               │
│                                                                 │
│  Agent finishes bead                                            │
│       │                                                         │
│       │ pan inspect <issueId> --bead <beadId>                   │
│       ▼                                                         │
│  ┌──────────────────────────┐                                   │
│  │  inspect-agent (Sonnet)  │                                   │
│  │  - Spec fidelity check   │──── BLOCKED ──→ Agent fixes       │
│  │  - Constraint compliance │                  and re-requests   │
│  │  - Compile + smoke       │                                   │
│  └──────────┬───────────────┘                                   │
│             │ PASS                                               │
│             │ (checkpoint saved)                                 │
│             ▼                                                    │
│       Agent continues to next bead                              │
│       ... repeat for each bead ...                              │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│  AFTER ALL BEADS COMPLETE                                       │
│                                                                 │
│  Agent signals completion → Verification Gate                   │
│       │                                                         │
│       ▼                                                         │
│  ┌──────────────────────────┐                                   │
│  │  review-agent (Sonnet)   │                                   │
│  │  - Full MR code review   │──── CHANGES_REQUESTED ──→ Agent   │
│  │  - Security + perf       │                                   │
│  │  - Test coverage         │                                   │
│  └──────────┬───────────────┘                                   │
│             │ APPROVED                                           │
│             ▼                                                    │
│  ┌──────────────────────────┐                                   │
│  │  test-agent (Haiku)      │                                   │
│  │  - Run test suite        │──── FAILED ──→ Agent fixes        │
│  │  - Analyze failures      │                                   │
│  └──────────┬───────────────┘                                   │
│             │ PASSED                                             │
│             ▼                                                    │
│  ┌──────────────────────────┐                                   │
│  │  uat-agent (Sonnet)      │                                   │
│  │  - Real browser (PW)     │──── BLOCKED ──→ Agent fixes       │
│  │  - CORS verification     │                                   │
│  │  - Visual quality audit  │                                   │
│  │  - Requirement check     │                                   │
│  └──────────┬───────────────┘                                   │
│             │ PASSED                                             │
│             ▼                                                    │
│  ┌──────────────────────────┐                                   │
│  │  merge-agent (Sonnet)    │                                   │
│  │  - Resolve conflicts     │                                   │
│  │  - Validate + push       │                                   │
│  │  - Post-merge cleanup    │                                   │
│  └──────────────────────────┘                                   │
└─────────────────────────────────────────────────────────────────┘
```

## Inspect Specialist (PAN-382)

The inspect specialist runs **during** implementation, after each bead. It catches architectural deviations early — before they cascade through subsequent beads.

**Jidoka principle: never pass a defect downstream.**

### Agent Workflow

After completing each bead, agents must request inspection:

```bash
# After closing a bead
bd close <beadId> --reason="Implemented X"

# Request inspection before starting next bead
pan inspect <issueId> --bead <beadId>

# Wait for result — delivered via pan tell
# INSPECTION PASSED → proceed to next bead
# INSPECTION BLOCKED → fix issues, then re-request
```

### What Inspect Checks

1. **Spec fidelity** — Does the diff implement what the bead described?
2. **Constraint compliance** — Are CLAUDE.md/PRD constraints violated?
3. **Compile + smoke** — Does the code compile and lint?

### Checkpoint System

Inspections use commit checkpoints to scope diffs:

- First inspection: `main...HEAD` (full branch diff)
- Subsequent inspections: `checkpoint_n...HEAD` (only new changes)
- On PASS: current HEAD saved as new checkpoint
- On BLOCKED: same checkpoint, agent fixes and re-requests

Checkpoints stored at: `~/.panopticon/specialists/<project>/inspect-agent/checkpoints/<ISSUE>.json`

### CLI Reference

```bash
pan inspect <issueId> --bead <beadId>           # Request inspection
pan inspect <issueId> --bead <beadId> --workspace /path  # With explicit workspace
pan specialists done inspect <issueId> --status passed   # Signal completion (specialist only)
```

## UAT Specialist (PAN-383)

The UAT specialist runs **after tests pass**, using Playwright in a real browser to verify the application works from a user's perspective.

### Why UAT Exists

E2E tests bypass CORS (they use direct HTTP calls via `apiUtils`). The test specialist can pass while the actual browser experience is broken. The UAT specialist catches:
- **CORS errors** — real browser enforces preflight headers
- **Visual regressions** — broken layouts, wrong colors, overflow
- **Auth flow failures** — real login flow, not API shortcuts
- **Console errors** — unhandled exceptions, missing resources
- **Mobile responsiveness** — tests at desktop, tablet, and mobile viewports

### Four Verification Phases

1. **Smoke test** — Backend health, frontend loads, test-token auth in real browser, console clean, CORS works
2. **Requirement verification** — Read PRD, navigate to each feature, interact, verify, screenshot
3. **Visual quality audit** — Desktop (1920), tablet (768), mobile (375) viewport screenshots
4. **Console & network audit** — Final check for errors, failed requests, CORS blocks

### Auth Flow

UAT authenticates via test token (magic link email can't be intercepted by Playwright):
1. Fetch test token server-side: `curl -H "X-API-KEY: myn_test_e2e" <apiUrl>/api/v1/customers/retrieve-test-token`
2. Navigate in browser: `<frontendUrl>/magic-login?directtoken=<token>`
3. All subsequent API calls go through real browser CORS enforcement

### Pipeline Trigger

UAT is automatically spawned when the test specialist signals `passed`. No manual trigger needed.

```bash
pan specialists done uat <issueId> --status passed   # Signal completion (specialist only)
```

## Planning → Implementation Transition

When a user clicks **Start Agent** in the dashboard (`POST /api/agents`), the system transitions from planning phase to implementation phase:

### Lifecycle

```
1. Planning agent writes:
   .planning/
   ├── STATE.md              # Decisions, approach, remaining work
   ├── PLANNING_PROMPT.md    # Planning agent's instructions (DO NOT READ during implementation)
   ├── discussions/           # Discovery conversation transcripts
   ├── notes/                 # Research notes
   └── transcripts/           # Session transcripts

2. User clicks "Start Agent" → POST /api/agents

3. Dashboard server:
   a. Stops planning agent (marks state as 'stopped', stoppedReason: 'work-agent-started')
   b. Commits .planning/ artifacts to git
   c. Archives PLANNING_PROMPT.md → PLANNING_PROMPT.md.archived (PAN-250)
   d. Determines phase: .planning/ exists → 'implementation', otherwise → 'exploration'
   e. Evaluates work-agent lifecycle truth: real resumable stopped agent ⇒ resume path, orphaned placeholder/stale record ⇒ fresh start path
   f. Shells out via detached `pan start <ID> --local --phase implementation` and records exact lifecycle + spawn output in `~/.panopticon/agents/agent-<id>/lifecycle.log` and `spawn.log`

4. Dashboard UI shows `Starting...` / `Resuming...` immediately, then switches to the normal running controls once the work agent is actually live

5. Work agent reads .planning/STATE.md and implements remaining work
```

### Beads Prerequisite

Beads are a hard prerequisite for starting work agents. The `POST /api/agents` endpoint returns **422** if `.beads/issues.jsonl` does not exist in the workspace. Cloister automatically creates beads from the vBRIEF plan via `createBeadsFromVBrief()` when the planning agent touches the `.planning-complete` marker. Manual `bd create` is no longer needed.

### DAG-Aware Task Scheduling

The vBRIEF plan includes dependency edges (`blocks`, `informs`) between items. When Cloister converts items to beads, it preserves these dependencies. Work agents use `bd ready -l <issue>` to find unblocked beads, ensuring tasks are worked in dependency order. The `criticalPath()` utility in `src/lib/vbrief/dag.ts` computes the longest dependency chain for visualization.

### Acceptance Criteria Pipeline

Each vBRIEF item can have `subItems` with `metadata.kind: "acceptance_criterion"`. These AC flow through the specialist pipeline:

1. **Work agent**: sees AC per bead as an indented checklist
2. **Inspect agent**: verifies per-bead AC against the diff (Spec Fidelity check)
3. **Review agent**: receives full AC list to verify implementation coverage
4. **Test agent**: maps test results to AC, flags untested criteria
5. **Verification gate**: hard-gates on all AC subItems completed
6. **Merge agent**: final AC validation before merge
7. **pan done**: blocks completion if AC are incomplete (skippable with `--force`)

### Handling Pre-Existing PRDs

A PRD may already exist in `docs/prds/active/` or `docs/prds/drafts/` before the planning agent runs — e.g., written manually or by a previous session. The planning agent handles three cases:

1. **PRD with `<task>` XML tags** (execution-ready): Skip discovery. Use existing tasks directly to create `.planning/STATE.md`, beads, and `config.json`.

2. **Prose PRD** (architecture decisions, requirements, no `<task>` tags): Use as foundation — do NOT redo decisions already made. Run abbreviated discovery to fill gaps, then convert prose into executable `<task>` XML structure. The PRD provides the "what and why"; planning creates the "how and in what order."

3. **No PRD**: Full discovery phase — fetch issue from tracker, ask clarifying questions, create PRD from scratch.

The planning agent should always check for existing PRDs before starting discovery to avoid duplicating work or contradicting decisions already made.

### Why PLANNING_PROMPT.md Is Archived

`PLANNING_PROMPT.md` contains the planning agent's instructions, including "STOP and tell the user: Planning complete." If a work agent finds and reads this file, it follows the planning instructions instead of implementing — re-running discovery and outputting "Planning complete" (PAN-250).

The archive step (`renameSync → .archived`) prevents this while preserving the file in git history for debugging.

### Agent Environment Variables

All agents spawned by Panopticon receive these environment variables via tmux `-e` flags:

**Work and Planning Agents:**

| Variable | Value | Purpose |
|----------|-------|---------|
| `PANOPTICON_AGENT_ID` | `agent-min-693` | Agent identifier for heartbeat, status, messaging |
| `PANOPTICON_ISSUE_ID` | `MIN-693` | Issue being worked on |
| `PANOPTICON_SESSION_TYPE` | `implementation` / `planning` / `exploration` | Current phase — used for cost attribution by stage |
| `CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION` | `false` | Disables suggested prompts for autonomous agents (PAN-251) |

**Specialist Agents (review, test, merge):**

| Variable | Value | Purpose |
|----------|-------|---------|
| `PANOPTICON_AGENT_ID` | `specialist-panopticon-cli-review-agent` | Specialist tmux session name |
| `PANOPTICON_ISSUE_ID` | `PAN-379` | Issue being reviewed/tested/merged |
| `PANOPTICON_SESSION_TYPE` | `review` / `test` / `merge` | Specialist type — used for cost attribution by stage |

Specialist env vars are set both in tmux `-e` flags and as `export` statements in the inner run script (belt-and-suspenders for env inheritance).

Provider-specific variables (`BASE_URL`, `AUTH_TOKEN`) are also injected based on the model's provider configuration.

### Session-to-Agent Mapping

The heartbeat hook (PostToolUse) maintains a mapping between Claude Code session UUIDs and Panopticon agents:

- **`runtime.json`** — `claudeSessionId` field tracks the currently active Claude session
- **`sessions.json`** — Append-only array of all Claude session UUIDs this agent has ever used

This mapping is used by the cost reconciler to attribute transcript files to the correct agent and issue.

### Specialist Busy Handling

When a specialist is dispatched but already running a task, `spawnEphemeralSpecialist` returns `{ error: 'specialist_busy' }`. The review and request-review endpoints handle this by reverting `reviewStatus` to `pending` (not `failed`), so the deacon can retry the dispatch later. This prevents fake review feedback from being sent to work agents.

## Worker Agent Integration

### Step 1: Complete Implementation

Worker agent implements the feature/fix according to the issue requirements.

### Step 2: Create Pull Request

```typescript
// Worker agent creates PR using gh CLI
const prResult = execSync(
  `gh pr create --title "feat: ${title}" --body "${body}" --head ${branch}`,
  { cwd: projectPath, encoding: 'utf-8' }
);

// Extract PR URL
const prUrl = prResult.trim(); // e.g., "https://github.com/owner/repo/pull/123"
```

### Step 3: Signal Completion

Workers signal completion via `pan done <issueId>` (Bash command). Cloister then:

1. Runs the **verification gate** (typecheck, lint, test) from `projects.yaml`
2. If gates pass, dispatches **review-agent** via `spawnEphemeralSpecialist` — no queue, immediate spawn

```bash
# Worker signals done — triggers verification gate → review-agent dispatch
pan done PAN-42
```

The worker agent exits after calling `pan done`. The specialist pipeline takes over automatically.

### Step 4: Specialist Pipeline Takes Over

After `pan done`:
- Verification gate passes → review-agent spawned immediately for this workspace
- Review approved → test-agent spawned immediately
- Tests pass → UAT-agent spawned (if configured)
- UAT passes → issue enters the **merge queue** (SQLite-backed, per-project)
- Human approves → merge-agent processes the merge

## Specialist Agent Processing

### Review Agent Workflow

> For the full end-to-end review architecture — `pan review run` CLI, the four-phase flow, prompt primitives under `src/lib/cloister/prompts/review/`, the dashboard-restart invariant, and synthesis as the judgment layer — see [`REVIEW-AGENT-ARCHITECTURE.md`](./REVIEW-AGENT-ARCHITECTURE.md). The summary below covers the specialist-pipeline integration only.

1. **Dispatched immediately** via `spawnEphemeralSpecialist` when verification gate passes
2. **Reads PR** using GitHub CLI (`gh pr view`, `gh pr diff`)
3. **Reviews code** for:
   - Correctness and logic errors
   - OWASP Top 10 security vulnerabilities
   - Performance issues (N+1 queries, inefficient algorithms)
   - Code quality and maintainability
4. **Submits review** on GitHub:
   - **APPROVED**: No issues, ready to merge
   - **CHANGES_REQUESTED**: Critical issues must be fixed
   - **COMMENTED**: Suggestions, questions, minor feedback
5. **Reports results** with structured output markers
6. **If approved**, dispatches test-agent immediately

### Test Agent Workflow

Test-agent is dispatched automatically when review-agent reports APPROVED.

Test agent:
1. **Dispatched immediately** via `spawnEphemeralSpecialist` when review passes
2. **Detects test runner** (npm, pytest, cargo, etc.)
3. **Runs test suite**
4. **Analyzes failures**
5. **Attempts simple fixes** if applicable (< 5 min fix)
6. **Reports results** with structured output

### Merge Agent Workflow

The merge agent uses a **SQLite-backed per-project queue** (`merge_queue` table). This is the only specialist with a queue — merges are human-approved and serialized per project.

1. **Enqueued** when tests pass and issue enters `readyForMerge`
2. **Dequeued** when human clicks MERGE in the dashboard
3. **Attempts merge** to target branch (usually `main`)
4. **If conflicts exist**:
   - Reads conflict files
   - Analyzes both sides of conflict
   - Resolves conflicts (preserving intent of both changes)
   - Runs tests if configured
5. **Completes merge commit**
6. **Pushes to remote**
7. **Reports results, advances queue** to next issue

## Merge Queue Priority

The merge queue (SQLite-backed, per-project) supports priority ordering:

```typescript
type Priority = 'urgent' | 'high' | 'normal' | 'low';
```

- **urgent**: Critical hotfixes, security patches (processed first)
- **high**: Important features, blocking issues
- **normal**: Standard features, bug fixes (default)
- **low**: Minor improvements, cleanup tasks

Only the merge queue has priority. Review, test, inspect, and UAT are dispatched immediately and run in parallel per workspace — there is no queue to prioritize.

## Result Monitoring

### Review Agent Results

```typescript
interface ReviewResult {
  success: boolean;
  reviewResult: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED';
  filesReviewed: string[];
  securityIssues?: string[];
  performanceIssues?: string[];
  notes: string;
}
```

Review results are:
- Written to `~/.panopticon/specialists/review-agent/history.jsonl`
- Posted as GitHub PR review comments

### Test Agent Results

```typescript
interface TestResult {
  success: boolean;
  testResult: 'PASS' | 'FAIL' | 'ERROR';
  testsRun: number;
  testsPassed: number;
  testsFailed: number;
  failures?: TestFailure[];
  fixAttempted: boolean;
  fixResult: 'SUCCESS' | 'FAILED' | 'NOT_ATTEMPTED';
}
```

### Merge Agent Results

```typescript
interface MergeResult {
  success: boolean;
  resolvedFiles?: string[];
  failedFiles?: string[];
  testsStatus?: 'PASS' | 'FAIL' | 'SKIP';
  reason?: string;
}
```

## Example: Complete Worker Agent Flow

```bash
# 1. Implement feature
# ... (agent edits files, runs tests locally)

# 2. Create PR via gh CLI
gh pr create --title "feat: PAN-42 implement feature X" --body "..." --head feature/pan-42

# 3. Signal completion — triggers verification gate → specialist pipeline
pan done PAN-42

# That's it. Cloister handles the rest:
#   verification gate → review-agent → test-agent → UAT-agent → merge queue
```

## CLI Commands

```bash
# List all specialists with status
pan specialists list

# Manually dispatch a specialist (triggers immediate spawn)
pan specialists wake review-agent

# Reset a specialist (clear session, start fresh)
pan specialists reset review-agent
```

## Configuration

Specialists can be configured in `~/.panopticon/cloister.toml`:

```toml
[specialists.review_agent]
enabled = true
auto_wake = true

[specialists.test_agent]
enabled = true
auto_wake = true
test_command = "npm test"  # Optional override

[specialists.merge_agent]
enabled = true
auto_wake = true
```

## Best Practices

### For Worker Agents

1. **Create good PR descriptions**: Help reviewers understand the change
2. **Run tests locally first**: Don't submit PRs with known test failures
3. **Use appropriate priority**: Don't mark everything as urgent
4. **Include context**: Add relevant information in the context field
5. **Exit after submission**: Let specialists handle review/merge
6. **Use `pan done` not `pan approve`**: `pan done <ISSUE-ID>` is the agent completion command (run via Bash). `pan approve` is supervisor-only.

### For Specialist Configuration

1. **Monitor history logs**: Check `~/.panopticon/specialists/<name>/history.jsonl`
2. **Configure test commands**: Override auto-detection for custom test setups

## Session Lifecycle

There are **two specialist session strategies** in the system, and they apply to
different specialists:

### 1. Reviewer canonical sessions (PAN-830) — persistent across rounds

Per-issue reviewer specialists (`review-correctness`, `review-security`,
`review-performance`, `review-requirements`, `review-synthesis`) use canonical
tmux sessions named:

```
specialist-<projectKey>-<issueId>-review-<role>
```

These sessions are **kept alive between review rounds** with `remain-on-exit on`.
On each new round, `dispatchParallelReview` checks whether the canonical session
already exists. If it does, the new round's prompt is delivered into the running
Claude Code process via `sendKeysAsync` (tmux `load-buffer`/`paste-buffer`/`C-m`)
rather than spawning a fresh process.

Why this is safe vs PAN-612: the corruption case in PAN-612 is specifically
about resuming a serialized session via `claude --resume`, which re-parses the
JSONL and trips the thinking-block-signature check. The canonical pattern never
serializes/resumes — the Claude process stays alive in tmux across rounds, so
the corruption path doesn't exist. Reviewers retain their accumulated
understanding of the issue (codebase patterns, prior findings, decisions made)
without paying the corruption tax.

### 2. Other specialist dispatches (test-agent, merge-agent, etc.) — fresh per dispatch

Non-reviewer specialist dispatches spawn a fresh ephemeral Claude Code session
each time (random `--session-id`, no `--resume`). Reasons:

1. Context compaction corrupts thinking block signatures, making `--resume`
   permanently fail with "Invalid signature in thinking block" (PAN-612).
2. These dispatches are task-based: each is a new task with a full prompt.
3. For test-agent specifically, accumulated context caused false-FAILs from
   stale analysis.

A preamble is injected at the start of every task prompt to handle the case
where a session has run before:

```
IMPORTANT: This is a NEW task dispatch. You may have context from prior runs in this session —
that is useful background knowledge, but you MUST execute this task fresh RIGHT NOW.
```

### Context Digest (cross-dispatch memory)

For specialists that don't use canonical sessions, a **context digest** is
written after each run (`specialist-context.ts`) and injected into the next
dispatch's prompt as background knowledge. It provides accumulated
understanding without requiring session resume:

- **test-agent**: Known flaky tests, test runner quirks, infrastructure notes
- **merge-agent**: Conflict patterns, resolution strategies

Reviewers don't need a digest since their sessions persist (PAN-830).

### Resetting a Specialist

```bash
# Reset via CLI — clears session state and context digest
pan specialists reset review-agent
```

For canonical reviewer sessions, reset additionally kills the per-issue tmux
sessions so the next round spawns fresh.

### Event-driven status (PAN-915)

Reviewer status (`reviewSubStatuses[role]`, `reviewSessionNames`,
`reviewCoordinatorSessionName`) is now driven by domain events rather than tmux
polling:

- `review.coordinator_started` — emitted when `pan review run` is dispatched
- `review.reviewer_started` — emitted when each reviewer session is spawned
  or has a new prompt sent into an existing canonical session
- `review.reviewer_completed` — emitted when a reviewer's output file is
  written

The dashboard's read model applies these events directly, so the kanban card
reflects per-role status the instant a reviewer is dispatched. Snapshot rebuild
still falls back to `enrichReviewStatusFromSessions()` (which reads tmux) for
recovery from server restarts mid-review.

## Review Cycle Circuit Breaker

Agents can automatically request re-review up to **3 times** (`MAX_AUTO_REQUEUE = 3`). After 3 cycles of specialist feedback and agent fixes, the circuit breaker trips and human intervention is required.

### What Happens at the Limit

When the circuit breaker fires:
1. The API returns HTTP 429 with `"Circuit breaker triggered"`
2. The deacon stops sending recovery nudges to the agent
3. The dashboard ACTIONS section shows **"Review cycles: 3/3"** with a warning: **"Human intervention needed"**
4. The agent cannot proceed further without human help

### Human Intervention

When the circuit breaker fires, the human should:

1. **Review the feedback history** — expand the status section in the dashboard workspace panel to see what went wrong across cycles
2. **Assess the situation** — is the agent going in circles? Are the review-agent's requests reasonable? Is there a pre-existing test failure confusing things?
3. **Click "Review & Test"** in the dashboard to reset the counter and run a fresh review cycle
4. Alternatively, **review the code manually** and either merge directly or send specific guidance to the agent via `pan tell <ISSUE-ID> "message"`

### Full Review Flow

```
Agent runs `pan done` (Bash command)
  → Verification gate runs quality_gates from projects.yaml (typecheck, lint, test)
    → FAIL → feedback sent to agent's tmux session, completion NOT marked as processed (agent retries)
    → PASS → wake review-agent
      → review-agent reviews code
        → APPROVED → queues test-agent
          → test-agent runs tests
            → PASS → marks ready for merge (human clicks MERGE or merge-agent handles)
            → FAIL → feedback to .planning/feedback/ → agent fixes → re-requests review
        → CHANGES REQUESTED → feedback to .planning/feedback/ → agent fixes → re-requests review
          → This cycle repeats up to 3 times before circuit breaker trips
```

The verification gate (PAN-174) runs between agent completion and review-agent wake. It executes the `quality_gates` defined in `projects.yaml` (typecheck, lint, test). If any gate fails, feedback is sent to the agent's tmux session and the completion marker is NOT processed, allowing the agent to fix issues and re-signal completion. After 3 consecutive failures, the gate is bypassed to prevent permanent blocking. See `src/lib/cloister/verification-gate.ts`.

#### verificationStatus semantics

`verificationStatus` reflects the most recent gate run within the current review cycle:

| Value | Meaning | Blocks `readyForMerge`? |
|-------|---------|------------------------|
| `undefined` | No gate has run yet | No |
| `pending` | Scheduled but not yet run this cycle | **No** — "pending" is not failure |
| `running` | Gate is actively executing | No |
| `passed` | All gates passed | No |
| `skipped` | Gates bypassed (3-strike rule) | No |
| `failed` | At least one gate failed | **Yes** |

**Only `'failed'` blocks `readyForMerge`.** `'pending'` means "this cycle's gate hasn't run yet" — it is reset to `pending` at the start of each review cycle by `request-review`, and is not a signal of failure. This is enforced in `verificationSatisfied()` in `review-status.ts` and aligned in `normalizeReviewStatus()`.

Orphaned review/test recovery in deacon must not depend solely on `agentState.workspace`. If the work-agent state file is missing but the workspace still exists on disk, deacon now falls back to canonical workspace discovery (`findWorkspacePath(projectPath, issueLower)`) before deciding recovery is impossible. This keeps `pending` review and `dispatch_failed`/orphaned test states recoverable after agent-state loss.

A second verification gate also runs **post-rebase in the merge queue** (before the GitHub merge). This gate uses the same `quality_gates` but runs in the workspace state after rebase, not after the original `pan done`. Its failure sends feedback to the work agent and pauses the merge; the queue advances to the next issue.

### Activity Log

Every call to `setReviewStatus()` that changes a status field emits an `activity.entry` domain event. These events flow through the SQLite event store → WebSocket → Zustand store → `ActivityPanel` in real-time.

**Events emitted per transition:**

| Field changed | Event emitted |
|---------------|--------------|
| `verificationStatus: running` | `"PAN-XXX — verification running"` (source: `cloister`) |
| `verificationStatus: passed/failed/skipped` | `"PAN-XXX — verification passed/failed/skipped"` |
| `reviewStatus: reviewing/passed/failed/blocked` | `"PAN-XXX — review started/passed/failed/blocked"` (source: `review-specialist`) |
| `testStatus: testing/passed/failed` | `"PAN-XXX — tests running/passed/failed"` (source: `test-specialist`) |
| `mergeStatus: queued/merging/verifying/merged/failed` | `"PAN-XXX — queued for merge / merge in progress / post-merge verification / merged / merge failed"` (source: `merge-agent`) |
| `readyForMerge: true` (transition) | `"PAN-XXX — ready for merge"` (source: `cloister`) |

The REST `GET /api/activity` endpoint provides a bootstrap fallback for the ActivityPanel on initial load; the primary real-time flow is via WebSocket.

### Key API Endpoints

| Endpoint | Purpose | Counter Effect |
|----------|---------|---------------|
| `POST /api/review/:id/request` | Agent re-review request | Increments (max 3) |
| `POST /api/review/:id/trigger` | Human-initiated review | Resets to 0 |
| `GET /api/review/:id/status` | Status including `autoRequeueCount` | Read-only |

## Troubleshooting

### Review agent not dispatching

```bash
# Check if specialist is running
pan specialists list

# Manually dispatch specialist
pan specialists wake review-agent
```

### Test agent not detecting test runner

Add explicit config:

```toml
[specialists.test_agent]
enabled = true
test_command = "npm test"
```

### Merge agent conflict resolution failed

Check merge history:

```bash
cat ~/.panopticon/specialists/merge-agent/history.jsonl | tail -1 | jq
```

Review agent logs for specific errors.

## Sync with Main (PAN-242)

The merge-agent also handles syncing active workspaces with the latest `main` branch. This propagates hotfixes and other changes from main into feature branches without interrupting in-progress work.

### How It Works

1. **User clicks "Sync with Main"** in the dashboard (Board view → workspace detail → ACTIONS section) or runs `pan sync-main <ISSUE-ID>`
2. **Auto-commit**: Any uncommitted changes in the workspace are automatically committed (`WIP: auto-commit before sync with main`) with post-commit verification
3. **Fetch + merge**: `git fetch origin main` followed by `git merge origin/main`
4. **Clean merge**: If no conflicts, returns immediately with commit count and changed files
5. **Conflicts**: If conflicts arise, the merge-agent specialist is woken with the `sync-main.md` prompt template containing the conflict file list. The sync endpoint polls until conflicts are resolved (up to 15 minutes)

### Design Decisions

- **Merge, not rebase**: Merge preserves history and requires no force-push. Feature branches squash-merge to main anyway, so merge commits don't pollute the final history.
- **Auto-commit before sync**: Instead of blocking on uncommitted changes, the system auto-commits a WIP snapshot. This prevents data loss if the merge introduces complex conflicts.
- **Never revert a successful merge**: If post-merge operations (container restart, etc.) fail, the git merge stands. The merge and downstream operations are decoupled.
- **Polyrepo**: For polyrepo workspaces (MYN), sync runs against each sub-repo independently (all-or-nothing).

### API

```
POST /api/issues/:issueId/sync-main

Response (success):
{ "success": true, "commitCount": 49, "changedFiles": [...], "message": "Synced 49 commit(s) from main" }

Response (already up to date):
{ "success": true, "alreadyUpToDate": true, "message": "Already up to date with main" }

Response (error):
{ "success": false, "error": "...", "conflictFiles": [...] }
```

### CLI

```bash
pan sync-main PAN-143
```

## Prompt Templates

Every specialist and orchestration prompt is a Mustache template with YAML frontmatter, loaded through the unified `renderPrompt()` API in `src/lib/cloister/prompts.ts`. See the full authoring guide at [reference/prompts](../reference/prompts.mdx).

### Template Location

- **Source**: `src/lib/cloister/prompts/`
- **Runtime (built)**: `dist/dashboard/prompts/`

The build pipeline copies `*.md` from source to dist (see [BUILD.md](./BUILD.md#specialist-prompt-templates)). `resolvePromptsDir()` in the loader handles both paths transparently.

### Available Templates

| Template | Used by | Purpose |
|----------|---------|---------|
| `work.md` | Work agents | Implementation task instructions |
| `planning.md` | Planning agents | vBRIEF authoring and PRD analysis |
| `review.md` | review-agent | Code review checklist and criteria |
| `test.md` | test-agent | Test execution and baseline comparison |
| `merge.md` | merge-agent | PR merge, rebase, and conflict resolution |
| `sync-main.md` | merge-agent | Sync-from-main conflict resolution |
| `resume-work.md` | Cloister resume path | Wake a stalled work agent with feedback |
| `handoff-to-work.md` | Planning → work handoff | Bridge prompt carrying serialized plan context |
| `identity-wake.md` | Specialist bootstrap | Initial role/identity message for long-lived specialists |
| `inspect-agent.md` | inspect-agent (legacy) | Ad-hoc inspection path, not yet migrated to renderPrompt |

### Frontmatter Contract

Each template declares its variables up front:

```yaml
---
name: review
description: Code review instructions for review-agent
requires:
  - ISSUE_ID
  - WORKSPACE_PATH
  - BRANCH_NAME
optional:
  - ADDITIONAL_CONTEXT
---
```

- `requires` — must be present and non-empty at render time; omission throws `PromptError`.
- `optional` — permitted but not required; undefined becomes empty string.
- Any variable not listed in `requires` or `optional` is **unknown** and throws at render time (fail loud).

### Template Syntax

Templates use [Mustache](https://mustache.github.io/) with HTML escaping disabled globally:

- `{{VAR}}` — variable substitution (no escaping, braces stay literal via `Mustache.escape = String`)
- `{{#VAR}}...{{/VAR}}` — truthy section (renders block when VAR is truthy)
- `{{^VAR}}...{{/VAR}}` — inverted section (renders when VAR is falsy/empty)
- `{{#VAR}}{{VAR}}{{/VAR}}` — context fall-through (render VAR only if set)

No partials, lambdas, or helpers — keep composition in TypeScript.

### Adding a New Template

1. Create `src/lib/cloister/prompts/your-template.md` with frontmatter declaring `requires`/`optional`.
2. Use Mustache `{{VAR}}` syntax throughout the body.
3. Call it from TypeScript: `renderPrompt({ name: 'your-template', vars: { VAR: value } })`.
4. Add a loader contract test in `src/lib/cloister/__tests__/prompts.test.ts` (requires-present, unknowns-reject, rendering).
5. The build pipeline automatically copies new `.md` files to `dist/dashboard/prompts/` — no config changes needed.

## Deacon Health Monitor

The deacon patrols specialists every 30 seconds and handles recovery:

- **Heartbeat checks**: Specialists write heartbeat files; deacon checks staleness
- **Stuck detection**: 3 consecutive stale heartbeats → force-kill + restart with fresh session
- **Dead specialist recovery**: Uses `wakeSpecialist()` with `clearSessionId()` to start fresh (not `initializeSpecialist()` which rejects for existing sessions — see PAN-246)
- **No backoff yet**: Deacon retries indefinitely (PAN-247 tracks adding backoff/escalation)

## Reopening Issues for Re-Work

When an issue is closed or marked done but needs additional work, use the reopen flow to reset specialist state.

### What Reopen Resets

The `pan reopen <ID>` command (and the dashboard Reopen button) performs these actions atomically:

1. **Tracker transition** — moves the issue to "In Progress" (not Backlog)
2. **Specialist states** — resets `reviewStatus`, `testStatus`, `mergeStatus` to `pending`
3. **readyForMerge** — cleared to `false`
4. **Specialist queues** — removes any stale queue items for the issue from review-agent, test-agent, and merge-agent
5. **STATE.md** — appends a `## Reopened — <date>` section with:
   - Previous status and review/test state
   - Optional reopen reason
   - Latest tracker comments (reuses PAN-253's `getTrackerContext()` pattern)

### Why "In Progress" and Not Backlog

Previous behavior moved the issue to Backlog and triggered re-planning. This was wrong:
- The implementation plan in STATE.md is still valid
- The agent should resume re-work, not replan from scratch
- Backlog triggers `planCommand()` which overwrites STATE.md progress

The new behavior moves to "In Progress" and lets the agent read the "Reopened" section in STATE.md to understand what changed.

### Preserving History

The `history` array in `review-status.json` retains all previous status transitions. Reopening adds a new entry tagged with the reason. This provides an audit trail for issues that go through multiple review cycles.

### Agent Behavior After Reopen

On restart, the agent reads STATE.md and sees:
1. A `## Reopened` section (clear signal that fast-path is wrong)
2. Tracker comments with the new requirements
3. Previous status of all specialist states

The `getTrackerContext()` function (PAN-253) injects this into the work agent prompt, ensuring the agent never fast-paths to done when reopened.

### Preventing Stale Dispatch

Reopen clears `reviewStatus`, `testStatus`, and `mergeStatus` to `pending`. Because review/test specialists dispatch immediately on status transitions (no queue), there are no stale queue items to clear. The merge queue entry for the issue is also removed if one exists.

## Future Enhancements

- External PR selection (select PRs from repo, not just Panopticon-created)
- Multiple merge agents per repository
- Webhook integration (GitHub webhooks trigger specialists)
- Deacon backoff/escalation for repeated failures (PAN-247)
- Persistent specialist sessions per issue — keep tmux session alive across review/test cycles so Claude doesn't regather context (PAN-722)

## Related Documentation

- [BUILD.md](./BUILD.md) - Build pipeline and prompt template copying
- [TESTING.md](./TESTING.md) - Test suites and Playwright conventions
- [Cloister Configuration](../src/lib/cloister/config.ts) - Config schema
- [Specialist Registry](../src/lib/cloister/specialists.ts) - Registry management
