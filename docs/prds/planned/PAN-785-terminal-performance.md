# PAN-785: Terminal Session Performance Regression

## Problem

Terminal panels in the dashboard take several seconds to draw, and tmux-based agent interactions (message delivery, specialist handoffs, stuck-agent nudges) feel sluggish. The regression began roughly one week before this PRD was filed and persisted after the PAN-70 / PAN-446 `execSync` cleanup in commit `2e461154`.

Investigation revealed three compounding root causes introduced by commit `fdb591af` ("feat(terminal): route terminal tmux access through managed context") plus a pre-existing flaw in `sendKeysAsync`.

## Goal

Restore terminal attach and tmux interaction latency to pre-regression levels:

- **Cold terminal attach** (no existing hub): WebSocket connect → first live PTY data under ~100 ms on an empty session.
- **Hub-join** (second client to an existing session): first draw under ~200 ms regardless of scrollback depth.
- **Agent prompt delivery** (`sendKeysAsync` with a 100-line prompt): completes in under 500 ms end-to-end.

## Non-Goals

- Rewriting the WebSocket terminal protocol or the `/ws/terminal` hub model.
- Moving off `@homebridge/node-pty-prebuilt-multiarch`.
- Changing the managed tmux socket naming or managed-config content.
- Touching the merge queue or any specialist queue logic.
- Rewriting the xterm.js client write pipeline.
- Reverting `fdb591af` (the intent of that commit — unified managed-context tmux access — is correct; the implementation has fixable defects).

## Root Causes (Verified)

### 1. `ensureManagedTmuxConfig*` thrash on every tmux invocation

**Location:** `src/lib/tmux.ts`

```typescript
// Lines 84-88 (sync) and 90-94 (async):
function ensureManagedTmuxConfigSync(): void {
  ensureManagedTmuxDirSync();
  writeFileSync(getManagedTmuxConfigPath(), MANAGED_TMUX_CONFIG_CONTENT, 'utf-8'); // ALWAYS writes
  reloadManagedTmuxConfigSync();                                                    // 2 tmux spawns
}
```

These functions have no idempotency guard. They write the config file and run `tmux start-server` + `tmux source-file` every call.

They are invoked from:

- **Sync path (blocks Node event loop):** `getTmuxBaseArgs` (line 121) → called by `buildTmuxArgs` (line 127) → called by `buildTmuxCommandString` (line 139) / directly at PTY-spawn sites.
- **Async path (adds latency, no block):** `tmuxExecAsync` (line 144) → called by every `*Async` helper.

Sync-path callers on the server event loop:

- `src/dashboard/server/ws-terminal.ts:275` — `pty.spawn('tmux', buildTmuxArgs(['attach-session', '-t', sessionName]), ...)`
- `src/dashboard/server/services/terminal-service.ts:137` — Bun branch PTY spawn
- `src/dashboard/server/services/terminal-service.ts:152` — Node-pty branch PTY spawn
- `src/dashboard/server/routes/agents.ts:747-759` — answer-question `send-keys` chain (7 calls via `buildTmuxCommandString`)
- `src/lib/cloister/deacon.ts:992,1027,1031` — stuck-agent Escape + Ctrl-C nudges

Per terminal attach, the chain runs:

1. `listSessionNamesAsync` → async prep (mkdir + write + 2 tmux spawns) + 1 actual tmux spawn
2. `captureSnapshot`:
   - `resizeWindowAsync` → 3 spawns + 1 write
   - `capturePaneAsync` → 3 spawns + 1 write
3. Wait for client `ready`
4. `sessionExistsAsync` → 3 spawns + 1 write
5. `pty.spawn('tmux', buildTmuxArgs([...]))` — **sync prep blocks the event loop**: 2 tmux spawns + 1 `writeFileSync`, then the PTY process itself

Total: ~15 tmux subprocess spawns + 5 file writes per terminal attach, with 2 spawns + 1 file write on the blocking path.

### 2. 5000-line escape-coded snapshot on every attach

**Location:** `src/dashboard/server/ws-terminal.ts:50-53`

