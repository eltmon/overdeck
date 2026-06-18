# Effect v4-beta Idioms (`4.0.0-beta.73`) — Canonical Patterns for the overdeck Rewrite

> **Status:** Verified against installed `node_modules` types and live `src/` usage on
> 2026-06-16. Every signature below was read from
> `node_modules/effect/dist/**/*.d.ts` at version `4.0.0-beta.73`, or from an actual
> call site in the repo. Where the codebase does not yet exercise a primitive, the
> entry says so explicitly and shows the API straight from the installed `.d.ts`.

## TL;DR — the one fact that reorganizes everything

In Effect **v4-beta**, the published packages collapsed. Almost all the
"`@effect/*`" packages from v3 now live **inside the single `effect` package** under
the **`effect/unstable/*`** namespace:

| v3 package (what you'd reach for from memory) | v4-beta import path |
| --- | --- |
| `@effect/platform` (HttpRouter, HttpServer, HttpClient) | `effect/unstable/http` |
| `@effect/platform` (HttpApi*, declarative) | `effect/unstable/httpapi` |
| `@effect/rpc` | `effect/unstable/rpc` (sub-modules: `effect/unstable/rpc/Rpc`, `.../RpcGroup`) |
| `@effect/sql` | `effect/unstable/sql` |
| `@effect/schema` | `effect/Schema` (top-level named export `Schema`) — also re-surfaced under `effect/unstable/schema` |
| `@effect/sql-sqlite-bun` (the driver) | **separate package, still `@effect/sql-sqlite-bun@4.0.0-beta.73` — NOT installed here** (catalog-only) |
| `@effect/platform-node` (Node runtime layers) | **separate package, installed** — `@effect/platform-node/NodeHttpServer`, `/NodeServices`, `/NodeRuntime` |
| `@effect/platform-bun` (Bun runtime layers) | **separate package, installed** — `@effect/platform-bun/BunRuntime` |

So the rewrite imports core abstractions from `effect` / `effect/unstable/*`, but the
**concrete runtime layers** (`NodeHttpServer.layer`, `NodeServices.layer`, `runMain`)
still come from the separately-installed `@effect/platform-node` / `@effect/platform-bun`.
Do not assume "everything is in `effect` now" — the platform *adapters* are still split out.

Installed `effect` subpath exports (from `effect/package.json`):
`./unstable/{ai,cli,cluster,devtools,encoding,eventlog,http,httpapi,observability,persistence,process,reactivity,rpc,schema,socket,sql,workflow,workers}`.

---

## Glossary

- **Service key / tag** — the runtime identity object used for dependency injection. In
  v4 it is created by `Context.Service` and is usually *also a class*, so the class
  value doubles as the tag.
- **Shape** — the interface of methods/values a service provides.
- **Layer** — a recipe that builds one or more services, possibly depending on other
  services. `Layer.effect(Tag, build)` is the workhorse.
- **`Live` layer** — repo naming convention: `XxxServiceLive` is the production `Layer`
  that constructs `XxxService`.
- **Codec / `Schema`** — a bidirectional encode/decode definition. `S.Type` is the
  decoded TS type, `S.Encoded` is the wire/storage type.
- **`Top`** — v4's base schema type (the constraint `extends Schema.Top` you'll see in
  helper signatures); v3 used `Schema.Schema.Any`.

---

## 1. Service + Dependency Injection

**Canonical form** (`import { Context } from "effect"`):

```ts
class EventStoreService extends Context.Service<
  EventStoreService,            // Self
  EventStoreServiceShape        // Shape
>()('overdeck/dashboard/EventStoreService') {}   // mandatory string key
```

- Two-stage call: `Context.Service<Self, Shape>()("Key")`. The **empty `()` is required**
  between the type params and the key string.
- The **string key is mandatory** and is the runtime identity. Repo convention is a
  slash-namespaced key, e.g. `'overdeck/dashboard/ReadModelService'`.
- The class *is* the tag — `yield* EventStoreService` inside an `Effect.gen` yields the
  shape; `EventStoreService` is also what you pass to `Layer.effect`.

