# Specialist Workflow Guide

This document explains how worker agents interact with specialist agents (inspect-agent, review-agent, test-agent, merge-agent) through the queue system.

## Overview

Specialist agents are ephemeral Claude Code sessions that handle specific tasks:

- **inspect-agent (Sonnet)**: Per-bead verification — checks implementation matches spec and constraints
- **review-agent (Sonnet)**: Full MR code review, security checks, quality analysis
- **test-agent (Haiku)**: Test execution, failure analysis, simple fixes
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

# Wait for result — delivered via pan work tell
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
   e. Spawns work agent via `pan work issue <ID> --phase implementation`

4. Work agent reads .planning/STATE.md and implements remaining work
```

### Beads Prerequisite

Beads are a hard prerequisite for starting work agents. The `POST /api/agents` endpoint returns **422** if `.beads/issues.jsonl` does not exist in the workspace. The planning agent must create beads via `bd create` before handing off to implementation.

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

### Step 3: Submit to Review Queue

```typescript
import { submitToSpecialistQueue } from '@/lib/cloister/specialists';

// Submit PR to review-agent
submitToSpecialistQueue('review-agent', {
  priority: 'normal', // or 'urgent', 'high', 'low'
  source: 'agent-pan-42', // Worker agent ID
  prUrl: prUrl,
  issueId: 'PAN-42',
  workspace: '/path/to/workspace',
  branch: 'feature/pan-42',
  filesChanged: ['src/foo.ts', 'src/bar.ts'], // Optional
  context: {
    // Optional additional context
    description: 'Implemented new feature X',
    estimatedComplexity: 'medium',
  },
});
```

### Step 4: Worker Agent Waits

Worker agent can:
- **Exit** and let specialists handle the rest (recommended)
- **Wait and monitor** for review results (if immediate feedback needed)
- **Continue with other tasks** while review is pending

## Specialist Agent Processing

### Review Agent Workflow

1. **Wakes up** when work is detected in queue (FPP principle)
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
6. **If approved**, submits to merge queue automatically
7. **Removes task** from review queue

### Test Agent Workflow (Optional)

Review-agent or worker-agent can optionally submit to test-agent:

```typescript
submitToSpecialistQueue('test-agent', {
  priority: 'normal',
  source: 'review-agent',
  issueId: 'PAN-42',
  workspace: '/path/to/workspace',
  branch: 'feature/pan-42',
});
```

Test agent:
1. **Detects test runner** (npm, pytest, cargo, etc.)
2. **Runs test suite**
3. **Analyzes failures**
4. **Attempts simple fixes** if applicable (< 5 min fix)
5. **Reports results** with structured output

### Merge Agent Workflow

1. **Wakes up** when work is detected in queue
2. **Attempts merge** to target branch (usually `main`)
3. **If conflicts exist**:
   - Reads conflict files
   - Analyzes both sides of conflict
   - Resolves conflicts (preserving intent of both changes)
   - Runs tests if configured
4. **Completes merge commit**
5. **Pushes to remote**
6. **Reports results**
7. **Removes task** from merge queue

## Queue Priority Levels

```typescript
type Priority = 'urgent' | 'high' | 'normal' | 'low';
```

- **urgent**: Critical hotfixes, security patches (processed first)
- **high**: Important features, blocking issues
- **normal**: Standard features, bug fixes (default)
- **low**: Minor improvements, cleanup tasks

Specialists process queue items in priority order (urgent → high → normal → low).

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
- Available via CLI: `pan specialists queue review-agent`

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

```typescript
// worker-agent.ts - Example implementation

// 1. Implement feature
await implementFeature(issueId);

// 2. Run tests locally (optional but recommended)
const localTestResult = execSync('npm test', { cwd: workspace });
if (!localTestResult.includes('PASS')) {
  console.error('Tests failed locally. Fixing...');
  await fixTests();
}

// 3. Create PR
const prUrl = execSync(
  `gh pr create --title "feat: ${issueTitle}" --body "${prBody}" --head ${branch}`,
  { cwd: workspace, encoding: 'utf-8' }
).trim();

console.log(`Created PR: ${prUrl}`);

// 4. Submit to review queue
submitToSpecialistQueue('review-agent', {
  priority: 'normal',
  source: agentId,
  prUrl,
  issueId,
  workspace,
  branch,
  filesChanged: getChangedFiles(),
  context: {
    description: 'Implemented feature X with tests',
    testsPassed: true,
  },
});

