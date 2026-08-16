# Spawn Gating

Agent starts for projects with `workspace.docker.compose_template` must pass workspace stack health before creating a tmux session. The gate refuses unhealthy Docker-backed workspaces and tells the operator to run `pan workspace rebuild <issue-id>` or explicitly retry with `--host`.

## Central gate

- `src/lib/agents.ts:1814` defines `assertWorkspaceStackHealthyForSpawn(issueId, role, allowHost)`.
- `src/lib/agents.ts:1872` gates `spawnRun()` before role-run state or tmux session creation.
- `src/lib/agents.ts:2117` gates `spawnAgent()` before hook initialization, beads checks, state writes, or work-agent tmux creation.
- `src/lib/agents.ts:2719`, `src/lib/agents.ts:2890`, `src/lib/agents.ts:3051`, and `src/lib/agents.ts:3219` gate fallback relaunch, resume, restart, and crash recovery before they create replacement tmux sessions.

The spawn gate reads the cached Docker lifecycle snapshot maintained by `DockerStatsCollector`; it does not run `docker ps` or any Docker subprocess on the spawn path. CLI/status/manual diagnostics can still collect Docker state explicitly and pass it into stack-health evaluation.

If `allowHost` is true, the gate emits `agent-spawn-host-override` and persists `hostOverride` on the agent state so later resume/restart/recovery paths honor the same operator decision.

## CLI and dashboard break-glass

- `src/cli/index.ts:410` registers `pan start <id>`.
- `src/cli/index.ts:413` adds `--host`; `src/cli/index.ts:414` adds `--yes` for non-interactive confirmation.
- `src/cli/commands/start.ts:124` always prompts `Are you sure? This bypasses workspace isolation. (y/N)` for interactive `--host`, even when `--yes` is present, and requires `--yes` when stdin is not a TTY.
- `src/cli/commands/start.ts:1009` passes `allowHost` into `spawnAgent()`.
- `pan swarm <id>` starts or attaches to the parent foreman through `ensureSwarmForeman()` and `spawnRun()`; it has no host-bypass flag.
- `pan swarm dispatch <id>` is the only slot-spawn gate. It checks the durable hold, DAG blockers, file overlap, reserved slot capacity, and duplicate slot resources before `spawnRun()`.
- The Deacon janitor may restore a missing foreman only after the work-concurrency governor admits it. The janitor never spawns slots.
- `src/dashboard/server/routes/agents.ts:1818` accepts an explicit dashboard host override request after origin validation and confirmation phrase validation.
- `src/dashboard/server/routes/agents.ts:2652` and `src/dashboard/server/routes/agents.ts:2712` pass `--host --yes` to the `pan start` child only when the request explicitly set and confirmed `host` or `allowHost`.
- `src/dashboard/server/services/agent-spawner.ts:172` passes `allowHost` through its direct `spawnAgent()` service path.

There is no `pan work` spawn command today; the CLI audit found `pan start <id>` and `pan swarm <id>` as direct work-agent start surfaces.

## Spawn entrypoint audit

- `src/lib/agents.ts:1851` `spawnRun()` is the role-run choke point for spawned review and test roles; it gates non-work roles directly and delegates work to `spawnAgent()`.
- `src/lib/agents.ts:2106` `spawnAgent()` is the work-agent choke point; dashboard direct services, swarm slots, merge-prep recovery, and handoff all flow through it.
- `src/lib/cloister/review-agent.ts:335` and `src/lib/cloister/review-agent.ts:525` start review roles through `spawnRun()`.
- `src/lib/cloister/test-agent-queue.ts:85`, `src/lib/cloister/deacon.ts:1568`, `src/lib/cloister/deacon.ts:1745`, and `src/dashboard/server/routes/workspaces.ts:3602` start test roles through `spawnRun()`.
- Server-side shipping no longer starts a ship role through `spawnRun()`.
- `src/lib/cloister/service.ts:350` starts reactive lifecycle roles through `spawnRun()` when a lifecycle state maps to a spawned role.
- `src/dashboard/server/services/agent-spawner.ts`, workspace routes, swarm foreman and dispatch gates, and `src/lib/cloister/handoff.ts` start work agents through the shared spawn door.
- `src/dashboard/server/routes/agents.ts:2649` and `src/dashboard/server/routes/agents.ts:2709` shell out to `pan start`, which reaches `spawnAgent()`.
- `src/lib/cloister/swarm-foreman.ts` starts the parent foreman, and `dispatchNextWave()` starts slot agents. Both reach the shared work-agent spawn gate.

## Non-agent tmux sessions

The following `createSessionAsync()` uses do not create work or role agents and are outside the stack-health gate:

- `src/lib/planning/spawn-planning-session.ts:557` creates planning sessions. Planning is intentionally exempt because it produces the workspace plan before work starts.
- `src/lib/cloister/inspect-agent.ts:263` creates inspection sessions after work; inspection is not a work/role spawn path.
- `src/lib/cloister/deacon.ts:812` resumes an existing agent launcher path from saved runtime state rather than constructing a fresh work/role spawn.
- `src/lib/runtimes/pi.ts:338`, `src/lib/runtimes/claude-code.ts:340`, and `src/lib/runtime/claude.ts:72` are runtime abstractions not used by the Overdeck work/role spawn chokepoints documented above.
- Dashboard utility sessions under `src/dashboard/server/routes/misc.ts`, `src/dashboard/server/routes/codex-auth.ts`, and `src/dashboard/server/routes/conversations.ts` are interactive/user utility sessions, not autonomous work/role agents.
