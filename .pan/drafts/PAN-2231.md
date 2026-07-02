# PAN-2231 — Lint ban on new source-introspection tests (baseline the 28 existing offenders)

**Issue:** https://github.com/eltmon/overdeck/issues/2231
**Verified-Against:** main @ `bc95c5956c6ea9a47f7e5629ac3f0772be0853c3`
**Queue phase:** Phase 1 — guardrails first (item 6 of `docs/codebase-health/REFACTOR-QUEUE.md`)
**Status:** draft

> Executor note: this PRD is the implementation brief. Every claim was verified against the
> sha above. References are **grep anchors** (quoted code) — search, don't trust line
> numbers. The offender list in §3 WILL have drifted by execution time — regenerate it with
> the exact command given there; never copy the list from this document.

---

## 0. Glossary (define before use)

- **Source-introspection test** — a test under `tests/` that reads a production source file
  under `src/` (via `readFileSync`/`readFile`/`readdirSync`) and asserts on its text with
  string or regex matching (`.match(...)`, `toContain(...)`). Such tests break whenever the
  code MOVES, even when behavior is identical — they turn refactors into outages.
- **The #2124 incident** — the red-main this issue exists to prevent recurring: PR #2124
  decomposed `src/dashboard/server/routes/workspaces.ts`; 9 tests in
  `tests/lib/cloister/review-agent.test.ts` still `readFileSync`'d `workspaces.ts` and
  regex-matched for route code that had moved, so all 9 went red on main and on every
  branch. The incident and its repointing fix are documented in
  `docs/codebase-health/FIX-review-agent-test.md` (grep anchor:
  `still \`readFileSync\`s \`workspaces.ts\` and regex-matches`).
- **No-loss audit test** — a *sanctioned* introspection class: a focused test that
  enumerates an old surface (routes, exports) and blocks a refactor until every item is
  accounted for (house rule "Refactor existing surfaces with an explicit no-loss audit").
  Examples: `tests/unit/lib/overdeck/no-loss-matrix.test.ts`,
  `tests/unit/lib/pan-1908-no-loss-audit.test.ts`. These are deliberate and stay — they are
  baselined, and NEW ones enter through the audited-addition path (D2).
- **Detector** — the heuristic this lint uses to flag a test file (D1): the file contains a
  source-read call AND a `src/`-pointing path expression. Exact patterns in WI-1.
- **Baseline** — `scripts/source-introspection-baseline.txt` (new), one repo-relative test
  path per line, sorted. Shrink-only: entries may be removed freely; additions are audited
  (issue reference in the adding commit — enforced by PAN-2227's ratchet audit once both
  are registered, D4).
- **Repointing** — the long-term fix for a baselined offender: replace text assertions with
  behavioral assertions (call the function, assert the effect) or assert against exported
  constants instead of raw source text. Out of scope here except as guidance text.
- **Guard-script convention** — bash script, `#!/usr/bin/env bash`, `set -euo pipefail`,
  `cd "$(dirname "$0")/.."`, wired into `npm run lint` via a `lint:*` entry — the style of
  `scripts/lint-file-size.sh` and `scripts/lint-state-writes.sh`.

---

## 1. Problem (verified evidence)

1. The #2124 red-main class is live, not historical: `tests/lib/cloister/review-agent.test.ts`
   still introspects — grep anchor (present today):
   ```ts
   const agentSrc = readFileSync(
     resolve(import.meta.dirname, '../../../src/lib/cloister/review-agent.ts'),
     'utf-8',
   );
   ```
   followed by `agentSrc.match(/const gate = await resolveConflictGate` — a regex over
   production source. Any extraction from `review-agent.ts` (Phase 3 touches
   `cloister/`) reddens these tests again.
2. **28 test files** currently trip the detector (regenerate per §3 — verified at
   `bc95c5956c`). They span every test tier: `tests/cloister/`, `tests/dashboard/`,
   `tests/e2e/`, `tests/integration/`, `tests/lib/`, `tests/unit/`.
3. Nothing guards against NEW introspection tests: `npm run lint` runs
   `eslint src/ ...` (src only — tests are not linted by eslint at all), and no custom
   guard script scans `tests/`.