```typescript
async function captureSnapshot(sessionName: string, cols: number, rows: number): Promise<string> {
  await resizeWindowAsync(sessionName, cols, rows).catch(() => {});
  return capturePaneAsync(sessionName, 5000, { escapeSequences: true });
}
```

Called for **every** WebSocket attach, including the hub-join path (`ws-terminal.ts:180`) where the PTY is already actively streaming to other clients. The server waits for `capture-pane -p -e -S -5000` to complete, serializes the result to JSON inside a control frame, and transmits it before the client sends `ready`. Only after the client writes the entire snapshot does it unblock live data.

For a busy agent session (e.g., a verbose Claude Code conversation) this snapshot is commonly several megabytes of escape-coded text. Sending megabytes per attach dominates the perceived draw latency.

`resizeWindowAsync` inside `captureSnapshot` fires unconditionally — even when the requested dimensions already match the current tmux window size, triggering an unnecessary SIGWINCH and pane re-layout.

### 3. `sendKeysAsync` per-line buffer + 50 ms sleep

**Location:** `src/lib/tmux.ts:352-385`

```typescript
export async function sendKeysAsync(sessionName: string, keys: string, caller?: string): Promise<void> {
  // ...
  const lines = keys.split('\n');
  if (lines.length > 1) {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.length > 0) {
        await setAndPasteBuffer(sessionName, lines[i]!, `${sendId}-${i}`);  // set + paste + 50ms + delete
      }
      if (i < lines.length - 1) {
        await tmuxExecAsync(['send-keys', '-t', sessionName, 'S-Enter']);
      }
    }
    await new Promise(r => setTimeout(r, 300));
    await tmuxExecAsync(['send-keys', '-t', sessionName, 'C-m']);
  } else {
    // single-line path
  }
}
```

Each line triggers `setAndPasteBuffer`, which is itself `set-buffer` + `paste-buffer` + 50 ms sleep + `delete-buffer`. For a 100-line prompt this is:

- 100 × (3 tmux calls + 50 ms sleep) + 99 × `S-Enter` + final `C-m`
- Each tmux call pays the `ensureManagedTmuxConfigAsync` tax (~3 spawns + 1 write)
- Approximately 500 tmux subprocesses, 100 file writes, and 5 s of deliberate sleeping

The sync `sendKeys` function two entries above this one (line 391-404) demonstrates the correct pattern: write the full payload to a temp file, `load-buffer`, `paste-buffer`, settle, `send-keys C-m`. Claude Code (and standard shells behind tmux paste-buffer) interpret the embedded newlines correctly — there is no need to send `S-Enter` per line. The async version's per-line decomposition was unnecessary.

## Fixes

### Fix 1 — Make tmux argument builders pure

Remove `ensureTmuxContextPreparedSync` from `getTmuxBaseArgs` and `ensureTmuxContextPreparedAsync` from `tmuxExecAsync` / `tmuxExecSync`. The argument-builders become pure functions that return `['-L', 'panopticon', '-f', <configPath>, ...args]`.

Prep runs exactly once per process lifetime via an awaited call from `src/dashboard/server/main.ts` before `server.listen`:

```typescript
// main.ts, before server startup
import { ensureManagedTmuxContextOnce } from './lib/tmux.js';
await ensureManagedTmuxContextOnce();
```

A module-level `let tmuxContextPrepared = false` flag in `tmux.ts` guards `ensureManagedTmuxConfigSync` / `ensureManagedTmuxConfigAsync` so that any incidental caller during tests or CLI use is still idempotent. After the first call, the prep is a boolean check.

CLI commands (which run in their own short-lived process) continue to work: the first tmux call they make will trigger the guarded init exactly once.

### Fix 2 — Drop the redundant per-call `source-file`

Every tmux invocation already passes `-L panopticon -f <configPath>`. The tmux server reads the config on first connect to that socket. The explicit `source-file` only matters for the edge case of a pre-existing `panopticon` socket server inherited from a previous process, so it runs exactly once during startup init. Per-call `source-file` is deleted.

`start-server` is also idempotent and unnecessary as a separate step — the first real tmux command against the socket starts the server automatically. Keep the explicit `start-server` only inside the one-time init if we want clear error surfacing for "tmux not installed".

