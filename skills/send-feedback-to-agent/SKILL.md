---
name: send-feedback-to-agent
description: Send findings and feedback from specialist agents back to issue agents
triggers:
  - send feedback
  - report findings
  - share learnings
---

# Send Feedback to Agent

This skill is used by specialist agents (merge-agent, test-agent, review-agent) to share their findings, patterns, and learnings back to the issue agent that initiated the work.

## When to Use

Use this skill after completing a task (merge, test, review) to:
- Report success/failure status
- Share patterns you noticed
- Provide actionable suggestions
- Document learnings that help future work

## How to Send Feedback

To send feedback, format a structured message to the issue agent's tmux session.

### Feedback Types

1. **success** - Task completed successfully
2. **failure** - Task failed, needs attention
3. **warning** - Task completed with caveats
4. **insight** - Learned something useful

### Categories

- `merge` - Merge conflict resolution feedback
- `test` - Test execution feedback
- `review` - Code review feedback
- `general` - General observations

### Example: Merge Success

```
Sending feedback to agent-pan-45:

**Feedback from merge-agent** (merge)

**Summary:** Merge completed successfully with minor conflict resolution

**Details:**
The merge of feature/pan-45 into main was successful.
Resolved 2 conflicts in config files by keeping both changes.

**Patterns Noticed:**
- Config files frequently conflict due to version bumps
- Test data files often have merge markers left behind

**Suggestions:**
- Consider using separate config files per feature
- Run linter after merge to catch stray markers
```

### Example: Test Failure

```
Sending feedback to agent-pan-45:

**Feedback from test-agent** (test)

**Summary:** 3 tests failed after merge

**Details:**
Test suite ran with 3 failures in authentication module.
Root cause appears to be missing mock in new test file.

**Action Items:**
1. Add AuthMock to tests/auth/login.test.ts
2. Check that TEST_API_KEY environment variable is set
3. Re-run with --verbose flag for more details
```

## API Function

The `sendFeedbackToAgent()` function in specialists.ts handles:
1. Logging feedback to `~/.panopticon/specialists/feedback/feedback.jsonl`
2. Sending formatted message to the issue agent's tmux session
3. Returning success/failure status

## Related

- `wakeSpecialist()` - Wake a specialist to handle a task
- `wakeSpecialistWithTask()` - Wake with pre-formatted task prompt
- `getPendingFeedback()` - Get feedback for an issue