The Shape is a hand-written `interface` of `Effect`-returning members:

```ts
export interface EventStoreServiceShape {
  readonly append: (event: Record<string, unknown>) => Effect.Effect<number>;
  readonly readFrom: (fromSequence: number) => Effect.Effect<StoredEvent[]>;
  readonly getLatestSequence: Effect.Effect<number>;        // 0-arg members are bare Effects
  readonly streamEvents: Stream.Stream<StoredEvent>;
}
```

> Verified: `src/dashboard/server/services/domain-services.ts:38`,
> `src/dashboard/server/read-model.ts:362`, `Context.d.ts:225` (`Context.Service`).

**⚠️ v3→v4:** **`Effect.Service` does not exist in v4-beta.** Confirmed at runtime:
`import * as E from "effect/Effect"; typeof E.Service === "undefined"`. The only
`*Service` exports on `Effect` are `Effect.provideService` / `Effect.updateService`.
If you remember `class Foo extends Effect.Service<Foo>()("Foo", { effect: ... })` from
v3 — that's gone. **This codebase standardizes on `Context.Service` + a separate
`Layer.effect`.** (Function-style keys `Context.Service<Shape>("Key")` also exist for
non-class services, but the class form is what the repo uses everywhere.)

---

## 2. Layer composition & app bootstrap

**Build a service's layer** with `Layer.effect(Tag, Effect)`:

```ts
export const EventStoreServiceLive = Layer.effect(
  EventStoreService,
  Effect.gen(function* () {
    const store = yield* Effect.promise(() => initEventStore());
    const readModel = yield* ReadModelService;   // declares a dependency on ReadModelService
    /* … build the shape … */
    return { append, readFrom, getLatestSequence, streamEvents };
  }),
);
```

**Merge sibling layers** with `Layer.mergeAll(...)`; **satisfy a layer's deps** with
`Layer.provide` (deps stay internal) or `Layer.provideMerge` (deps also surface to the
parent). From `src/dashboard/server/server.ts`:

```ts
const DomainServicesLive = Layer.mergeAll(
  ReadModelServiceLive,
  AgentStateServiceLive,
  EventStoreServiceLive.pipe(Layer.provide(ReadModelServiceLive)), // feed the dep in
  TerminalServiceLive,
  /* … */
);

export const makeServerLayer = Layer.unwrap(Effect.gen(function* () {
  const config = yield* ServerConfig;
  const serverApplicationLayer = Layer.mergeAll(
    HttpRouter.serve(makeRoutesLayer, { disableLogger: true }),
    httpListeningLayer,
  );
  return serverApplicationLayer.pipe(
    Layer.provideMerge(DomainServicesLive),
    Layer.provideMerge(HttpServerLive),
    Layer.provideMerge(FetchHttpClient.layer),
    Layer.provideMerge(PlatformServicesLive),
  );
}));

export const runServer = Layer.launch(makeServerLayer); // Effect<never, unknown, ServerConfig>
```

**Concrete runtime layers come from the platform-node package** (NOT from `effect`):

```ts
// src/dashboard/server/server.ts:74-101 — dynamic import keeps it Node-only
const NodeHttpServer = yield* Effect.promise(() => import('@effect/platform-node/NodeHttpServer'));
const { layer }      = yield* Effect.promise(() => import('@effect/platform-node/NodeServices'));
```

**Entry point** (`src/dashboard/server/main.ts:627-633`):

```ts
const main = runServer.pipe(Effect.provide(ServerConfigLayer)); // Effect<never, unknown>
const { runMain } = await import('@effect/platform-node/NodeRuntime'); // Node prod
runMain(main as never);
// (Bun dev path imports '@effect/platform-bun/BunRuntime')
```

> Verified: `server.ts:74-101,343-410`, `main.ts:627-633`, `domain-services.ts:160`.

