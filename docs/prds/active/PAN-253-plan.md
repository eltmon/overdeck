# PAN-253: Inject Tracker Comments into Work Agent Prompt on Restart

## Problem

When a work agent is restarted on a reopened issue, it reads `.planning/STATE.md`, sees "Implementation complete", and immediately signals done — because it has zero visibility into tracker activity (comments, status changes) that occurred after STATE.md was last updated.

## Decisions

### Approach: Pre-fetch in callers, pass to prompt builder
- Keep `buildWorkAgentPrompt()` synchronous
- Add `trackerContext?: string` to `WorkAgentPromptContext`
- Callers (`issueCommand()` in `issue.ts`, server endpoint in `index.ts`) fetch tracker data before calling prompt builder
- Follows the existing `PENDING_FEEDBACK` pattern exactly

### Data to include
- **Current issue status** (with reopened detection)
- **New comments** since STATE.md's last modified time
- Reopened detection: if STATE.md has completion markers but issue state is `open`/`in_progress`, flag as reopened

### Error handling: Warn in prompt
- If tracker unavailable or fetch fails, inject a note telling the agent to check the tracker manually
- Don't block agent startup

### Tracker-specific considerations
- **GitHub**: `getComments()` returns issue comments; `getIssue()` returns `open`/`closed` only
- **Linear**: `getComments()` returns comments; `getIssue()` returns `open`/`in_progress`/`closed`
- **Rally**: `getComments()` fetches ConversationPosts (Discussions) — this is the correct data source for Rally
- **GitLab**: `getComments()` throws `NotImplementedError` — handle gracefully with warning

### Truncation: Both per-comment and total limits
- Per-comment body: ~500 characters, truncate with `[truncated — read full comment on tracker]` notice
- Total section: ~2000 characters, show most recent comments that fit
- If ANY truncation occurs, tell agent to check tracker directly for full content

## Architecture

### Data Flow
```
[issueCommand() / server endpoint]
  → getTrackerContext(issueId, workspacePath)  // new async function
    → tracker.getIssue(issueId)                // current status
    → tracker.getComments(issueId)             // all comments
    → statSync('.planning/STATE.md')           // get mtime
    → filter comments where createdAt > mtime
    → detect reopened (STATE.md says complete, issue is open)
    → format + truncate
    → return formatted string (or warning string on error)
  → buildWorkAgentPrompt({ ..., trackerContext })
    → template renders {{#if NEW_TRACKER_CONTEXT}}...{{/if}}
```

### Template placement
The `NEW_TRACKER_CONTEXT` section goes BEFORE "Check Completion Status FIRST" so the agent reads it before fast-pathing to done. Place it after `PENDING_FEEDBACK`.

### New function: `getTrackerContext()`
Located in `src/lib/cloister/work-agent-prompt.ts` (co-located with prompt building logic).

Signature:
```typescript
export async function getTrackerContext(
  issueId: string,
  workspacePath: string
): Promise<string>
```

Returns:
- Formatted markdown string with new comments and status, or
- Warning string if tracker unavailable, or
- Empty string if no new activity

## Files to Modify

| File | Change | Difficulty |
|------|--------|-----------|
| `src/lib/cloister/work-agent-prompt.ts` | Add `trackerContext` to `WorkAgentPromptContext`, add `getTrackerContext()` function, wire into `buildWorkAgentPrompt()` | medium |
| `src/lib/cloister/prompts/work-agent.md` | Add `{{#if NEW_TRACKER_CONTEXT}}` template section before completion check | simple |
| `src/cli/commands/work/issue.ts` | Call `getTrackerContext()` before `buildWorkAgentPrompt()`, pass result in context | simple |
| `src/dashboard/server/index.ts` | Call `getTrackerContext()` for both LOCAL and REMOTE paths when starting agent | simple |

## Remaining Work

Implementation not started.
