# A4 — Circular-dependency ratchet

**Epic:** A (Stop the bleeding) — see [`docs/CODEBASE-HEALTH-ROADMAP.md`](../CODEBASE-HEALTH-ROADMAP.md)
**Issue:** [PAN-2230](https://github.com/eltmon/overdeck/issues/2230)
**Status:** implemented, in review

---

## Glossary

- **Circular dependency** — an import cycle where module A imports B, B imports C, … and C imports A. Node.js strict ESM rejects these, which is why the dashboard server cannot run from `tsx` source-mode and must be pre-built.
- **madge** — the Node.js dependency-graph tool used to detect cycles: https://github.com/pahen/madge.
- **Baseline** — `scripts/circular-deps-baseline.txt`: one canonical cycle per line. A baselined cycle may disappear (lowering the ratchet); a new cycle fails CI.
- **Guard-script convention** — this repo enforces invariants with bash scripts wired into `npm run lint` (e.g. `scripts/lint-file-size.sh`, `scripts/lint-state-writes.sh`). A4 adds one more in exactly that style.

---

## Problem

The codebase has 77 import cycles under `src/` (production source only; test and `.d.ts` files excluded). The dashboard server's circular ESM imports force a dist-only run posture: `tsx` / source-mode fails under Node strict ESM, so every dashboard server edit requires a rebuild, and stale `dist/` is a recurring "why doesn't my fix work" incident. Nothing stops new cycles from appearing. This sub-issue installs a ratchet: **no new directed import cycle in `src/`**. It does NOT break any existing cycle (that is Epic B work).

---

## Requirements

**FR-1** — A new guard `scripts/lint-circular-deps.sh` fails (exit 1) when a directed import cycle under `src/` is not present in `scripts/circular-deps-baseline.txt`.

**FR-2** — The guard fails when `scripts/circular-deps-baseline.txt` contains stale entries for cycles that no longer exist.

**FR-3** — The guard passes (exit 0) on the current branch with a committed baseline capturing today's 77 cycles.

**FR-4** — Running `bash scripts/lint-circular-deps.sh --update` lowers the baseline by dropping removed cycles; it never adds new cycles.

**FR-5** — Running `bash scripts/lint-circular-deps.sh --regen` rewrites the baseline from the current cycle list.

**FR-6** — The guard is wired into `npm run lint` as `lint:circular`, and the chained `lint` script runs it before `lint:ratchet-audit`.

**FR-7** — Additions to `scripts/circular-deps-baseline.txt` are audited by `scripts/lint-ratchet-audit.sh`: raising the ratchet requires an issue reference in the commit message.

**NFR-1** — Pure addition: the only changes are the new script, a small Node canonicalization helper, the new baseline file, the `package.json` `scripts` block, the ratchet-audit integration, and this PRD doc. No production `src/**` code is modified.

**NFR-2** — Deterministic output: cycles are canonicalized (paths prefixed with `src/`, cycle members sorted, cycles sorted) so madge's rotation/order differences do not create noise.

**NFR-3** — Test files (`*.test.ts`, `*.test.tsx`, `*.spec.ts`, `*.spec.tsx`), test/mock directories (`__tests__`, `__mocks__`), and TypeScript declaration files (`*.d.ts`) are excluded from the scan. The ratchet guards production source cycles only.

---

## Proposal

### WI-1 — Install madge as a devDependency

```bash
bun add -d madge@^8
```

### WI-2 — Create `scripts/lint-circular-deps.sh`

See the implemented script at `scripts/lint-circular-deps.sh`. Key behaviors:

- Runs `node_modules/.bin/madge --circular --json --extensions ts,tsx src/`.
- Uses `scripts/canonicalize-circular-deps.js` to normalize each cycle to a stable line.
- Check mode compares the current cycle set to the baseline and fails on new or stale cycles.
- `--update` drops cycles that no longer exist.
- `--regen` rewrites the baseline from the current cycle list.

Make it executable: `chmod +x scripts/lint-circular-deps.sh`.

### WI-3 — Generate `scripts/circular-deps-baseline.txt`

```bash
bash scripts/lint-circular-deps.sh --regen
wc -l scripts/circular-deps-baseline.txt   # expect 77 entries
```

### WI-4 — Extend `scripts/lint-ratchet-audit.sh`

Add `scripts/circular-deps-baseline.txt` to the files audited for unaudited ratchet increases, alongside `scripts/file-size-baseline.txt` and `eslint-any-allowlist.json`.

### WI-5 — Wire into the lint chain

In `package.json`:

```jsonc
"lint": "... && npm run lint:source-introspection && npm run lint:circular && npm run lint:ratchet-audit && npm run lint:quarantine-audit",
"lint:circular": "bash scripts/lint-circular-deps.sh",
```

### WI-6 — Verify

```bash
# FR-3: green on the current branch
bash scripts/lint-circular-deps.sh ; echo "check_exit:$? (expect 0)"

# FR-4: --update is a no-op when baseline is current
bash scripts/lint-circular-deps.sh --update ; echo "update_exit:$? (expect 0)"

# FR-5: --regen reproduces the same baseline
bash scripts/lint-circular-deps.sh --regen
bash scripts/lint-circular-deps.sh ; echo "regen_exit:$? (expect 0)"

# FR-6: full lint chain still green
npm run lint ; echo "lint_exit:$? (expect 0)"
```

---

## Acceptance criteria

- **AC-1 (FR-1):** a new import cycle under `src/` makes `bash scripts/lint-circular-deps.sh` exit 1.
- **AC-2 (FR-2):** removing a baselined cycle without running `--update` makes the guard exit 1 with a stale-baseline message.
- **AC-3 (FR-3):** on the committed branch, `bash scripts/lint-circular-deps.sh` exits 0, and `scripts/circular-deps-baseline.txt` has 77 canonical cycle entries (production source only).
- **AC-4 (FR-4):** `bash scripts/lint-circular-deps.sh --update` exits 0 and drops only removed cycles.
- **AC-5 (FR-5):** `bash scripts/lint-circular-deps.sh --regen` exits 0 and reproduces the current baseline.
- **AC-6 (FR-6):** `npm run lint` exits 0 and its chain includes `lint:circular` before `lint:ratchet-audit`.
- **AC-7 (FR-7):** `bash scripts/lint-ratchet-audit.sh` exits 0 on HEAD; a synthetic commit adding a baseline line without an issue reference exits non-zero.
- **AC-8 (NFR-1):** `git diff --name-only origin/main..feature/pan-2230` shows only `scripts/lint-circular-deps.sh`, `scripts/canonicalize-circular-deps.js`, `scripts/circular-deps-baseline.txt`, `scripts/lint-ratchet-audit.sh`, `package.json`, `.pan/drafts/PAN-2230.md`, queue-doc updates, this PRD doc, and per-issue record updates — no production `src/**` edits.

---

## Intersecting repo rules

- **No bandaids / fix the root cause:** a real guard wired into CI, matching the existing `lint-*.sh` convention — not a one-off check.
- **Surgical changes (Karpathy #3):** every changed line traces to this brief.
- **Commit per coherent step**, conventional commits (commitlint + husky active), never `--no-verify`.
- **Worktree discipline:** you are in `workspaces/feature-pan-2230` on branch `feature/pan-2230`. Verify with `git branch --show-current` before editing.

## Out of scope

- Breaking any of the 77 existing cycles (that is Epic B extraction work).
- Running madge against `packages/`, `apps/`, or `scripts/`.
- Replacing madge with `dependency-cruiser`.