**⚠️ v3→v4:** key helpers — `Layer.mergeAll`, `Layer.provide`, `Layer.provideMerge`,
`Layer.unwrap` (build a layer from an effect that itself needs config), `Layer.launch`,
`Layer.effectDiscard`, `Layer.effect`, `Layer.sync`, `Layer.scoped`, `Layer.succeed` —
all present and used. The HTTP server is mounted by **`HttpRouter.serve(routesLayer, opts)`**
(a `Layer`), not v3's `HttpServer.serve` over an `HttpApp`.

---

## 3. Schema — entities, branded IDs, unions, transformations

Import: **`import { Schema } from "effect"`** (named export from the package root — the
repo uses this everywhere, not the `effect/Schema` subpath and not `effect/unstable/schema`).

### Struct (entity)

```ts
export const TerminalOutput = Schema.Struct({
  sessionName: Schema.String,
  data: Schema.String,
});
export type TerminalOutput = typeof TerminalOutput.Type;   // decoded type
// wire/storage type: typeof TerminalOutput.Encoded
```

### Optional fields

```ts
Schema.Struct({ issueId: Schema.optional(IssueId) })       // Schema.optional(member)
```

### Literal unions / enums

```ts
const AgentStatus = Schema.Literals(["starting", "running", "stopped", "error", "unknown"]);
const EventTag    = Schema.Literal("agent.started");       // single literal
```

### Discriminated union

```ts
const AgentStartedEvent = Schema.Struct({
  type: Schema.Literal("agent.started"),                   // the discriminant
  sequence: SequenceNumber,
  payload: Schema.Struct({ agentId: AgentId, issueId: IssueId }),
});
const DomainEvent = Schema.Union([AgentStartedEvent, AgentStoppedEvent, /* … 60+ members */]);
export type DomainEvent = typeof DomainEvent.Type;
```

### Branded IDs

The repo's `IssueId` / `AgentId` are currently **plain `Schema.String` aliases** (no real
brand). The real branding API, from `Schema.d.ts:3684`, applies a brand tag via `.pipe`:

```ts
import { Schema } from "effect";
const IssueId = Schema.String.pipe(Schema.brand("IssueId"));   // Schema.brand<B>(id): (s) => brand<…>
type IssueId  = typeof IssueId.Type;                            // string & Brand<"IssueId">
```

Constraint-style refinement uses **`.check(...)`** with a check predicate, not v3's
`.pipe(Schema.filter(...))`:

```ts
// src/lib/cloister/flywheel.ts:20 — real usage
const FlywheelRunIdSchema = Schema.String.check(Schema.isPattern(/^RUN-\d+$/));
```

There is also `Schema.fromBrand(id, ctor)` to attach a `Brand.Constructor`'s checks, and
`Schema.Opaque<Self>()(schema)` to produce a nominal class wrapper.

### Encode / decode

```ts
const decodeDomainEvent = Schema.decodeUnknownSync(DomainEvent);   // throws on failure
const encodeEvent       = Schema.encodeSync(SubstrateBugFiledEvent);
const result            = Schema.decodeUnknownResult(MemoryStatus)(data); // Result, not Either
```

> Verified: `packages/contracts/src/types.ts:5-39`, `events.ts:39-43,1102`,
> `flywheel-stats.ts:75-76`, `src/lib/memory/rollup.ts:119`,
> `Schema.d.ts:1206,1472,1786,3466,3508,3684`.

### Transformations — **API present, codebase does not yet use it**

Grepping `src/` + `packages/` for `decodeTo|encodeTo|transformOrFail|Schema.transform`
returns **nothing** — no transformation is in use today. The v4-beta API (for the
rewrite) is `Schema.decodeTo` / `Schema.encodeTo` composed via `.pipe`, with the
transformation built from the `SchemaTransformation` module:

```ts
import { Schema, SchemaTransformation } from "effect";
// string-on-the-wire ↔ number-in-memory:
const Port = Schema.String.pipe(Schema.decodeTo(Schema.Number, SchemaTransformation.numberFromString));
// custom:
const T = SchemaTransformation.transform({ decode: (s: string) => s.trim(), encode: (s) => s });
// fallible: SchemaTransformation.transformOrFail({ decode, encode })  // returns Effect/Result
```

