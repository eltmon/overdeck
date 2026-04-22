# tmux capture-pane Usage Audit — Full Report

## Executive Summary

There are **20 call sites** across **9 files** extracting data from tmux scrollback. Every single one can be replaced with structured data sources, file-based hooks, or RPC. The captures fall into **6 categories**: transcript display, readiness detection, delivery confirmation, health/stuck monitoring, model extraction, and terminal streaming.

---

## Category 1: Transcript Display (Dashboard)

### 1. `src/dashboard/server/routes/mission-control.ts:161`
- **Captures**: 500 lines of agent/planning output
- **Used for**: ActivityView dashboard panel showing live agent transcripts
- **Replacement**: Stream from `output.log` (already written by `agents.ts:stopAgentAsync` and append-mode logging). Add a live `tail -f` WebSocket or in-memory stream. The `runtime.json` hook already tracks `lastOutput` per cycle.

### 2. `src/dashboard/server/routes/mission-control.ts:297,306`
- **Captures**: 100 lines of specialist output (review/test/merge agents)
- **Used for**: Specialist live output panel in ActivityView
- **Replacement**: Specialists already write `runtime.json` and heartbeat files. Stream from those or add specialist-specific `output.log` files. The `specialists.ts` module controls specialist lifecycle — add a `specialistOutput` field to the heartbeat or a dedicated log stream.

### 3. `src/dashboard/server/routes/agents.ts:526`
- **Captures**: Configurable lines (default 100) of agent stdout
- **Used for**: GET `/api/agents/:id/output` endpoint for log streaming
- **Replacement**: Read from `output.log` directly. The `stopAgentAsync` already saves full capture to `~/.panopticon/agents/<id>/output.log`. For live agents, stream from an append-mode log file or add `lastOutput` to `runtime.json` heartbeat.

---

## Category 2: Readiness Detection (Claude Prompt Waiting)

### 4. `src/lib/tmux.ts:527-553` — `waitForClaudePrompt()`
- **Captures**: 10 lines every 500ms for 15s
- **Used for**: Blocking until Claude shows `❯` prompt before sending next message
- **Replacement**: Claude Code hooks already write `ready.json` on session start (see `agents.ts:244-274` which already prefers `ready.json`). Extend the hook system to write `ready.json` after every tool use completion, or add a `prompt-ready` heartbeat to `runtime.json`.

### 5. `src/dashboard/server/routes/conversations.ts:81-92` — `waitForClaudeReady()`
- **Captures**: 200 lines every 500ms for 30s
- **Used for**: Waiting for Claude to be ready when spawning new conversation sessions
- **Replacement**: Same as above — rely on `ready.json` hook. The `SessionStart` hook already fires; ensure it fires reliably and remove the tmux fallback.

### 6. `src/lib/agents.ts:266` — `waitForReadySignal()`
- **Captures**: 200 lines
- **Used for**: Fallback when `ready.json` hook not written (PAN-759)
- **Replacement**: Fix the hook reliability issue (PAN-759 root cause). The hook system should be the sole source of truth. The comment already says "fallback" — remove the fallback once hooks are reliable.

### 7. `src/lib/agents.ts:1057` — Agent spawn readiness check
- **Captures**: 200 lines
- **Used for**: Checking if spawned agent shows "bypass permissions on" or "Claude Code" text
- **Replacement**: The `SessionStart` hook writes `ready.json`. If the hook isn't firing, fix the hook. No tmux needed.

---

## Category 3: Delivery Confirmation

### 8. `src/lib/tmux.ts:559-599` — `confirmDelivery()`
- **Captures**: 50 lines before and after sending keys
- **Used for**: Comparing pane state to verify Claude received and started processing a message
- **Replacement**: This is the hardest replacement. Options:
  - **Option A**: Add a `message-received` acknowledgment to `runtime.json` (Claude Code writes a hook after reading stdin)
  - **Option B**: Use `sendKeysAsync` with the `load-buffer` + `paste-buffer` pattern (already in rules) and trust tmux delivery. The 300ms delay in the paste pattern is specifically to ensure delivery.
  - **Option C**: Add a `processing` field to `runtime.json` that Claude sets true when it starts processing input.

### 9. `src/lib/cloister/specialists.ts:2484,2495`
- **Captures**: 50 lines before sending, 50 lines before retry
- **Used for**: Confirming specialist task delivery using `confirmDelivery()`
- **Replacement**: Same as #8. Specialists are Claude Code sessions — they should use the same hook-based acknowledgment. The `specialists.ts` already manages specialist lifecycle; add delivery confirmation to the specialist protocol.

---

## Category 4: Health & Stuck Detection (Deacon)

