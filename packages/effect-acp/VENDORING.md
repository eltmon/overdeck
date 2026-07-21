# effect-acp vendoring record

- Upstream repository: https://github.com/pingdotgg/t3code
- Upstream path: `packages/effect-acp`
- Upstream commit: `5ca32661b7dc8d512305c3bb9237d994a41a1af5`
- Vendored on: 2026-07-17
- License: MIT, Copyright (c) 2026 T3 Tools Inc.

The package source tree was copied from the pinned commit without changing file names or relative paths. Overdeck intentionally keeps the package name `effect-acp` and marks it private so future upstream comparisons remain direct.

## Local integration edits

- `package.json` keeps `effect` on `catalog:`, which resolves to Overdeck's Effect `4.0.0-beta.73`.
- The upstream `tsgo` and Vite Plus scripts were replaced with plain `tsc` and Vitest commands available in the Overdeck workspace.
- `@effect/openapi-generator` and `vite-plus` were omitted. `scripts/generate.ts` is retained for provenance, but generation is not part of the vendored package's normal typecheck or test path.
- `@types/node` uses Overdeck's existing Node type version because the root catalog does not define it.
- `tsconfig.json` replaces the upstream repository-wide base configuration with the explicit strict `tsc` settings used by Overdeck's `packages/contracts` package. Its include path is limited to `src`, which contains the package tests and excludes the retained generator with its intentionally omitted dependency. `allowImportingTsExtensions` preserves the upstream `.ts` import specifiers under plain `tsc`.
- The root Bun workspace list includes `packages/effect-acp`, the root package depends on it through `workspace:*`, and the root Vitest configuration includes `packages/effect-acp/src/**/*.test.ts` in normal and benchmark-enabled discovery.
- The root TypeScript configuration enables `allowImportingTsExtensions` because the preserved package exports point directly at upstream source files whose imports retain their `.ts` suffixes.
- `LICENSE` records the upstream MIT attribution locally.

## Effect 4.0.0-beta.73 compatibility edits

- `src/errors.ts`: replaced the five upstream `Schema.Defect()` calls with `Schema.Defect`. Effect 4.0.0-beta.73 exports `Defect` as a schema value, while beta.78 changed it to a zero-argument factory. The schema fields and runtime behavior are otherwise unchanged.