console.log('Submitted to review queue. Specialist will handle review and merge.');

// 5. Worker agent work is done - specialist takes over
exit(0);
```

## CLI Commands

```bash
# List all specialists with status
pan specialists list

# Check a specialist's queue
pan specialists queue review-agent

# Manually wake a specialist (for testing)
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
6. **Use `pan work done` not `pan approve`**: `pan work done <ISSUE-ID>` is the agent completion command (run via Bash). `pan approve` is supervisor-only.

### For Specialist Configuration

1. **Keep auto_wake enabled**: Ensures specialists respond to queue items
2. **Monitor history logs**: Check `~/.panopticon/specialists/<name>/history.jsonl`
3. **Reset sessions periodically**: If context gets too large (>100K tokens)
4. **Configure test commands**: Override auto-detection for custom test setups

## Session Persistence & Memory

Specialist agents maintain persistent sessions across invocations, accumulating project knowledge over time. This is a key differentiator — specialists get smarter the more they work on a project.

### How It Works

Each specialist stores a session ID in `~/.panopticon/specialists/<name>.session` (global) or `~/.panopticon/specialists/projects/<projectKey>/<name>.session` (per-project). When a specialist is dispatched:

1. **First dispatch** (no session file): A deterministic UUID is generated from the specialist's identity string (e.g., `specialist-mind-your-now-review-agent` → SHA-256 → UUID format). Claude Code starts with `--session-id <uuid>`, and the ID is persisted to disk.
2. **Subsequent dispatches**: The saved session ID is read and Claude Code starts with `--resume <sessionId>`, restoring the full conversation history.

**Important**: Claude Code requires valid UUID format for both `--session-id` and `--resume`. Session IDs are generated via `deterministicUUID()` which hashes the specialist name with SHA-256 and formats the result as a UUID. This ensures the same specialist for the same project always gets the same session ID. A validation guard in `getSessionId()` discards any stored session IDs that aren't valid UUIDs (e.g., from older formats).

This means the merge-agent remembers every merge it has performed, the review-agent accumulates knowledge of code patterns and past review decisions, and the test-agent retains awareness of flaky tests and project-specific test configurations.

### What Gets Preserved

| Specialist | Accumulated Knowledge |
|------------|----------------------|
| **merge-agent** | Previous merge resolutions, conflict patterns, project conventions, which files commonly conflict |
| **review-agent** | Code quality patterns, past review decisions, security patterns specific to the project |
| **test-agent** | Test infrastructure knowledge, known flaky tests, failure patterns |

### Session Rotation (Context Management)

When a specialist's token usage exceeds **100K tokens**, session rotation triggers automatically:

1. The current session is killed
2. A **tiered memory file** is built from git history:
   - **Last 100 merges**: commit hash + message (summary)
   - **Last 50 merges**: + files changed (detailed)
   - **Last 20 merges**: + full diffs (complete context)
3. A fresh session starts with the memory file injected as context
4. The new session ID is persisted for future `--resume`

This ensures specialists maintain long-term knowledge without exhausting their context window.

### Why This Matters

Without session persistence, every specialist wake starts from zero — the merge-agent would re-learn the same conflict patterns, the review-agent would forget past decisions, and the test-agent would lose awareness of the test infrastructure. Session persistence transforms specialists from stateless workers into experienced team members that improve over time.

### Resetting a Specialist

To clear a specialist's accumulated context and start fresh:

```bash
# Delete the session file — next dispatch will create a new session with the same deterministic UUID
rm ~/.panopticon/specialists/merge-agent.session

# For per-project specialists:
rm ~/.panopticon/specialists/projects/mind-your-now/review-agent.session

# Or reset via CLI
pan specialists reset merge-agent
```

Note: resetting only clears the session file. The next dispatch will regenerate the same deterministic UUID from the specialist name, creating a fresh Claude session with a new conversation history.

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
Agent runs `pan work done` (Bash command)
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

### Key API Endpoints

| Endpoint | Purpose | Counter Effect |
|----------|---------|---------------|
| `POST /api/workspaces/:id/request-review` | Agent re-review request | Increments (max 3) |
| `POST /api/workspaces/:id/review` | Human-initiated review | Resets to 0 |
| `GET /api/workspaces/:id/review-status` | Status including `autoRequeueCount` | Read-only |