### 10. `src/lib/cloister/deacon.ts:664` — `checkLazyAgent()`
- **Captures**: 20 lines
- **Used for**: Detecting lazy patterns ("what would you like me to do", "options:", "stop here") when agent is at idle prompt
- **Replacement**: Add `intent` or `status` field to `runtime.json` that Claude Code sets based on its internal state. Lazy patterns indicate Claude is asking for direction — this should be a structured state (`waiting-on-human`, `needs-clarification`) not parsed from text.

### 11. `src/lib/cloister/deacon.ts:851` — `isAgentActiveInTmux()`
- **Captures**: 5 lines (bottom 8 non-blank)
- **Used for**: Checking if agent is actively working (computing, thinking, reading, Bash, Read, Write, Edit, etc.)
- **Replacement**: Claude Code already knows what it's doing. Add `activity` field to `runtime.json` with values: `computing`, `thinking`, `reading`, `bash`, `read`, `write`, `edit`, `idle`. The `PostToolUse` hook can update this after every tool invocation.

### 12. `src/lib/cloister/deacon.ts:978` — `checkStuckWorkAgents()`
- **Captures**: 10 lines
- **Used for**: Parsing "Thinking… (Xm Ys)" duration and detecting exclude-from-context dialog
- **Replacement**:
  - Thinking duration: Add `thinkingSince` timestamp to `runtime.json`. Claude sets it when thinking starts, clears when done.
  - Exclude-from-context dialog: Add `dialogs` array to `runtime.json` with active modal states. Or detect this via the `PostToolUse` hook pattern.

### 13. `src/lib/health.ts:93` — `getAgentOutput()`
- **Captures**: Configurable lines
- **Used for**: Health monitoring — getting recent terminal output
- **Replacement**: Read from `output.log` or `runtime.json.lastOutput`. Health checks should query structured state, not parse tmux.

### 14. `src/dashboard/lib/health-filtering.ts:26` — `checkAgentHealthAsync()`
- **Captures**: 5 lines
- **Used for**: Quick health check — is agent active?
- **Replacement**: Query `runtime.json` `status` field. Already structured, already written by hooks.

---

## Category 5: Model & Metadata Extraction

### 15. `src/dashboard/server/routes/workspaces.ts:931`
- **Captures**: 50 lines
- **Used for**: Extracting model info via regex `[(](?:oai|cx|go)?@?(?:gpt-[0-9.]+...)[^\]]*\]`
- **Replacement**: The model is known at spawn time (passed to Claude Code via `--model` or config). Write `model` to `runtime.json` at session start. Or parse from the agent config file. Never parse from tmux text.

---

## Category 6: Terminal Streaming (WebSocket)

### 16. `src/dashboard/server/ws-terminal.ts:80-91` — `captureFreshSnapshot()`
- **Captures**: 500 lines (configurable via `SNAPSHOT_SCROLLBACK_LINES`) with ANSI escape sequences
- **Used for**: Initial scrollback when client connects to `/ws/terminal` before live PTY stream starts
- **Replacement**: This is the **only legitimate use case** for historical terminal content. Replace with:
  - **Option A**: PTY hub maintains an in-memory ring buffer of last N lines. Serve from buffer on connect.
  - **Option B**: Write scrollback to a rotating log file (`terminal.scrollback.log`) and serve from file.
  - **Option C**: Use `node-pty`'s `onData` handler to accumulate scrollback in memory before the WebSocket attaches.

### 17. `src/dashboard/server/ws-terminal.ts:100-102` — `captureViewportSnapshot()`
- **Captures**: 0 lines (viewport only) with escape sequences
- **Used for**: Capturing visible viewport when joining existing PTY hub
- **Replacement**: Same as #16. The PTY hub knows the current viewport state. Maintain it in memory.

---

## Category 7: Agent Lifecycle (Save Before Kill)

### 18. `src/lib/agents.ts:1224` — `stopAgentAsync()`
- **Captures**: 5000 lines
- **Used for**: Saving full terminal output to `output.log` before killing session
- **Replacement**: This is a **write**, not a read concern. Replace with continuous append-mode logging. Instead of capturing at stop, stream to `output.log` continuously via `tee` or hook-based logging. Then remove this capture entirely.

---

## Category 8: Git Pattern Scanning (Merge Agent)

### 19. `src/lib/cloister/merge-agent.ts:660-666` — `captureTmuxOutput()`
- **Captures**: 50 lines (default)
- **Used for**: Polling loop scanning for git operations in merge specialist output
- **Replacement**: The merge specialist should write structured git events to `runtime.json` or a dedicated `git-events.jsonl` file. Patterns like `force-with-lease`, `git push`, `[rejected]` are events — emit them as events.

