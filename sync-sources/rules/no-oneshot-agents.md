---
scope: dev
---
### Agents must be persistent, lifecycle-managed sessions — never one-shot execs

Overdeck agents must run as persistent sessions the dashboard and Deacon can
observe, message, interrupt, resume, and recover. Never spawn agents through
one-shot/headless execution (`codex exec`, `claude -p`, …) — a one-turn
command exits, loses lifecycle state, and becomes orphaned.

Persistent does NOT mean TUI. A structured-protocol server with resumable
sessions (e.g. `codex app-server`, adopted in PAN-2597) satisfies this rule
just as a tmux TUI does.

If no reliable persistent path is wired for a harness, do not spawn that
agent — surface the blocker to the operator.
