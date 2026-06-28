# A1 — ESLint `no-explicit-any` ratchet

**Epic:** A (Stop the bleeding) — see [`docs/CODEBASE-HEALTH-ROADMAP.md`](../CODEBASE-HEALTH-ROADMAP.md)
**Branch:** `codebase-health/a1` (already created) · **Base:** `main@f2649f1ca`
**Executor:** GPT-5.5 (handoff conversation), supervised by conversation #182
**Mode:** orchestrated handoff — **do NOT run `pan done`**, do NOT open a PR, do NOT touch the pipeline. Commit on this branch; the orchestrator reviews and merges.

---

## Glossary

- **Explicit `any`** — a source-visible `any`: `as any`, `: any` annotations, `<any>` casts, `any[]`. This is what `@typescript-eslint/no-explicit-any` flags. (It does NOT flag *implicit* any or unsafe operations — those are a later sub-issue, out of scope here.)
- **Ratchet** — a mechanical gate that lets a metric move in only one direction. Here: the count of files containing explicit `any` can only **decrease**. New `any` in a clean file fails lint.
- **Baseline allowlist** — `eslint-any-allowlist.json` at the repo root: a JSON array of the repo-relative paths of every `src/` file that contains explicit `any` *today*. These files are exempted from the rule so the build stays green; **removing a file from this list is the unit of future cleanup work**.
- **The lint door** — `npm run lint` (defined in `package.json`), which runs `eslint src/` first. CI runs it at `.github/workflows/ci.yml:98` (`run: npm run lint`).

---

## Problem

`tsconfig.json` sets `"strict": true`, but that guarantee is undermined by **1,810 explicit `any` across 384 `src/` files** (measured at `main@09b2e423c`; top offenders: `src/dashboard/server/routes/workspaces.ts` 62, `src/dashboard/server/routes/issues.ts` 50, `src/dashboard/server/services/issue-data-service.ts` 42). Each `any` is a hole the compiler cannot see through: when a shape changes, broken callers behind an `any` are **not** flagged, so the break surfaces at runtime and becomes a "fix." This is a primary mechanical reason the repo spends more effort fixing than shipping.

The repo's ESLint is currently a no-op for this: `.eslintrc.json` has `"rules": {}` and **`@typescript-eslint/eslint-plugin` is not installed** (only `@typescript-eslint/parser@6.21.0` is). So the rule that would catch new `any` does not exist yet.

This sub-issue does **not** remove existing `any`. It installs the ratchet: **zero new explicit `any`**, with the current 384 offenders quarantined in a visible, shrinkable allowlist.

---

## Requirements

**FR-1** — `@typescript-eslint/no-explicit-any` is enabled at `error` for all of `src/`.
**FR-2** — Every `src/` file that contains explicit `any` *today* is exempted via a committed `eslint-any-allowlist.json`, so `npm run lint` passes on this branch with no code changes to those files.
**FR-3** — Introducing a new explicit `any` in any `src/` file **not** in the allowlist (and not a test file) makes `eslint src/` (and therefore `npm run lint`) exit non-zero.
**FR-4** — Test files (`**/*.test.ts`, `**/*.test.tsx`, `**/__tests__/**`) are exempt from the rule (tests legitimately use `any`); they are NOT added to the allowlist.

