# PAN-80: Use Hooks for Specialist Status Instead of Terminal Output Parsing

## Problem Statement

Two related issues with specialist/agent management:

1. **Status detection is fragile** - Current `isIdleAtPrompt()` parses terminal output looking for prompt patterns and spinner indicators. This breaks when Claude Code UI changes and requires constant pattern maintenance (e.g., the recent bandaid fix for `❯ text ↵ send` pattern).

2. **No lifecycle management** - All agents stay running forever (22+ Claude processes). No distinction between "idle waiting for work" and "stuck". Resource waste keeping idle agents running.

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | All-in-one implementation | Complete solution - hooks, auto-suspend, activity log, dashboard changes, cleanup |
| Hook types | PreToolUse, Stop, PostToolUse | PreToolUse=active, Stop=idle, PostToolUse=logging |
| Status persistence | Hybrid (files + API) | Files for persistence across restarts, API for real-time dashboard updates |
| Specialist idle timeout | 5 minutes | Specialists are shared resources, suspend quickly |
| Work agent idle timeout | 10 minutes | Work agents wait longer for specialist feedback |
| Resume trigger | Auto + manual | Auto-resume when queued work arrives, plus manual Resume button |
| Activity log retention | Last 100 entries | Prune on write to keep file size manageable |
| Terminal parsing cleanup | Remove completely | Clean break, no fallback to old approach |
| Dashboard changes | Full update | New states, activity history panel, resume button, queue depth |

## Current Status

**Last Updated:** 2026-01-23 16:00

### Completed (Layers 1-2 - Foundation + Core Logic)

✅ **Hook Infrastructure** (panopticon-5sas)
- Created `pre-tool-hook` script (sets state=active)
- Created `stop-hook` script (sets state=idle)
- Updated `heartbeat-hook` to append to activity.jsonl with 100-entry pruning
- Updated `hooks.ts` to support PreToolUse, PostToolUse, Stop hook types
- All hooks write to `~/.panopticon/agents/{id}/` directory
- Hooks include optional API heartbeat to dashboard (non-blocking)

✅ **State Management** (panopticon-gm8y)
- Added `AgentRuntimeState` interface (active/idle/suspended/uninitialized)
- Added `ActivityEntry` interface for activity log
- Implemented `getAgentRuntimeState()` and `saveAgentRuntimeState()`
- Implemented `appendActivity()` with automatic 100-entry pruning
- Implemented `getActivity()` to read activity log
- Implemented `saveSessionId()` and `getSessionId()` for resume support

✅ **API Endpoints** (panopticon-4if2)
- POST `/api/agents/:id/heartbeat` - Receive state updates from hooks
- GET `/api/agents/:id/activity` - Fetch activity log entries
- POST `/api/agents/:id/suspend` - Save session ID and kill tmux
- POST `/api/agents/:id/resume` - Resume from saved session ID (with optional message)

✅ **Auto-Suspend Logic** (panopticon-eqs2)
- Added `checkAndSuspendIdleAgents()` to deacon patrol loop
- Specialists: 5 minute timeout, Work agents: 10 minute timeout
- Saves session ID, kills tmux, updates state to suspended
- Runs every 30 seconds as part of patrol

✅ **Agent Resume Implementation** (panopticon-k6fh)
- Created `resumeAgent()` function in agents.ts
- Reads saved session ID and creates tmux with `--resume` flag
- Auto-resume on `/work-tell` for work agents
- API endpoint simplified to use `resumeAgent()`

### Remaining Work (Layers 3-4)

**Layer 3 - UI & Cleanup:**
- Dashboard frontend updates (panopticon-t8k2) - Activity history, resume button, new states
- Terminal parsing cleanup (panopticon-r6tp) - Remove `isIdleAtPrompt()` and `detectSpecialistCompletion()`

**Layer 4 - Testing:**
- Integration tests (panopticon-wk6m) - State transitions, suspend/resume, auto-suspend

### Next Steps

1. ~~Implement auto-suspend logic in deacon patrol loop~~ ✅
2. ~~Implement agent resume functionality~~ ✅
3. Update dashboard frontend with new UI components
4. **CRITICAL**: Remove terminal parsing - especially `detectSpecialistCompletion()`
   - False positives: PAN-73 showed "Review Passed" when prompt mentioned "hand off to test-agent"
   - Solution: Specialists should POST status to API endpoint instead of terminal parsing
   - Add endpoint: `POST /api/specialists/:name/report-status` with `{issueId, status, notes}`
5. Write integration tests

### Critical Issue: detectSpecialistCompletion() False Positives

**Problem:** The review-agent status detection parses terminal output for phrases like "hand off to test-agent", but these appear in PROMPTS causing false positives (PAN-73 showed "Review Passed" while still reviewing).

**Root Cause:** Terminal output parsing is unreliable - can't distinguish between:
- Agent saying "I will hand off to test-agent" (status update)
- Prompt saying "When done, hand off to test-agent" (instruction)

