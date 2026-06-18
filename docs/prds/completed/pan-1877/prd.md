# PAN-1877 — Test isolation: no test may write the real `~/.panopticon`

**Status:** in progress on `main` (operator-authorized direct implementation, 2026-06-14).
**Scope:** immediate. Executed together with PAN-1883 and PAN-1884.
**Audit basis:** [`docs/STATE-STORAGE-AUDIT.md`](../../docs/STATE-STORAGE-AUDIT.md) §2, §5

> **Executor note (read first).** Line numbers drift — every anchor below is a **search string**;
> confirm in-file before editing. The hard enforcement is the runtime fs guard (WI-2); the offender
> list (WI-4) is what the guard will surface, not an exhaustive hand-list to trust.

---

## Background

Many tests build `~/.panopticon` paths from `homedir()` directly instead of the override-aware
`getOverdeckHome()`, so they write the developer's **real** state. A crash, OOM-kill, or parallel
race leaves the non-crash-safe `afterEach` restore unrun and the real state corrupted. The blast
radius spans review-status, **agent state**, shadow-state, and more.

**Verified offender inventory** (tests that build `homedir()+'.panopticon'` paths and do destructive
FS ops — `grep` reproducible):

| Test file | real subdir written | ops |
| --- | --- | --- |
| `tests/lib/cloister/deacon-ci-retry.test.ts` | `review-status.json` | mkdir/rm/unlink/write |
| `tests/unit/lib/cloister/pan-344-auto-merge.test.ts` | `review-status` | mkdir/write |
| `tests/lib/cloister/deacon-orphan-recovery.test.ts` | `agents/` | mkdir/rm/unlink/write (**deletes real agent state**) |
| `tests/lib/status-context.test.ts` | `agents/` | mkdir/rm/write |
| `tests/lib/shadow-state.test.ts` | `shadow-state/` | mkdir/rmdir/unlink |
| `tests/lib/shadow-mode.test.ts` | `shadow-state/` | unlink |
| `tests/unit/dashboard/server/routes/show.test.ts` | `shadow-state/` | unlink |
| `tests/lib/config-migration.test.ts` | `skills/` | mkdir/rm/write |

**Verified production-side root** (modules that hardcode `join(homedir(), '.panopticon', …)` rather
than `getOverdeckHome()`, so a test calling them writes real home regardless of test-local fixes):
`src/lib/review-status-json.ts`, `src/lib/shadow-utils.ts`, `src/lib/smee.ts`, `src/lib/env-loader.ts`,
`src/lib/config-migration.ts`, `src/lib/workspace-manager.ts`, `src/lib/runtimes/codex.ts`,
`src/lib/runtimes/pi.ts`, `src/lib/session-format-converter.ts`, `src/lib/test-runner.ts`.

The seam already exists: `src/lib/paths.ts` (search `getOverdeckHome`) — `process.env.OVERDECK_HOME
|| join(homedir(), '.panopticon')`. Note `paths.ts` *also* exports a top-level `const OVERDECK_HOME`
evaluated **at import time** (search `export const OVERDECK_HOME`); modules that capture that const
will NOT see a `OVERDECK_HOME` set after import — only `getOverdeckHome()` is dynamic. This
matters for both the fix and the test-setup ordering.

---

## Glossary

- **`OVERDECK_HOME`** — env var relocating all Overdeck state; read by `getOverdeckHome()`.
- **Runtime write-guard** — a `fs`/`fs/promises` wrapper installed in test setup that throws if a
  write targets the **real** `${homedir()}/.panopticon`. The hard, mechanism-agnostic enforcement.
- **Per-worker home** — each Vitest worker gets its own `OVERDECK_HOME` subtree (keyed by
  `VITEST_POOL_ID`) so tests cannot pollute each other's state within a shared run.

---

## Requirements

- **FR-1** — `src/lib/review-status-json.ts` (and the other state modules it is reasonable to fix in
  this pass) resolve their path from `getOverdeckHome()`, not `homedir()`.
