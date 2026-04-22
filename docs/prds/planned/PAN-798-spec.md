# PAN-798: Eliminate All tmux capture-pane Usage

**Status:** Draft / Planning  
**Created:** 2026-04-22  
**Related:** `PAN-798-audit.md`, `PAN-798-pattern-audit.md`

---

## Problem Statement

The codebase shells out to `tmux capture-pane` at 21 call sites across 9 files to extract data that should be available through structured channels. This is:

- **Fragile** — regex-parsing terminal output with ANSI sequences and spinner states
- **Expensive** — one subprocess per read, often polled in loops
- **Blocking** — `capturePaneAsync` shells out synchronously (async wrapper, but still a process spawn)
- **Wrong abstraction** — terminal text is a rendering surface, not a data API

The only legitimate use of historical terminal content is the WebSocket PTY initial snapshot, and even that should be served from an in-memory ring buffer rather than `tmux capture-pane`.

---

## Guiding Principle

**tmux is a rendering surface. Never query it for data.**

All structured state, activity, results, and metadata must flow through:
- `runtime.json` — agent runtime state (already exists, written by hooks)
- JSONL session files — conversation history (already exists, written by Claude Code)
- Event logs / structured output files — specialist results (new, but simple)

---

## Data Flow: Today vs Target

### Today (3 overlapping layers)

```
Agent → tmux pane → capture-pane → regex parsing → consumer
         ↑                                    ↓
    heartbeat JSON (liveness)          SQLite (structured state)
```

### Target (2 layers)

```
Agent → hooks → runtime.json ──┬──→ Dashboard (structured state)
                               ├──→ Deacon (health/stuck detection)
                               └──→ ActivityView (status, activity)

Agent → JSONL session file ────→ Conversation panel (transcript)

Agent → event files ───────────→ Merge queue (git ops, test results)

Agent → PTY byte stream ───────→ WebSocket terminal (live only)
         ↓
    in-memory ring buffer ──────→ WebSocket terminal (snapshot on connect)
```

---

## What Goes Where

### `runtime.json` (extend existing schema)

Already at `~/.panopticon/agents/<id>/runtime.json`. Written by bash hooks on `PostToolUse` / `SessionStart`. Read by Deacon, dashboard, health checks.

**New fields to add:**

| Field | Type | Written by | Replaces |
|-------|------|------------|----------|
| `model` | `string` | SessionStart hook | `workspaces.ts:931` model regex from tmux |
| `activity` | `"bash" \| "read" \| "write" \| "edit" \| "thinking" \| "idle" \| null` | PostToolUse hook | `deacon.ts:851` `isAgentActiveInTmux()` parsing |
| `thinkingSince` | `string (ISO 8601) \| null` | PostToolUse hook (start) / completion hook (clear) | `deacon.ts:978` "Thinking… (Xm Ys)" duration parsing |
| `messageReceived` | `number (sequence)` | PostToolUse hook after stdin read | `tmux.ts:559` `confirmDelivery()` |
| `waitingOnHuman` | `boolean` | Hook when interactive dialog appears | `deacon.ts:985` exclude-from-context dialog detection |

**Existing fields (no change):**
- `state`, `lastActivity`, `currentTool`, `sessionId`, `claudeSessionId` — already drive Deacon, dashboard, health checks

### JSONL Session Files (use existing)

Already at `~/.claude/projects/*/*.jsonl`. Written natively by Claude Code. Contains every tool call, read, write, edit, and result in structured form.

**Replaces:**
- `mission-control.ts:161` ActivityView agent transcript (500 lines)
- `agents.ts:526` agent output endpoint
- `agents.ts:1224` save-before-kill 5000-line capture

**Implementation:** Dashboard renders a human-readable timeline from JSONL instead of raw terminal text. No new file needed.

### Specialist Event Files (new, lightweight)

**`git-events.jsonl`** — written by merge specialist
- One line per git operation: `{"op":"push","ref":"main","remote":"origin","time":"..."}`
- Replaces: `merge-agent.ts:660-666` `captureTmuxOutput()` git pattern scanning

**`test-results.json`** — written by test specialist
- Structured test run summary: `{"passed":42,"failed":3,"skipped":1,"time":"..."}`
- Replaces: `merge-agent.ts:1070-1077` test failure count regex from tmux

### WebSocket Terminal (in-memory ring buffer)

The PTY hub (`ws-terminal.ts`) already accumulates live terminal data in `ptyProcess.onData`. Add a fixed-size ring buffer (e.g., last 500 lines) and serve the snapshot from memory on WebSocket connect.

**Replaces:**
- `ws-terminal.ts:89` `captureFreshSnapshot()` (500 lines from tmux)
- `ws-terminal.ts:101` `captureViewportSnapshot()` (viewport from tmux)

---

## Per-Consumer Migration Plan

### P0 — Remove the worst offenders

