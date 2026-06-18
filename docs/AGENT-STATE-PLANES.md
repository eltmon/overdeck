# Agent State Planes

Overdeck splits every piece of agent and pipeline state into exactly one of three planes. Keeping the boundaries strict prevents the "directory-as-registry" and `state.json`-as-authority problems that caused dashboard stalls, deacon log bloat, and phantom incidents.

## The three planes

### 1. Permanent plane — git, the infra repo

**What lives here:** durable, portable per-issue state.

- The immutable vBRIEF **spec** (`.pan/specs/`).
- The mutable per-issue **record** (`.pan/<recordsPath>/<issue-id>.json`):
  - `decisions`, `hazards`, `feedback` — durable continue subset.
  - `pipeline` — durable review/test/inspect/merge verdicts.
  - `closeOut` — usage by stage, merges, ranOn, closedAt.
  - `owner` — URI lease naming the machine currently driving the issue.

**Why it is portable.** Everything in this plane is plain JSON committed to git. Moving an issue to another machine is: stop on A, pull on B, resume on B. The runtime plane is rebuilt from git + tmux.

**Where it is written.** `src/lib/pan-dir/records.ts` builds records, `src/lib/pan-dir/auto-commit.ts` queues commits. Each project declares the repo and subpath below.

### 2. Runtime plane — local SQLite `~/.overdeck/panopticon.db`

**What lives here:** machine-local, process-local state for agents running *on this host now*.

- `agents` table — authoritative runtime registry. Replaces reading `~/.overdeck/agents/<id>/state.json` for enumeration and status.
- `review_status` table — ephemeral columns such as retry counters, stuck flags, inspection bead id, and recovery timestamps.
- `events` table — append-only lifecycle event log that drives reactive consumers.
- `conversations` table — remains machine-local; not made portable here.

**Why it is fast.** Indexed queries replace O(all-agents-ever) directory scans. The table is written through a transactional projection: row upsert + event append in one SQLite transaction.

**Rebuild path.** `pan admin db rebuild-agents` reconstructs the `agents` table from the rollback `state.json` files + live tmux reconciliation. The permanent record plus tmux is sufficient to restore the runtime view.

### 3. Liveness oracle — tmux on the `overdeck` socket

**What lives here:** the answer to "is this agent actually running?"

- A tmux session named after the agent id exists on socket `-L overdeck`.
- Lifecycle events project agent status, but tmux remains the ground truth for physical presence.

## Infra-repo configuration (`pan_records`)

Each project in `projects.yaml` declares where `.pan/` records are committed:

```yaml
projects:
  overdeck:
    name: Overdeck
    path: /home/eltmon/Projects/overdeck
    issue_prefix: PAN
    pan_records:
      repo: "."
      path: .pan

  myn:
    name: Mind Your Now
    path: /home/eltmon/Projects/myn
    type: polyrepo
    issue_prefix: MIN
    workspace:
      repos:
        - name: api
          path: api
        - name: infra
          path: infra
        - name: fe
          path: frontend
    pan_records:
      repo: infra
      path: .pan
```

- `repo`: the repository that holds the records. For monorepos use `"."` (the project repo). For polyrepos use a repo name from `workspace.repos`.
- `path`: subdir inside that repo where records live.

`resolveInfraRepo(project)` in `src/lib/projects.ts` resolves these declarations to an absolute repo path and records path.

## Lifecycle events

State changes are pushed to the event store and projected into the `agents` table transactionally. Consumers react to events; they do not scan directories.

- `agent.started` — agent session has started.
- `agent.status_changed` — mutable columns changed; partial payload merges without nulling absent columns.
- `agent.stopped` — agent stopped.
- `agent.heartbeat_dead` — heartbeat missed, agent is orphaned.

Deacon handlers subscribe to these events instead of reading `~/.overdeck/agents/`. A thin 60s patrol remains as a dropped-event safety net.

## What is NOT here anymore

- `~/.overdeck/agents/<id>/state.json` is no longer read for enumeration or status. It is still written as a rollback/rebuild source and kept until the new registry is proven.
- `preSpawnStashRef`, `preSpawnStashMessage`, `preSpawnBaselineHead`, and `codexMode` were removed from the runtime serialization path; they were dead or single-valued.
- `review_status` durable verdict columns are mirrored into the per-issue permanent record's `pipeline` block; ephemeral columns stay in SQLite.

## Recovery and kill switches

- **Pre-migration snapshot:** the v54→v55 migration copies `panopticon.db` to `panopticon.db.v54-backfill-snapshot` before touching agents data.
- **Rebuild command:** `pan admin db rebuild-agents` rebuilds the `agents` table from `state.json` + live tmux.
- **Records backfill:** `pan admin db backfill-records` writes permanent records for every in-flight issue.
- **Kill switch:** `OVERDECK_NO_RESUME=1` disables event-driven deacon resume and orphan recovery, dropping to safe no-resume mode without data loss.
