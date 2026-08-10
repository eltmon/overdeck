# Workspace Containers

Overdeck workspaces are host git worktrees with an optional Docker Compose stack for project services. The host remains the orchestrator: agents, tmux sessions, Cloister, and Deacon state live on the host, while the workspace stack provides project-local init, frontend, and server services.

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

## Compose project naming

A workspace's Docker Compose project is its **declared** name — the dev-script's `COMPOSE_PROJECT_NAME` (e.g. `myn-${FEATURE_FOLDER}`) or a compose file's top-level `name:` field (e.g. `name: myn-feature-min-901`) — never a name independently re-derived from the issue ID. `composeProjectNameForWorkspace` in `src/lib/workspace/stack-health.ts` is the single resolver for this: it checks the dev script first, then the devcontainer compose file, and only falls back to `overdeck-feature-<issue>` when neither declares a name. Every consumer — rebuild, teardown, health checks, idle reapers, `pan doctor` — must call through this resolver rather than re-deriving the name itself. Two independent derivations disagreeing is exactly what let a duplicate `overdeck-feature-*` stack spring up beside a workspace's real `myn-feature-*` one (PAN-3049): one code path resolved the declared name, another took the fallback, and both brought up a stack.

Bring-up paths use the strict variant, `requireComposeProjectNameForWorkspace`. It throws instead of silently returning the `overdeck-` fallback when a devcontainer compose file exists but declares no resolvable name — a workspace with a compose file and no declared name is a bug worth surfacing loudly, not a condition to paper over with a guess. `rebuildWorkspaceStack` resolves the bring-up name only *after* re-rendering `.devcontainer/`, so a freshly rendered compose file's own declaration is what `docker compose up -p` uses, not a stale pre-render guess.

Container and network filters that scan for "workspace stacks" must match on the `feature-<issue>` token (any prefix, or none), never anchor to the `overdeck-feature-` prefix specifically. A filter hardcoded to `overdeck-feature-` is blind to every other declared prefix (`myn-feature-`, etc.) — the deacon's crash sweep, the idle-stack reaper's UI tier, and `pan workspace reap` all learned this the hard way and were widened to prefix-agnostic matching.

`pan doctor` is the supported way to find duplicate or mismatched stacks: it lists running containers by `com.docker.compose.project`, groups them by issue, and reports any issue running under more than one project or under only a non-canonical one. It always points at `pan workspace rebuild <issue>` and never emits an automatic `docker compose down` command — `docker ps` proves a container is running, not that it's serving correctly, and no container-name heuristic can substitute for a real application health check. No Overdeck code path stops a running foreign-named stack automatically — a foreign stack may be the one actually serving a live agent, so reconciling which duplicate is safe to stop is always an explicit operator decision, guided by `pan workspace rebuild` and `docker ps` output, never inferred by doctor.

## Single-deacon invariant

Workspace containers must never mount `${HOME}/.overdeck`, and the container `server` service must set `OVERDECK_DISABLE_DEACON=1`. The container server is a development-time read/UI peer, not a second orchestrator.

See `sync-sources/rules/single-deacon-invariant.md` for the full invariant and failure history.

## Remote Fly resiliency tiers

Remote Fly workspaces support two resiliency tiers. The tier is chosen at spawn time
(`pan start --remote --tier <tier>`) and stored in the workspace config; it can also
be set as the default in dashboard Settings or `~/.overdeck/config.yaml`.

| Tier | Durability posture | Use when |
|---|---|---|
| **ephemeral** | Work survives only while it is pushed out of the VM. The VM rootfs is wiped on every stop/start. | Cost-sensitive, interruptible work; short-lived tasks; the agent can re-clone/restart cheaply. |
| **durable** | A persistent Fly volume is mounted at `/workspace`, so the working tree, git state, and `.pan/` files survive stop/start and restart-on-failure. | Long-running work you cannot afford to lose; tasks that take more than one bead and may outlast a laptop close. |

### Durability guarantees by tier

- **Both tiers** install a VM-side continuous commit+push heartbeat daemon that
  commits any uncommitted changes and pushes the feature branch on a regular interval.
  This is the baseline guarantee: even on ephemeral machines, the branch on origin is
  kept current.
- **Durable tier only** mounts a Fly volume at `/workspace`. The volume survives
  machine stops, restarts, and `restart.on-failure` retries. The rootfs still resets
  from the image on every start, so anything outside `/workspace` is lost.
