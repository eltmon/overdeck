# PRD: Pipeline Throughput Hardening

> Draft authored 2026-06-07 by an operator agent (conv-3095 lineage) at the end of a long
> session that landed the 3 "brake" PRs, decoupled docs-index, and shipped graceful-reconnect
> + non-destructive hot-reload. This PRD rolls those learnings into the **next phase**: make
> Panopticon run *many* work agents reliably without stampeding/saturating the host, and scale
> out to remote (fly.io) capacity. Intended to become a GitHub **milestone** + an **umbrella
> epic** with the issues below as children.

## Vision

Panopticon should be able to keep a large number of **work** agents busy continuously, on a
mix of **local** and **remote (fly.io)** workspaces, with the pipeline-advancing roles
(review / test / ship) spawned **on demand** and **rate-limited** so the host never stampedes
into resource exhaustion — and never deadlocks. Turning the Deacon on (or letting the Flywheel
run unattended) should be a non-event.

## Motivation — the 2026-06-07 unfreeze incident (hard data)

With the Deacon frozen all session, unfreezing it (`globally_paused` → false) caused a
**thundering herd**: a single patrol re-spawned every eligible stopped work agent at once.
Measured on a 24-core host:

```
t+12s  load 5.6   12 agents
t+48s  load 8.0   17 agents   (npm exec @playwright bursts starting)
t+72s  load 14.0  31 agents
t+96s  load 18.6  37 agents
t+132s load 24.6  37 agents
t+180s load 49.6  36 agents
t+204s load 50.2  → re-froze (POST /api/deacon/pause {paused:true})
final  load 52.2
```

~37 work agents resumed; each immediately kicked off work + verification (Playwright/builds).
Re-freezing recovered cleanly (load 52→24 in ~50s, agents 37→13). This previously crashed the
dashboard twice; the 3 brakes + docs-index decouple **softened** it (gradual 3.5-min climb,
recoverable) but did not prevent it.

**Operator observation:** the herd looked like *more than* work agents — there aren't 37 open
issues. Two compounding causes: (a) resumed work agents cascade into **specialist spawns**
(each `pan done` triggers a review convoy: correctness/security/perf/requirements + test +
ship); (b) **zombie agents on CLOSED issues** get re-spawned (PAN-1613). So the real surface is
work-resume × specialist-cascade × zombies.

## Current behavior / root causes

1. **Unthrottled resume.** `autoResumeStoppedWorkAgents()` (src/lib/cloister/deacon.ts:5531),
   run each patrol after the `globally_paused` gate (~deacon.ts:4407) and after
   `recoverOrphanedAgents()` (deacon.ts:4463, which only marks orphans stopped — *not* the
   culprit), loops over EVERY agent dir and resumes each eligible stopped **work** agent
   (filters: status=stopped, role=work, has workspace, not paused/troubled, no live tmux, past
   `lastFailureNextRetryAt` backoff). The eligibility filters are good; there is **no
   concurrency cap, no inter-resume delay, and no load-aware gate** — so unfreeze/boot
   re-spawns all eligible at once.
2. **Specialists are not on-demand.** Review (correctness/security/performance/requirements),
   test, and ship agents get spawned/re-spawned as a side effect of work-agent progress and
   are not gated by available capacity. They should be **ephemeral and demand-driven** — spawned
   only when there is concrete work for them, never mass-resumed. (Relates: PAN-1556
   review-spawn spam/coalescing.)
3. **No resource-slot accounting.** There is no notion of "max local workspaces" / "max local
   running agents," so spawns/resumes are unbounded relative to host capacity.
4. **Local workspace init is broken** (PAN-1645) — agents can't reliably run in local docker
   workspaces (worked around this session with `pan start --host --yes`). A prerequisite for
   trustworthy local slots.
5. **Zombie agents on closed issues** (PAN-1613) — agents re-spawned for CLOSED issues consume
   slots for no reason.
6. **Single-box ceiling.** All agents run on one host. Remote (fly.io) workspaces were
   implemented but never fully tested/hardened, and there's no CLI to move an agent
   local↔remote — so there's no pressure-relief valve.

## Goals / design

### A. Throttle the Deacon resume (immediate unfreeze-safety gate) — PAN-1665
In `autoResumeStoppedWorkAgents` (deacon.ts:5531): add a **per-patrol concurrency cap**
(resume at most N, e.g. 3, eligible agents per cycle; remainder picked up on later cycles → a
gentle ramp), a **load-aware gate** (skip resuming this cycle if 1-min load > ~1.5× cores), and
optionally a small **stagger** between the N resumes. Eligibility logic stays; only the *rate*
is added. This alone makes unfreeze safe.