### Fix 3 — Rewrite `captureSnapshot`

Two targeted changes in `src/dashboard/server/ws-terminal.ts`:

**Hub-join path (line 174 onward):** Do not call `captureSnapshot`. The existing PTY is the source of truth and is actively streaming. Send a lightweight `size` control frame with the current hub dimensions so the client can resize, then broadcast live data straight away. The existing client-side `reset()` on connect already clears stale buffer; xterm.js will repaint from the first live data chunk forward.

**Fresh attach path (line 308):** Cap the snapshot at 500 lines (configurable via `PANOPTICON_TERMINAL_SNAPSHOT_LINES`, default 500). Keep `-e` because the client relies on escape-coded color/styling; the regression is scrollback size, not escape processing. 500 lines at typical density is tens of KB, not MB.

### Fix 4 — Skip `resizeWindowAsync` when dimensions already match

Query current window dimensions (`tmux display-message -p -t <session> '#{window_width}x#{window_height}'`) or track them on the hub and skip `resizeWindowAsync` when the requested size equals the current size. Extract a single `ensureWindowSize(sessionName, cols, rows)` helper for the attach and resize paths to share.

### Fix 5 — Rewrite `sendKeysAsync` to match `sendKeys`

Replace the per-line split with the single-paste pattern used by the sync version:

```typescript
export async function sendKeysAsync(sessionName: string, keys: string, caller?: string): Promise<void> {
  logSendKeys(sessionName, keys, caller);
  const tmpFile = join(tmpdir(), `pan-sendkeys-${process.pid}-${Date.now()}-${randomId()}.txt`);
  try {
    await writeFile(tmpFile, keys, 'utf-8');
    await tmuxExecAsync(['load-buffer', tmpFile]);
    await tmuxExecAsync(['paste-buffer', '-t', sessionName]);
    await new Promise(r => setTimeout(r, 300));
    await tmuxExecAsync(['send-keys', '-t', sessionName, 'C-m']);
  } finally {
    await unlink(tmpFile).catch(() => {});
  }
}
```

Total: 3 tmux subprocess spawns + 1 temp file regardless of line count. The `randomId()` in the tmp filename preserves the collision-avoidance work from commits `5bc15ff7`, `eda45724`, `12055034`, `1285b9b9`.

`setAndPasteBuffer` is deleted.

## Implementation Order

The fixes are largely independent, but the cleanest order is:

1. **Fix 1 + Fix 2 together** (`src/lib/tmux.ts` + `src/dashboard/server/main.ts`). One commit. This alone removes the majority of the per-terminal-attach overhead.
2. **Fix 5** (`src/lib/tmux.ts`). Standalone. Cleanest change.
3. **Fix 3 + Fix 4 together** (`src/dashboard/server/ws-terminal.ts`). One commit. Tightly coupled to the snapshot/resize flow.

Each commit should pass typecheck + lint + tests before moving to the next.

## Code Changes Summary

### Delete

- `setAndPasteBuffer` helper in `src/lib/tmux.ts`
- `captureSnapshot` call in the hub-join branch of `ws-terminal.ts`
- Unconditional `resizeWindowAsync` inside `captureSnapshot`
- `source-file` call from per-tmux-call path

### Modify

- `src/lib/tmux.ts` — `ensureManagedTmuxConfig{Sync,Async}` gated by module flag; `getTmuxBaseArgs` / `tmuxExecAsync` / `tmuxExecSync` stop calling ensure; `sendKeysAsync` rewritten.
- `src/dashboard/server/main.ts` — `await ensureManagedTmuxContextOnce()` before `server.listen`.
- `src/dashboard/server/ws-terminal.ts` — `captureSnapshot` caps at 500 lines and only runs on fresh attach; hub-join sends `size` frame and begins streaming; `resize-window` only on dimension delta.

### Add

- `ensureManagedTmuxContextOnce()` exported from `src/lib/tmux.ts` (explicit one-shot init hook).
- `ensureWindowSize()` helper (no-op when already at target size).
- `PANOPTICON_TERMINAL_SNAPSHOT_LINES` env var (default 500).

## Acceptance Criteria

Functional:

