# Performance Review - PAN-709

## Summary

Scope: large PR (~9,300 LOC) adding the self-improving flywheel — skill frontmatter
contracts, skill-lint, sync audience routing, retro/synthesis/issue-filer modules
(all CLI-path code), plus bulk `audience:` frontmatter additions to ~90 SKILL.md
files and a few hook scripts.

No hot-path, server, or React code is touched. The new code runs in short-lived
CLI processes (`pan sync`, `pan admin skills audit`, flywheel commands) where
synchronous fs is explicitly allowed per `CLAUDE.md` ("CLI commands only: sync
calls are acceptable"). Overall performance risk is **low**.

**Verdict:** PASS (with minor observations below).

---

## Findings

### 🟡 Minor — Redundant frontmatter parser implementations

**Files:**
- `packages/contracts/src/skills.ts` (`parseSkillFrontmatter`)
- `src/lib/flywheel/skill-lint.ts` (`parseFrontmatter`)
- `src/lib/template.ts` (`parseSkillFrontmatter`)
- `src/lib/sync.ts` (`readSkillAudience` — regex-only for `audience:`)

**Issue:** Four separate frontmatter parsers live in the same PR that introduces
the canonical `@panopticon/contracts` `parseSkillFrontmatter`. Each traverses
SKILL.md content independently. For a one-shot `pan sync` this is negligible
(≈100 skills × a few ms), but it duplicates work and risks semantic drift
(the sync.ts regex silently defaults unknown values to `operator` while the
contracts parser throws).

**Condition to hurt:** if `pan admin skills audit` or a future server path
ever loops over skills repeatedly.

**Fix:** replace the three local parsers with `parseSkillFrontmatter` from
`@panopticon/contracts`. Single source of truth + one parse per file.
Not a blocker for this PR.

---

### 🟡 Minor — `sync.ts` reads each SKILL.md twice on the same run

**File:** `src/lib/sync.ts:313-378` (planSync) and `src/lib/sync.ts:459-478`
(executeSync).

**Issue:** `planSync()` builds an `audienceCache` but it's local to that call.
`executeSync()` re-creates its own `audienceCache` and re-reads every
SKILL.md to filter agent-only skills. A typical invocation calls plan then
execute in the same process, so every `audience:` line is parsed twice.

**Impact:** ~100 extra `readFileSync` + regex calls per `pan sync`. Likely
<50 ms total — immeasurable in practice — but trivially avoidable.

**Fix:** hoist `audienceCache` to a module-level `Map`, or have
`executeSync()` accept a prebuilt plan / cache from the caller. Not a
blocker.

---

### 🟢 OK — `extractSkillRefs` regex over full file body

**File:** `src/lib/flywheel/skill-lint.ts:73-86`

`matchAll` over the entire file content for two regexes. With ~100 skills
of a few KB each, worst case is ~200 regex passes — fine for lint gates
that run once per review. No action needed.

---

### 🟢 OK — `readdirSync` / `readFileSync` in CLI paths

All new sync fs usage is confined to CLI entry points (`sync.ts`,
`template.ts`, `skill-lint.ts`, flywheel modules) and to hook scripts.
This is explicitly sanctioned by `CLAUDE.md`'s Node-event-loop rule.
None of these modules are imported by dashboard server routes.

Verified: Grep of the new flywheel files shows no imports from
`src/dashboard/server/`.

---

### 🟢 OK — Hook scripts (`notification-hook`, `heartbeat-hook`, `pre-tool-hook`)

Bash + `jq` pipelines; per-event cost is dominated by `jq` startup (~20 ms).
Invoked at human-interaction cadence, not hot. Changes here only add small
field mutations — no new loops or sleeps.

---

## Scope / Database / Caching

- No DB queries added or modified.
- No new caching layers or cache keys.
- No React components; frontend diff is limited.
- No network calls added to request-path code.

## Recommendations (non-blocking)

1. Consolidate the four frontmatter parsers onto
   `@panopticon/contracts#parseSkillFrontmatter` in a follow-up.
2. Share the `audienceCache` between `planSync` and `executeSync`, or pass
   the plan into `executeSync` so we stop re-reading SKILL.md files.

Neither item warrants blocking this PR.
