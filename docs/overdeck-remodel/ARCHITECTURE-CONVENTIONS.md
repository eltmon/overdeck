# Overdeck — Architecture Conventions (Effect v4-beta house style)

> The single style every domain follows. Verified against the installed
> `effect@4.0.0-beta.73` — see [`investigations/effect-v4-idioms.md`](investigations/effect-v4-idioms.md)
> for the exact signatures and the v3→v4 diff. Companion:
> [`END-STATE.md`](END-STATE.md).

## 0. The shape of a domain

Every domain is the same five things. Nothing in a domain is allowed to exist
outside them:

| Piece | Effect primitive | Rule |
|---|---|---|
| **Entities** | `Schema.Struct` / branded IDs / `Schema.Literals` | one definition; validates API input, decodes DB rows, serializes to the client |
| **Errors** | `Schema.TaggedErrorClass` (wire) / `Data.TaggedError` (internal) | every failure is typed in the `E` channel |
| **Read door** | a `Context.Service` (the **Resolver**) | the *only* reader of the domain's cache |
| **Write door** | a `Context.Service` (the **Writer**) | the *only* mutator; persists to the source of truth first, then updates the cache; emits an event |
| **Controller** | one `HttpApiGroup` (+ the RPC group) | delegates to the two services; never touches `Sql` |

The enforcement: the `Sql` service (the cache handle) is provided **only** to
Resolver and Writer Layers. A controller's `R` never contains `Sql`, so reaching
past the door is a **compile error**, not a code-review note.

## 1. The package fact (v4-beta)

In v4-beta the old `@effect/*` packages collapsed into the **single `effect`
package** under `effect/unstable/*`. Runtime adapters stay as separate installed
packages.

```ts
import { Effect, Layer, Context, Schema, Data, SubscriptionRef, Stream } from "effect"
import { SqlClient, SqlSchema } from "effect/unstable/sql"
import { HttpApi, HttpApiGroup, HttpApiEndpoint, HttpApiBuilder } from "effect/unstable/httpapi"
import { Rpc, RpcGroup, RpcServer, RpcSerialization } from "effect/unstable/rpc"
import { NodeRuntime } from "@effect/platform-node"   // runtime adapter stays separate
```

**v3→v4 traps to never write the old way** (full list in the idioms doc):
`Effect.Service` is **gone** → use `Context.Service`. `Schema.Literals([...])` /
`Schema.Union([...])` take **arrays**. Decode returns a **`Result`**, not
`Either`. `Schema.TaggedError` → **`Schema.TaggedErrorClass`**. `Stream.async` →
**`Stream.callback`**; the unsafe-suffix moved (`Queue.offerUnsafe`).

## 2. Entities — `Schema`

One Schema per entity. Branded IDs so an `AgentId` can never be passed where an
`IssueId` is wanted. States are literal unions, not strings.

```ts
export const IssueId = Schema.String.pipe(Schema.brand("IssueId"))
export type  IssueId = typeof IssueId.Type

export const Stage = Schema.Literals([
  "todo","planning","planned","working","in_review",
  "testing","verifying","merging","verifying_on_main","closed","cancelled",
])
export type Stage = typeof Stage.Type

export const GateOutcome = Schema.Literals(["pending","passed","failed"])

export const Issue = Schema.Struct({
  id:            IssueId,
  stage:         Stage,
  gates:         Schema.Struct({ review: GateOutcome, test: GateOutcome }), // kept gates only
  verdictCommit: Schema.NullOr(Sha),
  blockers:      Schema.Array(Blocker),
  pr:            Schema.NullOr(Schema.Struct({ url: Schema.String, number: Schema.Number, headSha: Sha })),
  updatedAt:     Schema.Date,
})
export type Issue = typeof Issue.Type
```

- Type extraction is `typeof X.Type` (and `.Encoded` for the wire form).
- Decode untrusted input with `Schema.decodeUnknownResult(Issue)` → a `Result`
  you branch on; never trust a raw row or body.
- The **same** `Issue` schema is the DB-row decoder, the API success type, and
  the client type. No parallel interfaces.

## 3. Errors — tagged, in the `E` channel