- **FR-2** — **No test reads or writes the developer's real `~/.panopticon`.** Enforced by a runtime
  write-guard, not only by inspection.
- **FR-3** — Each Vitest worker runs against its own throwaway `OVERDECK_HOME` subtree; the real
  home is never the target.
- **FR-4** — Every offender in the inventory above writes under the temp home, verified by the guard.
- **NFR-1** — Retry/backoff tests touched here keep using **fake timers** (`vi.useFakeTimers()` +
  `vi.advanceTimersByTimeAsync()`), never real `setTimeout` (repo rule).

---

## Work items

### WI-1 — `review-status-json.ts` honors `OVERDECK_HOME` (FR-1)

**File:** `src/lib/review-status-json.ts`. Current (search `DEFAULT_STATUS_FILE`):

```ts
import { homedir } from 'os';
const DEFAULT_STATUS_FILE = join(homedir(), '.panopticon', 'review-status.json');
```

Replace with a dynamic resolver and use it as each function's default arg (search every
`filePath = DEFAULT_STATUS_FILE`):

```ts
import { getOverdeckHome } from './paths.js';
function defaultStatusFile(): string { return join(getOverdeckHome(), 'review-status.json'); }
// … each fn: (…, filePath = defaultStatusFile())
```

Remove the unused `homedir` import and the const. **Also** convert the same hardcoded pattern in the
production modules the offender tests call transitively — at minimum `src/lib/shadow-utils.ts`
(shadow-state path) — to `getOverdeckHome()`, since WI-2's guard will otherwise fire on
shadow-state tests. (The non-state modules — `smee.ts`, runtimes, etc. — are out of scope unless the
guard surfaces them; list any it does as follow-ups rather than expanding this PR unboundedly.)

Note `src/lib/review-status.ts` keeps a `DEFAULT_STATUS_FILE` from `homedir()` only as a **comparison
sentinel** (the JSON path is rejected there); converting it to `getOverdeckHome()` is harmless
cleanup but not required for correctness — do it only if the guard flags it.

### WI-2 — Runtime fs write-guard (hard enforcement) (FR-2)

**File:** `tests/setup/no-real-home-writes.ts` (wire via `setupFiles` in `vitest.config.ts`).

Install a guard that wraps the write surface of `fs` and `fs/promises` and throws if the resolved,
absolute target is under the **real** `${homedir()}/.panopticon` (computed from `os.homedir()`, NOT
the temp `OVERDECK_HOME`). Cover at minimum:

- sync: `writeFileSync`, `appendFileSync`, `mkdirSync`, `rmSync`, `rmdirSync`, `unlinkSync`,
  `renameSync`, `cpSync`, `createWriteStream`
- promises: `writeFile`, `appendFile`, `mkdir`, `rm`, `rename`, `cp`

Throw a clear error (`[test-guard] write to REAL ~/.panopticon blocked: <path> — set OVERDECK_HOME
to a temp dir`). Provide a minimal allowlist hook for any test that legitimately must touch real home
(none expected). This catches every offender regardless of which module (test or production helper)
issues the write — the property a static grep cannot guarantee.

### WI-3 — Per-worker throwaway `OVERDECK_HOME` (FR-3)

**Files:** `vitest.config.ts`, `tests/setup/panopticon-home.ts`.

- `globalSetup` creates a run root `mkdtemp(pan-test-root-*)` and removes it on teardown.
- A **setupFile** (runs per worker, before test modules import) sets
  `process.env.OVERDECK_HOME = join(root, 'worker-' + (process.env.VITEST_POOL_ID ?? '0'))` and
  `mkdirSync` it. Because `paths.ts` evaluates its `OVERDECK_HOME` const at import, the setupFile
  MUST run before any state module is imported — verify Vitest setupFile ordering and that no
  offender imports a state module at top-of-file before setup. Where a module captured the const too
  early, prefer `getOverdeckHome()` (WI-1) so the value is read dynamically.

