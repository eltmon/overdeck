# A2 — Adopt `ts-reset` (safe granular rules)

**Epic:** A (Stop the bleeding) — see [`docs/CODEBASE-HEALTH-ROADMAP.md`](../CODEBASE-HEALTH-ROADMAP.md)
**Branch:** `codebase-health/a2` (already created, stacked on `codebase-health/a1`) · **Base:** `codebase-health/a1`
**Executor:** GLM-5.2 (handoff conversation), supervised by conversation #182
**Mode:** orchestrated handoff — **do NOT run `pan done`**, do NOT open a PR, do NOT touch the pipeline. Commit on this branch; the orchestrator reviews and merges.

---

## Glossary

- **`ts-reset`** — the package [`@total-typescript/ts-reset`](https://github.com/mattpocock/ts-reset): a set of global type declarations that tighten TypeScript's overly-loose standard-library types. Activated by importing it from a `.d.ts` file in the compilation.
- **Granular rule** — `ts-reset` exposes individual rules as subpath imports (e.g. `@total-typescript/ts-reset/filter-boolean`) so you can adopt them one at a time instead of the all-or-nothing `@total-typescript/ts-reset`.
- **`filter-boolean`** — makes `array.filter(Boolean)` narrow the result type (removes `null`/`undefined`/`false` from the element type). Without it, `[1, null].filter(Boolean)` is typed `(number | null)[]`; with it, `number[]`. Very low breakage; pure improvement.
- **`array-includes`** — lets `readonlyArray.includes(x)` accept a wider `x` without a cast. Low breakage.
- **The A1 ratchet** — the `no-explicit-any` ESLint gate already on this branch (this worktree inherits it). Any new `: any` / `as any` you write fails `npm run lint`. Fix type errors with **real types, never `any`**.
- **Root typecheck scope** — `npm run typecheck` runs `tsc --noEmit` against `tsconfig.json`, whose `include` is `src/**/*` and `exclude` is `["node_modules","dist","**/*.test.ts","src/dashboard/**/*"]`. So it covers all non-test, non-dashboard `src/` code. The dashboard has its own tsconfig and is **out of scope for A2** (documented follow-up).

---

## Problem

TypeScript's stdlib types are loose in ways that silently inject `any`/unsafe values even under `strict: true`. The most common in this repo is `array.filter(Boolean)`, which keeps falsy members in the type, so downstream code either crashes on the value it "removed" or papers over it with a cast. `ts-reset` fixes these at the type level globally. Adopting it tightens the floor that the A1 ratchet sits on.

`ts-reset` is **all-or-nothing if imported as the root package**, and the aggressive rules (`json-parse`, `fetch`) turn `JSON.parse(...)` and `response.json()` into `unknown`, which forces narrowing at hundreds of call sites — too large for "stop the bleeding." This sub-issue therefore adopts only the **safe, low-blast-radius granular rules** and explicitly defers the aggressive ones.

---

## Requirements

**FR-1** — `@total-typescript/ts-reset` is a `devDependency`.
**FR-2** — A `src/reset.d.ts` activates the granular rules **`filter-boolean`** and **`array-includes`** (and only those).
**FR-3** — `npm run typecheck` exits 0 (root scope). Any type errors surfaced by the new rules are fixed with **real types**, never `any` / `as any` / `as unknown as`.
**FR-4** — `npm run lint` exits 0 (the A1 `no-explicit-any` ratchet must stay green — you must not introduce any new explicit `any`).

**NFR-1** — Behavior-preserving: the only production-code edits are **type-level** fixes for errors the new rules surface (e.g. removing a now-unnecessary cast, adding a precise type, a narrowing guard). No runtime logic changes.
**NFR-2** — Scope is the root tsconfig only. Do NOT add `ts-reset` to the dashboard tsconfigs in this sub-issue (it is a separate follow-up to bound blast radius).
**NFR-3** — Adopt only `filter-boolean` and `array-includes`. Do NOT import `json-parse`, `fetch`, `is-array`, `set-has`, `map-has`, `storage`, or the root `@total-typescript/ts-reset` aggregate.

---

## Proposal

### WI-1 — Install ts-reset

```bash
bun add -d @total-typescript/ts-reset
```

Confirm it lands in `devDependencies`.

### WI-2 — Verify the granular subpath exports, then activate

**Implementation checkpoint (do this first):** confirm the exact subpath names the installed version exposes. Read the `exports` field:

```bash
node -e "console.log(Object.keys(require('@total-typescript/ts-reset/package.json').exports))"
```

You expect to see entries including `./filter-boolean` and `./array-includes`. Use the exact names printed.

- **If both `./filter-boolean` and `./array-includes` are exported:** create `src/reset.d.ts`:
  ```ts
  // Adopt only the safe, low-blast-radius ts-reset rules (A2). Aggressive rules
  // (json-parse, fetch, …) are deferred — see docs/codebase-health/A2-ts-reset.md.
  import '@total-typescript/ts-reset/filter-boolean';
  import '@total-typescript/ts-reset/array-includes';
  ```
- **If the granular subpaths are NOT exported in this version:** do NOT fall back to importing the full `@total-typescript/ts-reset` (that has a large blast radius). **Stop and report to the orchestrator** with the actual `exports` keys.

`src/reset.d.ts` is automatically included by the root `tsconfig.json` (`include: ["src/**/*"]`); no tsconfig edit is needed. Verify it is picked up in WI-3.

### WI-3 — Make typecheck pass

```bash
npm run typecheck
```

This runs `tsc --noEmit` (root) + `tsc --noEmit -p tsconfig.hooks.json`. The new rules may surface type errors — chiefly at `.filter(Boolean)` sites that previously carried a redundant cast or a `| null` the code now correctly sees as removed. Fix each with a real type:

- Remove now-redundant `as T` / `!` that only existed to work around the loose `filter(Boolean)` type.
- Where a genuine narrowing is needed, add a type guard or precise annotation.
- **Never** silence an error with `any` / `as any` / `as unknown as` — that both defeats A2's purpose and trips the A1 ratchet.

**Blast-radius checkpoint:** if `npm run typecheck` surfaces **more than ~40 errors**, or any are ambiguous/non-mechanical, do NOT push through them. Instead: keep only `filter-boolean` in `src/reset.d.ts` (drop `array-includes`), re-run, and if still large, commit `filter-boolean`-only, then **report the remaining count to the orchestrator** so `array-includes` (and the rest) can be split into a follow-up. Document whatever you defer in this PRD's "Deferred" section.

### WI-4 — Verify the ratchet stayed green

```bash
npm run lint    # A1 no-explicit-any ratchet must still pass (no new `any`)
```

### WI-5 — Prove ts-reset is active

Create a temporary probe and typecheck it, then delete it:

```bash
cat > src/__tsreset_probe.ts <<'EOF'
const probe: number[] = [1, null, 2, undefined].filter(Boolean);
export default probe;
EOF
npx tsc --noEmit src/__tsreset_probe.ts 2>&1 | head    # should report NO error about number[]
rm src/__tsreset_probe.ts
```

Without `filter-boolean` active, assigning `(number|null|undefined)[]` to `number[]` errors; with it active, it typechecks. (If `tsc <file>` ignores the project config, instead temporarily add the probe and run `npm run typecheck`; the key check is that the `.filter(Boolean)` result is `number[]`.)

---

## Acceptance criteria

- **AC-1 (FR-1/FR-2):** `@total-typescript/ts-reset` is in `devDependencies`; `src/reset.d.ts` imports exactly `filter-boolean` + `array-includes` (or `filter-boolean` only if the blast-radius checkpoint forced the split — documented under "Deferred").
- **AC-2 (FR-3):** `npm run typecheck` exits 0.
- **AC-3 (FR-4):** `npm run lint` exits 0.
- **AC-4 (NFR-1):** `git diff origin/main..codebase-health/a2 -- src/` shows only type-level edits + `src/reset.d.ts` — no runtime logic changes, no new `any`.
- **AC-5 (WI-5):** the probe confirms `filter(Boolean)` narrows.

---

## Intersecting repo rules (restated — do not assume recall)

- **No bandaids / fix the root cause:** fix surfaced type errors with real types; never `any`.
- **A1 ratchet is live on this branch:** new explicit `any` fails `npm run lint`. If you must touch a file already in `eslint-any-allowlist.json`, still don't add new `any` there.
- **Surgical changes (Karpathy #3):** every edit traces to a ts-reset-surfaced error. Don't reformat or refactor unrelated code.
- **Commit per coherent step**, conventional commits (commitlint+husky active), never `--no-verify`. Suggested: `build(ts-reset): add @total-typescript/ts-reset`, `chore(a2): activate filter-boolean + array-includes`, `fix(types): resolve ts-reset filter(Boolean) narrowing errors`.
- **Worktree discipline:** you are in `workspaces/codebase-health-a2` on branch `codebase-health/a2`. Verify with `git branch --show-current` before editing. Never `git checkout` another branch; never `git stash`.
- **Do NOT run `pan done` / `pan start` / open a PR.** Surface blockers to the orchestrator.

## Deferred (fill in if the blast-radius checkpoint splits work)

- _List any rule you did not adopt (e.g. `array-includes`) and the typecheck error count that justified deferring it._

## Out of scope

- The aggressive rules `json-parse`, `fetch`, `set-has`, `map-has`, `is-array`, `storage` (each needs call-site narrowing — separate follow-up).
- Applying `ts-reset` to the dashboard tsconfigs (`src/dashboard/**`).
- Removing existing `any` (that's the A1 allowlist cleanup, ongoing).