#### `src/lib/agents.ts:1224` — `stopAgentAsync()`
**Today:** Captures 5000 lines from tmux and writes to `output.log`.
**Target:** Delete `output.log` entirely. Historical transcript comes from JSONL. If something needs "last output", read `runtime.json.lastOutput` or tail the JSONL.

#### `src/dashboard/server/routes/workspaces.ts:931` — model extraction
**Today:** Regex scrapes model name from tmux output.
**Target:** Write `model` to `runtime.json` at session start. Dashboard reads from there.

### P1 — Deacon health/stuck detection (structured state)

#### `src/lib/cloister/deacon.ts:664` — `checkLazyAgent()`
**Today:** Captures 20 lines, searches for "what would you like me to do", "options:", "stop here".
**Target:** Rely on `runtime.json.state === 'waiting-on-human'` and `runtime.json.waitingReason`. If the agent is asking for direction, the hook should already know.

#### `src/lib/cloister/deacon.ts:851` — `isAgentActiveInTmux()`
**Today:** Captures 5 lines, regex-matches computing/thinking/reading/bash/read/write/edit patterns.
**Target:** Read `runtime.json.activity` directly. PostToolUse hook already knows what tool is active.

#### `src/lib/cloister/deacon.ts:978` — `checkStuckWorkAgents()`
**Today:** Captures 10 lines, parses "Thinking… (Xm Ys)" duration, detects exclude-from-context dialog.
**Target:**
- Thinking duration: compare `Date.now()` against `runtime.json.thinkingSince`. No parsing needed.
- Exclude dialog: `runtime.json.waitingOnHuman` tells us an interactive dialog is blocking.

#### `src/lib/health.ts:93` — `getAgentOutput()`
**Today:** Captures configurable lines for health monitoring.
**Target:** Read `runtime.json.activity` and `runtime.json.state`. Health checks should query structured state, not parse tmux.

#### `src/dashboard/lib/health-filtering.ts:26` — `checkAgentHealthAsync()`
**Today:** Captures 5 lines for quick active/idle check.
**Target:** Read `runtime.json.state` directly.

### P2 — Readiness and delivery (trust hooks, remove fallbacks)

#### `src/lib/tmux.ts:527-553` — `waitForClaudePrompt()`
**Today:** Polls tmux every 500ms for 15s waiting for `❯` prompt.
**Target:** `ready.json` is already written by SessionStart hook. Ensure it fires reliably after every tool use completion. Remove the tmux fallback.

#### `src/dashboard/server/routes/conversations.ts:81-92` — `waitForClaudeReady()`
**Today:** Polls tmux every 500ms for 30s.
**Target:** Same as above — rely on `ready.json` hook.

#### `src/lib/agents.ts:266` — `waitForReadySignal()`
**Today:** Captures 200 lines, fallback when `ready.json` hook not written.
**Target:** Fix PAN-759 (hook reliability root cause). Remove this fallback.

#### `src/lib/tmux.ts:559-599` — `confirmDelivery()`
**Today:** Captures before/after, searches for processing patterns (`●`, `⎿`, `Read`, `thinking`, etc.).
**Target:** Add `messageReceived` sequence number to `runtime.json`. The hook increments it after Claude reads stdin. Senders check the sequence instead of comparing pane text.

#### `src/lib/cloister/specialists.ts:2484,2495` — specialist delivery confirmation
**Today:** Uses `confirmDelivery()` before sending and before retry.
**Target:** Same `messageReceived` sequence approach.

### P3 — Dashboard transcripts (stream from JSONL)

#### `src/dashboard/server/routes/mission-control.ts:161` — ActivityView agent transcript
**Today:** Captures 500 lines for live agent transcript panel.
**Target:** Read and render from JSONL session file. No tmux involvement.

#### `src/dashboard/server/routes/mission-control.ts:297,306` — specialist live output
**Today:** Captures 100 lines for specialist panel.
**Target:** Same — JSONL for transcript, `runtime.json` for status/activity.

#### `src/dashboard/server/routes/agents.ts:526` — agent output endpoint
**Today:** Configurable lines from tmux for log streaming.
**Target:** Stream from JSONL session file.

### P3 — Merge/test structured events

#### `src/lib/cloister/merge-agent.ts:660-666` — `captureTmuxOutput()`
**Today:** Polls tmux, scans for `force-with-lease`, `git push`, `[rejected]`, etc.
**Target:** Merge specialist writes structured git events to `git-events.jsonl` as they happen. Merge agent tails the file.

#### `src/lib/cloister/merge-agent.ts:1017-1022` — `scanGitPatterns()`
**Today:** Scans captured tmux output for git operations.
**Target:** Read from `git-events.jsonl`.

#### `src/lib/cloister/merge-agent.ts:1070-1077` — test failure baseline
**Today:** Regex `Failed\s*│\s*(\d+)\s*│` from tmux.
**Target:** Test specialist writes `test-results.json`.