Decision: **per-worker** (not one home for the whole run) so parallel workers cannot pollute each
other's state — this is the cross-file-pollution dimension a single shared home would leave open.

### WI-4 — Fix the surfaced offenders (FR-4)

For each test in the inventory, replace `join(homedir(), '.panopticon', …)` with
`join(getOverdeckHome(), …)` (import from `src/lib/paths.js`). With WI-2+WI-3 these land in the
per-worker temp home; the existing backup/restore dances become unnecessary (may stay, now harmless).
Re-anchored locations for the primary review-status offender, `tests/lib/cloister/deacon-ci-retry.test.ts`
(verified current): `REVIEW_STATUS_FILE` at `:101`; `writeStatusFile` builds `join(homedir(), '.panopticon')`
at `:116`–`:118`; backup/restore at `:150`–`:151` and `:166`–`:168`. (v1 of this PRD cited the April
original `:69`/`:83` — stale; use these.)

**NFR-1 restated:** `deacon-ci-retry.test.ts` exercises CI-retry backoff — keep fake timers; if WI-4
surfaces a real `setTimeout`, convert it.

### WI-5 — Static grep as a second line of defense

Keep a lightweight `tests/meta/no-real-panopticon-home.test.ts` that greps `tests/` for
`homedir()`-near-`.panopticon`-write patterns and fails listing offenders. It is the **secondary**
guard (cheap, catches obvious regressions at author time); WI-2 is the authoritative one.

---

## Acceptance criteria (1:1 with work items)

- **AC-1 (WI-1)** — `grep -n "homedir" src/lib/review-status-json.ts` returns nothing; it imports
  `getOverdeckHome`. `shadow-utils.ts` shadow-state path uses `getOverdeckHome()`.
- **AC-2 (WI-2)** — A test that intentionally writes `${homedir()}/.panopticon/pan-test-guard` **fails**
  under the guard. The guard covers the sync + promise write APIs listed.
- **AC-3 (WI-3)** — Inside a test, `process.env.OVERDECK_HOME` points to a `pan-test-root-*/worker-*`
  dir; two workers get distinct subtrees.
- **AC-4 (WI-4)** — After a full `npm test`, `stat`/`find` shows **no** mtime or content change under
  real `~/.panopticon/review-status.json`, `~/.panopticon/shadow-state`, `~/.panopticon/agents`, or
  `~/.panopticon/conversations`. `grep -rn "homedir(), '.panopticon'"` over the inventoried tests
  returns nothing.
- **AC-5 (WI-5)** — the static guard passes clean and fails when a `homedir()`-write is reintroduced.
- **AC-6 (NFR-1)** — no new real-`setTimeout` delay in touched retry tests.

---

## Related issues — addresses vs. relates (softened per review)

- **Resolves one concrete corruption vector behind** [#1720](https://github.com/eltmon/panopticon-cli/issues/1720) (cloister auto-resume tests fail
  under parallel run). **But** [#1720](https://github.com/eltmon/panopticon-cli/issues/1720)'s comments also call for **tmux-socket isolation**,
  which is **out of scope here** — this PRD fixes real-home file writes; tmux socket isolation remains
  a separate fix. Do not mark [#1720](https://github.com/eltmon/panopticon-cli/issues/1720) resolved on this alone.
- **Same family, different mechanism (NOT fixed by this):** [#1880](https://github.com/eltmon/panopticon-cli/issues/1880) (cross-file mock
  pollution), [#1824](https://github.com/eltmon/panopticon-cli/issues/1824) (real-timer flakiness), [#1783](https://github.com/eltmon/panopticon-cli/issues/1783) (Playwright fixture). WI-3 reduces
  shared-state surface but does not address mock/timer pollution.
- **Prevents** the silent **agent-state** corruption found in the audit (deacon-orphan-recovery,
  status-context writing real `~/.panopticon/agents/`).
- **Sibling fixes** executed together: [#1883](https://github.com/eltmon/panopticon-cli/issues/1883), [#1884](https://github.com/eltmon/panopticon-cli/issues/1884).
