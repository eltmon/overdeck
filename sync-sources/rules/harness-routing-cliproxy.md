---
scope: dev
---
### Harness routing: never override `--harness` ad hoc — the resolved config routing wins

When spawning ANY agent (work, strike, plan, conversation), do NOT pass `--harness` (or
`--model`) to override the resolved routing unless the operator explicitly asked. Routing is
config-owned: `providers.<name>.harness` in `~/.overdeck/config.yaml` overrides the code
default (`src/lib/providers.ts`), and the operator sets it deliberately — e.g. since
2026-07-16 `openai.harness: claude-code` is an intentional operator choice (codex harness
regressions), not a mistake to "fix" back to codex.

Claude-code + CLIProxy for GPT/kimi models is **supported** when configured: the PAN-1865
"200k-window illusion" deadlock is mitigated by PAN-2441 — launchers export
`CLAUDE_CODE_AUTO_COMPACT_WINDOW=<model window>` (150000 for gpt-5.6 family) for every
non-Anthropic model, in both agent and conversation spawns. Do not cite PAN-1865 as a reason
to reroute; if a claude-code+CLIProxy session stalls while the dashboard is healthy, capture
pane + transcript + `~/.overdeck/cliproxy/cliproxy.log` as NEW evidence instead (2026-07-16
lesson: an event-loop-starved server mimicked a harness wedge and cost an afternoon).

This stays orchestrator-knowledge, deliberately NOT enforced in `resolveHarness`.