## Troubleshooting

### Review agent not processing queue

```bash
# Check queue status
pan specialists queue review-agent

# Check if specialist is running
pan specialists list

# Manually wake specialist
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

1. **User clicks "Sync with Main"** in the dashboard (Board view → workspace detail → ACTIONS section) or runs `pan work sync-main <ISSUE-ID>`
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
POST /api/workspaces/:issueId/sync-main

Response (success):
{ "success": true, "commitCount": 49, "changedFiles": [...], "message": "Synced 49 commit(s) from main" }

Response (already up to date):
{ "success": true, "alreadyUpToDate": true, "message": "Already up to date with main" }

Response (error):
{ "success": false, "error": "...", "conflictFiles": [...] }
```

### CLI

```bash
pan work sync-main PAN-143
```

## Prompt Templates

Each specialist uses a Markdown prompt template that gets populated with runtime context (workspace path, branch, issue ID, etc.) before being sent to Claude Code.

### Template Location

- **Source**: `src/lib/cloister/prompts/`
- **Runtime (built)**: `dist/dashboard/prompts/`

The build pipeline copies `*.md` from source to dist (see [BUILD.md](./BUILD.md#specialist-prompt-templates)).

### Available Templates

| Template | Used by | Purpose |
|----------|---------|---------|
| `work-agent.md` | Work agents | Implementation task instructions |
| `review-agent.md` | review-agent | Code review checklist and criteria |
| `test-agent.md` | test-agent | Test execution and baseline comparison |
| `merge-agent.md` | merge-agent | PR merge and conflict resolution |
| `sync-main.md` | merge-agent | Sync-from-main conflict resolution |

### Template Variables

Templates use `{{variable}}` syntax replaced at runtime:

- `{{projectPath}}` — workspace directory
- `{{workspaceBranch}}` — current feature branch name
- `{{issueId}}` — issue identifier (PAN-143, MIN-678, etc.)
- `{{conflictFiles}}` — list of files with merge conflicts (sync-main only)

### Adding a New Template

1. Create `src/lib/cloister/prompts/your-template.md`
2. Use `{{variable}}` placeholders for runtime context
3. Load in your code: `join(__dirname, 'prompts', 'your-template.md')`
4. Replace variables: `template.replace(/{{variable}}/g, value)`
5. The build pipeline automatically copies new `.md` files to `dist/dashboard/prompts/`

## Deacon Health Monitor

The deacon patrols specialists every 30 seconds and handles recovery:

- **Heartbeat checks**: Specialists write heartbeat files; deacon checks staleness
- **Stuck detection**: 3 consecutive stale heartbeats → force-kill + restart with fresh session
- **Dead specialist recovery**: Uses `wakeSpecialist()` with `clearSessionId()` to start fresh (not `initializeSpecialist()` which rejects for existing sessions — see PAN-246)
- **No backoff yet**: Deacon retries indefinitely (PAN-247 tracks adding backoff/escalation)

## Reopening Issues for Re-Work

When an issue is closed or marked done but needs additional work, use the reopen flow to reset specialist state.

### What Reopen Resets

The `pan work reopen <ID>` command (and the dashboard Reopen button) performs these actions atomically:

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

### Preventing Stale Queue Items

Without reopen clearing queues, specialists might pick up stale items from before the reset:
- review-agent might re-review old code against old criteria
- test-agent might run tests on the pre-fix branch
- merge-agent might try to merge already-done state

The reopen flow calls `completeSpecialistTask()` for all queue items matching the issue ID across all three specialist queues.

## Future Enhancements

- External PR selection (select PRs from repo, not just Panopticon-created)
- Multiple merge agents per repository
- Webhook integration (GitHub webhooks trigger specialists)
- Deacon backoff/escalation for repeated failures (PAN-247)
- Queue dashboard UI

## Related Documentation

- [BUILD.md](./BUILD.md) - Build pipeline and prompt template copying
- [TESTING.md](./TESTING.md) - Test suites and Playwright conventions
- [FPP Hooks System](../src/lib/hooks.ts) - Queue implementation
- [Cloister Configuration](../src/lib/cloister/config.ts) - Config schema
- [Specialist Registry](../src/lib/cloister/specialists.ts) - Registry management