```ts
export class IssueNotFound extends Schema.TaggedErrorClass<IssueNotFound>()(
  "IssueNotFound", { id: IssueId },
) {}
export class IllegalTransition extends Schema.TaggedErrorClass<IllegalTransition>()(
  "IllegalTransition", { from: Stage, to: Stage },
) {}
```

Raise with `Effect.fail(new IllegalTransition({ from, to }))`; handle with
`Effect.catchTag("IllegalTransition", …)`. Wire errors (`Schema.TaggedErrorClass`)
are declared on endpoints so the controller maps them to HTTP status
automatically. Purely-internal errors may use `Data.TaggedError("Tag")<{…}>`
(the codebase's existing ~85-site pattern).

## 4. The cache — `@effect/sql`

One `Sql` service wraps `overdeck.db`. Resolvers/Writers acquire `SqlClient`;
**no raw driver calls anywhere else.**

```ts
const make = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient

  const findById = SqlSchema.findOne({
    Request: IssueId,
    Result:  Issue,                                   // rows decode straight into the Schema
    execute: (id) => sql`SELECT * FROM issues WHERE id = ${id}`,
  })

  return { findById } as const
})
```

- Parameterized values only — `` sql`… ${param}` `` (never string-concat).
- Multi-store writes run in `sql.withTransaction(effect)` so a partial write
  can't split-brain the cache.

> **⚠ Driver decision (blocks standardizing this layer):** `effect/unstable/sql`
> has **no SQLite driver**, and `@effect/sql-sqlite-bun` is **Bun-only** — but the
> dashboard is **Node-22-only** (node-pty + circular-ESM). Resolution: implement a
> thin `SqlClient` over the existing `node:sqlite` driver (`src/lib/database/
> driver.ts`) so we get the Effect surface on Node-22. Until that adapter exists,
> Resolvers/Writers depend on a `Sql` Tag whose Layer is the node:sqlite-backed
> client. **Operator decision before building cache code.**

## 5. The two doors — `Context.Service` + `Layer`

`Context.Service` defines the interface **and** the Tag in one class. The Layer
is its constructor; the Layer's `R` is its dependencies.

```ts
// READ DOOR
export class IssuesResolver extends Context.Service<IssuesResolver, {
  readonly get:  (id: IssueId) => Effect.Effect<Issue, IssueNotFound>
  readonly list: (f: IssueFilter) => Effect.Effect<ReadonlyArray<Issue>>
}>()("overdeck/IssuesResolver") {}

export const IssuesResolverLayer = Layer.effect(IssuesResolver, Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient        // dependency → appears in the Layer's R
  /* … */
  return IssuesResolver.of({ get, list })
}))

// WRITE DOOR — the ONLY mutator
export class IssueWriter extends Context.Service<IssueWriter, {
  readonly advance: (id: IssueId, to: Stage, reason: string) =>
    Effect.Effect<Issue, IssueNotFound | IllegalTransition>
  readonly hold: (id: IssueId, flag: Hold, on: boolean, reason?: string) =>
    Effect.Effect<Issue, IssueNotFound>
}>()("overdeck/IssueWriter") {}

export const IssueWriterLayer = Layer.effect(IssueWriter, Effect.gen(function*() {
  const sql     = yield* SqlClient.SqlClient
  const records = yield* Records            // git .pan/records writer (source of truth)
  const bus     = yield* EventBus

  const advance = (id: IssueId, to: Stage, reason: string) => Effect.gen(function*() {
    const issue = yield* /* resolver.get(id) */
    if (!isLegalMove(issue.stage, to)) return yield* Effect.fail(new IllegalTransition({ from: issue.stage, to }))
    const next = applyMove(issue, to, reason)
    // 1. Persist to the SOURCE OF TRUTH first (git record / GitHub). This is the commit point.
    yield* records.write(next)
    // 2. Then update the cache. withTransaction keeps multi-row CACHE writes consistent.
    //    If THIS fails, the cache is briefly stale but self-heals on the next rebuild — git is truth.
    yield* sql.withTransaction(sql`UPDATE issues SET stage = ${to}, updated_at = ${now} WHERE id = ${id}`)
    // 3. Announce.
    yield* bus.emit({ type: "issue.advanced", payload: { id, to, reason } })
    return next
  })
  return IssueWriter.of({ advance, hold })
}))
```

**House rules for the writer** — the durability model is *git/GitHub is the
source, the DB is a rebuildable cache*, so durability is **ordering, not
atomicity**:
1. **Source-of-truth first, then cache.** Persist to the domain's source (git
   record / GitHub) *before* updating the cache — that write is the commit point.
   The cache update is **synchronous and failure-checked** (logged/retried), never
   the current fire-and-forget `void updateIssueRecord`. A cache write that fails
   leaves the cache briefly stale, which **self-heals on the next rebuild** because
   the source already holds the truth. **Do not** claim DB+git atomicity — a git
   write inside a SQL transaction is not atomic; ordering + a self-healing cache is
   the correct, achievable guarantee, and it strictly beats today's silent
   fire-and-forget divergence.
