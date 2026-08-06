# Effect bridging

`Effect.promise` and `Effect.tryPromise` bridge a thunk that returns a native
`Promise`. When a callee already returns `Effect.Effect`, yield it directly so
its fiber runs and its typed error channel remains available to the caller.

```ts
// Correct: the thunk returns a Promise.
const module = yield* Effect.promise(() => import('./module.js'));

// Correct: the callee already returns an Effect.
const result = yield* writeFeedbackFile(options);

// Incorrect: this creates an Effect that tries to await another Effect.
const result = yield* Effect.promise(() => writeFeedbackFile(options));
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
planned mechanical authoring gate is [PAN-3568](https://github.com/eltmon/overdeck/issues/3568);
its companion design document will live at `docs/EFFECT-DIAGNOSTICS.md`.

Until that gate lands, run `bash scripts/lint-dashboard-types.sh` to ensure the
baseline does not grow. The rule applies anywhere this repository uses Effect,
not only dashboard routes.
