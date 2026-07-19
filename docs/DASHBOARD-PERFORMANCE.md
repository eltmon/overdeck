# Dashboard Performance Architecture

The dashboard stays responsive by keeping request handling separate from convergence work. HTTP and RPC reads return in-memory snapshots; background services gather tracker, git, Docker, tmux, and process evidence through bounded shared primitives.

## Request-path invariant

A list or detail request must not launch tracker, git, Docker, tmux, process-table, or cache-refresh work. The resource and membership routes read the latest published snapshot and return immediately. Cold membership and machine-resource snapshots return a fast `503` while their background service warms; neither request performs discovery. The machine-resource snapshot is rebuilt once every three seconds regardless of how many dashboard clients poll `/api/resources`.

Pipeline membership is advisory to rendering. Membership loading or failure may show a status message and Retry action, but it never replaces the issue tree or removes issue actions. Lifecycle events invalidate membership queries, so the frontend does not interval-poll membership.

## Project resource convergence

`src/dashboard/server/services/project-resource-refresh-queue.ts` is the only scheduler for resource convergence:

- The queue is keyed by canonical project path and drains in FIFO order.
- Repeated events for one project coalesce before execution.
- Only one drain runs at a time. An event that arrives during a project refresh schedules at most one follow-up for that project.
- One drain captures fleet-wide signals once, computes each requested project separately, and publishes each project snapshot atomically.
- A project failure preserves its last-good snapshot and does not prevent later queued projects from running.
- Boot warming, lifecycle events, and the five-minute convergence sweep all use this queue.
- Agent lifecycle events refresh live resource evidence from the existing membership snapshot. They do not rerun durable tracker/branch/PR/spec membership lenses; boot warming and the five-minute convergence sweep own that work.
- Workspace branch metadata is cached until `.git/HEAD` changes, and merged-PR history is queried only for open issues because closed issues resolve terminal without it. Periodic convergence therefore does not respawn git/GraphQL work for unchanged historical workspaces.

The server binds its HTTP socket before it starts triggers or enqueues the boot warm. Boot logs must show `Dashboard listening` before `Project resource refresh queue and resources snapshot service started` and `Boot cache warm complete`.

## Shared runtime census

`src/lib/runtime-census.ts` owns recurring tmux and process evidence. It combines one bulk `tmux list-panes -a` read with one `ps` table, indexes process descendants once, and serves consumers from a three-second single-flight cache.

Tmux and process availability are independent. A failed process read does not hide live tmux sessions, and unavailable process evidence fails open for harness liveness. A failed tmux refresh retains the last-good pane data but marks tmux evidence unavailable, so lifecycle consumers skip death transitions. Conversation cleanup performs one forced bulk refresh before marking any candidate ended.

Recurring consumers must use the census rather than launching their own tmux or `ps` subprocesses. One-off CLI sync fallbacks remain only where a dashboard-owned warm census cannot exist.

## Demand-driven output

`src/dashboard/server/services/agent-output-service.ts` captures panes only while output has subscribers:

- Explicit RPC subscriptions are reference-counted per agent.
- The first interested subscriber gets an immediate capture; subsequent captures run every three seconds.
- One agent has at most one capture in flight, and overlapping polls coalesce.
- The final unsubscribe stops the timer when no other output interest exists.
- The public SSE feed retains its historical all-agent output surface, but it activates fleet capture only while an SSE client requests `agent.output_received` or leaves event types unfiltered.

`agent.output_received` is excluded from the general dashboard and issue event streams. Visible output surfaces use `subscribeAgentOutput`; God View cards subscribe only while they are in or near the viewport. The existing reducer still caps each agent at 200 lines.

## CPU-aware quality-gate admission

`src/lib/cloister/quality-gate-admission.ts` serializes local and container command gates through a cross-process FIFO under `${OVERDECK_HOME}/verification-workers/admission/`. The oldest live waiter may acquire the owner only when both sampled CPU utilization and one-minute load per core are below their start thresholds. Admission rechecks pressure after a short settle period before returning the lease.

Every gate attempt, including a retry, re-enters the queue and releases its lease in `finally`. Dead waiters, dead owners, over-age owners, malformed owner files, and stale breaker files are reclaimed. Remote gates and HTTP health checks bypass the CPU slot because their expensive work does not run on the local host.

Verification-worker state distinguishes `queued` from `running` and records `admittedAt`. The 65-minute worker execution timeout starts at the first admitted or bypassed gate, so waiting for CPU before the first gate does not consume the execution budget. CPU admission is scheduling only: it never pauses agents, sheds memory, enforces a spend limit, or replaces the memory governor.

## Verification

Build and boot-test the Node 22 production bundle before restarting the live dashboard. Use a throwaway port with `OVERDECK_DISABLE_DEACON=1`, verify `/api/health` responds before boot warming completes, and confirm the listen log precedes warm-start and warm-complete logs.

For a loaded instance, measure a 65-second window:

```bash
node scripts/verify-dashboard-performance.mjs --duration 65 --assert
```

Pass `--pid` and `--base-url` for a throwaway instance. The script reads `/proc/<pid>/stat`, polls direct children, samples the snapshot routes, and reads `/api/metrics/summary` for event-loop delay. Acceptance targets are:

- dashboard CPU below 15%;
- fewer than two direct child processes per second;
- event-loop p99 below 100 ms;
- `/api/health`, `/api/registered-projects`, `/api/issues/resource-allocated`, and `/api/resources` p95 below 200 ms;
- no membership-caused issue skeleton and no lost issue action, route, view, status, or recovery affordance.
