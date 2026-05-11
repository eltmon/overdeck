# Coding-Agent Harnesses

Panopticon supports two **coding-agent harnesses** — the underlying CLI that drives a workspace agent. The harness is the binary in tmux; the **model** is what the binary calls. They're picked independently per spawn.

| Harness | Binary | Default for | Notes |
| --- | --- | --- | --- |
| `claude-code` | [Anthropic Claude Code](https://github.com/anthropics/claude-code) | All workflows | Default if you don't pick. Required for Anthropic-subscription users. |
| `pi` | [Pi Coding Agent](https://github.com/badlogic/pi-mono) | Multi-provider work, large workspaces | Adds Pi-style RPC over a named pipe; reads `~/.claude/skills` for skill parity. |

---

## 1. Supported harnesses

### Claude Code (default)
- Shipped by Anthropic; Panopticon installs no special integration — drop in `claude` and run.
- Works with both subscription auth (Claude Code OAuth) and API-key auth.
- All role runs (`plan`, `work`, `review`, `test`, `ship`) default here.

### Pi (alternative)
- Adds RPC mode (`pi --mode rpc`) so Panopticon can write structured commands to Pi's stdin via a named pipe (`mkfifo` at `~/.panopticon/agents/<agentId>/rpc.in`).
- Vendored extension at `packages/pi-extension/` reports lifecycle events: `session_start` writes a `ready.json`, `tool_execution_end` updates a heartbeat, and a `/pan-done` slash command writes a completion marker.
- Multi-provider — drives Anthropic, OpenAI, Google, OpenRouter, Minimax through Pi's own provider routing.

---

## 2. Installing Pi

Pi is **not** auto-installed. Install it once, then run `pan doctor` to confirm.

```bash
npm install -g @mariozechner/pi-coding-agent
# or — install from the pi-mono repo:
#   git clone https://github.com/badlogic/pi-mono && cd pi-mono && ./install.sh

pan doctor                 # confirms `pi` is on PATH and reports the version
pan doctor --strict        # exits non-zero if Pi is missing (good for CI)
```

`pan doctor` also checks that `packages/pi-extension/dist/index.js` exists in the Panopticon workspace. If it doesn't, run:

```bash
cd packages/pi-extension && npm run build
```

The minimum supported Pi version is pinned in `src/cli/commands/doctor.ts` (`SUPPORTED_PI_VERSION_MIN`); upgrade Pi if `pan doctor` reports it as too old.

After installing Pi, run `pan sync` once. Panopticon writes `~/.pi/agent/settings.json` with a `skills` array pointing at `~/.claude/skills` so Pi loads the same skill tree Claude Code does. Existing keys in `settings.json` are preserved.

---

## 3. Where you pick the harness

The harness is chosen **per spawn** at four user-initiated surfaces:

| Surface | How |
| --- | --- |
| Plan kickoff (start-planning) | Harness/model picker in the kickoff dialog. |
| Work agent start (CLI) | `pan start <ISSUE> --harness pi --model <id>`. Default is `claude-code`. |
| Work agent start (Dashboard) | "Start" button menu lets you pick harness + model before launch. |
| Conversation panel | Harness/model selector at the top of the panel. |

There is **no per-issue lock** — an issue planned with Pi can have a Claude Code review agent on the same PR, and vice versa.

### Role runs (plan / work / review / test / ship)
Pipeline-spawned roles do **not** prompt at runtime. They read per-role harness + model defaults from the dashboard Settings page. Add a `harness` selector next to each role's model dropdown to mix and match. Sub-roles such as `work.inspect` and `review.security` inherit from the parent role unless configured more specifically.

---

## 4. ToS rules

There is exactly **one blocked combination**, gated by `canUseHarness(harness, model, authMode)` in `src/lib/harness-policy.ts`:

> **Blocked:** `pi` + Anthropic model + Anthropic auth = `subscription`

This is required by the Claude Code subscription terms — only the `claude-code` binary may invoke Anthropic models when you're authenticated via the Claude Code OAuth subscription. Everything else is allowed:

| Harness | Model provider | Anthropic auth mode | Allowed? |
| --- | --- | --- | --- |
| claude-code | any | any | ✅ |
| pi | non-Anthropic (OpenAI/Google/OpenRouter/Minimax/...) | any | ✅ |
| pi | Anthropic | API key | ✅ |
| pi | Anthropic | subscription | 🚫 |
| pi | Anthropic | unset (no Anthropic auth) | ✅ |

The gate is evaluated at every spawn entry point and at every picker UI so a stale Settings selection cannot bypass it. When the pipeline routes a role run into the blocked cell, it falls back to `claude-code` and emits a `console.warn` rather than failing the whole pipeline.

### Auth mode is exclusive
Anthropic auth is exclusively subscription **or** API key, never both. If you log into the Claude Code subscription, Panopticon ignores any `ANTHROPIC_API_KEY` in the environment. This is existing behavior reaffirmed for Pi — set one or the other, not both.

---

## 5. Troubleshooting

### "Pi not on PATH" or wrong version
Run `pan doctor`. The Pi check reports OK / missing / too-old with the resolved version. The fix message includes the install/upgrade command.

### Pi spawns but the agent never reaches "ready"
Check `~/.panopticon/agents/<id>/ready.json` — the vendored extension writes this on `session_start`. If it never appears:
1. Confirm `packages/pi-extension/dist/index.js` exists (`pan doctor` will warn).
2. Tail the tmux session: `tmux -L panopticon attach -t agent-<id>`. Pi prints stdout to the pane; structural errors show up there.
3. Verify the named pipe exists at `~/.panopticon/agents/<id>/rpc.in`. If a stale regular file is in its place, `createPiFifo` replaces it on next spawn.

### Pi heartbeat is stale but the agent is working
`PiRuntime.getHeartbeat()` walks three sources in priority order: active heartbeat (<60s old) → JSONL session mtime → tmux session created timestamp. If your dashboard shows a stale heartbeat, check `~/.panopticon/heartbeats/<id>.json` — Pi writes there on every `tool_execution_end`.

### End-to-end smoke test
A full Pi spawn smoke (spawn → ready → prompt via fifo → tool execution → completion → cost parsed → resume) is tracked under workspace-w1o0 and requires a real Pi binary on PATH. When implemented, it will live at `src/lib/runtimes/__tests__/pi-e2e.test.ts` gated behind `PAN_E2E=1` so default CI runs stay green on machines without Pi installed. Until then, the unit tests in `src/lib/runtimes/__tests__/pi.test.ts` and `packages/pi-extension/src/__tests__/index.test.ts` cover the individual lifecycle signals; you can also smoke the full path manually with `pan start <ISSUE> --harness pi` once Pi is installed.

---

## 6. Tradeoffs

### RPC over named pipe vs tmux paste-buffer
Pi's harness uses a per-agent `mkfifo` (`~/.panopticon/agents/<id>/rpc.in`) for command delivery. Claude Code uses tmux's `load-buffer` + `paste-buffer` pattern. The fifo path:
- skips the 300ms paste-render wait Claude Code needs;
- gives Pi its own structured RPC channel separate from the visible tmux pane;
- keeps the agent inside tmux for crash isolation and visual attach (Pi's stdout still flows into the pane).

The downside: a reader-less fifo throws `ENXIO` immediately, so `writePiCommand` returns a typed `PiNotReady` error and the runtime adapter recycles the agent rather than blocking on the open call.

### Multi-provider via Pi vs CLIProxy
Both Pi (with native multi-provider routing) and Claude Code (via the CLIProxy auth shim) can drive non-Anthropic models. Pi gives you provider routing without an extra middleware process; CLIProxy gives you Claude Code's tooling/UX with non-Anthropic providers. Pick by which UX you want — there is no correctness difference today.

### When to pick which
- **Default to `claude-code`** for Anthropic-subscription users and for roles whose instructions rely on Claude Code agent definitions.
- **Switch to `pi`** when you need a non-Anthropic provider, when you want Pi's compact-context behavior, or when you're driving a long-running session where the named-pipe RPC is materially faster than paste-buffer delivery.
- **Mix per role** in Settings if you want, e.g., a Pi work role feeding a Claude Code review role.

---

## See also

- `src/lib/runtimes/pi.ts` — `PiRuntime` (AgentRuntime adapter for Pi)
- `src/lib/runtimes/pi-fifo.ts` — `createPiFifo`, `writePiCommand`, `PiNotReady`
- `src/lib/cost-parsers/pi-parser.ts` — Pi v3 JSONL active-branch walker
- `src/lib/harness-policy.ts` — `canUseHarness` ToS gate
- `packages/pi-extension/` — vendored lifecycle extension Pi loads via `--extension`
