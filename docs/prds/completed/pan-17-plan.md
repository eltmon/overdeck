# PAN-17: XTerminal Performance Issues

## Problem Statement

The web terminal component experiences intermittent keystroke lag - keystrokes are delayed or don't register, with a pattern of working for 1-2 seconds then hanging for 1-2 seconds.

## Root Cause Analysis

### Primary Cause: Blocking `execSync` calls

The server uses synchronous `execSync` for tmux/git operations. Combined with aggressive dashboard polling (1-5 second intervals), the Node.js event loop is blocked multiple times per second, causing WebSocket messages (including keystrokes) to queue up.

**Key blocking operations:**
| Location | Operation | Frequency |
|----------|-----------|-----------|
| Line 4101 | `tmux list-sessions` on WS connect | Each terminal open |
| Line 4155 | `tmux resize-window` on resize | Many times/second during resize |
| Line 1026 | `tmux list-sessions` in `/api/agents` | Polled every 3s |
| Line 1086 | `tmux capture-pane` in `/api/agents/:id/output` | Polled every 1s |

### Secondary Cause: No resize debouncing

Frontend `ResizeObserver` triggers resize messages at potentially 60fps during UI movement. Each resize message causes a blocking `execSync` on the server.

**Chain of events:**
1. Container size changes (even slightly)
2. ResizeObserver fires immediately (no debounce)
3. `fit()` called → `term.onResize` fires
4. WebSocket sends resize JSON message
5. Server receives → **blocks on execSync for tmux resize**
6. All other WebSocket messages (keystrokes) queue up
7. Repeat

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | Claude Code prompts only | Other TUI apps can use `tmux attach` workaround |
| Recovery behavior | Auto-reconnect gracefully | Better UX than manual reconnect |
| Observability | Add metrics to `/api/health` | Simple, single endpoint |
| Out of scope | Auth, major UI changes, multi-terminal | Keep focused |

## Solution Architecture

### 1. Convert Terminal-Critical Operations to Async

Replace `execSync` with async `exec` (promisified) for operations that affect terminal responsiveness.

**Priority 1 (Terminal path - MUST fix):**
```typescript
// Before (blocking):
execSync(`tmux resize-window -t ${sessionName} -x ${cols} -y ${rows}`)

// After (non-blocking):
import { exec } from 'child_process';
import { promisify } from 'util';
const execAsync = promisify(exec);

await execAsync(`tmux resize-window -t ${sessionName} -x ${cols} -y ${rows}`)
```

Files:
- Line 4101: `tmux list-sessions` on WebSocket connection
- Line 4155: `tmux resize-window` on resize messages

**Priority 2 (Polling paths - SHOULD fix):**
- Line 1026: `/api/agents` endpoint
- Line 1086: `/api/agents/:id/output` endpoint

### 2. Debounce Resize Messages

Add 200ms debounce to resize handling on frontend.

**Frontend (`XTerminal.tsx`):**
```typescript
// Add debounce utility
function debounce<T extends (...args: any[]) => void>(fn: T, ms: number) {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// Debounce ResizeObserver callback
const debouncedFit = debounce(() => {
  if (wsRef.current?.readyState === WebSocket.OPEN) {
    fitAddon.current?.fit();
  }
}, 200);

const resizeObserver = new ResizeObserver(debouncedFit);
```

### 3. Add Connection Metrics

Extend `/api/health` endpoint:

```typescript
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    connections: {
      websockets: wss.clients.size,
      activePtys: activePtys.size
    }
  });
});
```

### 4. Auto-Reconnect Logic

**Frontend changes:**
- Detect disconnect (WebSocket close/error events)
- Show "Reconnecting..." indicator in terminal
- Exponential backoff retry: 1s → 2s → 4s → 8s → max 30s
- Clear indicator and restore session on successful reconnect
- After 5 failed attempts, show "Connection lost. Click to reconnect." with manual button

## Files to Modify

| File | Changes |
|------|---------|
| `src/dashboard/server/index.ts` | Convert execSync to async for terminal ops, add connection metrics |
| `src/dashboard/frontend/src/components/XTerminal.tsx` | Add resize debouncing, auto-reconnect logic |

## Implementation Order

1. **Debounce resize messages** (quick win, low risk, ~30 min)
2. **Convert terminal-path execSync to async** (main fix, ~1 hour)
3. **Add connection metrics to health** (observability, ~15 min)
4. **Add auto-reconnect** (polish, ~1 hour)

## Testing Strategy

1. **Manual keystroke test**: Type continuously while moving/resizing panels
2. **Resize stress test**: Rapidly resize terminal while typing
3. **Reconnect test**: Stop/start backend while terminal is open
4. **Health endpoint test**: Verify `/api/health` shows connection counts

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Async conversion breaks error handling | Keep try/catch structure, test thoroughly |
| Debounce makes resize feel sluggish | Use 200ms which is imperceptible for most users |
| Auto-reconnect loops on persistent failure | Cap retries at 5, then show manual reconnect |

## Out of Scope (Explicitly)

- Converting ALL execSync calls (too risky for this issue, do incrementally)
- Authentication/security changes
- Major UI changes
- Multiple simultaneous terminal support
- Fixing other TUI apps (vim, less, etc.) - they can use `tmux attach`
