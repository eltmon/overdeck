# Remote Terminal Visual Bug

## Summary
When viewing remote exe.dev VM terminals in the Overdeck dashboard, status lines (tmux status bar and Claude Code spinner) duplicate and scroll instead of updating in place.

## Affected Scenarios
- **ONLY affects remote SSH connections** (exe.dev VMs)
- Local terminals using node-pty work correctly
- Bug manifests when status lines update rapidly (every ~1 second)

## Visual Symptoms

### Bug Screenshots (terminal-bug-1.png, terminal-bug-2.png)
1. **Status lines print as new lines** instead of updating in place
   - tmux status bar `[planning-0:claude*` appears multiple times
   - Claude Code spinner `Unfurling...` appears on separate lines
2. **Green background bleeds** - ANSI color codes aren't properly terminated
3. **Scrolling/duplicating** - Terminal fills with repeated status content
4. **Numbers appearing in status** - `claude3`, `claude4`, `claude5` etc. showing corruption

### What it looks like:
```
pUnfurling...claude3                    [0,0] "· Per-model cost
pUnfurling...claude4                    [0,0] "· Per-model cost
*pUnfurling...claude5                   [0,0] "· Per-model cost
*pUnfurling...claude6                   [0,0] "· Per-model cost
·pUnfurling...claude*                   [0,0] "· Per-model cost
*pUnfurling...claude7                   [0,0] "· Per-model cost
...repeating endlessly...
```

## Root Cause Hypothesis

### Original Hypothesis: Split Escape Sequences
SSH2 library sends terminal data in small, fragmented chunks that split ANSI escape sequences across multiple network packets. When cursor positioning sequences like `\x1b[<row>;<col>H` (move cursor to position) get split:

1. First packet: `\x1b[30;1` (incomplete - missing `H`)
2. Second packet: `H[planning-0:claude*...`

**However**: xterm.js documentation states the VT100 parser maintains state across `write()` calls, so this shouldn't cause issues.

### New Hypothesis: Async Blob Processing (TESTING)
WebSocket with default `binaryType='blob'` requires async processing via `blob.text()`. This can cause **out-of-order writes** to xterm.js when multiple messages arrive rapidly:

```javascript
// PROBLEMATIC: Messages can arrive out of order
ws.onmessage = async (event) => {
  if (event.data instanceof Blob) {
    const text = await event.data.text();  // ASYNC - order not guaranteed!
    term.write(text);
  }
};
```

**Fix**: Set `binaryType = 'arraybuffer'` for synchronous processing:
```javascript
ws.binaryType = 'arraybuffer';  // Receive as ArrayBuffer, not Blob
ws.onmessage = (event) => {
  if (event.data instanceof ArrayBuffer) {
    term.write(new Uint8Array(event.data));  // SYNC - order guaranteed
  }
};
```

## Technical Details

### Escape sequences affected:
- `\x1b[<row>;<col>H` - Cursor positioning (for status line updates)
- `\x1b[s` / `\x1b[u` - Save/restore cursor position
- `\r` (carriage return) - Claude Code spinner updates

### Why local terminals work:
node-pty does internal buffering that keeps escape sequences intact before emitting data events.

### Why remote terminals break:
SSH2's data events fire with small chunks as network packets arrive. Combined with async Blob processing on the client, this can cause out-of-order writes.

## Fix Attempts

### Attempt 1: setImmediate buffering (INSUFFICIENT)
```typescript
// Only batches data arriving in same event loop tick
// SSH packets can arrive across multiple ticks
if (!flushScheduled) {
  flushScheduled = true;
  setImmediate(flushBuffer);
}
```
**Result**: Still showed corruption during rapid updates.

### Attempt 2: Timer-based buffering (16ms)
```typescript
// Gives time for escape sequences to fully arrive
const FLUSH_INTERVAL_MS = 16; // ~60fps
if (!flushTimer) {
  flushTimer = setTimeout(flushBuffer, FLUSH_INTERVAL_MS);
}
```
**Result**: Still showed corruption during rapid updates.

### Attempt 3: Escape sequence detection
Tried detecting incomplete CSI/OSC sequences and waiting for completion.
**Result**: Still showed corruption - the pattern of corruption doesn't match incomplete sequences.

### Attempt 4: Binary buffer with 50ms timeout (resetting timer)
```typescript
// Accumulate Buffer chunks, reset timer on each new chunk
const FLUSH_INTERVAL_MS = 50;
stream.on('data', (data: Buffer) => {
  dataChunks.push(data);
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(flushBuffer, FLUSH_INTERVAL_MS);
});
```
**Result**: Looks clean when idle, but corrupted during rapid updates.