### 20. `src/lib/cloister/merge-agent.ts:1017-1022` — `scanGitPatterns()`
- **Captures**: Scans captured tmux output
- **Used for**: Emitting to `git_operations` database table
- **Replacement**: Same as #19. The merge agent should emit structured git events directly, not be parsed from tmux text.

### 21. `src/lib/cloister/merge-agent.ts:1070-1077`
- **Captures**: Specialist output from tmux
- **Used for**: Extracting test failure baseline via regex `Failed\s*│\s*(\d+)\s*│`
- **Replacement**: The test specialist should write structured test results to `test-results.json` or similar. Parse structured data, not tmux text.

---

## Implementation Priority

| Priority | File | Reason |
|----------|------|--------|
| **P0** | `src/lib/agents.ts:1224` | Continuous logging replaces 5000-line capture |
| **P0** | `src/dashboard/server/routes/workspaces.ts:931` | Model is known at spawn time |
| **P1** | `src/lib/cloister/deacon.ts` (all 3) | Health/stuck detection needs structured state |
| **P1** | `src/lib/health.ts:93` | Health checks should use structured data |
| **P1** | `src/dashboard/lib/health-filtering.ts:26` | Same as above |
| **P2** | `src/lib/tmux.ts:527-553,559-599` | Readiness + delivery need hook extensions |
| **P2** | `src/lib/cloister/specialists.ts:2484,2495` | Same as above |
| **P2** | `src/lib/agents.ts:266,1057` | Remove ready.json fallbacks |
| **P2** | `src/dashboard/server/routes/conversations.ts:81-92` | Same as above |
| **P3** | `src/dashboard/server/routes/mission-control.ts` (all 3) | Stream from logs instead |
| **P3** | `src/dashboard/server/routes/agents.ts:526` | Same as above |
| **P3** | `src/lib/cloister/merge-agent.ts` (all 3) | Structured git/test events |
| **P4** | `src/dashboard/server/ws-terminal.ts` (both) | PTY hub in-memory buffer |

---

## Hook Extensions Needed

To fully eliminate `capture-pane`, extend the Claude Code hook system (already writing `runtime.json`, `ready.json`) to include:

1. **`status`**: `active | idle | suspended | stopped | waiting-on-human | thinking | computing`
2. **`activity`**: `bash | read | write | edit | idle | thinking | reading` (what tool is active)
3. **`thinkingSince`**: ISO timestamp when thinking started (null when not thinking)
4. **`dialogs`**: Array of active modal dialogs (`exclude-from-context`, etc.)
5. **`lastOutput`**: Last N lines of output (or path to continuous log)
6. **`messageReceived`**: Boolean/sequence acknowledging last input
7. **`model`**: Model identifier (set once at start)
8. **`gitEvents`**: Stream of git operations (for merge agent)
9. **`testResults`**: Structured test output (for test specialist)

All hooks should write atomically (write temp + rename) to prevent partial reads.

---

## Files to Modify

| File | Changes |
|------|---------|
| `src/lib/agents.ts` | Remove `capturePaneAsync` calls; implement continuous logging; rely on `ready.json` |
| `src/lib/tmux.ts` | Deprecate `capturePaneAsync`; remove `waitForClaudePrompt` and `confirmDelivery` or make them no-ops |
| `src/lib/cloister/deacon.ts` | Replace all captures with `runtime.json` field reads |
| `src/lib/cloister/merge-agent.ts` | Replace captures with structured event emission |
| `src/lib/cloister/specialists.ts` | Replace delivery confirmation with hook acknowledgment |
| `src/lib/health.ts` | Read from `output.log` or `runtime.json` |
| `src/dashboard/lib/health-filtering.ts` | Read `status` from `runtime.json` |
| `src/dashboard/server/routes/agents.ts` | Stream from `output.log` |
| `src/dashboard/server/routes/mission-control.ts` | Stream from logs/structured sources |
| `src/dashboard/server/routes/conversations.ts` | Remove tmux readiness check |
| `src/dashboard/server/routes/workspaces.ts` | Read model from config/hook |
| `src/dashboard/server/ws-terminal.ts` | Add in-memory scrollback buffer to PTY hub |

---

## Final Notes

- **`output.log` is already implemented** for stopped agents. Extend it to live mode with append + flush.
- **`runtime.json` is already written** by hooks. Extend the schema with the fields above.
- **The only hard case** is delivery confirmation (#8, #9). The `load-buffer` + `paste-buffer` + 300ms delay pattern is already reliable per `.claude/rules/async-tmux.md`. Trust tmux delivery; don't verify via capture.
- **PTY hub scrollback** (#16, #17) should maintain an in-memory ring buffer. 500 lines × 200 chars = ~100KB per terminal. Trivial memory cost.
- **Zero capture-pane calls remain** after these changes. The function can be deleted from `src/lib/tmux.ts`.