**Solution (PAN-80):**
1. Add API endpoint: `POST /api/specialists/:name/report-status`
   - Body: `{issueId: string, status: 'passed'|'blocked'|'failed', notes?: string}`
   - Specialist agents call this API explicitly when work is complete
2. Remove `detectSpecialistCompletion()` terminal parsing function
3. Remove `pollReviewStatus()` and related polling logic
4. Update specialists to call API endpoint instead of relying on terminal output

## Technical Approach

### 1. Hook Infrastructure

Update Claude Code hooks configuration to report state changes:

**PreToolUse hook** - Set state to "active":
```bash
#!/bin/bash
# Called before any tool execution
curl -s -X POST "http://localhost:3011/api/agents/${PANOPTICON_AGENT_ID}/heartbeat" \
  -H "Content-Type: application/json" \
  -d '{"state": "active", "tool": "'"${CLAUDE_TOOL_NAME}"'"}'
```

**Stop hook** - Set state to "idle":
```bash
#!/bin/bash
# Called when Claude finishes responding (waiting for input)
curl -s -X POST "http://localhost:3011/api/agents/${PANOPTICON_AGENT_ID}/heartbeat" \
  -H "Content-Type: application/json" \
  -d '{"state": "idle", "timestamp": "'"$(date -Iseconds)"'"}'
```

**PostToolUse hook** - Log activity:
```bash
#!/bin/bash
# Log tool completion to activity file
echo '{"timestamp":"'"$(date -Iseconds)"'","tool":"'"${CLAUDE_TOOL_NAME}"'","action":"completed"}' \
  >> ~/.panopticon/agents/${PANOPTICON_AGENT_ID}/activity.jsonl
```

Also write to disk for persistence:
- `~/.panopticon/agents/{id}/state.json` - Current state (active/idle/suspended)
- `~/.panopticon/agents/{id}/activity.jsonl` - Activity log (last 100 entries)
- `~/.panopticon/agents/{id}/session.id` - Claude session ID for resume

### 2. New Agent States

| State | Meaning | Indicators |
|-------|---------|------------|
| `active` | Running, currently processing | Recent PreToolUse hook |
| `idle` | Running, at prompt waiting for input | Stop hook fired, tmux session exists |
| `suspended` | Session ID saved, tmux killed | No tmux session, session.id file exists |
| `uninitialized` | Never started | No state file |

### 3. API Endpoints

Add to dashboard server:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/agents/:id/heartbeat` | POST | Receive state update from hooks |
| `/api/agents/:id/activity` | GET | Get activity log (last N entries) |
| `/api/agents/:id/resume` | POST | Resume a suspended agent |
| `/api/agents/:id/suspend` | POST | Manually suspend an agent |

Heartbeat payload:
```typescript
interface Heartbeat {
  state: 'active' | 'idle';
  tool?: string;           // For active state
  timestamp: string;       // ISO 8601
  summary?: string;        // Optional action description
}
```

### 4. Auto-Suspend Logic

Add to deacon patrol loop (or separate background job):

```typescript
async function checkIdleTimeout(agentId: string): Promise<boolean> {
  const state = await getAgentState(agentId);
  if (state.status !== 'idle') return false;

  const idleTime = Date.now() - new Date(state.lastActivity).getTime();
  const timeout = isSpecialist(agentId) ? 5 * 60 * 1000 : 10 * 60 * 1000;

  if (idleTime > timeout) {
    await suspendAgent(agentId);
    return true;
  }
  return false;
}

