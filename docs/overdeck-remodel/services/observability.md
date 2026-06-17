# Overdeck Service Tier — Observability (the EventBus)

> Observability is **not a domain** — it has no resolver/writer over canonical
> state. It is infrastructure: the live-event transport plus the in-memory
> read-model the dashboard subscribes to. This doc exists so the service tier is
> complete, not because there's a door to design. Companion:
> [`../END-STATE.md`](../END-STATE.md) §9, [`../ARCHITECTURE-CONVENTIONS.md`](../ARCHITECTURE-CONVENTIONS.md) §8.

## What it is

Two pieces, both backed by the disposable `events` table and a `SubscriptionRef`:

- **`EventBus`** (`Context.Service`) — the one thing writers depend on to announce
  a change. Its only method is `emit(event)`. Every domain writer calls it as the
  last step of a mutation (after the source-first write and the cache update). It
  appends to `events` and pushes onto a `Stream`.
- **The read-model** — a `SubscriptionRef<Snapshot>` held in memory, updated by the
  event stream, and served to the dashboard. It is rebuilt from the domain
  resolvers and the sources, **not** replayed from the event log — `events` is
  disposable pub/sub, not an event-sourcing journal.

## The surface (RPC, unchanged in shape)

The dashboard's live read/stream surface stays on the RPC group and keeps its
current methods, now sourced from the EventBus + read-model:

- `getSnapshot` — the current read-model snapshot (labelled with the latest event `sequence`).
- `subscribeDomainEvents` — the live `Stream` of domain events (the `.changes` of the read-model / the bus stream).
- `replayEvents(fromSequence)` — gap-fill between a client's snapshot and now. Called only with `snapshot.sequence`, never from 0.

There is **no HttpApiGroup** for Observability and **no domain controller** — the
EventBus is wired into the server bootstrap `Layer`, and the RPC group delegates
to it. Writers receive `EventBus` in their `R`; nothing else does.

## Folded in / retired

- **`health_events`** is an **Agent** projection (see `services/agents.md` →
  `recordHealth` / `getHealthHistory`), not a separate Observability surface.
- **Retention** is periodic + tiered (live-stream-only types retained hours;
  lifecycle/review/cost types kept to an analytics floor), replacing today's
  startup-only compaction that leaves `events` unbounded between restarts.
- **Phase-duration metrics** that today are derived only from `events` (and vanish
  when it's trimmed) move to the per-issue `closeOut` record so they survive — the
  one piece of durable truth that was hiding in the transport.

## No-loss note

Every current `events`/snapshot/replay surface keeps its behavior; the change is
that `emit` is the single announce-path (writers call it, nothing else writes
`events` ad hoc), and the read-model is rebuilt from resolvers rather than replayed
from the log.
