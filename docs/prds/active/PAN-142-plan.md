# PAN-142: Remove Multi-Runtime Support — Consolidate on Claude Code

## Status: PLANNED

## Decision Log

### D1: Scope — Full removal of all non-claude runtime code
Remove sync targets AND the entire `src/lib/runtime/` adapter system (codex.ts, cursor.ts, gemini.ts). Simplify RuntimeType to just 'claude', clean up interface.ts feature flags.

### D2: Cloister types — Simplify to claude-code only
Remove `opencode` and `codex` from `RuntimeName` type union. Simplify the switch in `getRuntimeForAgent()`. Default unknown runtimes to `claude-code`.

### D3: Config — Remove targets field entirely
No config needed since there's only one target. Eliminates a class of misconfiguration bugs (the crash in 843ad26 was caused by opencode being in config but missing from SYNC_TARGETS).

### D4: Cleanup — Add one-time cleanup of old symlinks
During `pan sync`, detect and remove Panopticon-managed symlinks from `~/.opencode/`, `~/.codex/`, `~/.cursor/`, `~/.gemini/`.

## Out of Scope
- **Model routing**: References to "gemini" models and "codex" models in `router-config.ts`, `providers.ts`, `settings-api.ts`, cost calculations, etc. are about claude-code-router model support, NOT sync targets. These stay.
- **Settings API**: `gemini_thinking_level` configuration stays (it's a model parameter, not a runtime).
- **Providers/costs**: Google/OpenAI provider configs and pricing tables stay.

## Architecture

### Files to Modify

| File | Change | Difficulty |
|------|--------|------------|
| `src/lib/paths.ts` | Remove `CODEX_DIR`, `CURSOR_DIR`, `GEMINI_DIR`, `OPENCODE_DIR`, trim `SYNC_TARGETS` to claude only | simple |
| `src/lib/config.ts` | Remove `targets` from sync config, update `PanopticonConfig` interface | simple |
| `src/lib/sync.ts` | Remove multi-runtime params from `planSync`/`executeSync`, hardcode claude | medium |
| `src/cli/commands/sync.ts` | Remove config targets loop, always sync to claude | simple |
| `src/cli/commands/restore.ts` | Simplify to always use claude target | simple |
| `src/lib/runtime/interface.ts` | Remove `CODEX_FEATURES`, `CURSOR_FEATURES`, `GEMINI_FEATURES`, simplify `RuntimeType` to `'claude'` | simple |
| `src/lib/runtime/index.ts` | Remove non-claude imports/adapters, simplify registry and helper functions | simple |
| `src/lib/runtimes/types.ts` | `RuntimeName = 'claude-code'` | simple |
| `src/lib/runtimes/index.ts` | Simplify `getRuntimeForAgent` switch, remove opencode/codex cases | simple |

### Files to Delete

| File | Reason |
|------|--------|
| `src/lib/runtime/codex.ts` | Codex runtime adapter — no longer needed |
| `src/lib/runtime/cursor.ts` | Cursor runtime adapter — no longer needed |
| `src/lib/runtime/gemini.ts` | Gemini runtime adapter — no longer needed |

### Test Files to Update

| File | Change |
|------|--------|
| `tests/unit/lib/paths.test.ts` | Remove codex/cursor/gemini SYNC_TARGETS assertions, remove CODEX_DIR etc imports |
| `tests/unit/lib/config.test.ts` | Remove `targets = ["claude", "codex"]` test, update assertions |
| `tests/fixtures/config.toml` | Remove `targets` line from `[sync]` section |

## Task Breakdown

### Bead 1: Remove non-claude paths and config targets (simple)
- `paths.ts`: Remove 4 DIR exports, trim SYNC_TARGETS to claude only, update Runtime type
- `config.ts`: Remove `targets` from sync config, update PanopticonConfig interface and defaults
- Update tests: paths.test.ts, config.test.ts, fixtures/config.toml

### Bead 2: Delete runtime adapter files and simplify interface (medium)
- Delete: `src/lib/runtime/codex.ts`, `cursor.ts`, `gemini.ts`
- Simplify: `interface.ts` — remove non-claude feature sets, simplify RuntimeType
- Simplify: `index.ts` — remove non-claude adapters, simplify registry/helpers

### Bead 3: Simplify Cloister runtime types (simple)
- `runtimes/types.ts`: Change `RuntimeName` to `'claude-code'`
- `runtimes/index.ts`: Simplify `getRuntimeForAgent` — remove opencode/codex cases, default all to claude-code

### Bead 4: Simplify sync system (medium)
- `sync.ts`: Remove `runtime` parameter from `planSync`/`executeSync`, hardcode claude target
- `sync.ts` command: Remove config targets loop, always sync to claude directly
- `restore.ts`: Simplify to always use claude target paths

### Bead 5: Add old symlink cleanup (medium)
- Add `cleanupOldSyncTargets()` function to `sync.ts`
- Scans `~/.opencode/skills/`, `~/.codex/skills/`, `~/.cursor/skills/`, `~/.gemini/skills/` (and commands/, agents/)
- Removes only Panopticon-managed symlinks (uses existing `isPanopticonSymlink()`)
- Integrate into `pan sync` flow

### Bead 6: Build verification and final test pass (simple)
- Run `npm run build` — verify no compile errors
- Run full test suite — fix any remaining references
- Verify `pan sync --dry-run` works correctly

## Dependencies
- Bead 1 blocks Bead 4 (sync depends on paths/config)
- Bead 2 is independent
- Bead 3 is independent
- Bead 4 depends on Bead 1
- Bead 5 depends on Bead 4
- Bead 6 depends on all others
