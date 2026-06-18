# PAN-142: Consolidate to Claude Code Only - Remove Multi-Runtime Support

## Implementation Status: COMPLETE

All planned work has been implemented:

1. **paths.ts** - Removed CODEX_DIR/CURSOR_DIR/GEMINI_DIR/OPENCODE_DIR, replaced SYNC_TARGETS with SYNC_TARGET (single claude), added LEGACY_RUNTIME_DIRS for cleanup migration
2. **sync.ts** - Removed Runtime parameter from planSync()/executeSync(), uses SYNC_TARGET directly
3. **sync CLI command** - Removed runtime loop, syncs directly to Claude Code
4. **Runtime adapters** - Deleted codex.ts, cursor.ts, gemini.ts; simplified runtime/interface.ts and runtime/index.ts to claude-only
5. **Cloister RuntimeName** - Consolidated to 'claude-code' only in runtimes/types.ts and runtimes/index.ts
6. **CLI flags** - Removed --runtime from work/index.ts, cleaned up issue.ts
7. **Config** - Removed targets from OverdeckConfig sync interface, added cleanupLegacyRuntimeSymlinks() and migrateSyncTargets() to config-migration.ts
8. **restore.ts** - Updated to use SYNC_TARGET instead of SYNC_TARGETS
9. **Tests** - Updated paths, config, sync tests and fixtures; removed targets references
10. **Documentation** - Updated PRD.md and PRD-CLOISTER.md to remove multi-runtime references

TypeScript compilation passes cleanly. Test suite: 1126 passing, 2 pre-existing failures (unrelated tracker/factory tests).

## Context

Overdeck was originally designed to support multiple AI coding tools (Claude Code, Codex, Cursor, Gemini, OpenCode) with a unified sync system. This added significant complexity:

- Multiple sync targets in `paths.ts`
- Runtime adapters for each tool (`src/lib/runtime/`)
- Separate runtime types in Cloister system (`src/lib/runtimes/`)
- CLI flags for runtime selection
- Complex config management

**Decision**: Consolidate to Claude Code as the sole AI coding tool, with `claude-code-router` handling alternative model selection.

## Scope of Work

### 1. Remove Sync Targets and Runtime Adapters

#### Files to Modify:
- **`src/lib/paths.ts`**
  - Remove: `CODEX_DIR`, `CURSOR_DIR`, `GEMINI_DIR`, `OPENCODE_DIR` constants
  - Simplify: `SYNC_TARGETS` to only include `claude` entry
  - Keep: `CLAUDE_DIR` and claude sync target
  - Update: `Runtime` type to `type Runtime = 'claude';`

- **`src/lib/sync.ts`**
  - Simplify: `planSync()` and `executeSync()` - no longer need to validate runtime
  - Keep: Core sync logic for skills/commands/agents
  - Consider: Since there's only one target, could hardcode to 'claude' or still accept parameter for future extensibility

- **`src/cli/commands/sync.ts`**
  - Remove: Runtime loop (lines 70-178) - no longer iterate over targets
  - Simplify: Always sync to claude only
  - Update: User-facing messages to not mention multiple targets
  - Keep: Backup, dry-run, force flags
  - Keep: Hooks sync and git hooks sync (unrelated to runtime targets)

#### Files to Remove:
- **`src/lib/runtime/codex.ts`** - Delete entirely
- **`src/lib/runtime/cursor.ts`** - Delete entirely
- **`src/lib/runtime/gemini.ts`** - Delete entirely
- **`src/lib/runtime/index.ts`** - Check if only exports removed adapters; if so, delete entirely

### 2. Consolidate Cloister Runtime System

The Cloister system (specialist agent management) has a separate runtime abstraction in `src/lib/runtimes/` that currently supports multiple runtimes.

#### Files to Modify:
- **`src/lib/runtimes/types.ts`**
  - Change: `type RuntimeName = 'claude-code' | 'opencode' | 'codex';`
  - To: `type RuntimeName = 'claude-code';`

- **`src/lib/runtimes/index.ts`**
  - Remove: Case statements for 'opencode' and 'codex' (lines 68-73)
  - Simplify: Runtime mapping logic since there's only one option

- **`src/lib/cloister/*.ts`** (if needed)
  - Check all files importing RuntimeName
  - Update any logic that assumes multiple runtimes

### 3. Remove CLI Runtime Selection

#### Files to Modify:
- **`src/cli/commands/work/index.ts`**
  - Remove: `--runtime` flag option (line 33)
  - Remove: Any logic that uses the runtime parameter
  - Update: Help text and examples

### 4. Config Migration

#### Files to Modify:
- **`src/lib/config.ts`**
  - Remove: `targets: string[]` from `sync` config interface (line 86)
  - Simplify: Config type since sync always targets claude
  - Decision: Keep or remove the entire `targets` field?
    - **Recommended**: Remove entirely - no need to configure what's hardcoded

