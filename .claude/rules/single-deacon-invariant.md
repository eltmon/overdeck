## Single Deacon Invariant — Never Mount `~/.panopticon` Into Workspace Containers

Only one Deacon may run at a time per `~/.panopticon` state directory. Mounting
`${HOME}/.panopticon` into a workspace devcontainer that also runs
`dist/dashboard/server.js` creates a second Deacon racing the host's.

For the broader workspace container contract, stack-health surfaces, and recovery
commands, see `docs/WORKSPACE-CONTAINERS.md`.

### What goes wrong

The container has its own tmux server. The host has its own tmux server. Both
deacons share the same `~/.panopticon/agents/*/state.json` files via the rw
mount. Each deacon's `recoverOrphanedAgents` patrol checks for tmux sessions
against ITS tmux server, sees them missing (because the other deacon's sessions
live elsewhere), and resets `state.json` to `stopped`. The other deacon then
auto-resumes the agent. Lather, rinse, repeat — every 60 seconds, forever.

Symptoms: `[deacon] Auto-resumed agent-XXX` messages firing constantly across
many agents. TTS narrator becomes a metronome. Agents thrash between running
and stopped without making progress.

### Rules

- `infra/.devcontainer-template/docker-compose.devcontainer.yml.template` and
  `.devcontainer/docker-compose.devcontainer.yml` MUST NOT include a
  `${HOME}/.panopticon:...` volume mount on the `server` service.
- Both compose files MUST set `PANOPTICON_DISABLE_DEACON=1` on the `server`
  service environment as belt-and-suspenders in case someone reintroduces a
  mount in the future. `src/dashboard/server/main.ts` already checks this env
  var and skips Cloister auto-start.
- The `server` service inside a workspace container is a development-time
  read/UI peer only — not a second orchestrator. It will start cleanly with no
  agent state; that's intentional. To inspect the host's running orchestrator,
  open `https://pan.localhost` (host) rather than the workspace's
  `https://api-feature-pan-XXX.pan.localhost`.

### History

- PAN-821 (2026-04-25) — duel first observed, host's `.devcontainer/` mount
  removed but template never updated.
- PAN-698 (2026-05-12) — recurrence: a workspace devcontainer brought up from
  the still-broken template duelled the host. Template + host compose both
  fixed to add `PANOPTICON_DISABLE_DEACON=1`.
