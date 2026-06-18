---
specialist: review-agent
issueId: PAN-824
outcome: changes-requested
timestamp: 2026-04-26T15:11:17Z
---

# Verdict: CHANGES_REQUESTED

## Summary
This is a pure refactor to consolidate 12 scattered inline bash launcher templates into a single `generateLauncherScript()` function with typed config. The consolidation is correct in scope and structure, but the refactor introduced three `!`-severity bugs: (1) `PANOPTICON_AGENT_ID` is incorrectly unset in review agent launchers because `unsetPanopticonEnv` overrides the explicit `panopticonEnv.agentId` export; (2) `promptInline` is embedded in double-quoted shell strings without escaping, enabling command injection; (3) `workingDir` (user-controlled via `summary-fork` `cwd`) is interpolated into `cd -- "..."` without shell escaping, also enabling command injection. All three must be fixed before merge.

## Blockers (MUST fix before merge)

### 1. Review agent `PANOPTICON_AGENT_ID` is unset when it must remain set — `src/lib/cloister/review-agent.ts:531-532` + `src/lib/launcher-generator.ts` — `!`
**Raised by**: requirements, correctness
**Why it blocks**: The old code explicitly exported `PANOPTICON_AGENT_ID` to pin heartbeat hook attribution to the reviewer session directory. The new generator's `unsetPanopticonEnv` emits `unset PANOPTICON_AGENT_ID PANOPTICON_ISSUE_ID PANOPTICON_SESSION_TYPE` after the `panopticonEnv` exports, overriding the explicit `agentId` export. Reviewer heartbeats will be attributed to the parent work agent instead of the dedicated reviewer session directory.

<fix instruction>
In `generateLauncherScript()`, change `unsetPanopticonEnv` logic so it only unsets Panopticon env vars that were NOT explicitly provided via `panopticonEnv` in the same config. For the review agent call site, `PANOPTICON_AGENT_ID` should remain set while `PANOPTICON_ISSUE_ID` and `PANOPTICON_SESSION_TYPE` are unset. Concretely: collect the keys from `panopticonEnv` first, then in the unset step skip any key that was explicitly set.
</fix>

### 2. `promptInline` shell injection — `src/lib/launcher-generator.ts:307, 346` — `!`
**Raised by**: correctness, security
**Why it blocks**: `promptInline` is embedded directly inside double-quoted strings in the generated bash script. A prompt containing `$(anything)` or `"` would break the quoting and execute arbitrary shell commands. This is a command injection vulnerability reachable from any caller that passes user-influenced strings to `promptInline`.

<fix instruction>
Escape shell metacharacters in `promptInline` before embedding it in double quotes. Use: `const escaped = config.promptInline.replace(/["\\$`]/g, '\\$&'); cmd += ` "${escaped}"`;`. Apply this at both call sites (lines 307 and 346).
</fix>

### 3. `workingDir` shell injection via user-controlled `cwd` — `src/lib/launcher-generator.ts:120` + `src/dashboard/server/routes/conversations.ts:1813` — `!`
**Raised by**: security, correctness
**Why it blocks**: `POST /api/conversations/:name/summary-fork` accepts a caller-supplied `cwd` and passes it as `workingDir` to `generateLauncherScript`, which emits `cd -- "${config.workingDir}"`. A directory name containing `$(command)` passes filesystem checks and executes at script runtime. The old code used `shellQuote(...)` (single quotes) which prevented command substitution; this PR regressed that protection.

<fix instruction>
Add a `shellQuote()` helper: `return \`'${value.replace(/'/g, `'\\''`)}'\`;` and use it for the `cd --` line: `lines.push(\`cd -- \${shellQuote(config.workingDir)}\`);`. The same escaping should be applied to all dynamic shell literals emitted by the generator (env values, paths, prompt strings) rather than relying on raw double-quoted interpolation.
</fix>

## High Priority (SHOULD fix; synthesis may still approve if justified)

### 1. Non-null assertion on `generateLauncherWrapper()` return — `src/lib/cloister/specialists.ts:1109` — `~`
**Raised by**: correctness
**Why it matters**: `generateLauncherWrapper()` returns `string | null` and the call site uses `!` to suppress the null case. If `scriptLogFile` is ever missing, `writeFileSync` receives `null` coerced to `"null"`.

<fix instruction>
Add an explicit guard: `const wrapper = generateLauncherWrapper({...}); if (!wrapper) throw new Error('specialist wrapper requires useScriptWrapper + scriptLogFile'); writeFileSync(launcherScript, wrapper, ...);`
</fix>