### Attempt 5: Fixed-interval flushing (16ms, no timer reset)
```typescript
// Don't reset timer - flush regularly even during rapid updates
const FLUSH_INTERVAL_MS = 16;
if (!flushTimer) {
  flushTimer = setTimeout(flushBuffer, FLUSH_INTERVAL_MS);
}
```
**Result**: Still showed corruption during rapid updates.

### Attempt 6: ArrayBuffer binaryType
```typescript
// Client-side fix: Use ArrayBuffer for synchronous processing
const ws = new WebSocket(wsUrl);
ws.binaryType = 'arraybuffer';  // KEY: Prevent async Blob processing

ws.onmessage = (event) => {
  if (event.data instanceof ArrayBuffer) {
    term.write(new Uint8Array(event.data));  // Synchronous write
  }
};
```
**Result**: Still showed corruption - async blob wasn't the issue.

### Attempt 7: Terminal dimension alignment (30 → 29 rows)
```typescript
// Server-side: Changed initial dimensions
let currentCols = 120;
let currentRows = 29;  // Was 30, changed to match xterm.js typical viewport

// Also updated tmux resize command
await execAsync(`ssh -A ${vmName}.exe.xyz "tmux resize-window -t ${sessionName} -x 120 -y 29 ..."`);
```
**Result**: Still showed corruption - dimension mismatch wasn't the only issue.

### Attempt 8: Added tmux resize on client resize
```typescript
// Server-side: When client sends resize, also resize tmux
if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
  sshStream.setWindow(parsed.rows, parsed.cols, 0, 0);
  // Also resize tmux to force status bar reposition
  execAsync(`ssh -A ${vmName}.exe.xyz "tmux resize-window -t ${sessionName} -x ${parsed.cols} -y ${parsed.rows} ..."`);
}
```
**Result**: Still showed corruption - tmux resize wasn't fast enough to prevent issues.

### Attempt 9: Write queue with xterm.js callbacks
```typescript
// Client-side: Sequential write queue ensuring order
const writeQueue: string[] = [];
let isWriting = false;

const processWriteQueue = () => {
  if (isWriting || writeQueue.length === 0) return;
  isWriting = true;
  const data = writeQueue.shift()!;
  term.write(data, () => {
    isWriting = false;
    setTimeout(processWriteQueue, 0);
  });
};

ws.onmessage = (event) => {
  writeQueue.push(dataStr);
  processWriteQueue();
};
```
**Result**: Still showed corruption - write ordering wasn't the issue.

### Attempt 10: Fixed row count in Terminal options
```typescript
// Client-side: Explicit 29 rows to match server
term = new Terminal({
  cols: 120,
  rows: 29,  // Match server's tmux dimensions exactly
  // ...
});
```
**Result**: Still showed corruption - xterm.js reported correct dimensions but bug persisted.

### Attempt 11: Disabled scrollback
```typescript
// Client-side: Disable scrollback buffer entirely
term = new Terminal({
  scrollback: 0,  // DISABLE scrollback completely
  // ...
});
```
**Result**: Initially showed improvement (1 status line), but bug returned after ~10 seconds of activity (2+ lines visible).

### Attempt 12: Combined fixes
All previous fixes applied together:
- ArrayBuffer binaryType (sync processing)
- 29 rows on both server and client
- tmux resize on client resize
- Write queue with callbacks
- Scrollback disabled

**Result**: Bug still persists. Debug logs show escape sequences arriving correctly:
```
DATA: \e[30m\e[42m[planning-0:claude*... [0,0] "✳ Per-model cost brea" 17:34 03-F\e(B\e[m\e[29;1H
```
The `\e[29;1H` cursor positioning is intact, but xterm.js doesn't keep the status bar at visual bottom.

### Attempt 13: scrollToBottom() after each write (INSUFFICIENT)
```typescript
// In write callback, force scroll to bottom after every write
term.write(data, () => {
  // Force scroll to bottom after every write
  // This keeps the viewport aligned with cursor position
  term!.scrollToBottom();

  isWriting = false;
  if (writeQueue.length > 0) {
    setTimeout(processWriteQueue, 0);
  }
});
```
**Result**: Initially appeared to work, but on further testing the bug persists. The status bar was WRAPPING to two lines because tmux was configured for 120 columns but xterm.js fitted to 106 columns.

**Why this didn't fix it**: The scrollToBottom() helped with viewport alignment but didn't address the core dimension mismatch issue.