async function suspendAgent(agentId: string) {
  // 1. Get Claude session ID from heartbeat/state
  const sessionId = await getClaudeSessionId(agentId);

  // 2. Save session ID for later resume
  await writeFile(`~/.panopticon/agents/${agentId}/session.id`, sessionId);

  // 3. Kill tmux session
  await exec(`tmux kill-session -t ${agentId}`);

  // 4. Update state
  await updateAgentState(agentId, { status: 'suspended', suspendedAt: new Date().toISOString() });
}
```

### 5. Resume Logic

```typescript
async function resumeAgent(agentId: string, message?: string) {
  const state = await getAgentState(agentId);
  if (state.status !== 'suspended') {
    throw new Error(`Cannot resume agent in state: ${state.status}`);
  }

  // 1. Get saved session ID
  const sessionId = await readFile(`~/.panopticon/agents/${agentId}/session.id`);

  // 2. Get workspace path
  const workspace = state.workspace;

  // 3. Create new tmux session with resume command
  const claudeCmd = `claude --resume "${sessionId}" --dangerously-skip-permissions`;
  await createTmuxSession(agentId, workspace, claudeCmd, {
    env: { PANOPTICON_AGENT_ID: agentId }
  });

  // 4. If there's a message, send it
  if (message) {
    await sendToTmux(agentId, message);
  }

  // 5. Update state
  await updateAgentState(agentId, { status: 'active', resumedAt: new Date().toISOString() });
}
```

Auto-resume triggers:
- Specialist: Queued work arrives via `submitToSpecialistQueue()`
- Work agent: Message sent via `/work-tell` or dashboard

### 6. Activity Log

JSONL format at `~/.panopticon/agents/{id}/activity.jsonl`:

```json
{"ts":"2026-01-23T10:30:00Z","tool":"Bash","action":"git status","state":"active"}
{"ts":"2026-01-23T10:30:05Z","tool":"Read","action":"src/index.ts","state":"active"}
{"ts":"2026-01-23T10:30:10Z","state":"idle"}
```

On write, prune to last 100 entries:
```typescript
async function appendActivity(agentId: string, entry: ActivityEntry) {
  const file = `~/.panopticon/agents/${agentId}/activity.jsonl`;
  const lines = await readLines(file);
  lines.push(JSON.stringify(entry));

  // Keep only last 100
  const trimmed = lines.slice(-100);
  await writeFile(file, trimmed.join('\n') + '\n');
}
```

### 7. Dashboard Changes

**Agent card updates:**
- Show state icon: active (spinner), idle (checkmark), suspended (pause), uninitialized (circle)
- Show last activity time and description
- "Resume" button for suspended agents (sends optional message)
- Activity history panel (collapsible, shows recent actions)

**Specialist panel:**
- Queue depth badge (existing from PAN-74)
- Current task (if active)
- Recent completions from activity log

### 8. Cleanup - Remove Terminal Parsing

Files to clean up:

| File | Remove |
|------|--------|
| `src/lib/cloister/specialists.ts` | `isIdleAtPrompt()` function (lines 483-576) |
| `src/lib/cloister/specialists.ts` | Bandaid fix for `❯ text ↵ send` pattern |
| `src/dashboard/server/index.ts` | `detectSpecialistCompletion()` function |
| `src/dashboard/server/index.ts` | `pollReviewStatus()` function and interval |
| `src/lib/cloister/deacon.ts` | Replace `isIdleAtPrompt()` calls with state checks |

## Files to Modify

| File | Changes |
|------|---------|
| `scripts/heartbeat-hook` | Update to report state, write activity log |
| `src/cli/commands/setup/hooks.ts` | Add Stop hook configuration |
| `src/lib/cloister/specialists.ts` | Remove `isIdleAtPrompt()`, add suspend/resume |
| `src/lib/cloister/deacon.ts` | Add idle timeout checking, use state instead of terminal parsing |
| `src/lib/agents.ts` | Add suspend/resume functions, state management |
| `src/dashboard/server/index.ts` | Add heartbeat API endpoint, activity endpoint, remove polling |
| `src/dashboard/frontend/src/components/AgentCard.tsx` | Add activity history, resume button |
| `src/dashboard/frontend/src/components/SpecialistAgentCard.tsx` | Update state display |

## Out of Scope

- Multiple session management per agent
- Remote/distributed agent management
- Historical analytics on agent activity
- Cost tracking per agent
- Agent restart (vs resume) functionality
- Graceful shutdown hooks

## Acceptance Criteria

- [ ] Agents report status via hooks (no terminal parsing)
- [ ] Activity log persists agent actions (last 100 entries)
- [ ] Auto-suspend idle agents after timeout (5 min specialists, 10 min work agents)
- [ ] Resume suspended agents on-demand (manual button)
- [ ] Auto-resume on queued work (specialists) or message (work agents)
- [ ] Dashboard shows activity history for any agent (running or suspended)
- [ ] Clear state distinction: active/idle/suspended/uninitialized
- [ ] Remove all terminal output parsing for status detection
- [ ] API endpoint receives heartbeats in real-time
- [ ] State persists to disk (survives dashboard restart)

## Implementation Order

1. **Hook infrastructure** - Update heartbeat-hook, add Stop hook to settings
2. **State management** - Add state.json read/write, activity log append
3. **API endpoints** - Add heartbeat, activity, suspend, resume endpoints
4. **Auto-suspend** - Add idle timeout checking to deacon patrol
5. **Resume logic** - Implement resume with session ID
6. **Dashboard frontend** - Update cards with new states, activity panel, resume button
7. **Cleanup** - Remove `isIdleAtPrompt()` and all terminal parsing
8. **Testing** - Integration tests for state transitions, suspend/resume

## Testing Notes

- Test state transitions: uninitialized → active → idle → suspended → active
- Test auto-suspend after idle timeout
- Test auto-resume when work is queued
- Test manual resume via dashboard
- Test activity log pruning (should stay at 100 entries max)
- Test dashboard receives real-time heartbeats
- Test state persists across dashboard restart
- Verify no terminal parsing remains in codebase

## References

- [Claude Code Hooks Reference](https://docs.claude.com/en/docs/claude-code/hooks) - Available hook types
- PAN-74 - Queue integration (uses `isIdleAtPrompt()` which this replaces)
- Existing heartbeat hook at `scripts/heartbeat-hook`