### 2. `specialist-dispatch` silently drops extra `baseCommand` tokens — `src/lib/launcher-generator.ts:268` — `~`
**Raised by**: correctness
**Why it matters**: Only the first space-delimited token of `baseCommand` is used for `specialist-dispatch`. All other agent types preserve the full string. This behavioral inconsistency is undocumented and would silently break callers passing flags like `claude --model gpt-5.4`.

<fix instruction>
Either document the limitation or apply the same `cmd += ...` pattern used by planning/exec types so all flags are preserved.
</fix>

### 3. `includes()` dedup for permission flags can false-positive — `src/lib/launcher-generator.ts:283, 322` — `~`
**Raised by**: correctness
**Why it matters**: `flagsStr.join(' ')` as a substring of `cmd` can incorrectly match `--disallow` when checking for `--allow`, or fail to match when flags are in a different order.

<fix instruction>
Split `cmd` into tokens and check each flag individually, or remove the dedup check and let callers be responsible for no duplicates.
</fix>

### 4. Duplicated command-building logic in `buildCommand()` — `src/lib/launcher-generator.ts:274-313` vs `316-353` — `~`
**Raised by**: correctness
**Why it matters**: The `planning` branch and "all other types" branch share nearly identical flag/session/prompt construction. Any future fix (including the shell injection fixes above) must be applied in two places, risking drift.

<fix instruction>
Extract shared flag/session/prompt construction into a helper function used by both branches. This reduces the blast radius of future changes.
</fix>

## Nits (advisory — safe to defer)

- `src/lib/launcher-generator.ts:207` — `?` — `escapeForBase64` name is misleading (base64 needs no escaping) and only escapes `$`. Other shell metacharacters (backticks, double quotes) may need escaping depending on enclosing context. Rename or clarify the flag's purpose. (correctness)
- `src/lib/launcher-generator.ts:174-176` — `~` — `debugLog` exit code capture is dead code for `exec`-based agent types (the `exec` replaces the shell process so `$?` is never reached). Not harmful but unused for work/resume/review/specialist types. (correctness)
- `src/lib/launcher-generator.ts:227` — `?` MAY — `PROVIDER_ENV_UNSETS` is declared in both `launcher-generator.ts` and `cloister/specialists.ts`. Export from the generator and import in specialists. Negligible impact; filed as follow-up. (performance)
- `src/lib/launcher-generator.ts:120` — `~` — `cd -- "${config.workingDir}"` uses `--` to prevent `-` prefix interpreted as options, which is good. But `"` inside the path closes the quoting. (This is the same underlying issue as Blocker 3 — fix together.)

## Cross-cutting groups

**Shell injection root cause** (all stem from dynamic values interpolated into double-quoted shell strings without escaping — fix with a single `shellQuote()` primitive applied uniformly):
- [blocker-3] `workingDir` shell injection via `cd -- "..."`
- [blocker-2] `promptInline` shell injection via double-quoted interpolation
- [nit-5] `workingDir` double-quote inside path (same underlying issue as blocker-3)

**`unsetPanopticonEnv` ordering bug** (all stem from the same ordering issue in the generator's emit sequence):
- [blocker-1] `PANOPTICON_AGENT_ID` unset when it must remain set for review agent

**Code duplication in `buildCommand()`** (same logic copied in two branches — future fixes must apply to both):
- [high-4] Duplicated command-building logic between `planning` and other types
- [blocker-2] Shell injection fix must be applied in both branches
- [high-3] Permission flags dedup check exists in both branches

## What's good
- All 12 call sites successfully migrated to the generator — scope complete
- 18 new tests covering all 9 agent type variants — test coverage is thorough
- `grep` acceptance criterion passes — no remaining inline `#!/bin/bash` templates outside the generator and its tests
- `settings-api.ts` hoist improvement (CONVOY_TO_REVIEW_MAP at module scope) is a small correctness win from the migration
- Performance is clean — cold-path code, bounded string ops, no hot-path impact
- The refactor correctly preserves TERM/COLORTERM/LANG, pipefail, provider unset/re-export ordering, trap HUP, keep-alive loops, and script wrapper behavior

## Review stats
- Blockers: 3   High: 4   Medium: 0   Nits: 4
- By reviewer: correctness=8, security=2, performance=1, requirements=1
- Files touched: 17   Files with findings: 8

## Appendix: individual reviews

See individual reviewer output files listed in `## Reviewer Output Files` in the
Synthesis Context above. Those files contain full per-reviewer detail; this
synthesis is the policy layer.

---

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-824 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