**NFR-1** — No type-aware linting is added (no `parserOptions.project`). `no-explicit-any` is syntactic; keep lint fast.
**NFR-2** — No production code under `src/` is modified to remove `any` in this sub-issue. The only code-shaped changes are config + the generated allowlist + `package.json` deps. (Editing a file to *remove* an `any` is fine if incidental, but it is not the goal and must not be the bulk of the diff.)
**NFR-3** — The change is surgical (Karpathy rule #3): touch only `package.json`, `.eslintrc.json`→`.eslintrc.cjs`, and the new `eslint-any-allowlist.json`. Do not "improve" adjacent config.

---

## Proposal

### WI-1 — Install the plugin

```bash
bun add -d @typescript-eslint/eslint-plugin@^6.21.0
```

Pin `^6.21.0` to match the installed `@typescript-eslint/parser@6.21.0` (mismatched major versions break the plugin). Confirm it lands in `devDependencies`.

### WI-2 — Convert `.eslintrc.json` → `.eslintrc.cjs`

The allowlist must be `require`d from a sibling JSON, which JSON config can't do — so convert to CJS. **Delete `.eslintrc.json`** and create `.eslintrc.cjs`:

**Before** (`.eslintrc.json`):
```json
{
  "root": true,
  "env": { "node": true, "es2022": true },
  "parser": "@typescript-eslint/parser",
  "parserOptions": { "ecmaVersion": 2022, "sourceType": "module" },
  "ignorePatterns": ["dist/", "node_modules/", "src/lib/caveman/*.js"],
  "rules": {}
}
```

**After** (`.eslintrc.cjs`):
```js
// Loads the baseline quarantine generated in WI-3. Empty/missing is tolerated
// so the file is valid before the allowlist exists (bootstrap).
let anyAllowlist = [];
try {
  anyAllowlist = require('./eslint-any-allowlist.json');
} catch {
  /* allowlist not generated yet */
}

module.exports = {
  root: true,
  env: { node: true, es2022: true },
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  plugins: ['@typescript-eslint'],
  ignorePatterns: ['dist/', 'node_modules/', 'src/lib/caveman/*.js'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
  },
  overrides: [
    // FR-4: tests legitimately use `any` — keep them out of the ratchet.
    {
      files: ['**/*.test.ts', '**/*.test.tsx', '**/__tests__/**'],
      rules: { '@typescript-eslint/no-explicit-any': 'off' },
    },
    // FR-2: baseline quarantine of existing offenders. SHRINK this list to clean up.
    ...(anyAllowlist.length
      ? [{ files: anyAllowlist, rules: { '@typescript-eslint/no-explicit-any': 'off' } }]
      : []),
  ],
};
```

### WI-3 — Generate the baseline allowlist

With WI-1 + WI-2 done (allowlist still empty), run eslint over `src/`, capture the files that violate `no-explicit-any`, and write them to `eslint-any-allowlist.json` as repo-root-relative paths. eslint exits non-zero when it finds errors, so capture stdout from the error path:

```bash
node -e '
const { execSync } = require("child_process");
let out;
try { out = execSync("npx eslint src/ -f json", { maxBuffer: 1 << 28 }).toString(); }
catch (e) { out = e.stdout.toString(); }   // non-zero exit still has JSON on stdout
const data = JSON.parse(out);
const root = process.cwd() + "/";
const files = [...new Set(
  data
    .filter(r => r.messages.some(m => m.ruleId === "@typescript-eslint/no-explicit-any"))
    .map(r => r.filePath.replace(root, ""))
)].sort();
require("fs").writeFileSync("eslint-any-allowlist.json", JSON.stringify(files, null, 2) + "\n");
console.error("allowlist:", files.length, "files");
'
```

Expected: roughly **384** files (the exact number is whatever eslint reports — that is the authoritative baseline; do not hand-edit it). The `.eslintrc.cjs` already `require`s this file, so the next lint run picks it up.

### WI-4 — Verify the ratchet

1. **Green baseline (FR-2):**
   ```bash
   npx eslint src/        # must exit 0 — every current offender is quarantined
   ```
2. **New `any` is caught (FR-3):** pick a file NOT in the allowlist (e.g. create a scratch `src/__ratchet_probe.ts` containing `export const x: any = 1;`), then:
   ```bash
   npx eslint src/__ratchet_probe.ts   # must exit non-zero, reporting no-explicit-any
   rm src/__ratchet_probe.ts
   ```
   (Use a brand-new file so it is guaranteed not in the allowlist.)
3. **Full lint door still green:**
   ```bash
   npm run lint
   ```
   `eslint src/` must pass. The other chained linters (`lint:effect`, `lint:permissions`, `lint:state-writes`, `lint:overdeck-boundaries`, `lint:skills`, `lint:prompts`) should be unaffected by this change; if one fails for a reason unrelated to `no-explicit-any`, report it to the orchestrator rather than working around it (do not edit those guards).

### WI-5 — Document the cleanup unit

Append a short note to the bottom of [`docs/CODEBASE-HEALTH-ROADMAP.md`](../CODEBASE-HEALTH-ROADMAP.md) under a new `### Cleaning up the `any` allowlist` heading: to clean a file, remove its entry from `eslint-any-allowlist.json`, fix the resulting `no-explicit-any` errors with real types, and confirm `npx eslint src/` passes. One file (or a few) per commit.

---

## Acceptance criteria

- **AC-1 (FR-1, FR-2):** On `codebase-health/a1`, `npx eslint src/` exits 0, and `.eslintrc.cjs` sets `@typescript-eslint/no-explicit-any: 'error'` with the allowlist override present.
- **AC-2 (FR-3):** A new explicit `any` in a fresh non-allowlisted, non-test file causes `npx eslint src/ <that file>` to exit non-zero citing `@typescript-eslint/no-explicit-any`.
- **AC-3 (FR-4):** An `any` added to a `*.test.ts` file does NOT fail lint.
- **AC-4 (NFR-2/NFR-3):** `git diff --stat main...codebase-health/a1` shows only: `package.json`, `bun.lock` (or lockfile), `.eslintrc.json` (deleted), `.eslintrc.cjs` (added), `eslint-any-allowlist.json` (added), and the two docs files. No production `src/**` files modified.
- **AC-5:** `npm run lint`'s `eslint src/` stage passes.

---

## Intersecting repo rules (restated — do not assume recall)

- **No bandaids / fix the root cause** (`CLAUDE.md`): use the real lint rule, not a `grep` counter. The allowlist is a *visible, shrinkable baseline*, not a permanent exemption.
- **Surgical changes** (Karpathy #3): every changed line traces to this brief. Do not reformat or "improve" unrelated config.
- **Commit per coherent step** with conventional-commit messages (commitlint + husky are active). Suggested: `build(eslint): add @typescript-eslint plugin`, `chore(eslint): no-explicit-any ratchet with baseline allowlist`. Never `--no-verify`.
- **Worktree discipline:** you are in `workspaces/codebase-health-a1` on branch `codebase-health/a1`. Verify with `git branch --show-current` before your first edit. Never `git checkout` another branch; never `git stash`.
- **Do NOT run `pan done`, `pan start`, or open a PR.** This is orchestrated handoff work, not pipeline work.

## Out of scope (explicitly)

- Removing existing `any` (that is the ongoing cleanup the allowlist enables).
- `no-unsafe-*` type-aware rules (separate, heavier sub-issue — needs `parserOptions.project`).
- `ts-reset` (sub-issue A2) and the file-size guard (A3).
- Migrating to ESLint flat config / ESLint 9.
