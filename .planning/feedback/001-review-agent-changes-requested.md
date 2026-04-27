---
specialist: review-agent
issueId: PAN-443
outcome: changes-requested
timestamp: 2026-04-27T10:21:43Z
---

# Verdict: CHANGES_REQUESTED

## Summary
PAN-443 migrates npm package names from `@panopticon/*` / `panopticon-cli` / `@eltmon/panctl` to the new `@panctl/*` scope (`@panctl/cli`, `@panctl/desktop`, `@panctl/contracts`), adds multi-package publishing to the release workflow, and updates all docs to show `npx @panctl/cli` as the canonical command. Two findings block this PR: (1) a requirements gap where `reference/architecture.mdx:223` still tells users to `npm unlink panopticon-cli`, contradicting the completed rename, and (2) a build completeness gap where all three `tsdown.config.ts` files retain the old `@panopticon/` pattern in their `alwaysBundle` option, meaning the bundled output would not correctly inline `@panctl/contracts` at publish time. All other findings are either already correct pre-existing state or are positive changes (dist-backed contracts exports).

## Blockers (MUST fix before merge)

### 1. Missing docs reference in architecture.mdx — `reference/architecture.mdx:223` — `!`
**Raised by**: requirements
**Why it blocks**: Requirements reviewer REQ-8 explicitly requires all "panopticon-cli" npm package references to be updated. The file still tells users to `npm unlink panopticon-cli` which refers to the old (now deprecated) package name — this contradicts the completed rename and misleads users who follow the docs after the migration.

<fix instruction>
Change `reference/architecture.mdx:223` from `npm unlink panopticon-cli` to `npm unlink @panctl/cli` (or remove the command entirely if the section is no longer applicable after the rename). The surrounding context should be reviewed to ensure the package-management instructions are consistent with the `@panctl/cli` canonical name throughout.
</fix>

### 2. tsdown `alwaysBundle` pattern not updated for rename — `tsdown.config.ts`, `apps/desktop/tsdown.config.ts`, `src/dashboard/server/tsdown.config.ts` — `!`
**Raised by**: correctness
**Why it blocks**: All three tsdown configs still match `@panopticon/` in their `alwaysBundle` option, which controls whether workspace local packages are inlined into the published bundle. Since the PR renamed the packages to `@panctl/contracts`, these patterns will silently stop matching — the bundled output will treat `@panctl/contracts` as an external dependency and the published npm packages will fail at runtime when `@panctl/contracts` is not installed separately. This is a build completeness gap: all import sites were renamed but the bundler configuration was missed.

<fix instruction>
Update all three `alwaysBundle` patterns to match the new scope:

```typescript
// tsdown.config.ts (root) — change line 16:
alwaysBundle: (id) => id.startsWith('@panctl/'),

// apps/desktop/tsdown.config.ts — change line 16:
alwaysBundle: (id: string) => id.startsWith("@panctl/"),

// src/dashboard/server/tsdown.config.ts — change line 13:
alwaysBundle: [/^@panctl\//],
```
</fix>

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. `catalog:` dependency in published contracts package — `packages/contracts/package.json:22` — `~`
**Raised by**: correctness
<fix instruction>
Before publishing the contracts package, replace `"effect": "catalog:"` with the resolved semver version. The release workflow should add a step that resolves `effect` from `node_modules` and writes the resolved version back into `package.json` before `npm publish`. Alternatively, hardcode the version range directly in `packages/contracts/package.json` instead of using `catalog:` — this is the simplest fix and avoids CI complexity.
</fix>

## Nits (advisory — safe to defer)

- `apps/desktop/src/updater.ts:80` — `?` — `setFeedURL` still references `repo: "panopticon-cli"`. This is correct — the GitHub repo name is unchanged — so no action needed. (correctness)
- `reference/architecture.mdx:223` — `?` — The unlink command references the old package name (covered by blocker #1 above). (correctness)
- `packages/contracts/package.json:7` — `?` — Dist-backed exports are a positive change, not a concern. (performance)

## Cross-cutting groups

**Build configuration completeness for scope rename** (all three share the same root cause: the rename touched all import sites but missed build-time configuration):
- [blocker-2] tsdown `alwaysBundle` pattern not updated for rename (`tsdown.config.ts`, `apps/desktop/tsdown.config.ts`, `src/dashboard/server/tsdown.config.ts`)
- [high-1] `catalog:` dependency in published contracts package (`packages/contracts/package.json:22`)

**These should be fixed together** — the tsdown fix restores bundling, and the `catalog:` fix ensures external consumers can install the published package. Both are part of the same "did we correctly handle build/config for the scope rename?" failure mode.

## What's good
- All 7 fully-implemented requirements are correctly done: package renames, bin wiring for both `panctl` and `pan`, contracts refactoring with no remaining `@panopticon/contracts` references, multi-package publishing in CI, deprecation of legacy packages, and docs updated to show `npx @panctl/cli`.
- Security review found zero issues — no injection paths, auth regressions, or secret exposure introduced.
- Performance review found no regressions; dist-backed contract exports are an improvement.
- Contracts version syncing added to the release command (`src/cli/commands/release.ts:386`) is correctly implemented.

## Review stats
- Blockers: 2   High: 1   Medium: 0   Nits: 3
- By reviewer: correctness=2, security=0, performance=0, requirements=1
- Files touched: 80   Files with findings: 5

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the Synthesis Context above. Those files contain full per-reviewer detail; this synthesis is the policy layer.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-443 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

