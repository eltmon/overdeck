# Effect bridging

`Effect.promise` and `Effect.tryPromise` bridge a thunk that returns a native
`Promise`. When a callee already returns `Effect.Effect`, yield it directly so
its fiber runs and its typed error channel remains available to the caller.

```ts
// Correct: the thunk returns a Promise.
const module = yield* Effect.promise(() => import('./module.js'));

// Correct: the callee already returns an Effect.
yield* autoRevertMerge(projectPath);

// Incorrect: this creates an Effect that tries to await another Effect.
yield* Effect.promise(() => autoRevertMerge(projectPath));
```

## Failure mode

With `effect@4.0.0-beta.73`, `Effect.promise(() => anEffect)` calls `.then()`
on the thunk result. An Effect value is not thenable, so the fiber raises
`TypeError: internalCall(...).then is not a function`; the route's HTTP handler
returns a 500 response and no statement after the broken `yield*` runs.

Do not mistake this for a successful no-op. A direct `yield*` both executes the
callee and exposes its typed error channel. Use `Effect.catch` to map expected
typed failures to a route result. A JavaScript `try/catch` surrounding a
`yield*` catches neither typed failures nor defects, so use `Effect.catchCause`
when a best-effort operation must also swallow defects.

## Preserve valid Promise bridges

Keep `Effect.promise` and `Effect.tryPromise` around:

- dynamic `import()`, which genuinely returns a Promise;
- a callee whose documented return type is genuinely `Promise<T>`.

[PAN-3567](https://github.com/eltmon/overdeck/issues/3567) corrected five
shipping route sites and one Effect-level cleanup fallback, removing 17
baselined dashboard type errors and lowering the ratchet from 47 to 30. The
mechanical authoring gate, [PAN-3568](https://github.com/eltmon/overdeck/issues/3568),
has landed as `npm run lint:effect-diagnostics`; see
[EFFECT-DIAGNOSTICS.md](EFFECT-DIAGNOSTICS.md). The rule applies anywhere this
repository uses Effect, not only dashboard routes.

## In-repo code: no façades

An exported Effect wrapper whose whole body bridges to another function in this
repository is never correct. It adds a second name and a second calling
convention but no behaviour, and callers usually run it straight back to a
Promise. [PAN-3958](https://github.com/eltmon/overdeck/issues/3958) found 220 of
the first shape, 301 of the second, and 82 pairs of the third in `src/lib`, and
is deleting them.

| Shape | What it looks like |
| --- | --- |
| A, Promise façade | `export const foo = (x) => Effect.promise(() => fooPromise(x))`, or `Effect.tryPromise({ try: () => fooPromise(x), catch })`, where `fooPromise` is an in-repo `async` function |
| B, sync façade | `export const foo = (x) => Effect.sync(() => fooSync(x))`, or `Effect.try({ try: () => fooSync(x), catch })`, where `fooSync` is an in-repo synchronous function |
| C, sync/async twin | exported `foo` and `fooSync` in one module, each implementing the same operation independently |

One operation has one exported variant. A module may export Effect functions
and `async` functions for different operations; a genuine Effect body
(`Effect.gen` pipelines, services, retries) stays Effect. A synchronous twin is
kept only where its module header names the synchronous callers that cannot
await.

When Effect code needs an in-repo Promise or sync function, bridge at the call
site and keep the failure semantics the caller had:

| Former façade | Former call | Call site now |
| --- | --- | --- |
| `Effect.promise` | `yield* foo(x)` | `yield* Effect.promise(() => foo(x))` |
| `Effect.tryPromise` | `yield* foo(x)` | `yield* Effect.tryPromise(() => foo(x))` |
| either | `foo(x)` passed to `Effect.all`, `Effect.retry`, `Effect.timeout`, `Effect.forEach`, or a `pipe` built before running | the same inline bridge, so laziness and re-execution are preserved |
| either | `await Effect.runPromise(foo(x))` | `await foo(x)` |
| `Effect.promise` | `Effect.runPromise(foo(x).pipe(Effect.catch(() => Effect.succeed(d))))` | `await foo(x)` (the catch never saw a rejection: it was a defect) |
| `Effect.tryPromise` | `Effect.runPromise(foo(x).pipe(Effect.catch(() => Effect.succeed(d))))` | `await foo(x).catch(() => d)` |
| `Effect.tryPromise` | `Effect.catchTag('<Tag>', …)` on the result | `yield* Effect.tryPromise({ try: () => foo(x), catch: (cause) => new <Tag>({ … }) })`, copying the old `catch:` mapping |
| `Effect.sync` / `Effect.try` | `yield* foo(x)` | `fooSync(x)` as a plain statement; keep `yield* Effect.try(() => fooSync(x)).pipe(…)` when the result was piped into `Effect.catch`, `Effect.orElse`, or `Effect.catchTag` |

`npm run lint:effect-facades` (`scripts/lint-effect-facades.sh`) enforces this
as a shrink-only ratchet. `node scripts/audit-effect-boundary.mjs` counts
Shapes A, B and C per `src/lib` module; the guard fails with a `NEW:` row when
a module's count rises above `scripts/effect-facades-baseline.txt` or a module
appears that the baseline lacks. After deleting façades or twins, lower the
baseline in the same commit:

```bash
bash scripts/lint-effect-facades.sh --update
```

`--update` only lowers rows and drops rows that reached zero. Raising a row, for
example to follow a module rename, is a hand edit of the baseline in a commit
whose message carries an issue reference; `scripts/lint-ratchet-audit.sh`
rejects it otherwise. `node scripts/audit-effect-boundary.mjs --json --usage`
lists every façade and twin with `file:line` and its production and test
references.