Prebuilt transformations available: `numberFromString`, `bigintFromString`,
`dateFromString`, `durationFromString`, `trim`, `snakeToCamel`, `toLowerCase`,
`optionFromNullOr`, `passthrough`, …

> Verified from types: `Schema.d.ts:3930` (`decodeTo`), `:4008` (`encodeTo`);
> `SchemaTransformation.d.ts:304,346,745`.

**⚠️ v3→v4 (Schema):**
- `Schema.Literal(a,b,c)` (varargs) → **`Schema.Literals([a,b,c])`** (single array). Single
  literal is still `Schema.Literal(x)`.
- `Schema.Union(a,b)` (varargs) → **`Schema.Union([a,b])`** (array).
- Type extraction: **`typeof X.Type` / `typeof X.Encoded`** (not v3's `Schema.Schema.Type<typeof X>`).
- Decode-to-value returns **`Result`** (`decodeUnknownResult`), not v3's `Either`.
- Refinements: **`.check(Schema.isPattern(...))`** rather than `Schema.pattern` / `Schema.filter`.
- Top-level standalone `Schema.transform` is gone; transformations are **`decodeTo`/`encodeTo` +
  the `SchemaTransformation` module**. The base constraint type is `Schema.Top`, not `Schema.Schema.Any`.

---

## 4. Tagged errors

**Two distinct constructs — pick by where the error lives:**

### `Data.TaggedError` — the dominant repo pattern (~85 definition sites)

`import { Data } from "effect"`. Use for **internal Effect error-channel** errors (not
serialized over the wire):

```ts
export class GitError extends Data.TaggedError('GitError')<{
  readonly command: readonly string[];
  readonly stderr: string;
  readonly exitCode: number;
  readonly cause?: unknown;
}> {}
```

### `Schema.TaggedErrorClass` — for errors that cross the wire (RPC/HTTP)

This is the **v4-beta name** (v3 called it `Schema.TaggedError`). Self-referential generic
+ empty `()` + tag + Schema fields:

```ts
export class PanRpcError extends Schema.TaggedErrorClass<PanRpcError>()("PanRpcError", {
  message: Schema.String,
  code: Schema.optional(Schema.String),
}) {}
```

### Raising and catching

```ts
// raise (src/lib/beads-query.ts:149)
return yield* Effect.fail(new BeadsMissingError({ issueId, workspacePath, transientFailure }));

// catch one tag (src/lib/worktree.ts:94)
someEffect.pipe(Effect.catchTag('GitError', () => Effect.succeed(false)))
```

> Verified: `src/lib/errors.ts:1-50`, `packages/contracts/src/rpc.ts:75`,
> `Schema.d.ts:8553` (`TaggedErrorClass`), `src/lib/beads-query.ts:149`,
> `src/lib/worktree.ts:94`, `src/lib/platform.ts:28`.

**⚠️ v3→v4:** the schema-backed tagged error is **`Schema.TaggedErrorClass<Self>()(tag, fields)`**
(note `…Class` suffix and the empty `()`), not v3's `Schema.TaggedError<Self>()(tag, fields)`.
Sibling class constructors in the same family: `Schema.Class`, `Schema.TaggedClass`,
`Schema.ErrorClass`, `Schema.TaggedErrorClass` (all `Schema.d.ts:8113-8636`). `Data.TaggedError`
is unchanged from v3 and remains the right tool for non-serialized internal errors.

---

## 5. `@effect/sql` (`effect/unstable/sql`)

**Hard finding: the codebase does NOT use `@effect/sql` today, and the SQLite driver is not installed.**

- `@effect/sql-sqlite-bun@4.0.0-beta.73` is listed in the workspace **catalog/devDeps but is
  not present in `node_modules/@effect/`** (only `platform-bun`, `platform-node`,
  `platform-node-shared`, `vitest` are installed). Conversion is deferred to **PAN-447**
  (see the banner comments across `src/lib/database/*.ts`).
- SQLite today is a **hand-rolled runtime-bundled driver**: `src/lib/database/driver.ts`
  dynamically requires `bun:sqlite` (Bun) / `node:sqlite` `DatabaseSync` (Node 22.16+).
  No Effect involvement.
- The abstract `effect/unstable/sql` module *is* installed (`SqlClient`, `SqlSchema`,
  `SqlModel`, `Statement`, `SqlResolver`, `Migrator`, `SqlError`, `SqlConnection`,
  `SqlStream`) — but it ships **no sqlite driver**; the driver layer lives in the absent
  `@effect/sql-sqlite-bun` package. So a live `SqlClient` **layer** cannot be shown from this
  repo — the rewrite must add the driver dependency first.

**Driver question for the rewrite:** the dashboard server is **Node-22-only** (node-pty +
circular-ESM constraints — see `.claude/rules/dashboard-node22-only.md`). A `-bun` SQLite
driver runs under Bun; targeting `@effect/sql-sqlite-bun` for a Node-only server is likely
the wrong adapter. Resolve node-vs-bun driver choice before standardizing on `@effect/sql-*`.

### API straight from the installed types (what the rewrite will write)

**Acquire the client** (it's a `Context.Service` tag):

```ts
import { SqlClient } from "effect/unstable/sql";
const sql = yield* SqlClient.SqlClient;     // Context.Service<SqlClient, SqlClient>
```

**Parameterized query** — `sql` is a tagged-template `Constructor`; interpolations become
bound params:

```ts
const rows = yield* sql<{ id: string }>`SELECT id FROM agents WHERE issue_id = ${issueId}`;
sql.unsafe("SELECT …", [a, b]);             // escape hatch
sql.in("id", ids);                          // safe IN (…) helper
```
> `Statement.d.ts:271` (`Constructor`), `:277` (`unsafe`), `:279` (`in`).

**Transactions** — wrap an effect; all queries inside run in one transaction:

```ts
yield* sql.withTransaction(
  Effect.gen(function* () { yield* sql`INSERT …`; yield* sql`UPDATE …`; })
);
```
> `SqlClient.d.ts:34` (`withTransaction`), `:61` (`SqlClient` tag).

**Rows ↔ Schema (the `SqlSchema` helpers):**

```ts
import { SqlSchema } from "effect/unstable/sql";
const getAgent = SqlSchema.findOne({
  Request: IssueId,
  Result:  AgentSnapshot,
  execute: (issueId) => sql`SELECT * FROM agents WHERE issue_id = ${issueId}`,
});
// findOne → A | NoSuchElementError; findOneOption → Option<A>; findAll → ReadonlyArray<A>; findNonEmpty; void
```
> `SqlSchema.d.ts:56,75,99,111` (`findAll/findNonEmpty/findOne/findOneOption`). Note the
> options keys are capitalized **`Request` / `Result`** (schemas), plus `execute`.

`SqlModel` (`effect/unstable/sql/SqlModel`) provides higher-level CRUD model helpers if the
rewrite wants ActiveRecord-style entities; not exercised in-repo, evaluate against need.

> Verified: `src/lib/database/driver.ts:274-293`, `src/lib/database/index.ts:11`,
> `node_modules/@effect/sql-sqlite-bun` **absent**, `effect/dist/unstable/sql/*` present.

**⚠️ v3→v4:** the module path is **`effect/unstable/sql`**, not `@effect/sql`. The driver is
a separately-published package (`@effect/sql-sqlite-bun`), same as v3 — and here it's *not
installed*. `SqlSchema` option keys are `Request`/`Result` (capitalized); helper return types
key off `Schema.Top`.

---

## 6. HTTP API — declarative `HttpApi`: **YES, available**

**Yes.** `effect/unstable/httpapi` is installed and exports the full declarative stack:
`HttpApi`, `HttpApiGroup`, `HttpApiEndpoint`, `HttpApiBuilder`, `HttpApiClient`,
`HttpApiMiddleware`, `HttpApiSecurity`, `HttpApiSchema`, `HttpApiError`, `HttpApiSwagger`,
`HttpApiScalar`, `HttpApiTest`.

> Verified by directory listing: `node_modules/effect/dist/unstable/httpapi/` contains
> `HttpApi.js`, `HttpApiGroup.js`, `HttpApiEndpoint.js`, `HttpApiBuilder.js`,
> `HttpApiClient.js`, `HttpApiMiddleware.js`, `HttpApiSecurity.js`, etc.

**Target pattern (declarative) — not yet used in-repo. Method shapes below are verified
against the installed `effect/unstable/httpapi/*.d.ts`:**

```ts
import { HttpApi, HttpApiGroup, HttpApiEndpoint, HttpApiBuilder } from "effect/unstable/httpapi";
import { Schema } from "effect";

// Endpoint: HttpApiEndpoint.get(name, path, options?) — an OPTIONS OBJECT carries the
// schemas (params/query/payload/success/error). There is NO .setPath().addSuccess() chain.
const getIssue = HttpApiEndpoint.get("getIssue", "/api/issues/:id", {
  params:  Schema.Struct({ id: Schema.String }),   // path params keyed off ":id"
  success: IssueSnapshot,
  error:   PanRpcError,
});

// Group: HttpApiGroup.make(id).add(...endpoints)  (.add is varargs, not array)
const issuesGroup = HttpApiGroup.make("issues").add(getIssue);

// Api: HttpApi.make(id).add(...groups)
const PanApi = HttpApi.make("pan").add(issuesGroup);

// Handlers: HttpApiBuilder.group(api, groupName, (handlers) => handlers.handle(name, fn))
//   → returns a Layer. handlers.handle(name, handler, options?).
const IssuesLive = HttpApiBuilder.group(PanApi, "issues", (handlers) =>
  handlers.handle("getIssue", ({ path }) => getIssueEffect(path.id)),
);

// Serving layer: HttpApiBuilder.layer(api, ...).  (No HttpApiBuilder.api()/.serve() in v4-beta.)
const ApiLive = HttpApiBuilder.layer(PanApi).pipe(Layer.provide(IssuesLive));
```

> Verified: `HttpApiEndpoint.d.ts:548` (`get` takes `(name, path, options)`; only chain method on
> the endpoint instance is `.prefix()`), `HttpApiGroup.d.ts:77,265` (`make` + varargs `.add`),
> `HttpApi.d.ts:90,144` (`make` + varargs `.add`), `HttpApiBuilder.d.ts:26,41,77` (`layer`,
> `group`, `handlers.handle`).

**What the codebase uses TODAY (the contrast):** low-level **`HttpRouter`** from
`effect/unstable/http`. Routes are individual `HttpRouter.add(method, path, handler)` layers
merged with `Layer.mergeAll`, then mounted with `HttpRouter.serve`:

```ts
// src/dashboard/server/server.ts
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

const dashboardSessionRouteLayer = HttpRouter.add(
  "POST", "/api/dashboard/session",
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    /* … */
    return jsonResponse({ ok: true });
  }),
);

export const makeRoutesLayer = Layer.mergeAll(healthRouteLayer, issuesRouteLayer, /* ~40 route layers */);
// mounted: HttpRouter.serve(makeRoutesLayer, { disableLogger: true })
```

> Verified: `server.ts:17,148-205,294-332,394`.

**⚠️ v3→v4:** both surfaces exist under `effect/unstable/{http,httpapi}`. The rewrite *can*
adopt declarative `HttpApi`, but the current `~40` routes are imperative `HttpRouter.add`
layers — a migration, not a config flip. `HttpServerRequest`/`HttpServerResponse` are the
request/response accessors; `HttpServerRequest.HttpServerRequest` is the service you `yield*`
to read the request.

---

## 7. RPC

**Package:** `effect/unstable/rpc` (sub-modules `effect/unstable/rpc/Rpc`,
`effect/unstable/rpc/RpcGroup`; server/serialization helpers from `effect/unstable/rpc`).

**Define endpoints with `Rpc.make(method, { payload, success, error?, stream? })`:**

```ts
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import { Schema } from "effect";

export const GetSnapshotRpc = Rpc.make(WS_METHODS.getSnapshot, {
  payload: Schema.Struct({}),
  success: DashboardSnapshot,
  error: PanRpcError,
});
export const SubscribeDomainEventsRpc = Rpc.make(WS_METHODS.subscribeDomainEvents, {
  payload: Schema.Struct({}),
  success: DomainEvent,
  stream: true,                       // streaming endpoint
});
```

**Assemble the group with `RpcGroup.make(...endpoints)`:**

```ts
export const PanRpcGroup = RpcGroup.make(SubscribeDomainEventsRpc, GetSnapshotRpc, /* …33 endpoints */);
export type PanRpcGroup = typeof PanRpcGroup;
```

> Verified: `packages/contracts/src/rpc.ts:1-3,219-225,249-252,553-587`.

**Server-side handlers** — `RpcGroup.toLayer(buildEffect)` returning `RpcGroup.of({...})`:

```ts
const PanRpcLayer = PanRpcGroup.toLayer(Effect.gen(function* () {
  const eventStore = yield* EventStoreService;       // handlers can depend on services
  return PanRpcGroup.of({
    [WS_METHODS.subscribeDomainEvents]: (_input) =>
      eventStore.streamEvents.pipe(Stream.map(storedToDomainEvent)),   // streaming → return a Stream
    [WS_METHODS.getSnapshot]: (_input) => readModel.getSnapshot,        // unary → return an Effect
  });
}));
```

**Transport (WebSocket):** `RpcServer.toHttpEffectWebsocket(group)` + `RpcSerialization.layerJson`,
mounted on a normal `HttpRouter.add('GET', '/ws/rpc', …)`:

```ts
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

export const websocketRpcRouteLayer = Layer.unwrap(Effect.gen(function* () {
  const rpcWebSocketHttp = yield* RpcServer.toHttpEffectWebsocket(PanRpcGroup).pipe(
    Effect.provide(Layer.mergeAll(PanRpcLayer, RpcSerialization.layerJson)),
  );
  return HttpRouter.add('GET', '/ws/rpc', Effect.gen(function* () {
    /* origin check … */ return yield* rpcWebSocketHttp;
  }));
}));
```

> Verified: `src/dashboard/server/ws-rpc.ts:10-11,569-590,1086-1110`.

**⚠️ v3→v4:** RPC is `effect/unstable/rpc` (was `@effect/rpc`). Endpoint factory is
**`Rpc.make`**; group is **`RpcGroup.make`**. Handlers are wired with
**`group.toLayer(effect)` + `group.of({...})`** (the group object carries `.toLayer`/`.of`),
not a free-standing `RpcRouter`. Streaming endpoints set `stream: true` and the handler
returns a `Stream`; unary handlers return an `Effect`.

---

## 8. Live state — `Ref` / `SubscriptionRef` / `Stream`

The codebase uses **two** live-state shapes; pick by whether you need change notification.

### `SubscriptionRef` — observable mutable state (the canonical choice)

`import { SubscriptionRef } from "effect"`. `.changes` is a `Stream` that emits the current
value and every subsequent update — the backbone for push subscriptions.

```ts
// src/dashboard/server/services/agent-state-service.ts:103-143
const ref = yield* SubscriptionRef.make<Record<string, AgentRuntimeSnapshot>>({});
yield* SubscriptionRef.update(ref, (cur) => mergeRuntimeBySequence(cur, seeded));
const all = yield* SubscriptionRef.get(ref);
return {
  get: (id)  => SubscriptionRef.get(ref).pipe(Effect.map((m) => m[id])),
  getAll:       SubscriptionRef.get(ref),
  changes:      SubscriptionRef.changes(ref),   // Stream<…> — feed to RPC subscribers
};
```

### Plain closure state (read model) + event `Stream` for the push

The `ReadModelService` keeps a **mutable `let state` closure** (not a `Ref`) and rebuilds a
snapshot on demand; the live `subscribeDomainEvents` push rides the EventStore's event
`Stream` instead of a `SubscriptionRef`:

```ts
// EventStore exposes a Stream built from a callback-style subscription:
const streamEvents = Stream.callback<StoredEvent>((queue) =>
  Effect.acquireRelease(
    Effect.sync(() => store.subscribe((event) => Queue.offerUnsafe(queue, event))),
    (unsubscribe) => Effect.sync(unsubscribe),
  ),
);

// the RPC handler maps it and merges a heartbeat tick:
const heartbeats = Stream.tick('15 seconds').pipe(Stream.map(createSystemHeartbeatEvent));
return eventStore.streamEvents.pipe(Stream.map(storedToDomainEvent), Stream.merge(heartbeats));
```

> Verified: `agent-state-service.ts:24,103-143`, `domain-services.ts:286-294`,
> `read-model.ts:369+`, `ws-rpc.ts:583-589`, `Stream.d.ts:563,721`, `Queue.d.ts:650`.

**⚠️ v3→v4:**
- **`Stream.async` → `Stream.callback`.** The callback receives a `Queue` and you push with
  **`Queue.offerUnsafe(queue, value)`**.
- **`unsafe*` methods are renamed to an `*Unsafe` suffix** in v4 (e.g. v3 `Queue.unsafeOffer`
  → v4 **`Queue.offerUnsafe`**; same pattern across the API).
- **`Stream.tick(durationInput)`** for a periodic tick; durations accept **string literals**
  like `'15 seconds'` / `'500 millis'` directly (no `Duration.seconds(15)` needed).
- `SubscriptionRef.{make,get,update,changes}` are the live-state primitives; `.changes` is the
  observable `Stream`. `Stream.merge`, `Stream.map`, `Stream.mapEffect`, `Stream.filter`,
  `Stream.acquireRelease` are all present and used.

---

## Appendix — consolidated v3→v4 gotchas to watch during the rewrite

1. **Module homes moved into `effect/unstable/*`** — http, httpapi, rpc, sql, schema. But
   platform *adapters* (`@effect/platform-node`, `@effect/platform-bun`) are still separate
   installed packages for the concrete runtime layers.
2. **`Effect.Service` is gone.** Services = `class … extends Context.Service<Self, Shape>()("key")`
   plus a separate `Layer.effect`.
3. **Schema unions/literals take arrays:** `Schema.Literals([...])`, `Schema.Union([...])`.
4. **Schema type extraction:** `typeof X.Type` / `typeof X.Encoded`; base constraint `Schema.Top`.
5. **Schema refinement:** `.check(Schema.isPattern(...))`; branding `.pipe(Schema.brand("Id"))`.
6. **Schema transformations:** `Schema.decodeTo`/`encodeTo` + `SchemaTransformation.*` (no top-level
   `Schema.transform`). Not yet used in-repo.
7. **Decode returns `Result`, not `Either`** (`Schema.decodeUnknownResult`).
8. **Wire-tagged errors:** `Schema.TaggedErrorClass` (was `Schema.TaggedError`). Internal errors:
   `Data.TaggedError` (unchanged, ~85 definition sites).
9. **RPC:** `Rpc.make` / `RpcGroup.make` / `group.toLayer` + `group.of({...})`;
   `RpcServer.toHttpEffectWebsocket` + `RpcSerialization.layerJson`.
10. **Streams:** `Stream.callback` (was `Stream.async`), `Queue.offerUnsafe` (was
    `Queue.unsafeOffer`), `Stream.tick('15 seconds')` with string durations.
11. **HttpApi declarative stack is available** (`effect/unstable/httpapi`) — adopting it is a
    real migration off the current imperative `HttpRouter.add` routes, not a switch.
12. **SQL via `@effect/sql` is not wired** — driver pkg uninstalled, current SQLite is a
    hand-rolled `node:sqlite`/`bun:sqlite` driver (PAN-447 deferral). Node-22-only server makes
    the `-bun` driver choice a live question.
