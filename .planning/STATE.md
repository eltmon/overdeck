# PAN-406: Workspace detail — replace polling logs with live interactive terminal

## Decision Record

### Problem
The workspace detail TerminalPanel polls `/api/agents/{id}/output` every 1s and renders plain text in a `<pre>` tag. Users see delayed output with frozen timers and no interactivity. Meanwhile, the planning dialog uses `XTerminal` (xterm.js + WebSocket PTY) for rich real-time terminal — same tmux sessions, different frontend component.

### Approach
Replace the polling-based log rendering in `TerminalPanel.tsx` with `XTerminal` for running agents. Keep the existing polling fallback for stopped agents (no tmux session to attach to).

### Key Decisions
1. **Scope: TerminalPanel only** — AgentOutputPanel (sidebar) stays as-is; it serves specialist log viewing, different use case
2. **Stopped agent fallback**: Show static last output from `/api/agents/{id}/output` as read-only text (existing behavior)
3. **Remove Status tab**: Inspector panel already shows agent status — the tab is redundant
4. **Remove send-message input**: XTerminal is fully bidirectional — typing goes through the PTY directly
5. **Session name**: `agent.id` IS the tmux session name (e.g., `agent-pan-406`), pass directly to XTerminal

### Architecture
```
DetailPanelLayout
├── InspectorPanel (unchanged)
└── TerminalPanel
    ├── Running agent → XTerminal(sessionName={agent.id})
    └── Stopped agent → Static <pre> output (polling fetch, same as today)
```

### Files Modified
- `src/dashboard/frontend/src/components/TerminalPanel.tsx` — primary change: swap polling `<pre>` for XTerminal, remove Status tab, remove send-message UI

### What's NOT Changing
- `XTerminal.tsx` — no modifications needed, it's ready to use
- `ws-terminal.ts` — server WebSocket endpoint already handles all agent sessions
- `AgentOutputPanel.tsx` — out of scope (sidebar specialist logs)
- `DetailPanelLayout.tsx` — no changes needed, it already renders TerminalPanel
- `InspectorPanel.tsx` — no changes needed