- **`src/lib/config-migration.ts`**
  - Add: Migration logic to handle old configs with `[sync].targets`
  - Behavior: Strip out targets field, warn if non-claude targets were configured

#### New Functionality:
- **Symlink Cleanup Migration**
  - On first run after upgrade, detect and remove Overdeck-managed symlinks from:
    - `~/.opencode/skills/`, `~/.opencode/commands/`, `~/.opencode/agents/`
    - `~/.codex/skills/`, `~/.codex/commands/`, `~/.codex/agents/`
    - `~/.cursor/skills/`, `~/.cursor/commands/`, `~/.cursor/agents/`
    - `~/.gemini/skills/`, `~/.gemini/commands/`, `~/.gemini/agents/`
  - Use existing `isOverdeckSymlink()` helper from `sync.ts`
  - Log cleanup actions to user
  - **Where to implement**:
    - Option A: Add to config migration (`config-migration.ts`)
    - Option B: Add to sync command with auto-run flag
    - **Recommended**: Add to config migration since it's a one-time upgrade task

### 5. Update Tests

#### Files to Modify:
- **`tests/integration/cli/sync.test.ts`**
  - Remove: Multi-target tests
  - Update: Mock to only include claude
  - Verify: Symlink creation still works correctly

- **`tests/fixtures/config.toml`**
  - Change: `targets = ["claude", "codex"]`
  - To: Remove targets field entirely OR `targets = ["claude"]` depending on final config design

- **Other test files**: Search for references to codex/cursor/gemini/opencode and update

### 6. Update Documentation

#### Files to Modify:
- **`docs/PRD.md`**
  - Remove: Multi-runtime examples (lines 1522, 1537, 1541)
  - Update: Sync documentation to reflect claude-only

- **`docs/PRD-CLOISTER.md`**
  - Remove: opencode from complexity_routing example (line 592-593)
  - Update: Agent runtime examples to only show claude-code

- **`docs/CONFIGURATION.md`** (if exists)
  - Update: Sync configuration examples

- **`README.md`** (if exists)
  - Update: Any multi-runtime references

### 7. Skills Documentation

#### Files to Check:
- **`skills/pan-sync/SKILL.md`**
- **`skills/pan-setup/SKILL.md`**
- **`skills/pan-config/SKILL.md`**
- Update any references to multiple runtimes or sync targets

## Technical Decisions

### 1. Keep or Remove Runtime Parameter?

**Decision**: **Remove** the Runtime type parameter entirely from sync functions.

**Rationale**:
- There's only one target, so no need to parameterize
- Simplifies the API
- Prevents confusion about extensibility
- If we ever need multi-runtime again, we can add it back

**Alternative Considered**:
- Keep Runtime type as `type Runtime = 'claude';` for future extensibility
- Rejected: YAGNI principle - adds complexity for hypothetical future needs

### 2. Config Migration Strategy

**Decision**: **Remove** `[sync].targets` field entirely from config schema.

**Rationale**:
- No user configuration needed for a hardcoded value
- Simplifies config schema and validation
- Clear migration path: strip field if present, warn if non-default

**Migration Behavior**:
```typescript
// Old config:
[sync]
targets = ["claude", "codex"]

// New config (auto-migrated):
[sync]
# targets field removed - always syncs to Claude Code
```

### 3. Symlink Cleanup Approach

**Decision**: Auto-cleanup during config migration with user notification.

### 4. Cloister Runtime Consolidation

**Decision**: Simplify RuntimeName to only 'claude-code'.

**Rationale**:
- All model selection handled by claude-code-router
- No need for runtime selection at agent spawn time
- Simplifies Cloister's agent management

## Acceptance Criteria

- [x] Only `claude` sync target remains in codebase
- [x] `CODEX_DIR`, `CURSOR_DIR`, `GEMINI_DIR`, `OPENCODE_DIR` removed from paths.ts
- [x] Runtime adapter files (codex.ts, cursor.ts, gemini.ts) deleted
- [x] `RuntimeName` type in Cloister only includes 'claude-code'
- [x] `--runtime` flag removed from CLI commands
- [x] Config migration strips `[sync].targets` field
- [x] Symlink cleanup removes Overdeck-managed links in legacy runtime dirs
- [x] All tests pass with updated fixtures (2 pre-existing failures unrelated to PAN-142)
- [x] Documentation updated to reflect claude-only approach
- [x] No references to codex/cursor/gemini/opencode as runtimes (model references intentionally preserved)

## Notes

- This is a **breaking change** for users who configured multiple sync targets
- Alternative model selection is now handled by [claude-code-router](https://github.com/musistudio/claude-code-router)
- The crash fixed in `843ad26` (opencode in config but not in SYNC_TARGETS) is fully resolved by this change
