---
scope: dev
---
### Agents must be persistent sessions — never one-shot execs

Never spawn agents via one-shot/headless execution (`codex exec`, `claude -p`):
a one-turn command loses lifecycle state and becomes orphaned. Persistent ≠ TUI —
structured transports with resumable sessions (`codex app-server`, PAN-2597)
qualify. If no persistent path is wired for a harness, don't spawn; surface the
blocker.