4. Batch 2/3 of the refactor queue (route thinning, cloister decomposition) moves exactly
   the code these tests pin — without this ratchet, each decomposition risks repeating
   #2124.

---

## 2. Locked design decisions

- **D1 — Heuristic pair-presence detector, not dataflow analysis.** A test file is flagged
  when it contains a read call (`readFileSync` / `readFile(` / `readdirSync`) AND a
  `src/`-pointing path expression (a quoted literal containing `src/…​.ts(x)`, or a
  quoted `'src'` path segment followed by a comma). A bash lint cannot trace variables;
  perfect precision is impossible. High recall is the goal; the baseline absorbs current
  false positives, and future false positives take the audited-addition path. Rejected
  alternative: requiring the literal to sit lexically inside the read call — misses the
  common pattern where the path is built in a helper or constant lines away.
- **D2 — No-loss audit tests are sanctioned, baselined, and auditable-in.** They are
  deliberately introspective by design and always belong to an issue, so adding a new one
  to the baseline in a commit that references that issue is exactly the audit trail we
  want. The lint's failure message must name this path explicitly.
- **D3 — Shrink-only baseline with `--update`, mirroring PAN-2227 semantics.** Check mode
  fails on (a) a flagged file not in the baseline and (b) a stale baseline entry (file
  deleted or no longer flagged), the latter with the one-command fix
  (`bash scripts/lint-source-introspection.sh --update`). `--update` drops stale entries
  and NEVER adds — adding is a manual, audited edit.
- **D4 — Register the new baseline with PAN-2227's ratchet audit.** PAN-2227 (queue item 5,
  scheduled before this one) ships `scripts/lint-ratchet-audit.sh` with set-based increase
  detection for `eslint-any-allowlist.json`. Add `scripts/source-introspection-baseline.txt`
  to its audited files as a plain-text set (one path per line): added lines are increases
  requiring an issue reference; removals free. **Implementation checkpoint:** if
  `scripts/lint-ratchet-audit.sh` does not exist when you execute (PAN-2227 not yet
  landed), skip this work item, leave a `TODO(PAN-2231)` note in the script header of
  WI-1's script, and record the gap in your completion report — do not block on it and do
  not implement your own audit.
- **D5 — This PRD's own test file will trip the detector and is baselined on day one.**
  WI-4's test writes fixture test files whose *content* contains `src/...ts` literals and
  `readFileSync` calls, so the outer test file itself matches D1's patterns when the real
  detector scans the real `tests/` tree. Add `tests/unit/scripts/lint-source-introspection.test.ts`
  to the generated baseline in the same commit. Do not contort the fixture strings to dodge
  the heuristic — an honest baseline entry beats obfuscated fixtures.
- **D6 — Scope is `tests/` only.** The issue targets "a file under tests/". Frontend tests
  living under `src/dashboard/frontend/src/**` are out of scope (they are eslint-covered
  and colocated with their source; extending the guard there is a possible follow-up, not
  this issue).

---

## 3. Verified references (grep anchors) and the offender list

| File | Anchor to grep for | What it locates |
| --- | --- | --- |
| `tests/lib/cloister/review-agent.test.ts` | `'../../../src/lib/cloister/review-agent.ts'` | live introspection example (incident file) |
| `docs/codebase-health/FIX-review-agent-test.md` | `9 tests now get \`null\` matches` | the #2124 incident record |
| `scripts/lint-file-size.sh` | `set -euo pipefail` | guard-script convention to copy |
| `package.json` | `npm run lint:file-size` | tail of the `lint` chain to extend (see Re-verify — PAN-2227 appends `lint:ratchet-audit` here first) |
| `tests/unit/scripts/lint-overdeck-boundaries.test.ts` | `function makeTempRepo(): string` | fixture-repo test pattern to copy |
| `tests/unit/lib/overdeck/no-loss-matrix.test.ts` | `const ROUTES_DIR = join(WORKSPACE_ROOT, 'src', 'dashboard', 'server', 'routes');` | sanctioned no-loss class + the segment-style path pattern the detector must catch |

**Regenerate the offender list at execution time** (authoring-time result: **28 files**;
this WILL drift as Phase 0 decompositions repoint tests):

