# Workspace Containers

Panopticon workspaces are host git worktrees with an optional Docker Compose stack for project services. The host remains the orchestrator: agents, tmux sessions, Cloister, and Deacon state live on the host, while the workspace stack provides project-local init, frontend, and server services.

## Compose contract

A workspace stack is rendered from `workspace.docker.compose_template` into the workspace's `.devcontainer/docker-compose.devcontainer.yml`. The expected service chain is:

1. `init` installs workspace dependencies and performs any setup/build steps required before services start.
2. `frontend` depends on `init: service_completed_successfully`, so it must stay in `Created` until `init` exits 0.
3. `server` depends on `init: service_completed_successfully`, so it must also stay in `Created` until `init` exits 0.

A non-zero `init` exit is a broken stack, not a successful host fallback. If `init` fails, dependent services staying in `Created` is the correct Docker behavior and should be surfaced loudly.

The `init` service must install development dependencies and must not try to install host git hooks inside the container:

- `NODE_ENV=development` keeps devDependencies available for scripts such as `husky` and `tsdown`.
- `HUSKY=0` makes Husky's prepare script a no-op inside the container while preserving host-side hook installation.
- Do not replace this with a global removal of the `prepare` script; host installs still need hooks.

## Single-deacon invariant

Workspace containers must never mount `${HOME}/.panopticon`, and the container `server` service must set `PANOPTICON_DISABLE_DEACON=1`. The container server is a development-time read/UI peer, not a second orchestrator.

See `.claude/rules/single-deacon-invariant.md` for the full invariant and failure history.

## Health surfaces

Workspace stack health is reported as `{ healthy, reasons, lastObserved }` for projects with `workspace.docker.compose_template` configured.

A stack is unhealthy when:

- an `init` container exits non-zero;
- a service container exits non-zero;
- a container remains in `Created` for at least 120 seconds;
- container creation time is unavailable while the container is already observable as `Created`.

Operators see this in two places:

- `pan status` prints a red `STACK BROKEN` line with the health reasons.
- The dashboard workspace surfaces show a red stack-broken state from `/api/workspaces/:issueId`.

The activity stream emits one `workspace-stack-unhealthy` entry per healthy-to-unhealthy transition rather than on every poll.

## Spawn gate and break-glass

For projects that opt into workspace Docker isolation through `workspace.docker.compose_template`, agent spawn must pass the workspace stack-health gate before creating the host tmux session. If the stack is unhealthy, spawn should fail before the agent starts and tell the operator to run:

```bash
pan workspace rebuild <issue-id>
```

The break-glass path is `--host`. It is for explicit operator override only: interactive use requires confirmation, and non-interactive use requires the corresponding explicit yes/confirmation flag. `--host` bypasses workspace isolation, so use it only when the operator has intentionally decided that host execution is safer than blocking on Docker repair.

Projects without `workspace.docker.compose_template` keep host-only behavior and do not require the gate or `--host`.

## Recovery commands

Use `pan workspace rebuild <issue-id>` to reset one workspace stack:

1. tear down that stack with Docker Compose;
2. re-render the workspace `.devcontainer` from the template;
3. restart the stack with `docker compose up -d --build`.

Use `pan workspace reap` for bulk cleanup of orphaned broken stacks. It is dry-run by default and lists candidate workspace stacks without modifying Docker state. `pan workspace reap --apply` performs teardown for candidates, and active-agent stacks are skipped so in-progress work is not destroyed accidentally.

Use rebuild for the workspace you are actively repairing. Use reap for stale, orphaned stacks after reviewing the dry-run output.
