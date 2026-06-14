---
scope: dev
---
### Work agents must be live sessions, never one-shot execs

Panopticon work agents must run as persistent, attachable TUI sessions. Do not
spawn work agents through one-shot/headless execution. For Codex, the current
work-agent path records `codexMode: work-tui` in `src/lib/agents.ts`; legacy
`codex exec` code still exists in the runtime adapter and must not be used as a
fallback for new work agents.

If a reliable persistent TUI path is not wired for a harness, do not spawn that
agent. Surface the blocker to the operator instead of silently falling back to a
one-turn command that exits, loses lifecycle state, and becomes orphaned.