```bash
LITERAL_RE='["'\''][^"'\'']*src/[^"'\'']*\.tsx?["'\'']'
SEGMENT_RE="'src'[[:space:]]*,"
for f in $(grep -rl -E "readFileSync|readFile\(|readdirSync" tests/ --include="*.ts" --include="*.tsx" | sort); do
  grep -Eq "$LITERAL_RE" "$f" || grep -Eq "$SEGMENT_RE" "$f" && echo "$f"
done
```

Authoring-time list for reference only (do NOT copy into the baseline — regenerate):
`tests/cloister/session-rotation.test.ts`, `tests/cloister/sync-main.test.ts`,
`tests/dashboard/cache-service-init-home.test.ts`, `tests/e2e/styleguide-conformance.spec.ts`,
`tests/integration/agent-spawning.test.ts`, `tests/integration/foreman-swarm.test.ts`,
`tests/lib/cloister/review-agent.test.ts`, `tests/lib/memory/{cli,e2e,injection,observations,query-expansion,rollup}.test.ts`,
`tests/lib/mirrorProjectSkills.test.ts`, `tests/lib/settings-api.test.ts`,
`tests/unit/dashboard/routes/dashboard-continue-readers.test.ts`,
`tests/unit/dashboard/server/routes/projects.test.ts`,
`tests/unit/lib/agents/dispatch-tier.test.ts`,
`tests/unit/lib/cloister/deacon-swarm-enumerate.test.ts`,
`tests/unit/lib/ohmypi-no-loss-audit.test.ts`, `tests/unit/lib/overdeck/no-loss-matrix.test.ts`,
`tests/unit/lib/overdeck/process-services.test.ts`,
`tests/unit/lib/overdeck/sacred-file-invariant.test.ts`,
`tests/unit/lib/pan-1908-no-loss-audit.test.ts`,
`tests/unit/lib/pan-dir/retire-continues-modules.test.ts`,
`tests/unit/lib/smee-process.test.ts`, `tests/unit/scripts/lint-overdeck-boundaries.test.ts`,
`tests/unit/scripts/lint-state-writes.test.ts`.

Precision notes (verified): requiring the quote-bounded literal (not a bare `src/...ts`
token) excludes 4 files whose only match is a doc-comment mention of the file under test
(`tests/dashboard/tracker-config.test.ts`, `tests/dashboard/version-api.test.ts`,
`tests/lib/reopen.test.ts`, `tests/unit/lib/pan-444-post-merge-step0.test.ts`) — keep the
quote bounds exactly as specified. The `SEGMENT_RE` pattern is what catches
`no-loss-matrix.test.ts`-style `join(ROOT, 'src', ...)` builds; it also flags the two
`tests/unit/scripts/lint-*.test.ts` fixture builders — accepted false positives, baselined
(D1).

---

## 4. Requirements

### Functional
- **FR-1** A new guard `scripts/lint-source-introspection.sh` fails (exit 1) when any
  `tests/**/*.ts(x)` file matches the D1 detector and is not listed in
  `scripts/source-introspection-baseline.txt`.
