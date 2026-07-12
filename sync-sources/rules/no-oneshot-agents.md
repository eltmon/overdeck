---
scope: dev
---
### Agents must be persistent, lifecycle-managed sessions — never one-shot execs

Overdeck agents (work agents and conversations) must run as **persistent
sessions with full lifecycle state**: the dashboard and Deacon can observe
them, deliver follow-up messages, interrupt, pause, resume, and recover them.
Do not spawn agents through one-shot/headless execution (`codex exec`,
`claude -p`, …): a one-turn command exits, loses lifecycle state, and becomes
orphaned.

**"Persistent" does not mean "TUI".** A TUI in a tmux pane is one valid
substrate. A persistent structured-protocol server is equally valid — e.g.
`codex app-server` (JSON-RPC over stdio with resumable threads and
interruptible turns), adopted as the Codex transport in PAN-2597. The ban is
on one-shot execution and lost lifecycle state, not on the absence of a
terminal. Structured transports are in fact preferred where available:
keystroke injection + screen-scraping delivery wedges on large messages
(PAN-2597's conv-795 incident).

For Codex, the current work-agent path records `codexMode: work-tui` in
`src/lib/agents.ts` until PAN-2597 lands; legacy `codex exec` code still
exists in the runtime adapter and must not be used as a fallback for new work
agents.

If no reliable persistent path (TUI or structured) is wired for a harness, do
not spawn that agent. Surface the blocker to the operator instead of silently
falling back to a one-turn command.