- **Ephemeral tier** has no volume. A VM-side watchdog stops the machine if the host
  heartbeat goes stale (for example, the operator's laptop closes), keeping costs bounded.

### Production gate: #1 + #2

Do not advertise remote workspaces as "durable" in production until both:
1. **Continuous push** is active for both tiers (commit+push heartbeat daemon).
2. **Persistent `/workspace` volume** is mounted for the durable tier.

Without #1, uncommitted work can be lost on unexpected termination. Without #2, the
"durable" tier has the same rootfs semantics as the ephemeral tier and cannot survive
restart.

### Guardrails

- **Spend cap / concurrency cap** — `remote.max_concurrent_agents` limits how many
  remote agents can run at once. A value of `0` means unlimited. Spawns that would
  exceed the cap are refused before any Fly Machine is created.
- **Durability preflight gate** — durable-tier spawn verifies that a volume is
  actually mounted at `/workspace` before the agent starts. If the check fails, the
  spawn is refused rather than running durable work on a volumeless machine.

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

## Seeding UAT issue fixtures

A workspace container has no tracker-backed issue data by design: `IssueDataService` runs in skip-polling mode and the container-local `cache.db`/`overdeck.db` start empty, so any UI-redesign acceptance criterion that needs a live issue (open it, look at its tabs, check its agent rows) cannot be verified there out of the box. `pan admin seed-uat-fixtures` closes that gap by seeding one obviously-fake issue, `FIX-1` (reserved project key `uat-fixtures`, reserved prefix `FIX`, `[FIXTURE]` title prefix), with a phase, a branch, a PR, a review convoy, an xBRIEF plan, and activity history — everything a redesigned issue-detail page needs to render.

```bash
pan admin seed-uat-fixtures <issue-id>   # host mode: seeds that issue's workspace container
pan admin seed-uat-fixtures --local      # run inside the container directly
```

- **Host mode** (`pan admin seed-uat-fixtures <issue-id>`, run from the host) resolves the workspace's compose stack, execs `--local` inside its `server` container, restarts `server`, and polls the container's health endpoint before printing the dashboard URL. Restarting is required: skip-polling mode loads its cache and read model once at boot, so a seed without a restart is invisible.
- **`--local`** (run by the host wrapper, or manually by an operator already shelled into the container) writes the fixture set into the current `OVERDECK_HOME` through the same canonical write doors as the rest of Overdeck (project registration, the agent-state and review-status doors, the issue cache, activity events) plus a direct file write for the seeded workspace's `CLAUDE.md`, `.overdeck/spec.vbrief.json`, and `.overdeck/continue.json`. The `CLAUDE.md` marker exists only so `GET /api/workspaces/FIX-1` sees a valid workspace structure — that route reports `corrupted: true` for a workspace directory with none of `.git`, `.devcontainer`, or `CLAUDE.md`, and an empty seeded directory would otherwise trip it, 404-ing the Plan tab's `/plan` and `/tasks` reads. It unconditionally refuses to run unless both an env marker (`OVERDECK_DISABLE_DEACON=1` or `CONTAINER_MODE=1`) and real container-runtime evidence (`/.dockerenv` or `/run/.containerenv`) are present — the env marker alone is caller-controlled and not proof of isolation, so a host shell that merely sets it is still rejected. There is no production override, so seeding a host `OVERDECK_HOME` is not possible.
- **Ephemeral across recreate.** The fixture set lives only in the container-local `OVERDECK_HOME`, which does not survive `docker compose up --force-recreate` or a rebuild. Re-run `pan admin seed-uat-fixtures <issue-id>` after any operation that recreates the container.
- **Review status (including the PR link) reaches the live UI on boot, not just the REST endpoint.** `upsertReviewStatusSync()` is a raw DB upsert; on its own it never appends the `review.status_changed` event the dashboard's in-memory read model needs. `seedUatFixturesLocal()` appends the event itself (the same way `review-status-reconcile-service.ts` does — a reconciler that can't backstop this itself, since it only runs in `primary` dashboard mode and workspace containers always run `peer`), but that only helps a client already connected when it fires. The boot snapshot is what matters for a fresh page load after the container restart: `reconstructCacheAuto()` deliberately enumerates only tracker-backed in-flight issues, so an issue with no real per-issue record (every fixture) is never in its result. `mergeDbOnlyReviewStatuses()` (`src/dashboard/server/read-model.ts`) layers in any `review_status` DB row the tracker-driven pass missed — additive only, it never overrides a tracker-derived entry — so `reviewStatusByIssueId['FIX-1']` (and its `prUrl`, which the drawer's "View PR" action reads straight from that store slice) is present from the very next boot onward.
- **A seeded agent row's `branch` survives, end to end.** `agents.branch` is a real column (`drizzle/overdeck/0000_overdeck_init.sql`) that `AGENT_COLUMNS_FOR_DB` (`src/lib/overdeck/agent-state-sync.ts`) never wired into its SELECT/INSERT column list — dropped for every agent, fixture or real. Only the fixture's work-agent row sets `branch` (the four review-convoy rows don't). `GET /api/workspaces/:issueId` falls back to that persisted work-agent branch (`getPersistedBranchFallback()`) when there's no real `.git` checkout to shell `git` against, surfaced by the drawer's Workspace section.
- **Obviously fake, always.** Every fixture-identifying literal (project key, prefix, title, PR URL) marks the seeded issue as synthetic. Seeding is idempotent — re-running it preserves each store's fixture-defined row count (one issue-cache row, five agent rows, one review-status row, four activity entries) rather than accumulating duplicates — and never touches a tracker or the host's own `OVERDECK_HOME`.

## Terminal-state stack teardown

Terminal issues (closed/merged) must not leave Docker stacks running. Overdeck has four layers of protection:

1. **Merge-time cleanup is eager.** `postMergeLifecycle` removes the workspace Docker stack and its `overdeck-feature-<issue>_devnet` network as soon as the issue merges. It uses the same name-based teardown primitive as close-out, so the network is removed even when the workspace directory is already gone and shared sidecars such as `overdeck-traefik` are disconnected rather than removed.

2. **Close-out is the durable owner.** `pan close <issue-id>` and dashboard Close Out run a verified teardown of the workspace Docker stack and its `overdeck-feature-<issue>_devnet` network. Teardown is name-based (`docker compose -p overdeck-feature-<issue> down -v --remove-orphans` followed by `docker network rm overdeck-feature-<issue>_devnet`), so it works even if the workspace directory has already been removed. Close-out records a warning, not a failure, if the network cannot be verified as removed.

3. **Reaper backstop.** The deacon's closed-issue reaper (`reconcileClosedIssueAgents`) runs on boot and during periodic patrols. It invokes full `reapIssueResidue` cleanup for tracker-closed issues. For merged-but-not-closed issues, it queues Docker-only teardown on a deduplicated serial worker with retry backoff, so slow Docker commands do not stall the main patrol. Before each destructive attempt the worker revalidates canonical merged status; a fresh merge-agent enqueue can use its just-verified merge for the first retry when status persistence lags. Durable `mergeStep: post-merge-cleanup` records that the verifying-on-main handoff is incomplete. Startup atomically claims the pending artifact and runs it in a supervised background promise, so dashboard bootstrap continues while the claim remains owned. A failed run moves its claim into a discoverable queued generation unless canonical status positively proves that the durable marker owns the retry, so a newer pending generation is neither overwritten nor allowed to erase older work. Startup and patrol reclaim queued generations and claimed files whose owner PID is dead. The route and lock boundaries validate issue IDs, the resolved lock path must remain inside the lifecycle lock directory, and completion is rechecked after lock acquisition before any lifecycle work repeats. Patrol queues retries on a deduplicated serial worker instead of awaiting them. Completion records `mergeStep: merged`. Every patrol prunes Docker retries no longer in the eligible set, so reopening or closing an issue cancels stale cleanup. The worker removes Compose volumes and project-owned containers, disconnects shared sidecars, and removes the leaked devnet, while workspace files, branches, agents, sessions, state, and xBRIEF remain available for verify-on-main and close-out. Leaked-network closure checks run in batches of four so tracker latency cannot serialize the whole patrol. Closed detection (`isTrackerIssueClosed`) consults the external tracker for both GitHub- and Linear-tracked issues — Linear state types `completed`/`canceled` map to closed — so a Done issue in the Linear UI is reaped the same way as a closed GitHub issue. The Linear lookup is bounded by a 10-second timeout and is strictly false-on-failure: any API error, timeout, missing key, or fuzzy-search ref mismatch reads as not-closed, so a Linear API outage can never cause the reaper to tear down a live issue's stack.

4. **Rebuild guard.** `pan workspace rebuild` and all autonomous stack-rebuild paths go through `rebuildWorkspaceStack`, which no-ops with an error for closed/merged issues. Reopened issues can rebuild normally after their merge status is cleared.

### Widen the default address pool

Docker's default bridge pool supports only ~31 networks. To make a transient leak non-fatal, configure a wider pool in `/etc/docker/daemon.json` and restart Docker:

```json
{
  "default-address-pools": [
    { "base": "10.200.0.0/16", "size": 24 }
  ]
}
```

`pan doctor` warns when the host is within ~5 networks of the pool limit and errors once the pool is fully consumed. It counts **every bridge network on the host** (`docker network ls --filter driver=bridge`), because that is the quantity the limit governs — a network from any project, or Docker's own `bridge`, consumes a slot exactly like an `overdeck-feature-*_devnet` does. The message carries a per-project breakdown (`myn-feature-* 13, overdeck-feature-* 6, other 5`) so you can see who is holding the slots. When `default-address-pools` is declared, the limit is derived from it rather than assumed to be 31.

Counting only `overdeck-feature-*_devnet` was PAN-3053: on a host at 31/31 the check saw 12, reported healthy, and every workspace rebuild failed while queued review feedback silently went undelivered.

Pool pressure is also a live signal, not only an advisory you have to go ask for. The deacon patrol (`patrolDockerBridgePool` in `src/lib/cloister/bridge-pool-patrol.ts`) emits an activity entry when the host crosses into pressure or exhaustion, and again when it recovers. It emits on transitions only, so a sustained condition warns once rather than once per 60-second cycle, and it is strictly read-only — it never removes a network.

Overdeck never edits `daemon.json` automatically.