- **FR-2** The failure message names the file, states WHY (the #2124 outage class), and
  gives both remedies: (preferred) assert behavior or exported constants instead of source
  text; (deliberate introspection, e.g. a no-loss audit) add the file to the baseline in a
  commit whose message references an issue.
- **FR-3** Check mode fails on stale baseline entries (file deleted or no longer flagged)
  with the fix command; `bash scripts/lint-source-introspection.sh --update` drops stale
  entries, never adds, and writes the file sorted.
- **FR-4** The guard is wired into `npm run lint` as `lint:source-introspection`, appended
  to the `lint` chain.
- **FR-5** The baseline is generated at execution time by running the detector, committed
  in the same change, and the guard passes on the current tree.
- **FR-6** (checkpoint, D4) `scripts/source-introspection-baseline.txt` is registered in
  `scripts/lint-ratchet-audit.sh` as a set-type audited file — additions require an issue
  reference in the adding commit; removals free. Fallback if PAN-2227 has not landed: skip,
  leave `TODO(PAN-2231)` note, report the gap.

### Non-functional
- **NFR-1** Guard-script convention (bash, `set -euo pipefail`, repo-root cd); no
  production `src/**` changes; no test behavior changes — this issue does NOT repoint any
  existing offender.
- **NFR-2** Runtime under ~2 seconds (two greps per candidate file; candidates are only
  files containing a read call).
- **NFR-3** Deterministic output ordering (`sort`) so baseline diffs are stable.
- **NFR-4** The new script and test file each stay under 1,000 lines (file-size guard).

---

## 5. Work items

### WI-1 — `scripts/lint-source-introspection.sh` *(FR-1, FR-2, FR-3)*

**Files:** new `scripts/lint-source-introspection.sh`.

**Steps:**
1. Header comment: name the #2124 incident and `docs/codebase-health/FIX-review-agent-test.md`;
   state the detector heuristic and both remedies; document `--update` and the never-add rule.
2. Constants and detector exactly as §3's regenerate command: candidate files =
   `grep -rl -E "readFileSync|readFile\(|readdirSync" tests/ --include="*.ts" --include="*.tsx"`;
   a candidate is flagged when it matches `LITERAL_RE` or `SEGMENT_RE` (copy both regex
   definitions verbatim from §3 — the quoting is load-bearing).
3. Check mode: flagged file not in baseline → error per FR-2, exit 1. Baseline entry whose
   file is missing or no longer flagged → `✖ stale baseline entry: <path> — run: bash
   scripts/lint-source-introspection.sh --update`, exit 1. Success:
   `✓ source-introspection guard passed (no new introspection tests; baseline current)`.
4. `--update` mode: rewrite the baseline to (existing entries ∩ currently-flagged files),
   sorted; print `✓ baseline updated: N dropped, M kept`; exit 0. Never add entries.
5. Baseline file format: one repo-relative path per line, no comments, sorted — identical
   in spirit to `scripts/file-size-baseline.txt` minus the line-count column.

### WI-2 — Generate and commit the baseline *(FR-5)*

**Files:** new `scripts/source-introspection-baseline.txt`.

**Steps:** run the WI-1 script's detector (or `--update` against an initially-empty file —
NO: `--update` never adds; instead generate the initial file directly with the §3 command
piped to the baseline path), add `tests/unit/scripts/lint-source-introspection.test.ts`
(D5 — WI-4's file, which will exist by commit time), sort, commit. Then run
`bash scripts/lint-source-introspection.sh` and confirm `✓`.

### WI-3 — Wire into the lint chain *(FR-4)*

**Files:** `package.json`.

**Steps:** append to the `lint` chain (grep anchor for today's tail:
`npm run lint:file-size` — see Re-verify: PAN-2227 appends `lint:ratchet-audit` after it
first; chain after whatever is last):

```json
"lint:source-introspection": "bash scripts/lint-source-introspection.sh",
```
and `&& npm run lint:source-introspection` at the end of the `lint` value.

### WI-4 — Tests *(FR-1, FR-2, FR-3)*

**Files:** new `tests/unit/scripts/lint-source-introspection.test.ts`.

Copy the fixture pattern of `tests/unit/scripts/lint-overdeck-boundaries.test.ts` (grep
anchor: `function makeTempRepo(): string`): temp dir, install the script under test into
`<root>/scripts/`, seed `<root>/tests/` fixture files, run with
`execFileSync('bash', [script], { cwd: root })`, assert on exit + output. (`execFileSync`
in vitest fixtures is fine — the no-`execSync` rule covers server-reachable production
code.) Cases:
1. fixture test with `readFileSync` + quoted `src/lib/x.ts` literal, empty baseline →
   fails, output contains the file path and both remedies (FR-2 wording);
2. same file listed in baseline → passes;
3. segment-style fixture (`join(root, 'src', 'lib')` + `readdirSync`) → flagged;
4. read call but only a doc-comment `src/foo.ts` mention (no quoted literal) → NOT flagged;
5. stale baseline entry (listed file absent) → check fails with `--update` instruction;
   after `--update` the entry is gone and check passes;
6. `--update` never adds: a flagged-but-unbaselined file still fails check after `--update`.

No timers, retries, or delays anywhere in these tests — the fake-timers rule (restated in
§6) applies to none of them.

### WI-5 — Register with the ratchet audit *(FR-6; implementation checkpoint per D4)*

**Files:** `scripts/lint-ratchet-audit.sh` (from PAN-2227).

**Steps:** if the script exists, add `scripts/source-introspection-baseline.txt` to its
audited files with set semantics over plain text lines (added line = increase requiring an
issue ref; removal free — the same comparison its allowlist handler does, minus JSON
parsing), and extend `tests/unit/scripts/lint-ratchet-audit.test.ts` with one
addition-without-ref-fails + one removal-passes case for the new file. If the script does
not exist, execute the D4 fallback.

---

## 6. Intersecting repo rules (restated — do not assume recall)

- **ESLint runs `src/` only with `--no-inline-config`** — tests are not eslint-covered
  (why this guard is a script), and no inline disable comments anywhere.
- **No `execSync` in server-reachable code** — n/a for bash guards and vitest fixtures;
  the fixture tests use `execFileSync` per the existing `tests/unit/scripts/` convention.
- **Fake timers for any delay/retry/backoff test** (`vi.useFakeTimers()` +
  `vi.advanceTimersByTimeAsync`) — n/a here; no time-dependent tests.
- **Async tmux primitives only** (`sendKeysAsync`) — n/a; no tmux interaction.
- **File-size guard** — new files <1,000 lines.
- **commitlint** — all-lowercase subjects; scope enum `cloister, dashboard, workspace,
  cli, review, beads, db, specialists, terminal, infra, deps`. Suggested:
  `chore(infra): lint ban on new source-introspection tests (pan-2231)`.
- **Do not weaken existing tests** — this issue baselines offenders; it must not edit,
  repoint, or delete any existing test (that is follow-up work per offender).
- **Never `--no-verify`; never `git stash`; never edit rendered harness context files.**

---

## 7. Acceptance criteria (1:1 with work items)

- **AC-1 (WI-1/FR-1,2):** a new fixture test matching the detector and absent from the
  baseline fails `bash scripts/lint-source-introspection.sh` with output naming the file,
  the #2124 rationale, and both remedies. (unit)
- **AC-2 (WI-1/FR-3):** a stale entry fails check naming `--update`; `--update` drops it
  and never adds; doc-comment-only mentions are not flagged. (unit)
- **AC-3 (WI-2/FR-5):** `scripts/source-introspection-baseline.txt` exists, is sorted,
  contains the freshly-regenerated offender set including
  `tests/unit/scripts/lint-source-introspection.test.ts` (D5), and the guard prints `✓` at
  HEAD.
- **AC-4 (WI-3/FR-4):** `npm run lint` runs the guard and is green on this change.
- **AC-5 (WI-4):** all six test cases pass in `npm run test:unit`.
- **AC-6 (WI-5/FR-6):** either the baseline is registered in the ratchet audit with two
  new passing test cases, or the D4 fallback is executed and reported.
- **AC-END:** full `npm run typecheck && npm run lint && npm test` green; the diff touches
  only the two new scripts-side files, `package.json`, the new test file, and (if WI-5 ran)
  the ratchet-audit script + its test.

---

## 8. Re-verify at execution

1. **PAN-2227 (queue item 5) lands before this** and edits the same `package.json` `lint`
   chain tail and ships `scripts/lint-ratchet-audit.sh`. Re-grep the `lint` value; append
   after its last entry. Confirm whether the audit script exists to decide WI-5 vs the D4
   fallback.
2. **Regenerate the offender list** (§3 command) — Phase 0 decompositions (PAN-2156,
   PAN-2154, PAN-2153, PAN-2151) may add, repoint, or remove introspection tests. The
   authoring-time count of 28 is reference, not data.
3. **Re-grep the incident anchor** `'../../../src/lib/cloister/review-agent.ts'` in
   `tests/lib/cloister/review-agent.test.ts` — if a Phase 3 item already repointed it, the
   §1 evidence wording in your commit message should not claim it is still live.
4. **Confirm `tests/unit/scripts/` still holds the fixture-test convention** (anchor
   `function makeTempRepo(): string`).

## 9. Out of scope

- Repointing or fixing any of the baselined offenders (per-offender follow-up work; the
  baseline makes them enumerable).
- Extending the guard to frontend tests under `src/dashboard/frontend/` (D6).
- Banning fixture-writing tests that merely create `src/`-shaped temp trees — they are
  accepted false positives absorbed by the baseline (D1).
