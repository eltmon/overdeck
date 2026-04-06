# 484: WebSocket terminal: multiple tabs cause reconnection loop on same tmux session

## Status: Implementation Complete

## Current Phase
All work done. Awaiting inspection.

## Completed Work
- [x] pan-460-vew: Implement shared PTY hub (PtyHub interface) with WebSocket multiplexing in ws-terminal.ts (commit: TBD)

## Remaining Work
(none)

## Key Decisions
- D1: Option B chosen (shared PTY + WebSocket multiplexing) over Option C (reject second connection)
  because PAN-486 (detachable terminal) will need a second client anyway — Option B is the correct architecture
- D2: Input policy: all clients forward input to PTY
- D3: Dimension policy: first client sets size; any client resize updates PTY
- D4: PTY lifetime: kept alive until last client disconnects

## Specialist Feedback
(none yet)
