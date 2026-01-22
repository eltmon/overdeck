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

### For Specialist Configuration

1. **Keep auto_wake enabled**: Ensures specialists respond to queue items
2. **Monitor history logs**: Check `~/.panopticon/specialists/<name>/history.jsonl`
3. **Reset sessions periodically**: If context gets too large (>100K tokens)
4. **Configure test commands**: Override auto-detection for custom test setups

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