2. **Pure-cache domains** (no durable source — the review-run runtime, agent
   lifecycle gates) have no step 1; the cache write is the whole write.
3. Exactly **one** writer method per logical move. `advance` is the only thing
   that changes `stage`; it absorbs every one of the ~148 sites.

## 6. Wiring — `Layer`

```ts
const DomainLayer = Layer.mergeAll(
  IssuesResolverLayer, IssueWriterLayer,
  AgentsResolverLayer, AgentWriterLayer, /* … */
).pipe(Layer.provide(SqlLive), Layer.provide(RecordsLive), Layer.provide(EventBusLive))

const HttpLive = HttpApiBuilder.serve(OverdeckApi).pipe(Layer.provide(DomainLayer))
NodeRuntime.runMain(Layer.launch(HttpLive))
```

A missing dependency is a **type error at the merge**, not a runtime
`NoSuchBean`. That is the DI guarantee.

## 7. Controllers — one `HttpApiGroup` per domain

Declarative. Request / success / error are Schemas; the handler is just the
method body delegating to the service. (Today's ~40 imperative `HttpRouter.add`
handlers all migrate to this — a real migration, but the target is uniform.)

```ts
export const IssuesApi = HttpApiGroup.make("issues")
  .add(HttpApiEndpoint.get("get", "/issues/:id", {
    params: Schema.Struct({ id: IssueId }), success: Issue, error: IssueNotFound,
  }))
  .add(HttpApiEndpoint.post("advance", "/issues/:id/advance", {
    params: Schema.Struct({ id: IssueId }),
    payload: Schema.Struct({ to: Stage, reason: Schema.String }),
    success: Issue, error: Schema.Union([IssueNotFound, IllegalTransition]),
  }))

export const OverdeckApi = HttpApi.make("overdeck").add(IssuesApi).add(AgentsApi) /* … */

export const IssuesApiLive = HttpApiBuilder.group(OverdeckApi, "issues", (h) =>
  h.handle("get",     ({ path }) => IssuesResolver.get(path.id))
   .handle("advance", ({ path, payload }) => IssueWriter.advance(path.id, payload.to, payload.reason)))
```

The handler's `R` is `IssuesResolver | IssueWriter` — **not `Sql`**. That's the
compile-time door enforcement.

## 8. The live surface — RPC + `SubscriptionRef`

The dashboard's read/stream surface stays RPC (`effect/unstable/rpc`), delegating
to the **same** resolvers (HTTP and RPC cannot diverge). The read-model is a
`SubscriptionRef`; the write door's events feed it.

```ts
const issues = RpcGroup.make(
  Rpc.make("issues.get", { payload: Schema.Struct({ id: IssueId }), success: Issue, error: IssueNotFound }),
  Rpc.make("issues.subscribe", { success: IssueEvent, stream: true }),   // .changes → Stream
)
```

Event push uses `Stream.callback(q => Queue.offerUnsafe(q, ev))`; periodic ticks
use `Stream.tick("15 seconds")`.

## 9. The checklist for adding a domain

1. **Schema** the entities (branded IDs, `Literals` states) — one definition.
2. **TaggedErrorClass** the failures.
3. **Resolver** `Context.Service` — reads only; `Sql` in its Layer's `R`.
4. **Writer** `Context.Service` — the only mutator; mirrors to git + emits in one
   transaction.
5. **HttpApiGroup** (+ RPC) — delegate to the two services; never import `Sql`.
6. **Layer** the resolver + writer, `provide` the shared `Sql`/`Records`/`EventBus`.

If a piece of code wants to read or write this domain and isn't one of these
five, it's wrong — extend a door, never add a path.