### Attempt 14: Wait for client dimensions before starting SSH ✅ TESTING
The root cause discovered: **Dimension mismatch at connection time**

**Problem flow**:
1. Server started SSH at hardcoded 120x29
2. Client connected, waited 100ms, then fitted to container (e.g., 106x29)
3. Client sent resize to 106 columns
4. But tmux was already outputting at 120 columns, causing status bar to wrap to 2 lines

**Fix implemented**:
1. Client sends dimensions IMMEDIATELY on WebSocket open (no 100ms delay)
2. Server waits for the first resize message before starting SSH
3. SSH PTY and tmux are created with the client's actual dimensions from the start

```typescript
// Client (XTerminal.tsx): Send dimensions immediately
ws.onopen = () => {
  fit?.fit();  // Fit first
  ws.send(JSON.stringify({ type: 'resize', cols: term!.cols, rows: term!.rows }));  // Send immediately
};

// Server (index.ts): Wait for resize before starting SSH
ws.on('message', (data) => {
  const parsed = JSON.parse(data.toString());
  if (parsed.type === 'resize' && !sshStarted) {
    // First resize message - start SSH with these dimensions
    startSSH(parsed.cols, parsed.rows);
  }
});
```

**Result**: TESTING

## Key Discoveries (After 13 Attempts)

### What We Know Works
- Data arrives intact (escape sequences are not split or corrupted)
- Server sends correct cursor positioning (`\e[29;1H`)
- ArrayBuffer prevents async issues
- Write queue ensures order
- scrollToBottom() helps with viewport alignment

