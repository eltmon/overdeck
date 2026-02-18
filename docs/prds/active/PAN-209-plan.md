# PAN-209: Mouse scroll in planning dialog scrolls chat input instead of agent output

## Problem

In the PlanDialog's web terminal (XTerminal component), mouse wheel scroll events are forwarded to the tmux session, which passes them to Claude Code's TUI. Claude Code's input area captures the scroll instead of the agent output scrolling. The user expects scroll wheel to navigate the output history, just like a regular terminal emulator.

## Root Cause

1. **`scrollback: 0`** in XTerminal.tsx (line 220) — xterm.js has no local scrollback buffer, so there's nothing for it to scroll through
2. **tmux mouse tracking** — tmux has `set -g mouse on`, so xterm.js forwards mouse events (including wheel) as escape sequences to tmux
3. **Alternate screen mode** — Claude Code is a TUI that runs in alternate screen buffer, so tmux forwards scroll events to Claude Code instead of entering copy-mode
4. **Claude Code handles the scroll** — Claude Code's input area receives the scroll events and scrolls its own content

## Investigation: `scrollback: 0` History

`scrollback: 0` was set in commit `2282e69` (Feb 3, 2026) as part of a 14-attempt effort to fix a remote terminal visual corruption bug (tmux status bar duplication). The research shows:

- **`scrollback: 0` was Attempt 11** — it "initially showed improvement but the bug returned after ~10 seconds"
- **The ACTUAL fix was Attempt 14** — waiting for client dimensions before starting the SSH session (preventing a 120-col vs actual-col mismatch)
- `scrollback: 0` was left as a defensive "belt-and-suspenders" measure but is NOT the primary fix
- Other fixes committed alongside it (dimension sync, write queue, scroll-to-bottom) remain in place

**Conclusion**: Re-enabling scrollback should be safe. The real fix (Attempt 14) is independent.

## Approach

### Single-file change: `src/dashboard/frontend/src/components/XTerminal.tsx`

**1. Re-enable scrollback buffer**
- Change `scrollback: 0` to `scrollback: 5000`
- This gives xterm.js a local buffer for scroll history

**2. Intercept wheel events**
- Add a `wheel` event listener on the terminal container
- `event.preventDefault()` + `event.stopPropagation()` to prevent xterm.js from forwarding scroll events to tmux as mouse escape sequences
- Manually adjust xterm.js viewport scroll position using `terminal.scrollLines()` based on wheel delta

**3. Smart auto-scroll**
- Currently `scrollToBottom()` fires after every write (attempt 13 leftover), which would fight user scrolling
- Change to: only auto-scroll if the viewport is already at the bottom
- Use xterm.js buffer state to detect if user has scrolled up (`buffer.active.baseY + buffer.active.viewportY < buffer.active.baseY`)

### Files Modified
- `src/dashboard/frontend/src/components/XTerminal.tsx` — 1 file, ~20-30 lines changed

### Risk Assessment
- **Low risk**: The status bar fix (Attempt 14) is independent of scrollback setting
- **Regression check**: Verify remote terminal status bar doesn't duplicate after change
- **Fallback**: If status bar issue returns, scrollback can be reduced or the wheel interceptor can be adjusted without reverting to 0

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Re-enable scrollback | Yes | Attempt 14 was the real fix, not scrollback: 0 |
| Scrollback size | 5000 lines | Good balance of history vs memory |
| Auto-scroll behavior | Smart (only if at bottom) | User requested; prevents snapping away from read position |
| Wheel event handling | Intercept + manual scroll | Prevents forwarding to tmux/Claude Code |
| Scope | XTerminal.tsx only | All changes are in the terminal component |

## Out of Scope
- tmux configuration changes
- Claude Code TUI scroll behavior
- Server-side WebSocket changes
- Other dialog scroll issues