### B. On-demand / ephemeral specialists
Review (+ sub-roles), test, and ship agents spawn only when there is actual queued work for
them, and are torn down when idle — never bulk-resumed on unfreeze. Coalesce/supersede
re-reviews per issue (PAN-1556). Resuming a work agent must NOT implicitly stampede a convoy.

### C. Resource-slot manager (the core idea)
Configurable capacity, machine-level:
- `max_local_workspaces`, `max_local_agents` (and per-role considerations).
- **Prioritize work agents** — allow many to run.
- When low on slots, **defer spawning/respawning specialists** (review/test/ship) until slots
  free up.
- **CRITICAL — deadlock avoidance:** reserve a **minimum number of slots for
  pipeline-advancing roles** (review/test/ship). Otherwise work agents finish → need review/ship
  to progress and free their slots → but those can never spawn (no slots) → done-but-unreviewed
  work piles up → no slots ever free → **deadlock**. Must compute/define the minimum reserved
  capacity as a function of running work-agent count (e.g. always keep K slots claimable by
  advancing roles, or admit advancing roles ahead of new work when the done-queue is non-empty).
- Surface slot usage in the dashboard.

### D. Remote workspaces (fly.io) — scale-out / pressure-relief
- **Harden** the existing (untested) fly.io remote-workspace implementation.
- **Add CLI** to move agents local↔remote (e.g. `pan workspace move <id> --remote|--local`, or
  spawn-remote flags), so overflow work runs off-box when local slots are full.
- Slot manager treats remote capacity as additional/overflow slots.
- (No existing GitHub issue for this yet — the umbrella should spawn one.)

### E. Fix local workspace init — PAN-1645
So agents run in local docker workspaces without the `--host` workaround — prerequisite for
reliable local slots.

### F. Stop zombie re-spawns on closed issues — PAN-1613
Don't re-spawn/keep agents for CLOSED/COMPLETED issues; they waste slots and inflate the herd.

## Sequencing (suggested)

1. **A (PAN-1665 throttle)** — smallest change, immediate unfreeze safety; unblocks everything.
2. **F (PAN-1613 zombies)** + **B (on-demand specialists, PAN-1556)** — shrink the resume/spawn
   surface so the slot manager has less to manage.
3. **C (slot manager + deadlock-safe reservation)** — the core throughput control.
4. **E (PAN-1645 local workspace init)** — make local slots trustworthy.
5. **D (fly.io remote + migrate CLI)** — scale beyond one box.

## Related issues to roll into the milestone

- PAN-1665 — Deacon resume stampede / throttle (the keystone; has repro data + corrected root
  cause: autoResumeStoppedWorkAgents, not recoverOrphanedAgents).
- PAN-1645 — local workspace docker init broken (node_modules incomplete).
- PAN-1613 — agents re-spawned on CLOSED issues (zombie slots).
- PAN-1556 — review-spawn spam: coalesce/supersede re-reviews.
- PAN-1629 — concurrent `pan start` lock contention (relevant to controlled spawn).
- PAN-1336 — swarm slots never self-terminate (slot lifecycle).
- (new) fly.io remote-workspace hardening + local↔remote migration CLI.
- (new) resource-slot manager with deadlock-safe reservation.

## Open questions

- What's the right default for `max_local_agents` / `max_local_workspaces` on a 24-core box?
- Exact reservation policy for advancing roles (fixed K slots? ratio to work agents? admit
  advancing-role spawns ahead of new work whenever the done/awaiting-review queue is non-empty?).
- Should the resume throttle and the slot manager share one admission controller, or stay
  separate (throttle = rate, slot manager = capacity)? Likely one unified admission path.
- How does remote (fly.io) capacity register as slots, and how is load measured there?

## Acceptance (phase done when…)

- Unfreezing the Deacon with a large backlog ramps gently (no load spike past ~1.5× cores) and
  never deadlocks.
- Specialists spawn only on demand; no convoy stampede from a work-agent resume.
- A configurable local capacity is enforced; excess work can run on fly.io; agents can be moved
  local↔remote via CLI.
- Local docker workspaces work without `--host` (PAN-1645 closed).
- No agents run for closed issues (PAN-1613 closed).