### What We Know Doesn't Work
- Server-side buffering (any delay)
- Client-side write queues
- Dimension matching (29 rows everywhere) - doesn't help if dimensions mismatch at connection time
- Disabling scrollback (helps but doesn't fix)
- scrollToBottom() alone (Attempt 13) - doesn't address dimension mismatch

### Root Cause Identified (Attempt 14)
The issue is **dimension mismatch at connection time**:

1. Server was starting SSH session at hardcoded 120x29 immediately
2. Client fitted to container after connecting (e.g., 106x29 based on container width)
3. Client sent resize to 106 columns, but only after 100ms delay
4. By then, tmux was already outputting at 120 columns
5. Status bar configured for 120 columns wraps to 2 lines in 106-column terminal

### Why Local Terminals Work
node-pty + local tmux run with proper resize handling. The terminal dimensions are synchronized before data flows.

### Why Remote Terminals Break
The connection timing was wrong:
1. WebSocket connects → server immediately started SSH at 120x29
2. Client sends dimensions 100ms later → too late, tmux already outputting at 120 columns
3. Even though resize is sent, the initial burst of output is at wrong width

## Research Findings

### xterm.js documentation
From [xterm.js documentation](https://xtermjs.org/docs/guides/hooks/):
- The VT100 parser maintains state across `write()` calls
- Split escape sequences SHOULD be handled correctly by xterm.js
- Screen updates get halted at chunk borders during heavy data input

### xterm.js issues
From [xterm.js issue #145](https://github.com/xtermjs/xterm.js/issues/145):
- Execute characters don't break parser state

### WebSSH2 project analysis
From [WebSSH2 project](https://github.com/billchurch/webssh2):
- Uses SSH2 + Socket.io + xterm.js (similar stack)
- Has 700+ commits, suggesting stable solution exists

**Key difference**: WebSSH2 sends data immediately without server-side buffering:
```typescript
// WebSSH2 approach - no buffering, immediate emit via Socket.io
stream.on('data', (chunk: Buffer) => {
  socket.emit('ssh:data', chunk.toString('utf8'));
});
```

They also use Socket.io instead of raw WebSocket, which may have different buffering behavior.

## Debugging Steps

### Enable Debug Logging

**Server-side** (terminal output):
```bash
DEBUG_TERMINAL=1 npm run dev
```

**Client-side** (browser console):
```javascript
localStorage.setItem('DEBUG_TERMINAL', '1');
// Refresh the page
```

### Debug Log Output Format

**Server logs** show:
```
[ssh2-debug] SSH-IN #7 len=4095
[ssh2-debug]   DATA: \e[H  \e[1mCurrent State Summary\e(B\e[m...
[ssh2-debug] SEND #3 chunks=3 len=4999
```

**Client logs** show:
```
XTerminal-debug: RECV #7 type=ArrayBuffer len=4999
  DATA: \e[H  \e[1mCurrent State Summary\e(B\e[m...
```

### Access Debug Log History
```javascript
// In browser console
window.terminalDebugLog  // Array of all received messages
window.showTerminalDebug()  // Print all to console
```

## How to Reproduce and Test

### Prerequisites
- Access to exe.dev VM credentials
- Overdeck dashboard running locally (port 3010)

### Test Procedure

1. **Start dashboard with debug logging**:
   ```bash
   cd /Users/eltmon/Projects/panopticon-cli/src/dashboard
   DEBUG_TERMINAL=1 npm run dev
   ```

2. **Enable client debug logging**:
   - Open http://localhost:3010 in browser
   - Open DevTools console (F12)
   - Run: `localStorage.setItem('DEBUG_TERMINAL', '1')`
   - Refresh page

3. **Create a remote planning session**:
   - Go to Board view
   - Find or create issue PAN-105
   - Click to open issue details
   - Toggle "Remote" ON
   - Click "Start Planning"
   - Wait for VM to provision and session to start

4. **Trigger rapid updates**:
   - Once Claude Code starts, let it run (don't interact)
   - Watch for spinner activity and status line updates
   - Observe terminal for corruption

5. **Between tests (IMPORTANT)**:
   **Must abort and clean up before each new test:**

   a. In the dashboard Board view, find the issue card (e.g., PAN-105)
   b. Click the **"Abort"** link on the card
   c. The card expands to show a checkbox "Also delete workspace"
   d. Check the checkbox
   e. Click **"Deep Wipe"** button
   f. Wait for the card to return to "To Do" column (takes a few moments)
   g. Now you can start a new test

   **Alternative**: Use CLI command `pan kill <session-name>`

### What to Look For

**Working correctly**: Status bar updates in place, spinner animates on single line
**Bug present**: Status lines duplicate, scroll, merge with other text

### Comparing Debug Logs

If corruption occurs:
1. Note the message number when corruption appears
2. Check server SEND log at that number
3. Check client RECV log at that number
4. If they match but terminal is corrupted → issue is in xterm.js/write timing
5. If they differ → issue is in WebSocket transport

## Observations

- Corruption appears during **rapid screen updates** (Claude Code spinner, status line refreshes)
- Terminal looks **clean when idle**
- Corruption pattern shows:
  - Lines overlapping
  - Characters missing mid-line
  - Text from different lines merging
- This suggests cursor positioning escape sequences are being misinterpreted or writes are out of order

## Files Involved
- `/src/dashboard/server/index.ts` - SSH2 terminal WebSocket handler (lines ~9435-9530)
- `/src/dashboard/frontend/src/components/XTerminal.tsx` - xterm.js terminal component (lines ~288-365)

## Resolution

**TESTING Attempt 14**: Waiting for client dimensions before starting SSH session.

### Root Cause
Dimension mismatch at connection time. The server was starting SSH at hardcoded 120x29 immediately on WebSocket connection, but the client would only send its actual fitted dimensions (e.g., 106x29) after 100ms. By then, tmux was already outputting content formatted for 120 columns, which wrapped when displayed in 106 columns.

### The Fix (Attempt 14)
1. **Client (XTerminal.tsx)**: Send dimensions IMMEDIATELY on WebSocket open, not after 100ms delay
2. **Server (index.ts)**: Wait for the first resize message before starting SSH session
3. SSH PTY and tmux are created with the client's actual dimensions from the start

```typescript
// Client: Send dimensions immediately
ws.onopen = () => {
  fit?.fit();
  ws.send(JSON.stringify({ type: 'resize', cols: term!.cols, rows: term!.rows }));
};

// Server: Wait for resize before starting SSH
ws.on('message', (data) => {
  if (parsed.type === 'resize' && !sshStarted) {
    startSSH(parsed.cols, parsed.rows);  // Start with client dimensions
  }
});
```

### Why This Should Work
By ensuring the SSH session and tmux are created with the client's actual fitted dimensions from the start, there's no mismatch. The tmux status bar will be formatted for the correct width immediately.

### Files Modified
- `/src/dashboard/frontend/src/components/XTerminal.tsx` - Send dimensions immediately on open
- `/src/dashboard/server/index.ts` - Wait for resize message before starting SSH

## Alternative Approaches (No Longer Needed)

These were considered but the simpler scrollToBottom() fix resolved the issue:

1. ~~Force alternate screen buffer mode~~
2. ~~Disable tmux status bar~~
3. ~~Server-side status bar deduplication~~
4. ~~Use Socket.io instead of raw WebSocket~~
5. ~~Implement custom cursor tracking~~
