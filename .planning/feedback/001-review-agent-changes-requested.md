---
specialist: review-agent
issueId: PAN-443
outcome: changes-requested
timestamp: 2026-04-27T10:46:34Z
---

# Verdict: CHANGES_REQUESTED

## Summary
PAN-443 renames the package scope from `@panopticon/*` to `@panctl/*` and wires up a three-package release pipeline (cli, contracts, desktop). All four reviewers found no MUST-level blockers. The requirements reviewer found the PR PARTIALLY COMPLETE (REQ-5 partial — docs describe the wrong runtime behavior for `npx @panctl/cli`). The correctness reviewer found two SHOULD warnings: a build-order regression that will break `npm run build` on fresh clones, and stale dist artifacts from a DTS extension change. Performance and security are clean. Three issues must be addressed before merge.

## Blockers (MUST fix before merge)

_none_

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. Docs describe wrong runtime behavior for `npx @panctl/cli` — `~`
**Raised by**: requirements
**Why it blocks**: The changed docs (README.md, introduction.mdx, quickstart.mdx, cli/overview.mdx, docs/USAGE.md) describe `npx @panctl/cli` as opening the Electron/Command Deck desktop app directly. However, `src/cli/index.ts:925–989` defaults to the browser/server launcher (`serve`), and the Electron launcher lives in `apps/desktop/bin/panctl.mjs`. Merging with this inconsistency means the published package will have misleading usage docs.

**Fix instruction**: Update the changed docs to describe `npx @panctl/cli` as launching the browser/server experience. Reserve Electron/Command Deck wording for `@panctl/desktop`.

### 2. Build order regression — `package.json:67` — `~`
**Raised by**: correctness
**Why it blocks**: `npm run build` currently runs `build:cli` before `build:contracts`. This PR changed `packages/contracts/package.json` to export from `./dist/index.mjs` instead of `./src/index.ts`. On a fresh clone (where `dist/` is gitignored and doesn't exist), `build:cli` will fail with a module resolution error because tsdown's `alwaysBundle` will follow the `@panctl/contracts` workspace symlink and find no `dist/index.mjs`.

**Fix instruction**: Reorder the build script in `package.json` to run contracts first:
```json
"build": "npm run build:contracts && npm run build:cli && npm run build:scripts && npm run build:dashboard"
```

### 3. Stale DTS extension artifacts — `packages/contracts/tsdown.config.ts:9` — `~`
**Raised by**: correctness
**Why it blocks**: The `outExtensions.dts` changed from `.d.mts` to `.d.ts`. The existing `packages/contracts/dist/` contains stale `.d.mts` files. Incremental builds will not clean the old extension, causing stale and new type declarations to coexist.

**Fix instruction**: Add a pre-build clean step for contracts dist, or ensure developers do a clean build (`rm -rf packages/contracts/dist && npm run build:contracts`) after this migration. Document this in the migration notes.

## Nits (advisory — safe to defer)

- `docs/WORKSPACE-DEPENDENCIES.md`, `docs/EXTERNAL-EVENT-STREAM.md`, `docs/prds/*` — `?` — Historical docs still reference `@panopticon/contracts`. These files were not changed by this PR, so they are out of scope, but they should be updated in a follow-up to avoid confusing new developers. (correctness)

## Cross-cutting groups

**Build pipeline ordering** (all three issues relate to the new dist-based contracts export):
- [high-2] Build order regression — `build:cli` runs before `build:contracts` which now requires `dist/`
- [high-3] Stale DTS artifacts — old `.d.mts` files coexist with new `.d.ts` in contracts dist
- [high-1] Docs inconsistency — docs describe Electron behavior but code ships browser/server

## What's good
- Import renames are thorough and complete — zero stale `@panopticon/contracts` references remain in source code
- Release pipeline correctly publishes all three packages and deprecates old npm names on stable release
- Security and performance reviews are clean with no new concerns introduced

## Review stats
- Blockers: 0   High: 3   Medium: 0   Nits: 2
- By reviewer: correctness=4, requirements=1, performance=0, security=0
- Files touched: 28+   Files with findings: 7

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the
Synthesis Context above. Those files contain full per-reviewer detail; this
synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-443 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