### P4 — WebSocket terminal (in-memory buffer)

#### `src/dashboard/server/ws-terminal.ts:89` — `captureFreshSnapshot()`
**Today:** Captures 500 lines with ANSI escape sequences from tmux for initial snapshot.
**Target:** Serve from PTY hub in-memory ring buffer.

#### `src/dashboard/server/ws-terminal.ts:101` — `captureViewportSnapshot()`
**Today:** Captures visible viewport from tmux for hub join.
**Target:** Serve from PTY hub current viewport state in memory.

---

## Hook Extensions Required

The existing hook system (bash scripts that write `runtime.json` on `PostToolUse` / `SessionStart`) needs these additions:

### SessionStart hook
- Write `model` field (passed via `--model` arg or config)
- Ensure `ready` state is set reliably

### PostToolUse hook
- Write `activity` based on the tool used (`Bash` → `"bash"`, `Read` → `"read"`, `Write` → `"write"`, `Edit` → `"edit"`, thinking block → `"thinking"`, idle at prompt → `"idle"`)
- If entering a thinking block, set `thinkingSince` to current timestamp
- If exiting a thinking block, clear `thinkingSince` to `null`
- If Claude encounters an interactive dialog (exclude-from-context, etc.), set `waitingOnHuman = true` and `waitingReason = "exclude-from-context"`
- If dialog is dismissed, clear `waitingOnHuman`
- Increment `messageReceived` sequence when Claude reads stdin (this may require a PreToolUse or stdin-read hook — needs validation)

### Hook reliability (PAN-759)
The `ready.json` / `runtime.json` hooks must fire reliably. If they don't, fix the hook system rather than adding tmux fallbacks.

---

## Files to Modify

| Priority | File | Change |
|----------|------|--------|
| P0 | `src/lib/agents.ts` | Remove `output.log` and 5000-line capture; remove `waitForReadySignal()` fallback; add `model` to `runtime.json` |
| P0 | `src/lib/tmux.ts` | Deprecate `capturePaneAsync`; remove `waitForClaudePrompt()` and `confirmDelivery()` |
| P0 | `src/dashboard/server/routes/workspaces.ts` | Read model from `runtime.json` |
| P1 | `src/lib/cloister/deacon.ts` | Replace all captures with `runtime.json` reads; use `activity`, `thinkingSince`, `waitingOnHuman` |
| P1 | `src/lib/health.ts` | Read `runtime.json` instead of tmux capture |
| P1 | `src/dashboard/lib/health-filtering.ts` | Read `runtime.json.state` instead of tmux capture |
| P2 | `src/dashboard/server/routes/conversations.ts` | Remove tmux readiness check; rely on `ready.json` |
| P2 | `src/lib/cloister/specialists.ts` | Use `messageReceived` sequence for delivery confirmation |
| P3 | `src/dashboard/server/routes/mission-control.ts` | Stream ActivityView from JSONL session files |
| P3 | `src/dashboard/server/routes/agents.ts` | Stream agent output from JSONL session files |
| P3 | `src/lib/cloister/merge-agent.ts` | Read git events from `git-events.jsonl`; read test results from `test-results.json` |
| P3 | `src/lib/cloister/specialists.ts` | Merge/test specialists write structured event files |
| P4 | `src/dashboard/server/ws-terminal.ts` | Add in-memory ring buffer to PTY hub; serve snapshots from buffer |
| — | Hook scripts | Extend `runtime.json` writes with new fields |

---

## Interface Changes

### `AgentRuntimeState` (`src/lib/agents.ts:359`)

Add to existing interface:

```typescript
export interface AgentRuntimeState {
  // ... existing fields ...
  model?: string;                    // Model identifier (e.g., "claude-sonnet-4-6")
  activity?: 'bash' | 'read' | 'write' | 'edit' | 'thinking' | 'idle' | null;
  thinkingSince?: string | null;     // ISO 8601 timestamp
  waitingOnHuman?: boolean;          // Interactive dialog blocking
  waitingReason?: string;            // e.g., "exclude-from-context"
  messageReceived?: number;          // Monotonic sequence counter
}
```

---

## Success Criteria

- [ ] Zero calls to `capturePaneAsync()` outside of `src/lib/tmux.ts` itself
- [ ] `capturePaneAsync` deleted from `tmux.ts`
- [ ] All consumers read from `runtime.json`, JSONL session files, or structured event files
- [ ] Dashboard ActivityView renders from JSONL (no tmux)
- [ ] Deacon stuck/health detection reads `runtime.json` (no tmux)
- [ ] WebSocket terminal initial snapshot served from PTY hub in-memory buffer (no tmux)
- [ ] `output.log` eliminated
- [ ] Heartbeat JSON files (`~/.panopticon/heartbeats/*.json`) eliminated — `lastActivity` lives in `runtime.json`

---

## Open Questions / Research Needed

See `PAN-798-research-needed.md` for remaining investigations.