1. `buildTmuxArgs`, `buildTmuxCommandString`, `tmuxExecAsync`, `tmuxExecSync`, and `getTmuxBaseArgs` have zero filesystem or child-process side effects. Verified by a unit test that spies on `fs` and `child_process`.
2. Managed tmux context is prepared exactly once per server process: config file written once, `source-file` called at most once. Verified by a regression test that invokes 100 tmux helpers and asserts spy counts.
3. Hub-join (second client to an existing tmux session) does not call `capture-pane`. Verified by spying on `capturePaneAsync` during the hub-join path.
4. `resizeWindowAsync` / `ensureWindowSize` is skipped when requested dimensions equal current dimensions. Verified by unit test.
5. `sendKeysAsync` issues exactly 3 tmux subprocess spawns per invocation regardless of input line count. Verified by spying on `tmuxExecAsync`.
6. Existing tmux / terminal / `sendKeysAsync` test suites pass unmodified in behavior (tests may be updated for new implementation details, but external contracts hold).

Performance (measured on reference hardware, captured in PR description):

7. Cold terminal attach (empty session, 120×30 viewport): WS open → first PTY data byte under 100 ms p50, under 200 ms p95.
8. Hub-join attach: WS open → first visible paint under 200 ms p50 regardless of pre-existing scrollback depth.
9. `sendKeysAsync` with 100-line payload (~5 KB): completes in under 500 ms p50.
10. No observable regression in the existing "terminal bleeding" / "stale cursor" behavior guarded by commits `b915e52f`, `b70f50bc`, `d1cc7ee9`, `c02ad584`, `7512d134`, `05a78006`, `54684989`, `78585a76`, `04ca349c`, `4ade0274`, `2962c557`, `73a1985a`.

Quality gates:

11. `npm run typecheck` passes.
12. `npm run lint` passes.
13. `npm test` passes (root + frontend).
14. Manual smoke: open dashboard, click through 5 agent terminals cold, verify each draws without perceptible lag; tear down and rejoin to confirm hub-join path.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Hub-join without snapshot misses critical early-state context the user needs | Client already does `term.reset()` on connect; live PTY data includes full-screen redraws (tmux status line, prompt). If a problem surfaces, re-add a capped (e.g., 200-line) snapshot for hub-join only. |
| Removing per-call `source-file` misses config reloads if the content ever changes at runtime | Managed config is static (`MANAGED_TMUX_CONFIG_CONTENT` is a constant). If dynamic config is ever needed, add an explicit `pan tmux reload-context` CLI command that re-runs the init hook. |
| Reducing scrollback from 5000 to 500 truncates useful history when the user is reviewing an old agent | tmux still retains its own scrollback via mouse scroll. 500 lines covers the visible viewport + a comfortable scrollback window on first attach. Env var allows tuning without a release. |
| `sendKeysAsync` payload with null bytes or binary corrupts temp file | Callers only pass UTF-8 text. Add an input validation check that rejects non-UTF-8 with a clear error. |
| Race between temp-file creation and `load-buffer` on very fast calls | `process.pid + Date.now() + random` is the same scheme validated in the sync path and in `sendKeysAsync`'s own earlier collision fixes. |

## Out of Scope / Follow-ups

- Consider caching `capture-pane` output with a short TTL (e.g., 500 ms) to deduplicate rapid reconnects from a single client. Defer — measure first.
- Consider moving snapshot transmission to binary framing to skip JSON serialization overhead. Defer — the line-count cap makes this unnecessary.
- Audit other helpers that may also pay the `ensureManagedTmuxConfigAsync` tax (`listPaneValuesAsync`, `createSessionAsync`, etc.). After Fix 1, they all become cheap automatically.

## References

- Issue: https://github.com/eltmon/panopticon-cli/issues/785
- Regression commit: `fdb591af` (feat(terminal): route terminal tmux access through managed context)
- Pre-regression benchmark: commits prior to `fdb591af` on 2026-04-13
- Related prior work: PAN-70 (execSync cleanup), PAN-446 (sync FS cleanup in server routes)
- Snapshot protocol: `73a1985a` (fix: replace terminal attach heuristics with deterministic snapshot protocol)
