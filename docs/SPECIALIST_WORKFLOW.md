# Specialist Workflow Guide

This document explains how worker agents interact with specialist agents (review-agent, test-agent, merge-agent) through the queue system.

## Overview

Specialist agents are long-running Claude Code sessions that handle specific tasks:

- **review-agent (Sonnet)**: Code review, security checks, quality analysis
- **test-agent (Haiku)**: Test execution, failure analysis, simple fixes
- **merge-agent (Sonnet)**: Merge conflict resolution, CI handling

Worker agents (issue-specific agents like `agent-pan-42`) submit work to specialist queues. Specialists process work items one at a time, maintaining context across tasks.

## Architecture

```
┌─────────────────┐
│  Worker Agent   │
│  (agent-pan-42) │
└────────┬────────┘
         │
         │ 1. Creates PR
         │ 2. Submits to review queue
         ▼
┌─────────────────────────────┐
│   Review Queue              │
│   ~/.panopticon/agents/     │
│   review-agent/hook.json    │
└────────┬────────────────────┘
         │
         │ 3. review-agent processes
         ▼
┌─────────────────────────────┐
│   review-agent (Sonnet)     │
│   - Reviews code            │
│   - Checks security         │
│   - Approves/Requests Changes│
└────────┬────────────────────┘
         │
         │ 4. If approved, submits to merge queue
         ▼
┌─────────────────────────────┐
│   Merge Queue               │
│   ~/.panopticon/agents/     │
│   merge-agent/hook.json     │
└────────┬────────────────────┘
         │
         │ 5. merge-agent processes
         ▼
┌─────────────────────────────┐
│   merge-agent (Sonnet)      │
│   - Merges PR               │
│   - Resolves conflicts      │
│   - Handles CI              │
└─────────────────────────────┘
```

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

Each specialist stores a session ID in `~/.panopticon/specialists/<name>.session`. When a specialist is woken up:

1. **First wake** (no session file): A new UUID is generated, Claude Code starts with `--session-id <uuid>`, and the ID is persisted to disk.
2. **Subsequent wakes**: The saved session ID is read and Claude Code starts with `--resume <sessionId>`, restoring the full conversation history.

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
# Delete the session file — next wake will create a new session
rm ~/.panopticon/specialists/merge-agent.session

# Or reset via CLI
pan specialists reset merge-agent
```

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
  → Auto-triggers review-agent
    → review-agent reviews code
      → APPROVED → queues test-agent
        → test-agent runs tests
          → PASS → marks ready for merge (human clicks MERGE or merge-agent handles)
          → FAIL → feedback to .planning/feedback/ → agent fixes → re-requests review
      → CHANGES REQUESTED → feedback to .planning/feedback/ → agent fixes → re-requests review
        → This cycle repeats up to 3 times before circuit breaker trips
```

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

## Future Enhancements

- External PR selection (select PRs from repo, not just Panopticon-created)
- Multiple merge agents per repository
- Webhook integration (GitHub webhooks trigger specialists)
- Specialist health monitoring and auto-restart
- Queue dashboard UI

## Related Documentation

- [FPP Hooks System](../src/lib/hooks.ts) - Queue implementation
- [Cloister Configuration](../src/lib/cloister/config.ts) - Config schema
- [Specialist Registry](../src/lib/cloister/specialists.ts) - Registry management
